"""Blueprint: Caderno Inteligente (anotações e grifos por questão) e Presets de Estudo."""
from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from .db import db_transaction, get_db

bp = Blueprint("notes_presets", __name__)

ALLOWED_HIGHLIGHT_COLORS = {"yellow", "green", "pink", "blue"}
_PREVENTIVA_AREA_ALIASES = ("Preventiva", "Medicina Preventiva", "Medicina Preventiva e Social")
_CIRURGIA_AREA_ALIASES = ("Cirurgia", "Cirurgia Geral")


def _norm_note_search(value: str | None) -> str:
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFD", str(value))
    without_accents = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(without_accents.lower().split())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_highlights(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    cleaned: list[dict] = []
    for item in raw[:100]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:1000]
        if not text:
            continue
        color = str(item.get("color") or "yellow").lower()
        if color not in ALLOWED_HIGHLIGHT_COLORS:
            color = "yellow"
        cleaned.append({
            "id": str(item.get("id") or f"hl-{len(cleaned)+1}")[:64],
            "text": text,
            "color": color,
        })
    return cleaned


@bp.route("/presets", methods=["GET"])
def list_presets():
    db = get_db()
    rows = db.execute(
        """SELECT id, name, filters_json, created_at, updated_at
           FROM study_presets
           WHERE user_id = ?
           ORDER BY updated_at DESC, id DESC""",
        (str(g.user_id),),
    ).fetchall()
    items = []
    for r in rows:
        try:
            filters = json.loads(r["filters_json"] or "{}")
        except json.JSONDecodeError:
            filters = {}
        items.append({
            "id": r["id"],
            "name": r["name"],
            "filters": filters,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        })
    return jsonify({"presets": items})


@bp.route("/presets", methods=["POST"])
def create_preset():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()[:80]
    filters = payload.get("filters")
    if not name:
        return jsonify({"error": "validation_error", "message": "Nome do preset é obrigatório."}), 400
    if not isinstance(filters, dict):
        return jsonify({"error": "validation_error", "message": "Filtros devem ser um objeto JSON."}), 400

    now = _now_iso()
    filters_json = json.dumps(filters, ensure_ascii=False)
    db = get_db()
    with db_transaction(db):
        cur = db.execute(
            """INSERT INTO study_presets (user_id, name, filters_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (str(g.user_id), name, filters_json, now, now),
        )
        preset_id = cur.lastrowid

    return jsonify({
        "id": preset_id,
        "name": name,
        "filters": filters,
        "created_at": now,
        "updated_at": now,
    }), 201


@bp.route("/presets/<int:preset_id>", methods=["DELETE"])
def delete_preset(preset_id: int):
    db = get_db()
    with db_transaction(db):
        cur = db.execute(
            "DELETE FROM study_presets WHERE id = ? AND user_id = ?",
            (preset_id, str(g.user_id)),
        )
        if cur.rowcount == 0:
            return jsonify({"error": "not_found", "message": "Preset não encontrado."}), 404
    return jsonify({"deleted": True, "id": preset_id})


@bp.route("/notes", methods=["GET"])
def list_notes():
    db = get_db()
    area = (request.args.get("area") or "").strip()
    q = (request.args.get("q") or "").strip().lower()

    query = """
        SELECT n.question_id, n.highlights_json, n.note_text, n.updated_at,
               q.area, q.subtema, q.institution_code, q.year, q.stem
        FROM question_user_notes n
        LEFT JOIN questions q ON q.id = n.question_id
        WHERE n.user_id = ?
    """
    params: list[object] = [str(g.user_id)]
    if area:
        if area in _PREVENTIVA_AREA_ALIASES:
            query += " AND q.area IN (?, ?, ?)"
            params.extend(_PREVENTIVA_AREA_ALIASES)
        elif area in _CIRURGIA_AREA_ALIASES:
            query += " AND q.area IN (?, ?)"
            params.extend(_CIRURGIA_AREA_ALIASES)
        else:
            query += " AND q.area = ?"
            params.append(area)
    query += " ORDER BY n.updated_at DESC"

    rows = db.execute(query, params).fetchall()
    q_norm = _norm_note_search(q)
    notes = []
    for r in rows:
        try:
            highlights = json.loads(r["highlights_json"] or "[]")
        except json.JSONDecodeError:
            highlights = []
        note_text = r["note_text"] or ""
        if q_norm:
            haystack = _norm_note_search(" ".join([
                note_text,
                r["subtema"] or "",
                r["area"] or "",
                r["stem"] or "",
                " ".join(h.get("text", "") for h in highlights if isinstance(h, dict)),
            ]))
            if q_norm not in haystack:
                continue
        notes.append({
            "question_id": r["question_id"],
            "highlights": highlights,
            "note_text": note_text,
            "updated_at": r["updated_at"],
            "area": r["area"],
            "subtema": r["subtema"],
            "institution_code": r["institution_code"],
            "year": r["year"],
            "stem_preview": (r["stem"] or "")[:220],
        })
    return jsonify({"notes": notes})


@bp.route("/questions/<int:qid>/note", methods=["GET"])
def get_question_note(qid: int):
    db = get_db()
    row = db.execute(
        """SELECT highlights_json, note_text, updated_at
           FROM question_user_notes
           WHERE user_id = ? AND question_id = ?""",
        (str(g.user_id), qid),
    ).fetchone()
    if not row:
        return jsonify({"question_id": qid, "highlights": [], "note_text": "", "updated_at": None})
    try:
        highlights = json.loads(row["highlights_json"] or "[]")
    except json.JSONDecodeError:
        highlights = []
    return jsonify({
        "question_id": qid,
        "highlights": highlights,
        "note_text": row["note_text"] or "",
        "updated_at": row["updated_at"],
    })


@bp.route("/questions/<int:qid>/note", methods=["PUT"])
def upsert_question_note(qid: int):
    payload = request.get_json(silent=True) or {}
    highlights = _sanitize_highlights(payload.get("highlights", []))
    note_text = str(payload.get("note_text") or "").strip()[:10000]
    now = _now_iso()

    db = get_db()
    if not highlights and not note_text:
        with db_transaction(db):
            db.execute(
                "DELETE FROM question_user_notes WHERE user_id = ? AND question_id = ?",
                (str(g.user_id), qid),
            )
        return jsonify({"question_id": qid, "highlights": [], "note_text": "", "updated_at": now})

    highlights_json = json.dumps(highlights, ensure_ascii=False)
    with db_transaction(db):
        db.execute(
            """INSERT INTO question_user_notes (user_id, question_id, highlights_json, note_text, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, question_id) DO UPDATE SET
                   highlights_json = excluded.highlights_json,
                   note_text = excluded.note_text,
                   updated_at = excluded.updated_at""",
            (str(g.user_id), qid, highlights_json, note_text, now),
        )
    return jsonify({
        "question_id": qid,
        "highlights": highlights,
        "note_text": note_text,
        "updated_at": now,
    })


@bp.route("/questions/<int:qid>/note", methods=["DELETE"])
def delete_question_note(qid: int):
    db = get_db()
    with db_transaction(db):
        db.execute(
            "DELETE FROM question_user_notes WHERE user_id = ? AND question_id = ?",
            (str(g.user_id), qid),
        )
    return jsonify({"deleted": True, "question_id": qid})
