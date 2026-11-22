"""Rotas privadas para videoteca do Google Drive integrada aos 170 subtemas."""
from __future__ import annotations

import configparser
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone

import requests
from flask import Blueprint, Response, g, jsonify, request, stream_with_context

from .auth import create_lesson_stream_token, require_lessons_access
from .db import db_transaction, get_db
from .services.taxonomy import find_area_for_subtema
from .timezones import DEFAULT_TZ

bp = Blueprint("lessons", __name__)

VALID_STATUSES = ("not_started", "in_progress", "completed")
MAX_BOOKMARK_SECONDS = 86400
MAX_NOTES_LEN = 10000
STREAM_CHUNK_BYTES = 256 * 1024
DEFAULT_CYCLE_PRE_QUESTIONS = 5
DEFAULT_CYCLE_POST_QUESTIONS = 25
MAX_CYCLE_PRE_QUESTIONS = 30
MAX_CYCLE_POST_QUESTIONS = 100
VALID_CYCLE_PHASES = ("pre", "post")

_DRIVE_TOKEN_CACHE: dict[str, object] = {
    "access_token": None,
    "expires_at": 0.0,
}


def _resolve_drive_oauth_credentials() -> tuple[str, str, str] | None:
    """Resolve credenciais OAuth do Google Drive via variáveis de ambiente ou rclone.conf local."""
    env_cid = (os.environ.get("GOOGLE_DRIVE_CLIENT_ID") or "").strip()
    env_csec = (os.environ.get("GOOGLE_DRIVE_CLIENT_SECRET") or "").strip()
    env_rtok = (os.environ.get("GOOGLE_DRIVE_REFRESH_TOKEN") or "").strip()
    if env_cid and env_csec and env_rtok:
        return env_cid, env_csec, env_rtok

    if os.environ.get("RENDER"):
        return None

    rclone_path = os.path.expanduser("~/.config/rclone/rclone.conf")
    if not os.path.exists(rclone_path):
        return None
    try:
        cfg = configparser.ConfigParser()
        cfg.read(rclone_path, encoding="utf-8")
        if "Drive" not in cfg:
            return None
        sec = cfg["Drive"]
        cid = (sec.get("client_id") or "").strip()
        csec = (sec.get("client_secret") or "").strip()
        tok_raw = sec.get("token") or ""
        tok_obj = json.loads(tok_raw) if tok_raw else {}
        rtok = (tok_obj.get("refresh_token") or "").strip()
        if cid and csec and rtok:
            return cid, csec, rtok
    except Exception:
        return None
    return None


def _get_drive_access_token(force_refresh: bool = False) -> str | None:
    """Obtém access_token válido para leitura (alt=media) na Google Drive API v3."""
    now = time.time()
    cached_token = _DRIVE_TOKEN_CACHE.get("access_token")
    expires_at = float(_DRIVE_TOKEN_CACHE.get("expires_at") or 0.0)
    if not force_refresh and isinstance(cached_token, str) and cached_token and now < expires_at - 90:
        return cached_token

    creds = _resolve_drive_oauth_credentials()
    if not creds:
        return None
    client_id, client_secret, refresh_token = creds
    try:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        access_token = (data.get("access_token") or "").strip()
        expires_in = int(data.get("expires_in") or 3500)
        if not access_token:
            return None
        _DRIVE_TOKEN_CACHE["access_token"] = access_token
        _DRIVE_TOKEN_CACHE["expires_at"] = now + max(120, expires_in)
        return access_token
    except Exception:
        return None


def _build_stream_url(lesson_id: int) -> str | None:
    """Constrói URL assinada para streaming direto HTML5 <video> (720p/1080p original)."""
    if not _resolve_drive_oauth_credentials():
        return None
    st = create_lesson_stream_token(
        lesson_id=lesson_id,
        user_id=str(getattr(g, "user_id", "") or ""),
        user_email=str(getattr(g, "user_email", "") or ""),
    )
    if not st:
        return None
    base = (
        os.environ.get("BACKEND_PUBLIC_URL")
        or os.environ.get("RENDER_EXTERNAL_URL")
        or ("https://medquest-188y.onrender.com" if os.environ.get("RENDER") else "")
    ).rstrip("/")
    return f"{base}/api/lessons/{lesson_id}/stream?st={st}"


