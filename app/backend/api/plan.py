import json
import urllib.parse
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, g, jsonify, request

from .adaptive import get_adaptive_signals_by_topic
from .internato_config import RODIZIOS_TURMA_J
# planner service — geração do plano anual por pesos históricos USP
from .services.planner import generate_annual_plan, build_plan_from_schedule

from .db import db_transaction, get_db
from .filters import get_user_target_institutions
from .observability import record_domain_event
from .questions import invalidate_user_caches
from .schemas import (
    GeneratePlanIn,
    InternatoBlocksUpdateIn,
    PlannerConfigIn,
    PlannerMoveTopicIn,
    PlannerResetIn,
    PlannerRevisionIn,
    PlannerStudyIn,
    PlannerTopicProgressIn,
    ValidationError,
    validation_errors,
)

bp = Blueprint("plan", __name__)


def _resolve_schedule_mode(organization: str, intensive: bool) -> str:
    org = "internato" if organization == "internato" else "geral"
    return f"{org}_{'intensive' if intensive else 'standard'}"


def _parse_mode_parts(mode: str) -> tuple[str, bool]:
    if mode in ("internato_standard", "internato_intensive"):
        return "internato", mode.endswith("_intensive")
    return "geral", mode.endswith("intensive")


def _get_completed_subtemas(db, user_id: str) -> set[str]:
    rows = db.execute(
        "SELECT DISTINCT subtema FROM planner_topic_progress WHERE user_id = ? AND completed = 1",
        (user_id,),
    ).fetchall()
    return {r["subtema"] for r in rows}


