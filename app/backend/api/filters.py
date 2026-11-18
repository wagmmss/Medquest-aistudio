"""Construção das cláusulas de filtro da fila de estudo (compartilhado por rotas)."""
import os
from datetime import datetime, timezone

from flask import g
from api.cache import SimpleTTLCache
from api.edital_profiles import resolve_institution_codes

target_institutions_cache = SimpleTTLCache(60, max_size=500)


def question_filter_clauses(args):
    clauses = ["q.missing_alts = 0"]
    params = []

    raw_institutions = args.getlist("institution")
    institutions = []
    for item in raw_institutions:
        if "," in item:
            for part in item.split(","):
                part_clean = part.strip()
                if part_clean:
                    expanded = resolve_institution_codes(part_clean)
                    institutions.extend(expanded)
        elif item.strip():
            expanded = resolve_institution_codes(item.strip())
            institutions.extend(expanded)

    institutions = list(dict.fromkeys(institutions))
    if institutions:
        clauses.append(f"q.institution_code IN ({','.join('?' * len(institutions))})")
        params.extend(institutions)

    years = args.getlist("year")
    if years:
        clauses.append(f"q.year IN ({','.join('?' * len(years))})")
        params.extend(years)

    sources = args.getlist("source")
    if sources:
        clauses.append(f"q.source_file IN ({','.join('?' * len(sources))})")
        params.extend(sources)

    raw_areas = args.getlist("area")
    if raw_areas:
        areas = []
        for a in raw_areas:
            areas.append(a)
            if a == "Medicina Preventiva":
                areas.append("Medicina Preventiva e Social")
            elif a == "Medicina Preventiva e Social":
                areas.append("Medicina Preventiva")
        areas = list(dict.fromkeys(areas))
        clauses.append(f"q.area IN ({','.join('?' * len(areas))})")
        params.extend(areas)

    specialties = args.getlist("specialty")
    if specialties:
        clauses.append(f"q.specialty IN ({','.join('?' * len(specialties))})")
        params.extend(specialties)

    subtemas = args.getlist("subtema")
    if subtemas:
        clauses.append(f"q.subtema IN ({','.join('?' * len(subtemas))})")
        params.extend(subtemas)

    topics = args.getlist("topic")
    if topics:
        clauses.append(f"q.topic IN ({','.join('?' * len(topics))})")
        params.extend(topics)

    raw_status = (args.get("status") or "all").strip().lower()
    status_tokens = [s.strip() for s in raw_status.split(",") if s.strip() and s.strip() != "all"]
    unanswered_only = args.get("unanswered_only")
    if not status_tokens and unanswered_only in ("true", "1"):
        status_tokens = ["unanswered"]

    if status_tokens:
        status_or_clauses = []
        status_params = []
        for st in status_tokens:
            if st in ("unanswered", "new"):
                status_or_clauses.append("q.id NOT IN (SELECT question_id FROM attempts WHERE user_id = ?)")
                status_params.append(g.user_id)
            elif st == "wrong":
                status_or_clauses.append("""q.id IN (
                    SELECT question_id FROM attempts a1 WHERE a1.user_id = ? AND a1.is_correct = 0
                    AND a1.id = (SELECT MAX(a2.id) FROM attempts a2 WHERE a2.user_id = ? AND a2.question_id = a1.question_id)
                )""")
                status_params.extend([g.user_id, g.user_id])
            elif st == "answered":
                status_or_clauses.append("q.id IN (SELECT question_id FROM attempts WHERE user_id = ?)")
                status_params.append(g.user_id)
            elif st == "srs_due":
                status_or_clauses.append("q.id IN (SELECT question_id FROM spaced_repetition WHERE user_id = ? AND next_review_date <= ?)")
                status_params.extend([g.user_id, datetime.now(timezone.utc).isoformat()])
            elif st == "favorite":
                status_or_clauses.append("q.id IN (SELECT question_id FROM favorites WHERE user_id = ?)")
                status_params.append(g.user_id)
        if status_or_clauses:
            clauses.append("(" + " OR ".join(status_or_clauses) + ")")
            params.extend(status_params)

    if args.get("favorite") in ("1", "true"):
        clauses.append("q.id IN (SELECT question_id FROM favorites WHERE user_id = ?)")
        params.append(g.user_id)

    if args.get("has_images") in ("1", "true"):
        clauses.append("q.id IN (SELECT question_id FROM question_images)")

    if args.get("exclude_annulled") in ("1", "true"):
        clauses.append("UPPER(COALESCE(q.correct_letter, '')) != 'ANULADA'")

    q_type = (args.get("question_type") or "").strip().lower()
    if q_type == "objetiva":
        clauses.append("(SELECT COUNT(*) FROM alternatives a WHERE a.question_id = q.id) > 1")
    elif q_type == "discursiva":
        clauses.append("(SELECT COUNT(*) FROM alternatives a WHERE a.question_id = q.id) <= 1")

    if args.get("id"):
        clauses.append("q.id = ?")
        params.append(args.get("id"))

    return clauses, params


TARGET_INSTITUTION_RATIO = 0.40


def get_user_target_institutions(db, user_id: str) -> set[str]:
    """Retorna o conjunto expandido de institution_codes alvo do usuário (configurados no planejador de residência)."""
    if not user_id:
        return set()

    db_scope = os.environ.get("MEDQUEST_DB") or os.environ.get("TURSO_DATABASE_URL") or "default"
    cache_key = (user_id, db_scope)
    cached = target_institutions_cache.get(cache_key)
    if cached is not None:
        return set(cached)

    try:
        row = db.execute(
            "SELECT target_institution FROM planner_config WHERE user_id = ?",
            (user_id,)
        ).fetchone()
    except Exception:
        return set()

    if not row:
        target_institutions_cache.set(cache_key, frozenset())
        return set()

    try:
        raw = row["target_institution"]
    except Exception:
        return set()

    if not raw or not isinstance(raw, str):
        target_institutions_cache.set(cache_key, frozenset())
        return set()

    codes = set()
    for part in raw.split(","):
        clean = part.strip()
        if clean and clean.upper() not in ("TODAS AS BANCAS", "TODAS", "OUTRA"):
            expanded = resolve_institution_codes(clean)
            for exp in expanded:
                codes.add(exp)
                codes.add(exp.upper())
    target_institutions_cache.set(cache_key, frozenset(codes))
    return codes