@bp.after_request
def _add_private_no_store_headers(response):
    response.headers["Cache-Control"] = "private, no-store"
    return response


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_user_cycle_settings(db, user_id: str) -> dict[str, int]:
    """Retorna padrão do ciclo Medway do usuário (5q pré-aula, 25q pós-aula por padrão)."""
    defaults = {
        "default_pre_questions": DEFAULT_CYCLE_PRE_QUESTIONS,
        "default_post_questions": DEFAULT_CYCLE_POST_QUESTIONS,
    }
    try:
        row = db.execute(
            "SELECT default_pre_questions, default_post_questions FROM lesson_cycle_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    except Exception:
        return defaults
    if not row:
        return defaults
    pre_q = int(row["default_pre_questions"]) if row["default_pre_questions"] is not None else DEFAULT_CYCLE_PRE_QUESTIONS
    post_q = int(row["default_post_questions"]) if row["default_post_questions"] is not None else DEFAULT_CYCLE_POST_QUESTIONS
    return {
        "default_pre_questions": max(0, min(MAX_CYCLE_PRE_QUESTIONS, pre_q)),
        "default_post_questions": max(1, min(MAX_CYCLE_POST_QUESTIONS, post_q)),
    }


def _serialize_cycle_row(row, settings: dict[str, int]) -> dict:
    pre_target = int(row["pre_target"] if row["pre_target"] is not None else settings["default_pre_questions"])
    post_target = int(row["post_target"] if row["post_target"] is not None else settings["default_post_questions"])
    pre_completed = int(row["pre_completed"] or 0)
    pre_correct = int(row["pre_correct"] or 0)
    post_completed = int(row["post_completed"] or 0)
    post_correct = int(row["post_correct"] or 0)
    return {
        "subtema": row["subtema"],
        "pre_target": pre_target,
        "pre_completed": pre_completed,
        "pre_correct": pre_correct,
        "pre_accuracy": round((pre_correct / pre_completed) * 100) if pre_completed > 0 else None,
        "pre_done": bool(row["pre_done"]),
        "pre_completed_at": row["pre_completed_at"],
        "post_target": post_target,
        "post_completed": post_completed,
        "post_correct": post_correct,
        "post_accuracy": round((post_correct / post_completed) * 100) if post_completed > 0 else None,
        "post_done": bool(row["post_done"]),
        "post_completed_at": row["post_completed_at"],
        "updated_at": row["updated_at"],
    }


def _get_user_cycles_map(
    db, user_id: str, settings: dict[str, int], subtema: str | None = None
) -> dict[str, dict]:
    try:
        if subtema:
            rows = db.execute(
                "SELECT * FROM lesson_study_cycle WHERE user_id = ? AND subtema = ?",
                (user_id, subtema),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM lesson_study_cycle WHERE user_id = ?",
                (user_id,),
            ).fetchall()
    except Exception:
        return {}
    return {r["subtema"]: _serialize_cycle_row(r, settings) for r in rows}


def _norm_text(value: str | None) -> str:
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFD", str(value))
    without_accents = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(without_accents.lower().split())


_SEARCH_STOPWORDS = frozenset({"a", "o", "e", "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "com", "por", "para"})
_PREVENTIVA_AREA_ALIASES = ("Preventiva", "Medicina Preventiva", "Medicina Preventiva e Social")
_CIRURGIA_AREA_ALIASES = ("Cirurgia", "Cirurgia Geral")


def _norm_search_text(value: str | None) -> str:
    base = _norm_text(value)
    if not base:
        return ""
    return " ".join(re.findall(r"[a-z0-9]+", base))


def _tokenize_search_query(q_norm: str) -> list[str]:
    raw_tokens = [tok for tok in q_norm.split() if tok]
    if not raw_tokens:
        return []
    filtered = [tok for tok in raw_tokens if len(tok) >= 2 and tok not in _SEARCH_STOPWORDS]
    return filtered or raw_tokens


def _lesson_search_rank(item: dict, q_norm: str, q_tokens: list[str]) -> tuple[int, int, int, int, int] | None:
    title_norm = _norm_search_text(item["title"])
    title_sub = _norm_search_text(f"{item['title']} {item['subtema'] or ''}")
    full_haystack = _norm_search_text(
        f"{item['title']} {item['module_name']} {item['subtema'] or ''} {item['specialty']} {item['area']} {item['course_name']}"
    )
    in_title_exact = q_norm in title_norm
    in_title_all = bool(q_tokens) and all(tok in title_norm for tok in q_tokens)
    in_title_sub_exact = q_norm in title_sub
    in_title_sub_all = bool(q_tokens) and all(tok in title_sub for tok in q_tokens)
    in_full_exact = q_norm in full_haystack
    in_full_all = bool(q_tokens) and all(tok in full_haystack for tok in q_tokens)

    if not (in_title_sub_exact or in_title_sub_all or in_full_exact or in_full_all):
        return None

    scope_tier = 0 if (in_title_sub_exact or in_title_sub_all) else 1
    track_extra = 1 if item["is_extra"] else 0
    track_optional = 0 if item["is_essential"] else 1
    title_hits = sum(1 for tok in q_tokens if tok in title_norm)
    if in_title_exact:
        detail_tier = 0
    elif in_title_all:
        detail_tier = 1
    elif in_title_sub_exact:
        detail_tier = 2
    elif in_title_sub_all:
        detail_tier = 3
    elif in_full_exact:
        detail_tier = 4
    else:
        detail_tier = 5
    return (scope_tier, track_extra, track_optional, detail_tier, -title_hits)


def _extract_progress_fields(row) -> tuple[str, int, str, str | None, str | None]:
    keys = row.keys() if hasattr(row, "keys") else []
    status = row["progress_status"] if "progress_status" in keys and row["progress_status"] else "not_started"
    bookmark = row["bookmark_seconds"] if "bookmark_seconds" in keys and row["bookmark_seconds"] is not None else 0
    notes = row["notes"] if "notes" in keys and row["notes"] is not None else ""
    completed_at = row["completed_at"] if "completed_at" in keys else None
    progress_updated_at = row["progress_updated_at"] if "progress_updated_at" in keys else None
    return status, int(bookmark or 0), notes, completed_at, progress_updated_at


def _serialize_lesson(row) -> dict:
    drive_file_id = row["drive_file_id"]
    status, bookmark, notes, completed_at, progress_updated_at = _extract_progress_fields(row)

    return {
        "id": row["id"],
        "course_key": row["course_key"],
        "course_name": row["course_name"],
        "is_extra": bool(row["is_extra"]),
        "area": row["area"],
        "specialty": row["specialty"] or "",
        "subtema": row["subtema"],
        "module_name": row["module_name"],
        "module_order": int(row["module_order"] or 0),
        "title": row["title"],
        "lesson_order": int(row["lesson_order"] or 0),
        "lesson_kind": row["lesson_kind"] or "aula",
        "is_essential": bool(row["is_essential"]),
        "media_type": row["media_type"] or "video",
        "provider": row["provider"] or "gdrive",
        "drive_file_id": drive_file_id,
        "drive_path": row["drive_path"],
        "size_bytes": int(row["size_bytes"] or 0),
        "duration_seconds": row["duration_seconds"],
        "preview_url": f"https://drive.google.com/file/d/{drive_file_id}/preview",
        "open_url": f"https://drive.google.com/file/d/{drive_file_id}/view",
        "progress": {
            "status": status,
            "bookmark_seconds": bookmark,
            "notes": notes,
            "has_notes": bool(notes.strip()),
            "completed_at": completed_at,
            "updated_at": progress_updated_at,
        },
    }


def _serialize_lesson_list_item(row) -> dict:
    """Versão enxuta para listagem (reduz payload omitindo URLs deriváveis, path e texto de notas)."""
    status, bookmark, notes, completed_at, progress_updated_at = _extract_progress_fields(row)

    return {
        "id": row["id"],
        "course_key": row["course_key"],
        "course_name": row["course_name"],
        "is_extra": bool(row["is_extra"]),
        "area": row["area"],
        "specialty": row["specialty"] or "",
        "subtema": row["subtema"],
        "module_name": row["module_name"],
        "module_order": int(row["module_order"] or 0),
        "title": row["title"],
        "lesson_order": int(row["lesson_order"] or 0),
        "lesson_kind": row["lesson_kind"] or "aula",
        "is_essential": bool(row["is_essential"]),
        "drive_file_id": row["drive_file_id"],
        "duration_seconds": row["duration_seconds"],
        "progress": {
            "status": status,
            "bookmark_seconds": bookmark,
            "has_notes": bool(notes.strip()),
            "completed_at": completed_at,
            "updated_at": progress_updated_at,
        },
    }


def _sync_theme_theory_if_completed(db, user_id: str, subtema: str) -> bool:
    """Marca theory_completed=1 quando todas as aulas primárias essenciais do subtema forem concluídas."""
    if not subtema or not find_area_for_subtema(subtema):
        return False

    row = db.execute(
        """
        SELECT
            COUNT(*) AS total_essential,
            SUM(CASE WHEN COALESCE(lp.status, 'not_started') = 'completed' THEN 1 ELSE 0 END) AS completed_essential
        FROM lessons l
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
        WHERE l.subtema = ? AND l.active = 1 AND l.is_extra = 0 AND l.is_essential = 1
        """,
        (user_id, subtema),
    ).fetchone()

    total = int(row["total_essential"] or 0) if row else 0
    completed = int(row["completed_essential"] or 0) if row else 0
    if total <= 0 or completed < total:
        return False

    now = _now_iso()
    db.execute(
        """
        INSERT INTO theme_progress (user_id, subtema, theory_completed, study_path, updated_at)
        VALUES (?, ?, 1, 'essential', ?)
        ON CONFLICT(user_id, subtema) DO UPDATE SET
            theory_completed = 1,
            updated_at = excluded.updated_at
        """,
        (user_id, subtema, now),
    )
    return True


_BASE_LESSON_SELECT = """
    SELECT
        l.*,
        lp.status AS progress_status,
        lp.bookmark_seconds AS bookmark_seconds,
        lp.notes AS notes,
        lp.completed_at AS completed_at,
        lp.updated_at AS progress_updated_at
    FROM lessons l
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
"""

_LIST_LESSON_SELECT = """
    SELECT
        l.id, l.course_key, l.course_name, l.is_extra, l.area, l.specialty,
        l.subtema, l.module_name, l.module_order, l.title, l.lesson_order,
        l.lesson_kind, l.is_essential, l.drive_file_id, l.duration_seconds,
        lp.status AS progress_status,
        lp.bookmark_seconds AS bookmark_seconds,
        (CASE WHEN lp.notes IS NOT NULL AND lp.notes != '' THEN '1' ELSE '' END) AS notes,
        lp.completed_at AS completed_at,
        lp.updated_at AS progress_updated_at
    FROM lessons l
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
"""


@bp.route("/lessons", methods=["GET"])
@require_lessons_access
def list_lessons():
    db = get_db()
    user_id = str(g.user_id)

    course = (request.args.get("course") or "all").strip()
    area = (request.args.get("area") or "").strip()
    subtema = (request.args.get("subtema") or "").strip()
    q = (request.args.get("q") or "").strip()
    status_filter = (request.args.get("status") or "all").strip()
    essential_only = (request.args.get("essential_only") or "").strip().lower() in ("1", "true", "yes")
    limit_param = (request.args.get("limit") or "").strip()
    limit_val: int | None = None
    if limit_param:
        try:
            parsed_limit = int(limit_param)
            if parsed_limit > 0:
                limit_val = min(parsed_limit, 200)
        except (ValueError, TypeError):
            limit_val = None

    where = ["l.active = 1"]
    params: list = [user_id]

    if course and course != "all":
        where.append("l.course_key = ?")
        params.append(course)
    if area:
        if area in _PREVENTIVA_AREA_ALIASES:
            where.append("l.area IN (?, ?, ?)")
            params.extend(_PREVENTIVA_AREA_ALIASES)
        elif area in _CIRURGIA_AREA_ALIASES:
            where.append("l.area IN (?, ?)")
            params.extend(_CIRURGIA_AREA_ALIASES)
        else:
            where.append("l.area = ?")
            params.append(area)
    if subtema:
        where.append("l.subtema = ?")
        params.append(subtema)
    if essential_only:
        where.append("l.is_essential = 1")

    sql = (
        _LIST_LESSON_SELECT
        + " WHERE "
        + " AND ".join(where)
        + " ORDER BY l.is_extra ASC, l.module_order ASC, l.module_name ASC, l.lesson_order ASC, l.id ASC"
    )
    rows = db.execute(sql, tuple(params)).fetchall()

    q_norm = _norm_search_text(q)
    q_tokens = _tokenize_search_query(q_norm) if q_norm else []
    ranked_lessons: list[tuple[tuple[int, int, int, int, int], dict]] = []
    lessons_out: list[dict] = []
    areas_set: set[str] = set()
    by_course_map: dict[str, dict] = {}
    counts = {
        "total": 0,
        "completed": 0,
        "in_progress": 0,
        "not_started": 0,
        "total_duration_seconds": 0,
        "remaining_duration_seconds": 0,
    }

    for row in rows:
        item = _serialize_lesson_list_item(row)
        item_status = item["progress"]["status"]

        rank: tuple[int, int, int, int, int] = (0, 0, 0, 0, 0)
        if q_norm:
            matched_rank = _lesson_search_rank(item, q_norm, q_tokens)
            if matched_rank is None:
                continue
            rank = matched_rank

        if status_filter == "pending":
            if item_status == "completed":
                continue
        elif status_filter in VALID_STATUSES:
            if item_status != status_filter:
                continue

        if q_norm:
            ranked_lessons.append((rank, item))
        else:
            lessons_out.append(item)
        if item["area"]:
            areas_set.add(item["area"])

        dur = int(item["duration_seconds"] or 0)
        counts["total"] += 1
        counts[item_status] = counts.get(item_status, 0) + 1
        counts["total_duration_seconds"] += dur
        if item_status != "completed":
            counts["remaining_duration_seconds"] += dur

        ckey = item["course_key"]
        if ckey not in by_course_map:
            by_course_map[ckey] = {
                "course_key": ckey,
                "course_name": item["course_name"],
                "is_extra": item["is_extra"],
                "total": 0,
                "completed": 0,
                "in_progress": 0,
            }
        by_course_map[ckey]["total"] += 1
        if item_status == "completed":
            by_course_map[ckey]["completed"] += 1
        elif item_status == "in_progress":
            by_course_map[ckey]["in_progress"] += 1

    if q_norm:
        ranked_lessons.sort(
            key=lambda pair: (
                pair[0],
                1 if pair[1]["is_extra"] else 0,
                0 if pair[1]["is_essential"] else 1,
                pair[1]["module_order"],
                pair[1]["lesson_order"],
                pair[1]["id"],
            )
        )
        lessons_out = [item for _, item in ranked_lessons]

    if limit_val is not None:
        lessons_out = lessons_out[:limit_val]

    return jsonify({
        "lessons": lessons_out,
        "summary": {
            **counts,
            "by_course": sorted(by_course_map.values(), key=lambda c: (c["is_extra"], c["course_name"])),
            "areas": sorted(areas_set),
        },
    })


def _parse_start_date_local(raw: str):
    cleaned = (raw or "").strip()
    if not cleaned:
        raise ValueError("empty start_date")
    if len(cleaned) == 10 and cleaned[4] == "-" and cleaned[7] == "-":
        return datetime.strptime(cleaned, "%Y-%m-%d").date()
    dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        return dt.astimezone(DEFAULT_TZ).date()
    return dt.date()


def _get_current_planner_week_subtemas(
    db, user_id: str, requested_mode: str | None = None
) -> tuple[int | None, list[str]]:
    """Retorna (semana_atual, [subtemas]) no fuso America/Sao_Paulo, sem avançar para semanas futuras."""
    try:
        cfg = db.execute(
            "SELECT * FROM planner_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    except Exception:
        return None, []
    if not cfg:
        return None, []

    cfg_keys = cfg.keys() if hasattr(cfg, "keys") else []
    start_raw = str(cfg["start_date"] or "") if "start_date" in cfg_keys else ""
    try:
        start_dt = _parse_start_date_local(start_raw)
        today_dt = datetime.now(DEFAULT_TZ).date()
        week_num = max(1, (today_dt - start_dt).days // 7 + 1)
    except ValueError:
        week_num = 1

    org_raw = cfg["organization_mode"] if "organization_mode" in cfg_keys else "geral"
    org = "internato" if org_raw == "internato" else "geral"

    valid_modes = {"geral_standard", "geral_intensive", "internato_standard", "internato_intensive"}
    active_mode = requested_mode if requested_mode in valid_modes else f"{org}_standard"

    try:
        rows = db.execute(
            """
            SELECT subtema FROM planner_schedule
            WHERE user_id = ? AND mode = ? AND week = ?
            ORDER BY display_order ASC
            """,
            (user_id, active_mode, week_num),
        ).fetchall()

        if not rows and requested_mode not in valid_modes:
            # Fallback determinístico para o modo mais recentemente criado dentro da mesma organização
            fallback_mode_row = db.execute(
                """
                SELECT mode FROM planner_schedule
                WHERE user_id = ? AND mode LIKE ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (user_id, f"{org}_%"),
            ).fetchone()
            if not fallback_mode_row:
                fallback_mode_row = db.execute(
                    """
                    SELECT mode FROM planner_schedule
                    WHERE user_id = ?
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (user_id,),
                ).fetchone()
            if fallback_mode_row and fallback_mode_row["mode"] != active_mode:
                rows = db.execute(
                    """
                    SELECT subtema FROM planner_schedule
                    WHERE user_id = ? AND mode = ? AND week = ?
                    ORDER BY display_order ASC
                    """,
                    (user_id, fallback_mode_row["mode"], week_num),
                ).fetchall()
    except Exception:
        return week_num, []

    return week_num, [r["subtema"] for r in rows if r["subtema"]]


@bp.route("/lessons/summary-by-subtema", methods=["GET"])
@require_lessons_access
def lessons_summary_by_subtema():
    db = get_db()
    user_id = str(g.user_id)
    rows = db.execute(
        """
        SELECT
            l.id,
            l.course_key,
            l.subtema,
            l.is_extra,
            l.is_essential,
            l.duration_seconds,
            COALESCE(lp.status, 'not_started') AS progress_status
        FROM lessons l
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
        WHERE l.active = 1 AND l.subtema IS NOT NULL AND l.subtema != ''
        ORDER BY l.is_extra ASC, l.is_essential DESC, l.module_order ASC, l.lesson_order ASC, l.id ASC
        """,
        (user_id,),
    ).fetchall()

    theme_rows = db.execute(
        "SELECT subtema, theory_completed FROM theme_progress WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    theme_completed_map = {r["subtema"]: bool(r["theory_completed"]) for r in theme_rows}
    cycle_settings = _get_user_cycle_settings(db, user_id)
    cycles_map = _get_user_cycles_map(db, user_id, cycle_settings)

    subtemas: dict[str, dict] = {}
    fallback_next_any_main: dict[str, int] = {}
    fallback_next_non_extra: dict[str, int] = {}
    fallback_next_any: dict[str, int] = {}

    for row in rows:
        sub = row["subtema"]
        entry = subtemas.setdefault(sub, {
            "total": 0,
            "completed": 0,
            "essential_total": 0,
            "essential_completed": 0,
            "medway_optional_total": 0,
            "medway_optional_completed": 0,
            "extra_total": 0,
            "extra_completed": 0,
            "total_duration_seconds": 0,
            "remaining_duration_seconds": 0,
            "theory_completed": bool(theme_completed_map.get(sub, False)),
            "essential_all_completed": False,
            "next_lesson_id": None,
            "cycle": cycles_map.get(sub),
        })
        is_completed = row["progress_status"] == "completed"
        is_extra = bool(row["is_extra"])
        is_essential = bool(row["is_essential"])
        is_medway = row["course_key"] == "medway_r1_2026"
        is_medway_main = is_medway and is_essential
        is_medway_optional = is_medway and not is_essential
        dur = int(row["duration_seconds"] or 0)

        entry["total"] += 1
        if is_completed:
            entry["completed"] += 1

        if sub not in fallback_next_any:
            fallback_next_any[sub] = row["id"]
        if not is_extra and sub not in fallback_next_non_extra:
            fallback_next_non_extra[sub] = row["id"]

        if is_medway_main:
            if sub not in fallback_next_any_main:
                fallback_next_any_main[sub] = row["id"]
            if not is_completed and entry["next_lesson_id"] is None:
                entry["next_lesson_id"] = row["id"]
            entry["essential_total"] += 1
            entry["total_duration_seconds"] += dur
            if is_completed:
                entry["essential_completed"] += 1
            else:
                entry["remaining_duration_seconds"] += dur
        elif is_medway_optional:
            entry["medway_optional_total"] += 1
            if is_completed:
                entry["medway_optional_completed"] += 1
        elif is_extra:
            entry["extra_total"] += 1
            if is_completed:
                entry["extra_completed"] += 1

    for sub, entry in subtemas.items():
        entry["essential_all_completed"] = bool(
            entry["essential_total"] > 0 and entry["essential_completed"] >= entry["essential_total"]
        )
        if entry["next_lesson_id"] is None:
            entry["next_lesson_id"] = (
                fallback_next_any_main.get(sub)
                or fallback_next_non_extra.get(sub)
                or fallback_next_any.get(sub)
            )

    return jsonify({"subtemas": subtemas, "cycle_settings": cycle_settings})


@bp.route("/lessons/current-week", methods=["GET"])
@require_lessons_access
def lessons_current_week():
    db = get_db()
    requested_mode = (request.args.get("mode") or "").strip() or None
    week_num, subtemas = _get_current_planner_week_subtemas(db, str(g.user_id), requested_mode=requested_mode)
    return jsonify({"week": week_num, "subtemas": subtemas})


@bp.route("/lessons/continue", methods=["GET"])
@require_lessons_access
def lessons_continue():
    db = get_db()
    user_id = str(g.user_id)

    stats_row = db.execute(
        """
        SELECT
            COUNT(*) AS primary_total,
            SUM(CASE WHEN COALESCE(lp.status, 'not_started') = 'completed' THEN 1 ELSE 0 END) AS primary_completed,
            SUM(CASE WHEN COALESCE(lp.status, 'not_started') != 'completed' THEN COALESCE(l.duration_seconds, 0) ELSE 0 END) AS primary_remaining_seconds
        FROM lessons l
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
        WHERE l.active = 1 AND l.course_key = 'medway_r1_2026' AND l.is_essential = 1
        """,
        (user_id,),
    ).fetchone()
    stats = {
        "primary_total": int(stats_row["primary_total"] or 0) if stats_row else 0,
        "primary_completed": int(stats_row["primary_completed"] or 0) if stats_row else 0,
        "primary_remaining_seconds": int(stats_row["primary_remaining_seconds"] or 0) if stats_row else 0,
    }

    # 1. Prioridade: última aula em andamento
    in_prog_row = db.execute(
        _BASE_LESSON_SELECT
        + " WHERE l.active = 1 AND lp.status = 'in_progress'"
        + " ORDER BY lp.updated_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if in_prog_row:
        return jsonify({
            "lesson": _serialize_lesson(in_prog_row),
            "reason": "in_progress",
            "planner_week": None,
            "stats": stats,
        })

    # 2. Segunda prioridade: primeira aula essencial pendente da semana atual do Planner
    week_num, week_subtemas = _get_current_planner_week_subtemas(db, user_id)
    if week_subtemas:
        placeholders = ",".join("?" for _ in week_subtemas)
        planner_row = db.execute(
            _BASE_LESSON_SELECT
            + f" WHERE l.active = 1 AND l.is_extra = 0 AND l.is_essential = 1 AND l.subtema IN ({placeholders})"
            + " AND COALESCE(lp.status, 'not_started') != 'completed'"
            + " ORDER BY l.module_order ASC, l.lesson_order ASC, l.id ASC LIMIT 1",
            (user_id, *week_subtemas),
        ).fetchone()
        if planner_row:
            return jsonify({
                "lesson": _serialize_lesson(planner_row),
                "reason": "planner_week",
                "planner_week": week_num,
                "stats": stats,
            })

    # 3. Fallback: primeira aula essencial pendente do Extensivo R1
    next_row = db.execute(
        _BASE_LESSON_SELECT
        + " WHERE l.active = 1 AND l.is_extra = 0 AND l.is_essential = 1"
        + " AND COALESCE(lp.status, 'not_started') != 'completed'"
        + " ORDER BY l.module_order ASC, l.lesson_order ASC, l.id ASC LIMIT 1",
        (user_id,),
    ).fetchone()
    if next_row:
        return jsonify({
            "lesson": _serialize_lesson(next_row),
            "reason": "next_pending",
            "planner_week": week_num,
            "stats": stats,
        })

    return jsonify({"lesson": None, "reason": None, "planner_week": week_num, "stats": stats})


@bp.route("/lessons/notes", methods=["GET"])
@require_lessons_access
def list_lesson_notes():
    """Lista todas as anotações salvas em aulas do usuário autenticado (para o Caderno Inteligente)."""
    db = get_db()
    user_id = str(g.user_id)
    area = (request.args.get("area") or "").strip()
    q = (request.args.get("q") or "").strip()

    where = [
        "lp.user_id = ?",
        "l.active = 1",
        "TRIM(COALESCE(lp.notes, '')) != ''",
    ]
    params: list = [user_id]
    if area:
        if area in _PREVENTIVA_AREA_ALIASES:
            where.append("l.area IN (?, ?, ?)")
            params.extend(_PREVENTIVA_AREA_ALIASES)
        elif area in _CIRURGIA_AREA_ALIASES:
            where.append("l.area IN (?, ?)")
            params.extend(_CIRURGIA_AREA_ALIASES)
        else:
            where.append("l.area = ?")
            params.append(area)

    rows = db.execute(
        f"""
        SELECT
            l.id AS lesson_id,
            l.title,
            l.course_key,
            l.course_name,
            l.is_extra,
            l.is_essential,
            l.area,
            l.specialty,
            l.subtema,
            l.module_name,
            lp.status,
            lp.bookmark_seconds,
            lp.notes,
            lp.updated_at
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id
        WHERE {' AND '.join(where)}
        ORDER BY lp.updated_at DESC, l.id DESC
        """,
        tuple(params),
    ).fetchall()

    q_norm = _norm_search_text(q)
    q_tokens = _tokenize_search_query(q_norm) if q_norm else []
    notes_out: list[dict] = []

    for r in rows:
        note_text = (r["notes"] or "").strip()
        if not note_text:
            continue
        if q_norm:
            haystack = _norm_search_text(
                f"{note_text} {r['title']} {r['subtema'] or ''} {r['module_name']} {r['specialty'] or ''} {r['area']} {r['course_name']}"
            )
            if q_norm not in haystack and not (q_tokens and all(tok in haystack for tok in q_tokens)):
                continue
        notes_out.append({
            "lesson_id": r["lesson_id"],
            "title": r["title"],
            "course_key": r["course_key"],
            "course_name": r["course_name"],
            "is_extra": bool(r["is_extra"]),
            "is_essential": bool(r["is_essential"]),
            "area": r["area"],
            "specialty": r["specialty"] or "",
            "subtema": r["subtema"],
            "module_name": r["module_name"],
            "status": r["status"] or "not_started",
            "bookmark_seconds": int(r["bookmark_seconds"] or 0),
            "notes": note_text,
            "updated_at": r["updated_at"],
        })

    return jsonify({"notes": notes_out})


@bp.route("/lessons/by-subtema", methods=["GET"])
@require_lessons_access
def lessons_by_subtema():
    subtema = (request.args.get("subtema") or "").strip()
    if not subtema:
        return jsonify({"error": "Parâmetro 'subtema' é obrigatório."}), 400

    db = get_db()
    user_id = str(g.user_id)
    rows = db.execute(
        _BASE_LESSON_SELECT
        + " WHERE l.active = 1 AND l.subtema = ?"
        + " ORDER BY l.is_extra ASC, l.is_essential DESC, l.module_order ASC, l.lesson_order ASC, l.id ASC",
        (user_id, subtema),
    ).fetchall()

    primary: list[dict] = []
    extras: list[dict] = []
    progress = {
        "total": 0,
        "completed": 0,
        "essential_total": 0,
        "essential_completed": 0,
        "extra_total": 0,
        "extra_completed": 0,
    }

    for row in rows:
        item = _serialize_lesson(row)
        is_completed = item["progress"]["status"] == "completed"
        progress["total"] += 1
        if is_completed:
            progress["completed"] += 1

        if item["is_extra"]:
            extras.append(item)
            progress["extra_total"] += 1
            if is_completed:
                progress["extra_completed"] += 1
        else:
            primary.append(item)
            if item["is_essential"]:
                progress["essential_total"] += 1
                if is_completed:
                    progress["essential_completed"] += 1

    return jsonify({
        "subtema": subtema,
        "primary": primary,
        "extras": extras,
        "progress": progress,
    })


@bp.route("/lessons/<int:lesson_id>", methods=["GET"])
@require_lessons_access
def get_lesson_detail(lesson_id: int):
    db = get_db()
    user_id = str(g.user_id)
    row = db.execute(
        _BASE_LESSON_SELECT + " WHERE l.id = ? AND l.active = 1",
        (user_id, lesson_id),
    ).fetchone()
    if not row:
        return jsonify({"error": "Aula não encontrada."}), 404

    lesson = _serialize_lesson(row)
    lesson["stream_url"] = _build_stream_url(lesson["id"])
    if lesson["subtema"]:
        sibling_rows = db.execute(
            _BASE_LESSON_SELECT
            + " WHERE l.active = 1 AND l.subtema = ?"
            + " ORDER BY l.is_extra ASC, l.is_essential DESC, l.module_order ASC, l.lesson_order ASC, l.id ASC",
            (user_id, lesson["subtema"]),
        ).fetchall()
    else:
        sibling_rows = db.execute(
            _BASE_LESSON_SELECT
            + " WHERE l.active = 1 AND l.course_key = ? AND l.module_name = ?"
            + " ORDER BY l.module_order ASC, l.lesson_order ASC, l.id ASC",
            (user_id, lesson["course_key"], lesson["module_name"]),
        ).fetchall()

    playlist = [_serialize_lesson(r) for r in sibling_rows]
    cycle_settings = _get_user_cycle_settings(db, user_id)
    cycle = None
    if lesson["subtema"]:
        cycle = _get_user_cycles_map(db, user_id, cycle_settings, subtema=lesson["subtema"]).get(lesson["subtema"])
    return jsonify({
        "lesson": lesson,
        "playlist": playlist,
        "cycle": cycle,
        "cycle_settings": cycle_settings,
    })


@bp.route("/lessons/<int:lesson_id>/stream", methods=["GET"])
@require_lessons_access
def stream_lesson_video(lesson_id: int):
    """Faz proxy de streaming HTTP 206 (Range) do arquivo .mp4 original (720p/1080p) da Google Drive API v3."""
    db = get_db()
    row = db.execute(
        "SELECT id, drive_file_id, size_bytes FROM lessons WHERE id = ? AND active = 1",
        (lesson_id,),
    ).fetchone()
    if not row or not row["drive_file_id"]:
        return jsonify({"error": "Aula não encontrada."}), 404

    access_token = _get_drive_access_token(force_refresh=False)
    if not access_token:
        return jsonify({"error": "Stream direto do Google Drive não configurado."}), 503

    drive_url = f"https://www.googleapis.com/drive/v3/files/{row['drive_file_id']}?alt=media"
    range_header = request.headers.get("Range")

    def _open_upstream(token: str):
        req_headers = {"Authorization": f"Bearer {token}"}
        if range_header:
            req_headers["Range"] = range_header
        return requests.get(drive_url, headers=req_headers, stream=True, timeout=(10, 60))

    try:
        upstream = _open_upstream(access_token)
        if upstream.status_code == 401:
            upstream.close()
            refreshed = _get_drive_access_token(force_refresh=True)
            if not refreshed:
                return jsonify({"error": "Falha ao renovar autorização do Google Drive."}), 503
            upstream = _open_upstream(refreshed)
    except Exception:
        return jsonify({"error": "Erro de conexão com o Google Drive."}), 502

    if upstream.status_code not in (200, 206):
        status_code = upstream.status_code
        upstream.close()
        return jsonify({"error": f"Google Drive respondeu HTTP {status_code}."}), 502

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=STREAM_CHUNK_BYTES):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    resp = Response(stream_with_context(generate()), status=upstream.status_code)
    resp.headers["Content-Type"] = upstream.headers.get("Content-Type") or "video/mp4"
    resp.headers["Accept-Ranges"] = "bytes"
    resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    resp.headers["Cache-Control"] = "private, no-store"
    for hdr in ("Content-Length", "Content-Range"):
        val = upstream.headers.get(hdr)
        if val:
            resp.headers[hdr] = val
    return resp


@bp.route("/lessons/<int:lesson_id>/progress", methods=["PUT"])
@require_lessons_access
def update_lesson_progress(lesson_id: int):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Payload JSON inválido."}), 400

    if "status" in payload and payload["status"] is not None:
        if payload["status"] not in VALID_STATUSES:
            return jsonify({"error": "Status inválido. Use not_started, in_progress ou completed."}), 400

    if "bookmark_seconds" in payload and payload["bookmark_seconds"] is not None:
        raw_bookmark = payload["bookmark_seconds"]
        if type(raw_bookmark) is not int or raw_bookmark < 0 or raw_bookmark > MAX_BOOKMARK_SECONDS:
            return jsonify({"error": "bookmark_seconds deve ser um inteiro entre 0 e 86400."}), 400

    if "notes" in payload and payload["notes"] is not None:
        if not isinstance(payload["notes"], str):
            return jsonify({"error": "notes deve ser texto."}), 400

    sync_theme_theory = payload.get("sync_theme_theory", True)
    if type(sync_theme_theory) is not bool:
        return jsonify({"error": "sync_theme_theory deve ser booleano."}), 400

    db = get_db()
    user_id = str(g.user_id)
    now = _now_iso()
    theme_theory_completed = False

    with db_transaction(db, immediate=True):
        lesson_row = db.execute(
            "SELECT id, subtema, is_extra FROM lessons WHERE id = ? AND active = 1",
            (lesson_id,),
        ).fetchone()
        if not lesson_row:
            return jsonify({"error": "Aula não encontrada."}), 404

        existing = db.execute(
            "SELECT status, bookmark_seconds, notes, completed_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?",
            (user_id, lesson_id),
        ).fetchone()
        prev_status = existing["status"] if existing else "not_started"

        if "status" in payload and payload["status"] is not None:
            status = payload["status"]
        else:
            status = prev_status

        if "bookmark_seconds" in payload and payload["bookmark_seconds"] is not None:
            bookmark_seconds = payload["bookmark_seconds"]
        else:
            bookmark_seconds = int(existing["bookmark_seconds"] or 0) if existing else 0

        if "notes" in payload and payload["notes"] is not None:
            notes = payload["notes"][:MAX_NOTES_LEN]
        else:
            notes = existing["notes"] if existing else ""

        if status == "completed":
            completed_at = (existing["completed_at"] if existing and existing["completed_at"] else None) or now
        else:
            completed_at = None

        db.execute(
            """
            INSERT INTO lesson_progress (user_id, lesson_id, status, bookmark_seconds, notes, completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, lesson_id) DO UPDATE SET
                status = excluded.status,
                bookmark_seconds = excluded.bookmark_seconds,
                notes = excluded.notes,
                completed_at = excluded.completed_at,
                updated_at = excluded.updated_at
            """,
            (user_id, lesson_id, status, bookmark_seconds, notes, completed_at, now),
        )

        if (
            sync_theme_theory
            and prev_status != "completed"
            and status == "completed"
            and lesson_row["subtema"]
            and not bool(lesson_row["is_extra"])
        ):
            theme_theory_completed = _sync_theme_theory_if_completed(db, user_id, lesson_row["subtema"])

    return jsonify({
        "lesson_id": lesson_id,
        "status": status,
        "bookmark_seconds": bookmark_seconds,
        "notes": notes,
        "has_notes": bool(notes.strip()),
        "completed_at": completed_at,
        "updated_at": now,
        "theme_theory_completed": theme_theory_completed,
    })


@bp.route("/lessons/<int:lesson_id>/mapping", methods=["PATCH"])
@require_lessons_access
def update_lesson_mapping(lesson_id: int):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Payload JSON inválido."}), 400

    db = get_db()
    row = db.execute("SELECT id, area, subtema, is_essential FROM lessons WHERE id = ? AND active = 1", (lesson_id,)).fetchone()
    if not row:
        return jsonify({"error": "Aula não encontrada."}), 404

    next_subtema = row["subtema"]
    next_area = row["area"]
    if "subtema" in payload:
        raw_sub = payload["subtema"]
        if raw_sub is None or raw_sub == "":
            next_subtema = None
        elif isinstance(raw_sub, str):
            canonical_area = find_area_for_subtema(raw_sub.strip())
            if not canonical_area:
                return jsonify({"error": "Subtema não encontrado no catálogo canônico."}), 400
            next_subtema = raw_sub.strip()
            next_area = canonical_area
        else:
            return jsonify({"error": "subtema deve ser string ou null."}), 400

    next_essential = int(row["is_essential"])
    if "is_essential" in payload:
        if type(payload["is_essential"]) is not bool:
            return jsonify({"error": "is_essential deve ser booleano."}), 400
        next_essential = int(payload["is_essential"])

    now = _now_iso()
    with db_transaction(db):
        db.execute(
            "UPDATE lessons SET subtema = ?, area = ?, is_essential = ?, mapping_source = 'manual', updated_at = ? WHERE id = ?",
            (next_subtema, next_area, next_essential, now, lesson_id),
        )

    return jsonify({
        "lesson_id": lesson_id,
        "area": next_area,
        "subtema": next_subtema,
        "is_essential": bool(next_essential),
        "mapping_source": "manual",
        "updated_at": now,
    })


@bp.route("/lessons/cycle", methods=["GET"])
@require_lessons_access
def get_lesson_cycle():
    db = get_db()
    user_id = str(g.user_id)
    subtema = (request.args.get("subtema") or "").strip() or None
    settings = _get_user_cycle_settings(db, user_id)
    cycles = _get_user_cycles_map(db, user_id, settings, subtema=subtema)
    return jsonify({
        "settings": settings,
        "cycles": cycles,
    })


@bp.route("/lessons/cycle/settings", methods=["PUT"])
@require_lessons_access
def update_lesson_cycle_settings():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Payload JSON inválido."}), 400

    db = get_db()
    user_id = str(g.user_id)
    current = _get_user_cycle_settings(db, user_id)

    pre_q = current["default_pre_questions"]
    post_q = current["default_post_questions"]

    if "default_pre_questions" in payload and payload["default_pre_questions"] is not None:
        raw_pre = payload["default_pre_questions"]
        if type(raw_pre) is not int or raw_pre < 0 or raw_pre > MAX_CYCLE_PRE_QUESTIONS:
            return jsonify({"error": f"default_pre_questions deve ser inteiro entre 0 e {MAX_CYCLE_PRE_QUESTIONS}."}), 400
        pre_q = raw_pre

    if "default_post_questions" in payload and payload["default_post_questions"] is not None:
        raw_post = payload["default_post_questions"]
        if type(raw_post) is not int or raw_post < 1 or raw_post > MAX_CYCLE_POST_QUESTIONS:
            return jsonify({"error": f"default_post_questions deve ser inteiro entre 1 e {MAX_CYCLE_POST_QUESTIONS}."}), 400
        post_q = raw_post

    now = _now_iso()
    with db_transaction(db, immediate=True):
        db.execute(
            """
            INSERT INTO lesson_cycle_settings (user_id, default_pre_questions, default_post_questions, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                default_pre_questions = excluded.default_pre_questions,
                default_post_questions = excluded.default_post_questions,
                updated_at = excluded.updated_at
            """,
            (user_id, pre_q, post_q, now),
        )

    return jsonify({
        "default_pre_questions": pre_q,
        "default_post_questions": post_q,
        "updated_at": now,
    })


@bp.route("/lessons/cycle", methods=["PUT"])
@require_lessons_access
def upsert_lesson_cycle():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Payload JSON inválido."}), 400

    subtema = (payload.get("subtema") or "").strip() if isinstance(payload.get("subtema"), str) else ""
    if not subtema or not find_area_for_subtema(subtema):
        return jsonify({"error": "Subtema inválido ou não encontrado no catálogo canônico."}), 400

    phase = payload.get("phase")
    if phase not in VALID_CYCLE_PHASES:
        return jsonify({"error": "phase deve ser 'pre' ou 'post'."}), 400

    max_target = MAX_CYCLE_PRE_QUESTIONS if phase == "pre" else MAX_CYCLE_POST_QUESTIONS
    min_target = 0 if phase == "pre" else 1

    raw_target = payload.get("target")
    if raw_target is not None:
        if type(raw_target) is not int or raw_target < min_target or raw_target > max_target:
            return jsonify({"error": f"target inválido para fase {phase}."}), 400

    raw_completed = payload.get("completed")
    if raw_completed is not None:
        if type(raw_completed) is not int or raw_completed < 0 or raw_completed > 500:
            return jsonify({"error": "completed deve ser inteiro entre 0 e 500."}), 400

    raw_correct = payload.get("correct")
    if raw_correct is not None:
        if type(raw_correct) is not int or raw_correct < 0 or raw_correct > 500:
            return jsonify({"error": "correct deve ser inteiro entre 0 e 500."}), 400

    raw_done = payload.get("done")
    if raw_done is not None and type(raw_done) is not bool:
        return jsonify({"error": "done deve ser booleano."}), 400

    db = get_db()
    user_id = str(g.user_id)
    settings = _get_user_cycle_settings(db, user_id)
    now = _now_iso()

    with db_transaction(db, immediate=True):
        existing = db.execute(
            "SELECT * FROM lesson_study_cycle WHERE user_id = ? AND subtema = ?",
            (user_id, subtema),
        ).fetchone()

        pre_target = int(existing["pre_target"]) if existing else settings["default_pre_questions"]
        pre_completed = int(existing["pre_completed"]) if existing else 0
        pre_correct = int(existing["pre_correct"]) if existing else 0
        pre_done = int(existing["pre_done"]) if existing else 0
        pre_completed_at = existing["pre_completed_at"] if existing else None

        post_target = int(existing["post_target"]) if existing else settings["default_post_questions"]
        post_completed = int(existing["post_completed"]) if existing else 0
        post_correct = int(existing["post_correct"]) if existing else 0
        post_done = int(existing["post_done"]) if existing else 0
        post_completed_at = existing["post_completed_at"] if existing else None

        if phase == "pre":
            if raw_target is not None:
                pre_target = raw_target
            if raw_completed is not None:
                pre_completed = raw_completed
            if raw_correct is not None:
                pre_correct = min(raw_correct, pre_completed) if raw_completed is not None else raw_correct
            if raw_done is not None:
                pre_done = int(raw_done)
            elif raw_completed is not None:
                pre_done = 1 if pre_completed > 0 else 0
            if pre_done:
                pre_completed_at = now
            else:
                pre_completed_at = None
                if raw_completed is None and raw_done is False:
                    pre_completed = 0
                    pre_correct = 0
        else:
            if raw_target is not None:
                post_target = raw_target
            if raw_completed is not None:
                post_completed = raw_completed
            if raw_correct is not None:
                post_correct = min(raw_correct, post_completed) if raw_completed is not None else raw_correct
            if raw_done is not None:
                post_done = int(raw_done)
            elif raw_completed is not None:
                post_done = 1 if post_completed > 0 else 0
            if post_done:
                post_completed_at = now
            else:
                post_completed_at = None
                if raw_completed is None and raw_done is False:
                    post_completed = 0
                    post_correct = 0

        db.execute(
            """
            INSERT INTO lesson_study_cycle (
                user_id, subtema,
                pre_target, pre_completed, pre_correct, pre_done, pre_completed_at,
                post_target, post_completed, post_correct, post_done, post_completed_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, subtema) DO UPDATE SET
                pre_target = excluded.pre_target,
                pre_completed = excluded.pre_completed,
                pre_correct = excluded.pre_correct,
                pre_done = excluded.pre_done,
                pre_completed_at = excluded.pre_completed_at,
                post_target = excluded.post_target,
                post_completed = excluded.post_completed,
                post_correct = excluded.post_correct,
                post_done = excluded.post_done,
                post_completed_at = excluded.post_completed_at,
                updated_at = excluded.updated_at
            """,
            (
                user_id, subtema,
                pre_target, pre_completed, pre_correct, pre_done, pre_completed_at,
                post_target, post_completed, post_correct, post_done, post_completed_at,
                now,
            ),
        )
        saved = db.execute(
            "SELECT * FROM lesson_study_cycle WHERE user_id = ? AND subtema = ?",
            (user_id, subtema),
        ).fetchone()

    return jsonify({"cycle": _serialize_cycle_row(saved, settings), "settings": settings})