def _get_user_internato_blocks(db, user_id: str) -> list[dict]:
    row = db.execute("SELECT internato_blocks FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
    if row and row["internato_blocks"]:
        try:
            parsed = json.loads(row["internato_blocks"])
            if isinstance(parsed, list) and parsed:
                return parsed
        except (ValueError, TypeError):
            pass
    return [dict(b) for b in RODIZIOS_TURMA_J]


@bp.route("/planner/config/reset", methods=["POST"])
def planner_config_reset():
    raw_body = request.get_json(silent=True) or {}
    try:
        data = PlannerResetIn.model_validate(raw_body)
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

    db = get_db()
    with db_transaction(db, immediate=True):
        if data.scope == "schedule":
            if data.mode:
                db.execute("DELETE FROM planner_schedule WHERE user_id = ? AND mode = ?", (g.user_id, data.mode))
            else:
                db.execute("DELETE FROM planner_schedule WHERE user_id = ?", (g.user_id,))
        elif data.scope == "progress":
            db.execute("DELETE FROM planner_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_topic_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_schedule WHERE user_id = ?", (g.user_id,))
        else:
            db.execute("DELETE FROM planner_config WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_topic_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_schedule WHERE user_id = ?", (g.user_id,))
    invalidate_user_caches(g.user_id)
    return jsonify({"success": True, "scope": data.scope})


@bp.route("/planner/internato-blocks", methods=["PUT", "POST"])
def planner_internato_blocks():
    try:
        data = InternatoBlocksUpdateIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

    blocks_payload = [b.model_dump(exclude_none=True) for b in data.blocks]
    blocks_json = json.dumps(blocks_payload, ensure_ascii=False)
    now_iso = datetime.now(timezone.utc).isoformat()
    db = get_db()
    with db_transaction(db, immediate=True):
        existing = db.execute("SELECT user_id FROM planner_config WHERE user_id = ?", (g.user_id,)).fetchone()
        if existing:
            db.execute(
                "UPDATE planner_config SET internato_blocks = ?, updated_at = ? WHERE user_id = ?",
                (blocks_json, now_iso, g.user_id),
            )
        else:
            db.execute(
                "INSERT INTO planner_config (user_id, internato_blocks, updated_at) VALUES (?, ?, ?)",
                (g.user_id, blocks_json, now_iso),
            )
        db.execute(
            "DELETE FROM planner_schedule WHERE user_id = ? AND mode LIKE 'internato_%'",
            (g.user_id,),
        )
    invalidate_user_caches(g.user_id)
    return jsonify({"success": True, "internato_blocks": blocks_payload})


@bp.route("/planner/config", methods=["GET", "POST"])
def planner_config():
    db = get_db()
    if request.method == "POST":
        try:
            cfg = PlannerConfigIn.model_validate(request.get_json(force=True) or {})
        except ValidationError as e:
            return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
        
        target_inst = cfg.target_institution
        if not target_inst and cfg.target_institutions:
            target_inst = ", ".join(cfg.target_institutions)

        existing_row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (g.user_id,)).fetchone()
        existing_keys = existing_row.keys() if existing_row and hasattr(existing_row, "keys") else []
        org_mode = cfg.organization_mode or (
            existing_row["organization_mode"] if existing_row and "organization_mode" in existing_keys and existing_row["organization_mode"] else "geral"
        )
        existing_blocks_json = (
            existing_row["internato_blocks"] if existing_row and "internato_blocks" in existing_keys else None
        )
        blocks_json = (
            json.dumps([b.model_dump(exclude_none=True) for b in cfg.internato_blocks], ensure_ascii=False)
            if cfg.internato_blocks is not None
            else existing_blocks_json
        )

        # Só limpa planner_schedule se parâmetros estruturais de tempo/data, bancas ou blocos realmente mudarem
        existing_inst = (
            existing_row["target_institution"]
            if existing_row and "target_institution" in existing_keys
            else None
        )
        inst_changed = (existing_inst or "").strip() != (target_inst or "").strip()
        timing_changed = (
            not existing_row
            or existing_row["exam_date"] != cfg.exam_date
            or existing_row["start_date"] != cfg.start_date
            or existing_row["days_per_week"] != cfg.days_per_week
            or (existing_row["hours_per_day"] if "hours_per_day" in existing_keys else None) != cfg.hours_per_day
        )
        blocks_changed = cfg.internato_blocks is not None and blocks_json != existing_blocks_json

        with db_transaction(db, immediate=True):
            if timing_changed or inst_changed:
                db.execute("DELETE FROM planner_schedule WHERE user_id = ?", (g.user_id,))
            elif blocks_changed:
                db.execute("DELETE FROM planner_schedule WHERE user_id = ? AND mode LIKE 'internato_%'", (g.user_id,))

            db.execute("""
                INSERT INTO planner_config (
                    user_id, exam_date, start_date, days_per_week, questions_per_day,
                    hours_per_day, updated_at, target_score, target_institution,
                    target_specialty, organization_mode, internato_blocks
                )
                VALUES (?, ?, ?, ?, 30, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    exam_date = excluded.exam_date, start_date = excluded.start_date,
                    days_per_week = excluded.days_per_week, hours_per_day = excluded.hours_per_day,
                    updated_at = excluded.updated_at, target_score = excluded.target_score,
                    target_institution = excluded.target_institution, target_specialty = excluded.target_specialty,
                    organization_mode = excluded.organization_mode, internato_blocks = excluded.internato_blocks
            """, (
                g.user_id, cfg.exam_date, cfg.start_date, cfg.days_per_week, cfg.hours_per_day,
                datetime.now(timezone.utc).isoformat(), cfg.target_score, target_inst,
                cfg.target_specialty, org_mode, blocks_json,
            ))
        invalidate_user_caches(g.user_id)
        return jsonify({"success": True})

    return jsonify(get_planner_config_data(db, g.user_id) or {})


def get_planner_config_data(db, user_id: str) -> dict | None:
    row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return None
    row_keys = row.keys() if hasattr(row, 'keys') else []
    inst_str = row["target_institution"] if "target_institution" in row_keys else None
    inst_list = [i.strip() for i in inst_str.split(",") if i.strip()] if inst_str else []
    primary_inst = None
    if inst_list and inst_list[0] not in ("Todas as Bancas", "TODAS"):
        primary_inst = inst_list[0]

    org_mode = row["organization_mode"] if "organization_mode" in row_keys and row["organization_mode"] else "geral"
    internato_blocks = [dict(b) for b in RODIZIOS_TURMA_J]
    if "internato_blocks" in row_keys and row["internato_blocks"]:
        try:
            parsed = json.loads(row["internato_blocks"])
            if isinstance(parsed, list) and parsed:
                internato_blocks = parsed
        except (ValueError, TypeError):
            pass

    return {
        "exam_date": row["exam_date"],
        "start_date": row["start_date"],
        "days_per_week": row["days_per_week"],
        "hours_per_day": row["hours_per_day"] if "hours_per_day" in row_keys else row["questions_per_day"],
        "target_score": row["target_score"] if "target_score" in row_keys else None,
        "target_institution": inst_str,
        "target_institutions": inst_list,
        "primary_institution": primary_inst,
        "target_specialty": row["target_specialty"] if "target_specialty" in row_keys else None,
        "organization_mode": org_mode,
        "internato_blocks": internato_blocks,
    }


def get_planner_progress_data(db, user_id: str) -> dict:
    rows = db.execute("SELECT * FROM planner_progress WHERE user_id = ?", (user_id,)).fetchall()
    return {str(r["week"]): {
        "studied": bool(r["studied"]), "studied_at": r["studied_at"],
        "rev24h": bool(r["rev24h"]), "rev7d": bool(r["rev7d"]), "rev30d": bool(r["rev30d"]),
    } for r in rows}


def get_planner_topic_progress_data(db, user_id: str) -> dict:
    rows = db.execute("SELECT week, subtema, completed FROM planner_topic_progress WHERE user_id = ?", (user_id,)).fetchall()
    res = {}
    for r in rows:
        val = bool(r["completed"])
        res[f"{r['week']}:{r['subtema']}"] = val
        if val:
            res[r["subtema"]] = True
    return res


@bp.route("/planner")
def get_planner():
    db = get_db()
    return jsonify(get_planner_progress_data(db, g.user_id))


@bp.route("/planner/topics")
def get_planner_topics():
    db = get_db()
    return jsonify(get_planner_topic_progress_data(db, g.user_id))


@bp.route("/planner/<int:week>/topic", methods=["POST"])
def planner_topic(week):
    try:
        data = PlannerTopicProgressIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
    completed = 1 if data.completed else 0
    completed_at = datetime.now(timezone.utc).isoformat() if completed else None
    db = get_db()
    with db_transaction(db, immediate=True):
        if completed:
            db.execute("""INSERT INTO planner_topic_progress (week, subtema, completed, completed_at, user_id)
                          VALUES (?, ?, ?, ?, ?)
                          ON CONFLICT(week, subtema, user_id) DO UPDATE SET completed = excluded.completed, completed_at = excluded.completed_at""",
                       (week, data.subtema, completed, completed_at, g.user_id))
        else:
            # Desmarcar apaga/desmarca em todas as semanas para manter consistência global entre modos
            db.execute(
                "DELETE FROM planner_topic_progress WHERE user_id = ? AND subtema = ?",
                (g.user_id, data.subtema),
            )
    invalidate_user_caches(g.user_id)
    if completed:
        record_domain_event("planner_topic_completed", user_id=g.user_id, week=week, subtema=data.subtema)
    return jsonify({"success": True, "completed": bool(completed)})


@bp.route("/planner/move-topic", methods=["POST"])
def planner_move_topic():
    try:
        data = PlannerMoveTopicIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

    db = get_db()
    schedule_rows = db.execute(
        "SELECT week, subtema, display_order FROM planner_schedule WHERE user_id = ? AND mode = ? ORDER BY week ASC, display_order ASC",
        (g.user_id, data.mode)
    ).fetchall()

    now_iso = datetime.now(timezone.utc).isoformat()

    # Se ainda não houver schedule salvo, popula a partir do plano gerado
    if not schedule_rows:
        start_date, exam_date, days, hours_per_week = _get_planner_config(db, g.user_id)
        rows, answered_map, use_bank_incidence = _fetch_plan_data(db, g.user_id)
        adaptive_signals = get_adaptive_signals_by_topic(db, g.user_id)
        completed_subtemas = _get_completed_subtemas(db, g.user_id)
        internato_blocks = _get_user_internato_blocks(db, g.user_id)
        org_mode, is_intensive = _parse_mode_parts(data.mode)
        plan = generate_annual_plan(
            rows, start_date, exam_date, hours_per_week,
            intensive=is_intensive, user_progress=answered_map,
            adaptive_signals=adaptive_signals,
            organization=org_mode,
            internato_blocks=internato_blocks,
            completed_subtemas=completed_subtemas,
            use_bank_incidence=use_bank_incidence,
        )
        if isinstance(plan, dict) and plan.get("plan"):
            insert_records = []
            for w in plan["plan"]:
                week_num = int(w["week"])
                for order_idx, t in enumerate(w.get("topics", [])):
                    insert_records.append((g.user_id, data.mode, week_num, t["subtema"], order_idx, now_iso))
            if insert_records:
                with db_transaction(db, immediate=True):
                    db.execute("DELETE FROM planner_schedule WHERE user_id = ? AND mode = ?", (g.user_id, data.mode))
                    db.executemany("""
                        INSERT INTO planner_schedule (user_id, mode, week, subtema, display_order, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, insert_records)
            schedule_rows = db.execute(
                "SELECT week, subtema, display_order FROM planner_schedule WHERE user_id = ? AND mode = ? ORDER BY week ASC, display_order ASC",
                (g.user_id, data.mode)
            ).fetchall()

    if not schedule_rows:
        return jsonify({"error": "Cronograma não encontrado"}), 404

    weeks_map = {}
    for r in schedule_rows:
        w_num = int(r["week"])
        weeks_map.setdefault(w_num, []).append(r["subtema"])

    source_week = data.source_week
    target_week = data.target_week
    subtema = data.subtema

    # Se o subtema não estiver exatamente na source_week indicada pelo cliente, procurar onde ele está
    found_week = None
    for w_num, topics in weeks_map.items():
        if subtema in topics:
            found_week = w_num
            break

    if found_week is not None:
        source_week = found_week
        weeks_map[source_week].remove(subtema)
    else:
        return jsonify({"error": f"Subtema '{subtema}' não encontrado no cronograma"}), 404

    if target_week not in weeks_map:
        weeks_map[target_week] = []

    if data.target_index is not None and 0 <= data.target_index <= len(weeks_map[target_week]):
        weeks_map[target_week].insert(data.target_index, subtema)
    else:
        weeks_map[target_week].append(subtema)

    affected_weeks = {source_week, target_week}
    with db_transaction(db, immediate=True):
        placeholders = ",".join("?" * len(affected_weeks))
        db.execute(
            f"DELETE FROM planner_schedule WHERE user_id = ? AND mode = ? AND week IN ({placeholders})",
            (g.user_id, data.mode, *affected_weeks)
        )
        insert_records = []
        for w_num in affected_weeks:
            for order_idx, s in enumerate(weeks_map.get(w_num, [])):
                insert_records.append((g.user_id, data.mode, w_num, s, order_idx, now_iso))
        if insert_records:
            db.executemany("""
                INSERT INTO planner_schedule (user_id, mode, week, subtema, display_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, insert_records)

        # Atualizar planner_topic_progress para a nova semana se moveu de semana
        if source_week != target_week:
            db.execute("""
                UPDATE planner_topic_progress
                SET week = ?
                WHERE user_id = ? AND subtema = ? AND week = ?
            """, (target_week, g.user_id, subtema, source_week))

    invalidate_user_caches(g.user_id)
    record_domain_event(
        "planner_topic_moved",
        user_id=g.user_id,
        subtema=subtema,
        source_week=source_week,
        target_week=target_week,
        target_index=data.target_index
    )

    return jsonify({
        "success": True,
        "subtema": subtema,
        "source_week": source_week,
        "target_week": target_week,
        "target_index": data.target_index
    })


@bp.route("/planner/<int:week>/study", methods=["POST"])
def planner_study(week):
    db = get_db()
    try:
        data = PlannerStudyIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
    studied = 1 if data.studied else 0
    if studied:
        studied_at = datetime.now(timezone.utc).isoformat()
        with db_transaction(db, immediate=True):
            db.execute("""
                INSERT INTO planner_progress (week, studied, studied_at, rev24h, rev7d, rev30d, user_id)
                VALUES (?, 1, ?, 0, 0, 0, ?)
                ON CONFLICT(week, user_id) DO UPDATE SET studied = 1, studied_at = excluded.studied_at
            """, (week, studied_at, g.user_id))
    else:
        studied_at = None
        with db_transaction(db, immediate=True):
            db.execute("""
                INSERT INTO planner_progress (week, studied, studied_at, rev24h, rev7d, rev30d, user_id)
                VALUES (?, 0, NULL, 0, 0, 0, ?)
                ON CONFLICT(week, user_id) DO UPDATE SET studied = 0, studied_at = NULL, rev24h = 0, rev7d = 0, rev30d = 0
            """, (week, g.user_id))
    invalidate_user_caches(g.user_id)
    return jsonify({"success": True, "studied": bool(studied), "studied_at": studied_at})


@bp.route("/planner/<int:week>/revision", methods=["POST"])
def planner_revision(week):
    db = get_db()
    try:
        data = PlannerRevisionIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
        
    allowed_columns = {'rev24h', 'rev7d', 'rev30d'}
    if data.type not in allowed_columns:
        return jsonify({'error': 'invalid type'}), 400
        
    checked = 1 if data.checked else 0
    with db_transaction(db, immediate=True):
        db.execute(f"""
            INSERT INTO planner_progress (week, {data.type}, user_id) VALUES (?, ?, ?)
            ON CONFLICT(week, user_id) DO UPDATE SET {data.type} = excluded.{data.type}
        """, (week, checked, g.user_id))
    invalidate_user_caches(g.user_id)
    return jsonify({"success": True, "type": data.type, "checked": bool(checked)})


@bp.route("/generate_plan", methods=["POST"])
def generate_plan():
    try:
        data = GeneratePlanIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
    start_date = data.start_date or datetime.now(timezone.utc).isoformat()
    mode = _resolve_schedule_mode(data.organization, data.intensive)

    db = get_db()
    rows, answered_map, use_bank_incidence = _fetch_plan_data(db, g.user_id)
    adaptive_signals = get_adaptive_signals_by_topic(db, g.user_id)
    completed_subtemas = _get_completed_subtemas(db, g.user_id)
    internato_blocks = _get_user_internato_blocks(db, g.user_id)

    if not data.regenerate:
        schedule_rows = db.execute(
            "SELECT week, subtema, display_order FROM planner_schedule WHERE user_id = ? AND mode = ? ORDER BY week ASC, display_order ASC",
            (g.user_id, mode)
        ).fetchall()
        if schedule_rows:
            plan = build_plan_from_schedule(
                schedule_rows, start_date, data.hours_per_week,
                exam_date_str=data.exam_date,
                rows=rows, user_progress=answered_map,
                adaptive_signals=adaptive_signals, intensive=data.intensive,
                completed_subtemas=completed_subtemas,
                organization=data.organization,
                internato_blocks=internato_blocks,
                use_bank_incidence=use_bank_incidence,
            )
            if plan:
                return jsonify(plan)

    plan = generate_annual_plan(
        rows, start_date, data.exam_date, data.hours_per_week,
        intensive=data.intensive, user_progress=answered_map,
        adaptive_signals=adaptive_signals,
        organization=data.organization,
        internato_blocks=internato_blocks,
        completed_subtemas=completed_subtemas,
        use_bank_incidence=use_bank_incidence,
    )

    if isinstance(plan, dict) and plan.get("plan"):
        now_iso = datetime.now(timezone.utc).isoformat()
        with db_transaction(db, immediate=True):
            db.execute("DELETE FROM planner_schedule WHERE user_id = ? AND mode = ?", (g.user_id, mode))
            insert_records = []
            for w in plan["plan"]:
                week_num = int(w["week"])
                for order_idx, t in enumerate(w.get("topics", [])):
                    insert_records.append((g.user_id, mode, week_num, t["subtema"], order_idx, now_iso))
            if insert_records:
                db.executemany("""
                    INSERT INTO planner_schedule (user_id, mode, week, subtema, display_order, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, insert_records)
        invalidate_user_caches(g.user_id)

    return jsonify(plan)


def _get_planner_config(db, user_id):
    row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
    
    if not row or not row["exam_date"]:
        start_date = datetime.now(timezone.utc).isoformat()
        exam_date = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()
        hours_per_week = 24
        days = 6
    else:
        start_date = row["start_date"] or datetime.now(timezone.utc).isoformat()
        exam_date = row["exam_date"]
        days = row["days_per_week"] or 6
        row_keys = row.keys() if hasattr(row, "keys") else []
        hours = (row["hours_per_day"] if "hours_per_day" in row_keys else row["questions_per_day"]) or 4
        hours_per_week = min(168, days * hours)

    return start_date, exam_date, days, hours_per_week


def _fetch_plan_data(db, user_id):
    target_insts = get_user_target_institutions(db, user_id)
    use_bank_incidence = bool(target_insts)

    if target_insts:
        sorted_insts = sorted(target_insts)
        placeholders = ",".join("?" * len(sorted_insts))
        q_query = f"""
            SELECT area, subtema, GROUP_CONCAT(DISTINCT topic) as topics,
                   COUNT(id) as q_count,
                   SUM(CASE WHEN institution_code IN ({placeholders}) OR UPPER(institution_code) IN ({placeholders}) THEN 1 ELSE 0 END) as target_q_count
            FROM questions
            WHERE area IS NOT NULL AND subtema IS NOT NULL AND missing_alts = 0
            GROUP BY area, subtema
        """
        q_params = tuple(sorted_insts) + tuple(sorted_insts)
    else:
        q_query = """
            SELECT area, subtema, GROUP_CONCAT(DISTINCT topic) as topics,
                   COUNT(id) as q_count,
                   0 as target_q_count
            FROM questions
            WHERE area IS NOT NULL AND subtema IS NOT NULL AND missing_alts = 0
            GROUP BY area, subtema
        """
        q_params = ()

    a_query = """
        SELECT q.subtema, COUNT(DISTINCT a.question_id) as ans_count, SUM(a.is_correct) as correct_count, COUNT(a.id) as attempts
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.subtema IS NOT NULL
        GROUP BY q.subtema
    """
    if hasattr(db, "batch"):
        res = db.batch([
            (q_query, q_params),
            (a_query, (user_id,))
        ])
        rows = [dict(r) for r in res[0].fetchall()]
        answered = [dict(r) for r in res[1].fetchall()]
    else:
        rows = [dict(r) for r in db.execute(q_query, q_params).fetchall()]
        answered = [dict(r) for r in db.execute(a_query, (user_id,)).fetchall()]

    answered_map = {r["subtema"]: r for r in answered}
    return rows, answered_map, use_bank_incidence


def _get_base_url():
    base_url = ""
    try:
        req_origin = request.headers.get("Origin") or request.headers.get("Referer")
        if req_origin:
            parsed = urllib.parse.urlparse(req_origin)
            base_url = f"{parsed.scheme}://{parsed.netloc}"
        elif request.host_url:
            base_url = request.host_url.rstrip("/")
            if ":5050" in base_url:
                base_url = "http://localhost:3000"
    except Exception:
        base_url = ""
    return base_url


def _generate_calendar_ics_content(db, user_id):
    start_date, exam_date, days, hours_per_week = _get_planner_config(db, user_id)
    rows, answered_map, use_bank_incidence = _fetch_plan_data(db, user_id)
    adaptive_signals = get_adaptive_signals_by_topic(db, user_id)
    completed_subtemas = _get_completed_subtemas(db, user_id)
    internato_blocks = _get_user_internato_blocks(db, user_id)
    cfg_data = get_planner_config_data(db, user_id) or {}
    org_mode = cfg_data.get("organization_mode") or "geral"
    schedule_mode = _resolve_schedule_mode(org_mode, intensive=False)

    schedule_rows = db.execute(
        "SELECT week, subtema, display_order FROM planner_schedule WHERE user_id = ? AND mode = ? ORDER BY week ASC, display_order ASC",
        (user_id, schedule_mode)
    ).fetchall()
    if schedule_rows:
        plan_result = build_plan_from_schedule(
            schedule_rows, start_date, hours_per_week,
            exam_date_str=exam_date,
            rows=rows, user_progress=answered_map,
            adaptive_signals=adaptive_signals, intensive=False,
            completed_subtemas=completed_subtemas,
            organization=org_mode,
            internato_blocks=internato_blocks,
            use_bank_incidence=use_bank_incidence,
        ) or {}
    else:
        plan_result = generate_annual_plan(
            rows, start_date, exam_date, hours_per_week,
            intensive=False, user_progress=answered_map,
            adaptive_signals=adaptive_signals,
            organization=org_mode,
            internato_blocks=internato_blocks,
            completed_subtemas=completed_subtemas,
            use_bank_incidence=use_bank_incidence,
        )

    plan_weeks = plan_result.get("plan", [])
    now_dt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//MedQuest//Cronograma de Estudos//PT-BR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:MedQuest - Cronograma de Residência Médica",
        "X-WR-TIMEZONE:America/Sao_Paulo",
    ]

    study_days_count = max(1, min(7, days))
    base_url = _get_base_url()

    _generate_ics_events(ics_lines, plan_weeks, now_dt, study_days_count, base_url, user_id)

    ics_lines.append("END:VCALENDAR")
    return "\r\n".join(ics_lines)


def _build_consolidation_event(ics_lines, w_num, week_start_dt, w_date_str, now_dt, user_id, base_url):
    start_str = week_start_dt.strftime("%Y%m%dT080000")
    end_str = (week_start_dt + timedelta(hours=3)).strftime("%Y%m%dT110000")
    uid = f"medquest-week-consolidation-{w_num}-{user_id}-{w_date_str}@medquest"
    footer_link = f"\\n\\n🔗 {base_url}/planner" if base_url else ""
    ics_lines.extend([
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{now_dt}",
        f"DTSTART:{start_str}",
        f"DTEND:{end_str}",
        f"SUMMARY:[MedQuest] Semana {w_num}: Revisão Geral & Consolidação",
        f"DESCRIPTION:Semana reservada para consolidação de metas e simulados.{footer_link}",
        "STATUS:CONFIRMED",
        "END:VEVENT",
    ])


def _build_topic_events(ics_lines, topics, w_num, week_start_dt, study_days_count, now_dt, user_id, base_url):
    day_slot_minutes = [0] * study_days_count
    for t_idx, topic in enumerate(topics):
        subtema = topic.get("subtema", "Aula")
        area = topic.get("area", "Geral")
        theory_h = topic.get("estimated_theory_hours", 1.0)
        practice_h = topic.get("estimated_practice_hours", 2.0)
        total_h = topic.get("estimated_hours", theory_h + practice_h)

        day_offset = t_idx % study_days_count
        topic_date = week_start_dt + timedelta(days=day_offset)
        date_str = topic_date.strftime("%Y%m%d")
        topic_id_clean = urllib.parse.quote(subtema[:30]).replace("%", "")

        # Duração REAL da aula (minutos calculados com precisão)
        duration_minutes = max(30, int(round(total_h * 60)))
        start_minutes = (8 * 60) + day_slot_minutes[day_offset]
        dt_start = topic_date.replace(hour=start_minutes // 60, minute=start_minutes % 60, second=0)
        dt_end = dt_start + timedelta(minutes=duration_minutes)
        day_slot_minutes[day_offset] += duration_minutes + 15

        start_str = dt_start.strftime("%Y%m%dT%H%M%S")
        end_str = dt_end.strftime("%Y%m%dT%H%M%S")
        uid_lecture = f"medquest-lec-{w_num}-{t_idx}-{topic_id_clean}-{user_id}-{date_str}@medquest"

        encoded_sub = urllib.parse.quote(subtema)
        # O subtema canônico é a chave de associação estável. Não inclua
        # a área aqui: nomes de área de bases antigas podem divergir da
        # normalização exibida no planner e zerar indevidamente a fila.
        study_url_text = f"\\n\\n🔗 Questões: {base_url}/estudar?subtema={encoded_sub}&limit=25" if base_url else ""

        ics_lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid_lecture}",
            f"DTSTAMP:{now_dt}",
            f"DTSTART:{start_str}",
            f"DTEND:{end_str}",
            f"SUMMARY:[MedQuest] 📖 {subtema} ({area})",
            f"DESCRIPTION:📚 Carga: {total_h}h (Teoria: {theory_h}h + Questões: {practice_h}h)\\nSemana {w_num} • {area}{study_url_text}",
            "STATUS:CONFIRMED",
            "END:VEVENT",
        ])


def _generate_ics_events(ics_lines, plan_weeks, now_dt, study_days_count, base_url, user_id):
    for w in plan_weeks:
        w_num = w.get("week")
        w_date_str = w.get("date", "")[:10]
        if not w_date_str:
            continue
        
        try:
            week_start_dt = datetime.strptime(w_date_str, "%Y-%m-%d")
        except Exception:
            continue

        topics = w.get("topics", [])
        if not topics:
            _build_consolidation_event(ics_lines, w_num, week_start_dt, w_date_str, now_dt, user_id, base_url)
        else:
            _build_topic_events(ics_lines, topics, w_num, week_start_dt, study_days_count, now_dt, user_id, base_url)


@bp.route("/planner/export/ics", methods=["GET"])
def export_ics():
    db = get_db()
    content = _generate_calendar_ics_content(db, g.user_id)
    return Response(
        content,
        mimetype="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": "attachment; filename=medquest_cronograma.ics"
        }
    )


@bp.route("/planner/calendar/feed", methods=["GET"])
def calendar_feed():
    db = get_db()
    # A identidade é definida exclusivamente pelo middleware de autenticação.
    # Aceitar user_id na URL permitia que um usuário autenticado lesse o plano
    # de qualquer outro usuário ao trocar o parâmetro.
    content = _generate_calendar_ics_content(db, g.user_id)
    return Response(
        content,
        mimetype="text/calendar; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Disposition": "inline; filename=medquest_feed.ics"
        }
    )
