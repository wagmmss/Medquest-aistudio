"""Blueprint: metadados, listagem/fila de estudo, detalhe, tentativa e favoritos."""
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

logger = logging.getLogger(__name__)

from . import srs
from .cache import SimpleTTLCache
from .adaptive import rank_adaptive_candidates
from .remediation import generate_remediation_queue
from .tri_engine import evaluate_tri_performance
from .db import db_transaction, get_db
from .edital_profiles import ALLOWED_ANALYSIS_INSTITUTIONS, get_canonical_institution, resolve_institution_codes
from .filters import TARGET_INSTITUTION_RATIO, get_user_target_institutions, question_filter_clauses
from .services.questions_service import (
    _bounded_int,
    _defer_question_review,
    _fetch_batch_metadata,
    _fetch_srs_map,
    _fts5_escape,
    _fts5_or_query,
    _fts_phrase,
    _resolve_answered_at,
    _sample_ids,
    _sample_prioritized_ids,
    check_is_correct,
)
from .idempotency import complete_idempotency, fail_idempotency, reserve_idempotency
from .observability import record_domain_event
from .schemas import (
    AttemptIn,
    BatchAttemptIn,
    FavoriteIn,
    QuestionBatchIn,
    ReviewIn,
    SimuladoCustomIn,
    SimuladoSessionIn,
    ValidationError,
    validation_errors,
)


meta_cache = SimpleTTLCache(60)
count_cache = SimpleTTLCache(60, max_size=1000)

bp = Blueprint("questions", __name__)


def invalidate_user_caches(user_id):
    """Invalidate every derived per-user view after a successful mutation."""
    meta_cache.clear_user(user_id)
    count_cache.clear_user(user_id)
    from .filters import target_institutions_cache
    target_institutions_cache.clear_user(user_id)
    from .stats import overview_cache
    overview_cache.clear_user(user_id)
    from .adaptive import _profile_cache, clear_user_last_known_profile
    _profile_cache.clear_user(user_id)
    clear_user_last_known_profile(user_id)


def invalidate_global_question_caches():
    """Invalidate global question metadata and totals caches after curator edits."""
    meta_cache.clear()
    count_cache.clear()
    from .stats import _q_totals_cache
    _q_totals_cache.clear()



@bp.route("/simulado/usp")
def simulado_usp():
    db = get_db()
    area_groups = [
        ("Cirurgia",),
        ("Clínica Médica",),
        ("Pediatria",),
        ("Ginecologia e Obstetrícia",),
        ("Medicina Preventiva", "Medicina Preventiva e Social"),
    ]
    all_ids = []
    for area_aliases in area_groups:
        ph = ",".join("?" * len(area_aliases))
        where = f"q.institution_code IN ('USP-SP', 'USP-RP') AND q.area IN ({ph}) AND q.missing_alts = 0"
        ids = _sample_ids(db, where, area_aliases, 24)
        all_ids.extend(ids)

    if not all_ids:
        return jsonify([])
    placeholders = ",".join("?" * len(all_ids))
    rows = db.execute(
        f"""SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                   q.institution_label, q.topic, q.area, q.subtema, q.editorial_status
            FROM questions q WHERE q.id IN ({placeholders})""",
        all_ids,
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["is_autoral"] = bool(d.get("editorial_status") == "autoral" or (d.get("source_file") and "AUTORAL" in d.get("source_file").upper()))
        out.append(d)
    random.shuffle(out)
    return jsonify(out)


@bp.route("/simulado/custom", methods=["POST"])
def simulado_custom():
    db = get_db()
    try:
        data = SimuladoCustomIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
    raw_institutions = [value[:64] for value in data.institutions]
    institutions = []
    for inst in raw_institutions:
        institutions.extend(resolve_institution_codes(inst))
    institutions = list(dict.fromkeys(institutions))
    years = [value[:4] for value in data.years]
    q_per_area = data.questions_per_area
    
    area_groups = [
        ("Cirurgia",),
        ("Clínica Médica",),
        ("Pediatria",),
        ("Ginecologia e Obstetrícia",),
        ("Medicina Preventiva", "Medicina Preventiva e Social"),
    ]
    all_ids = []
    
    # Montar restrições
    base_clauses = ["q.missing_alts = 0"]
    base_params = []
    
    if institutions:
        placeholders = ",".join("?" * len(institutions))
        base_clauses.append(f"q.institution_code IN ({placeholders})")
        base_params.extend(institutions)
        
    if years:
        placeholders = ",".join("?" * len(years))
        base_clauses.append(f"q.year IN ({placeholders})")
        base_params.extend(years)
        
    for area_aliases in area_groups:
        ph = ",".join("?" * len(area_aliases))
        clauses = base_clauses + [f"q.area IN ({ph})"]
        params = base_params + list(area_aliases)
        where = " AND ".join(clauses)
        ids = _sample_ids(db, where, tuple(params), q_per_area)
        all_ids.extend(ids)
        
    if not all_ids:
        return jsonify([])
        
    placeholders = ",".join("?" * len(all_ids))
    rows = db.execute(
        f"""SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                   q.institution_label, q.topic, q.area, q.subtema, q.editorial_status
            FROM questions q WHERE q.id IN ({placeholders})""",
        all_ids,
    ).fetchall()
    
    out = []
    for r in rows:
        d = dict(r)
        d["is_autoral"] = bool(d.get("editorial_status") == "autoral" or (d.get("source_file") and "AUTORAL" in d.get("source_file").upper()))
        out.append(d)
    random.shuffle(out)
    return jsonify(out)


@bp.route("/simulado/official-exams", methods=["GET"])
def simulado_official_exams():
    db = get_db()
    include_similar = request.args.get("similar_institutions") in ("1", "true", "True")
    target_institutions = ["USP-SP", "USP-RP", "UNICAMP", "UNIFESP", "SUS-SP"]
    if include_similar:
        target_institutions.extend(["ENARE", "FAMEMA", "FAMERP", "HSL", "EINSTEIN", "IAMSPE", "SCM-SP"])
    
    institution_meta = {
        "USP-SP": {
            "name": "USP - São Paulo",
            "full_name": "Universidade de São Paulo (Capital)",
            "standard_duration": 300,
            "badge_color": "blue",
            "typical_questions": 120,
        },
        "USP-RP": {
            "name": "USP - Ribeirão Preto",
            "full_name": "Faculdade de Medicina de Ribeirão Preto (USP)",
            "standard_duration": 240,
            "badge_color": "indigo",
            "typical_questions": 100,
        },
        "UNICAMP": {
            "name": "UNICAMP",
            "full_name": "Universidade Estadual de Campinas",
            "standard_duration": 240,
            "badge_color": "rose",
            "typical_questions": 80,
        },
        "UNIFESP": {
            "name": "UNIFESP",
            "full_name": "Escola Paulista de Medicina (EPM / UNIFESP)",
            "standard_duration": 240,
            "badge_color": "cyan",
            "typical_questions": 100,
        },
        "SUS-SP": {
            "name": "SUS-SP",
            "full_name": "Secretaria de Estado da Saúde de São Paulo",
            "standard_duration": 240,
            "badge_color": "emerald",
            "typical_questions": 100,
        },
        "ENARE": {
            "name": "ENARE",
            "full_name": "Exame Nacional de Residência",
            "standard_duration": 300,
            "badge_color": "amber",
            "typical_questions": 100,
        },
        "FAMEMA": {
            "name": "FAMEMA",
            "full_name": "Faculdade de Medicina de Marília",
            "standard_duration": 240,
            "badge_color": "sky",
            "typical_questions": 100,
        },
        "FAMERP": {
            "name": "FAMERP",
            "full_name": "Faculdade de Medicina de São José do Rio Preto",
            "standard_duration": 240,
            "badge_color": "teal",
            "typical_questions": 80,
        },
        "HSL": {
            "name": "Sírio-Libanês",
            "full_name": "Hospital Sírio-Libanês",
            "standard_duration": 240,
            "badge_color": "purple",
            "typical_questions": 100,
        },
        "EINSTEIN": {
            "name": "Einstein",
            "full_name": "Hospital Israelita Albert Einstein",
            "standard_duration": 240,
            "badge_color": "slate",
            "typical_questions": 75,
        },
        "IAMSPE": {
            "name": "IAMSPE",
            "full_name": "Instituto de Assistência Médica ao Servidor Público Estadual",
            "standard_duration": 240,
            "badge_color": "orange",
            "typical_questions": 100,
        },
        "SCM-SP": {
            "name": "Santa Casa SP",
            "full_name": "Irmandade da Santa Casa de Misericórdia de São Paulo",
            "standard_duration": 240,
            "badge_color": "pink",
            "typical_questions": 100,
        },
    }

    inst_codes_query = ["USP-SP", "USP", "USP-RP", "UNICAMP", "UNIFESP", "SUS-SP", "SUS"]
    if include_similar:
        inst_codes_query.extend(["ENARE", "FAMEMA", "FAMERP", "HSL", "EINSTEIN", "IAMSPE", "SCM-SP", "SCMSP", "SCM"])
    placeholders = ",".join("?" * len(inst_codes_query))

    rows = db.execute(f"""
        SELECT institution_code, year, COUNT(*) as n 
        FROM questions 
        WHERE missing_alts = 0 
          AND institution_code IN ({placeholders})
        GROUP BY institution_code, year
        ORDER BY year DESC
    """, inst_codes_query).fetchall()

    grouped_years = {inst: {} for inst in target_institutions}
    for r in rows:
        canon = get_canonical_institution(r["institution_code"])
        if canon in grouped_years and r["year"]:
            grouped_years[canon][r["year"]] = grouped_years[canon].get(r["year"], 0) + r["n"]

    exams = []
    for inst in target_institutions:
        years_dict = grouped_years.get(inst, {})
        editions = []
        for y in sorted(years_dict.keys(), reverse=True):
            count = years_dict[y]
            meta = institution_meta.get(inst, {})
            typical_q = meta.get("typical_questions", 100)
            target_q = min(count, typical_q)
            duration = meta.get("standard_duration", 240)
            editions.append({
                "year": y,
                "total_available": count,
                "recommended_questions": target_q,
                "duration_minutes": duration,
            })
        
        exams.append({
            "institution_code": inst,
            "name": institution_meta[inst]["name"],
            "full_name": institution_meta[inst]["full_name"],
            "badge_color": institution_meta[inst]["badge_color"],
            "editions": editions,
        })

    return jsonify({"exams": exams})


@bp.route("/simulado/sessions", methods=["GET"])
def get_simulado_sessions():
    db = get_db()
    rows = db.execute("""
        SELECT id, client_session_id, planned_duration_seconds, elapsed_seconds,
               total_questions, answered_count, correct_count,
               filters_json, area_results_json, completed_at
        FROM simulado_sessions
        WHERE user_id = ?
        ORDER BY completed_at DESC
        LIMIT 30
    """, (g.user_id,)).fetchall()

    sessions = []
    for r in rows:
        d = dict(r)
        try:
            d["filters"] = json.loads(d.pop("filters_json") or "{}")
        except Exception:
            d["filters"] = {}
        try:
            d["area_results"] = json.loads(d.pop("area_results_json") or "[]")
        except Exception:
            d["area_results"] = []
        
        total = d.get("total_questions", 0)
        correct = d.get("correct_count", 0)
        d["accuracy_percent"] = round((correct / total) * 100, 1) if total > 0 else 0.0
        sessions.append(d)

    return jsonify({"sessions": sessions})


@bp.route("/simulado/sessions/<session_id>", methods=["DELETE"])
def delete_simulado_session(session_id):
    db = get_db()
    with db_transaction(db, immediate=True):
        res = db.execute("DELETE FROM simulado_sessions WHERE client_session_id = ? AND user_id = ?", (session_id, g.user_id))
    return jsonify({"success": True, "deleted": res.rowcount > 0})


@bp.route("/simulado/sessions", methods=["POST"])
def save_simulado_session():
    db = get_db()
    raw_payload = request.get_data()
    cached_resp, err_resp, lease_token = reserve_idempotency(db, g.user_id, request.path, request.method, raw_payload)
    if cached_resp is not None:
        return cached_resp
    if err_resp is not None:
        return err_resp

    try:
        try:
            data = SimuladoSessionIn.model_validate(request.get_json(force=True) or {})
        except ValidationError as e:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

        completed_at = datetime.now(timezone.utc).isoformat()
        with db_transaction(db, immediate=True):
            db.execute("""INSERT INTO simulado_sessions
                (client_session_id, planned_duration_seconds, elapsed_seconds, total_questions, answered_count,
                 correct_count, filters_json, area_results_json, completed_at, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, client_session_id) DO UPDATE SET
                  planned_duration_seconds=excluded.planned_duration_seconds, elapsed_seconds=excluded.elapsed_seconds,
                  total_questions=excluded.total_questions, answered_count=excluded.answered_count,
                  correct_count=excluded.correct_count, filters_json=excluded.filters_json,
                  area_results_json=excluded.area_results_json, completed_at=excluded.completed_at
            """, (data.client_session_id, data.planned_duration_seconds, data.elapsed_seconds,
                   data.total_questions, data.answered_count, data.correct_count,
                   json.dumps(data.filters), json.dumps(data.area_results), completed_at, g.user_id))

        record_domain_event(
            "simulado_completed",
            user_id=g.user_id,
            session_id=data.client_session_id,
            total_questions=data.total_questions,
            answered_count=data.answered_count,
            correct_count=data.correct_count,
            elapsed_seconds=data.elapsed_seconds,
        )
        resp_data = {"success": True}
        if lease_token:
            complete_idempotency(db, g.user_id, 200, resp_data, lease_token)
        return jsonify(resp_data)
    except Exception:
        if lease_token:
            fail_idempotency(db, g.user_id, lease_token)
        raise


@bp.route("/simulado/tri-evaluation", methods=["POST"])
def simulado_tri_evaluation():
    db = get_db()
    data = request.get_json(force=True) or {}
    attempts = data.get("responses") if "responses" in data else data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []
    institution = data.get("institution_code") or data.get("institution") or "ENARE"
    return jsonify(evaluate_tri_performance(db, attempts, institution_code=str(institution)))


@bp.route("/search")
def search_questions():
    db = get_db()
    q = request.args.get("q", "").strip()
    institution = request.args.get("institution", "").strip()
    area = request.args.get("area", "").strip()
    year = request.args.get("year", "").strip()
    has_images = request.args.get("has_images", "false").lower() in ("true", "1")
    try:
        limit = min(max(int(request.args.get("limit", 50)), 1), 100)
    except (ValueError, TypeError):
        limit = 50
    try:
        offset = max(int(request.args.get("offset", 0)), 0)
    except (ValueError, TypeError):
        offset = 0

    if not q and not (institution or area or year or has_images):
        return jsonify([])

    semantic = request.args.get("semantic", "false").lower() == "true"

    # Construção de filtros adicionais SQL
    extra_filters = []
    extra_params = []
    if institution:
        extra_filters.append("q.institution_code = ?")
        extra_params.append(institution)
    if area:
        if area in ("Medicina Preventiva", "Medicina Preventiva e Social"):
            extra_filters.append("q.area IN (?, ?)")
            extra_params.extend(["Medicina Preventiva", "Medicina Preventiva e Social"])
        else:
            extra_filters.append("q.area = ?")
            extra_params.append(area)
    if year:
        try:
            extra_filters.append("q.year = ?")
            extra_params.append(int(year))
        except ValueError:
            pass
    if has_images:
        extra_filters.append("EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id)")

    and_clause = ""
    if extra_filters:
        and_clause = " AND " + " AND ".join(extra_filters)

    rows = []
    # 1. Tenta consulta nativa FTS5 (otimização C SQLite) se houver termo textual
    if q:
        try:
            if semantic:
                from .ai import expand_search_query
                expanded_terms = expand_search_query(q)
                fts_query = _fts5_or_query(expanded_terms)
            else:
                fts_query = _fts5_escape(q)
                
            if fts_query:
                try:
                    sql_fts = f"""
                        SELECT q.id, q.institution_code, q.year, q.area, q.subtema, q.source_file, q.editorial_status,
                               snippet(questions_fts, 0, '<b>', '</b>', '...', 25) as stem_snippet,
                               snippet(questions_fts, 1, '<b>', '</b>', '...', 25) as exp_snippet,
                               EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id) as has_image
                        FROM questions_fts f
                        JOIN questions q ON q.id = f.rowid
                        WHERE questions_fts MATCH ? {and_clause}
                        ORDER BY bm25(questions_fts)
                        LIMIT ? OFFSET ?
                    """
                    rows = db.execute(sql_fts, [fts_query, *extra_params, limit, offset]).fetchall()
                except Exception:
                    sql_fts = f"""
                        SELECT q.id, q.institution_code, q.year, q.area, q.subtema, q.source_file, q.editorial_status,
                               snippet(questions_fts, 0, '<b>', '</b>', '...', 25) as stem_snippet,
                               snippet(questions_fts, 1, '<b>', '</b>', '...', 25) as exp_snippet,
                               EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id) as has_image
                        FROM questions_fts f
                        JOIN questions q ON q.id = f.rowid
                        WHERE questions_fts MATCH ? {and_clause}
                        ORDER BY f.rowid DESC
                        LIMIT ? OFFSET ?
                    """
                    rows = db.execute(sql_fts, [fts_query, *extra_params, limit, offset]).fetchall()
        except Exception as fts_err:
            logger.warning("FTS5 indisponivel ou consulta invalida (%s), acionando fallback", fts_err)
            rows = []

        # 2. Fallback resiliente com LIKE caso FTS5 nao encontre resultados ou ocorra falha
        if not rows:
            def make_like_clauses(term_list, joiner="AND"):
                clauses = []
                params = []
                for term in term_list:
                    if not term: continue
                    term_clean = term.replace("%", "").replace("_", "")
                    if len(term_clean) < 2: continue
                    clauses.append("(q.stem LIKE ? OR e.explanation_text LIKE ? OR q.area LIKE ? OR q.subtema LIKE ?)")
                    like_val = f"%{term_clean}%"
                    params.extend([like_val, like_val, like_val, like_val])
                if not clauses:
                    return "", []
                return f"({f' {joiner} '.join(clauses)})", params

            if semantic:
                from .ai import expand_search_query
                expanded_terms = expand_search_query(q)
                where_sql, params = make_like_clauses(expanded_terms, "OR")
            else:
                terms = re.findall(r"\w+", q, flags=re.UNICODE)[:12]
                where_sql, params = make_like_clauses(terms, "AND")

            if where_sql:
                rows = db.execute(f"""
                    SELECT q.id, q.institution_code, q.year, q.area, q.subtema, q.source_file, q.editorial_status,
                           SUBSTR(q.stem, 1, 150) as stem_snippet,
                           SUBSTR(e.explanation_text, 1, 150) as exp_snippet,
                           EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id) as has_image
                    FROM questions q
                    LEFT JOIN explanations e ON q.id = e.question_id
                    WHERE {where_sql} {and_clause}
                    ORDER BY q.id DESC
                    LIMIT ? OFFSET ?
                """, [*params, *extra_params, limit, offset]).fetchall()
    else:
        # Busca estruturada por filtros diretos
        where_pure = and_clause.replace(" AND ", "", 1) if and_clause else "1=1"
        rows = db.execute(f"""
            SELECT q.id, q.institution_code, q.year, q.area, q.subtema, q.source_file, q.editorial_status,
                   SUBSTR(q.stem, 1, 150) as stem_snippet,
                   SUBSTR(e.explanation_text, 1, 150) as exp_snippet,
                   EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id) as has_image
            FROM questions q
            LEFT JOIN explanations e ON q.id = e.question_id
            WHERE {where_pure}
            ORDER BY q.id DESC
            LIMIT ? OFFSET ?
        """, [*extra_params, limit, offset]).fetchall()

    out = []
    for row in rows:
        item = dict(row)
        item["is_autoral"] = bool(item.get("editorial_status") == "autoral" or (item.get("source_file") and "AUTORAL" in str(item.get("source_file")).upper()))
        item["has_image"] = bool(item.get("has_image", 0))
        stem_snip = item.get("stem_snippet") or ""
        # Remove eventuais tags de imagem e URLs soltas que poluem o snippet da busca
        stem_snip = re.sub(r'!\[.*?\]\(.*?\)', '', stem_snip)
        stem_snip = re.sub(r'<img\b[^>]*>', '', stem_snip)
        stem_snip = re.sub(r'\s+', ' ', stem_snip).strip()
        if stem_snip and not stem_snip.endswith("..."):
            stem_snip += "..."
        item["stem_snippet"] = stem_snip
        exp_snip = item.get("exp_snippet") or ""
        exp_snip = re.sub(r'!\[.*?\]\(.*?\)', '', exp_snip)
        exp_snip = re.sub(r'<img\b[^>]*>', '', exp_snip)
        exp_snip = re.sub(r'\s+', ' ', exp_snip).strip()
        if exp_snip and not exp_snip.endswith("..."):
            exp_snip += "..."
        item["exp_snippet"] = exp_snip
        out.append(item)

    record_domain_event(
        "search_executed",
        user_id=g.user_id,
        query_length=len(q),
        query_terms=len(re.findall(r"\w+", q, flags=re.UNICODE)),
        results_count=len(out),
        semantic=semantic,
    )
    return jsonify(out)


@bp.route("/meta")
def meta():
    # Preserva valores repetidos (ex.: institution=A&institution=B) e faz
    # consultas equivalentes compartilharem a mesma entrada de cache.
    normalized_args = tuple(sorted(
        (key, tuple(sorted(values)))
        for key, values in request.args.lists()
    ))
    cache_key = (g.user_id, normalized_args)
    cached = meta_cache.get(cache_key)
    if cached:
        return jsonify(cached)

    db = get_db()
    clauses, params = question_filter_clauses(request.args)
    
    # We must replace q. with empty or alias questions as q
    # Because question_filter_clauses assumes "q.institution_code" etc
    where = " AND ".join(clauses)

    from werkzeug.datastructures import MultiDict
    args_no_subtema = MultiDict((k, v) for k, v in request.args.items(multi=True) if k != 'subtema')
    clauses_no_subtema, params_no_subtema = question_filter_clauses(args_no_subtema)
    where_no_subtema = " AND ".join(clauses_no_subtema)

    answered_params = list(params)
    answered_params.append(g.user_id)

    queries = [
        (f"SELECT q.institution_code, q.institution_label, COUNT(*) n FROM questions q WHERE {where} GROUP BY q.institution_code ORDER BY n DESC", params),
        (f"SELECT DISTINCT q.year FROM questions q WHERE q.year IS NOT NULL AND {where} ORDER BY q.year", params),
        (f"SELECT q.area, COUNT(*) n FROM questions q WHERE q.area IS NOT NULL AND q.area != '' AND {where} GROUP BY q.area ORDER BY n DESC", params),
        (f"SELECT q.subtema, COUNT(*) n FROM questions q WHERE q.subtema IS NOT NULL AND q.subtema != '' AND {where_no_subtema} GROUP BY q.subtema ORDER BY n DESC LIMIT 300", params_no_subtema),
        (f"SELECT q.topic, COUNT(*) n FROM questions q WHERE q.topic IS NOT NULL AND q.topic != '' AND {where_no_subtema} GROUP BY q.topic ORDER BY n DESC LIMIT 500", params_no_subtema),
        (f"SELECT COUNT(*) n FROM questions q WHERE {where}", params),
        (f"SELECT COUNT(DISTINCT q.id) n FROM questions q WHERE {where} AND q.id IN (SELECT question_id FROM attempts WHERE user_id = ?)", answered_params)
    ]

    if hasattr(db, "batch"):
        results = db.batch(queries)
        institutions = results[0].fetchall()
        years = results[1].fetchall()
        areas = results[2].fetchall()
        subtemas = results[3].fetchall()
        topics = results[4].fetchall()
        total = results[5].fetchone()["n"]
        answered = results[6].fetchone()["n"]
    else:
        institutions = db.execute(queries[0][0], queries[0][1]).fetchall()
        years = db.execute(queries[1][0], queries[1][1]).fetchall()
        areas = db.execute(queries[2][0], queries[2][1]).fetchall()
        subtemas = db.execute(queries[3][0], queries[3][1]).fetchall()
        topics = db.execute(queries[4][0], queries[4][1]).fetchall()
        total = db.execute(queries[5][0], queries[5][1]).fetchone()["n"]
        answered = db.execute(queries[6][0], queries[6][1]).fetchone()["n"]
    
    merged_institutions: dict[str, dict] = {}
    for row in institutions:
        raw_code = row["institution_code"]
        canon_code = get_canonical_institution(raw_code) or raw_code
        if not canon_code:
            continue
        existing = merged_institutions.get(canon_code)
        if existing is None:
            merged_institutions[canon_code] = {
                "institution_code": canon_code,
                "institution_label": row["institution_label"] or canon_code,
                "n": int(row["n"] or 0),
            }
        else:
            existing["n"] += int(row["n"] or 0)
            if raw_code == canon_code and row["institution_label"]:
                existing["institution_label"] = row["institution_label"]

    deduped_institutions = sorted(
        merged_institutions.values(),
        key=lambda item: (-item["n"], item["institution_code"]),
    )

    result = {
        "institutions": deduped_institutions,
        "years": [r["year"] for r in years],
        "sources": [],
        "areas": [dict(r) for r in areas],
        "specialties": [],
        "subtemas": [dict(r) for r in subtemas],
        "topics": [dict(r) for r in topics],
        "total_questions": total,
        "answered_questions": answered,
        "target_institutions": sorted(list(get_user_target_institutions(db, g.user_id))),
    }
    
    meta_cache.set(cache_key, result)
    return jsonify(result)


@bp.route("/subtemas")
def subtemas():
    db = get_db()
    area = request.args.get("area")
    q = request.args.get("q", "").strip()
    clauses = ["subtema IS NOT NULL", "subtema != ''"]
    params = []
    if area:
        clauses.append("area = ?")
        params.append(area)
    if q:
        clauses.append("subtema LIKE ?")
        params.append(f"%{q}%")
    where = " AND ".join(clauses)
    rows = db.execute(
        f"SELECT subtema, COUNT(*) n FROM questions WHERE {where} GROUP BY subtema ORDER BY n DESC LIMIT 50",
        params,
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route("/questions")
def questions():
    db = get_db()
    clauses, params = question_filter_clauses(request.args)
    where = " AND ".join(clauses)
    limit = _bounded_int(request.args.get("limit"), default=500, minimum=1, maximum=2000)
    target_insts = get_user_target_institutions(db, g.user_id)
    has_explicit_inst = bool(request.args.getlist("institution"))

    if request.args.get("mode") == "adaptive":
        adaptive_focus = request.args.get("adaptive_focus", "balanced")
        return jsonify(rank_adaptive_candidates(
            db, g.user_id, where, params, limit, adaptive_focus=adaptive_focus, target_institutions=target_insts
        ))
    if request.args.get("mode") == "remediation":
        subtema = request.args.get("subtema")
        area = request.args.get("area")
        return jsonify(generate_remediation_queue(
            db, g.user_id, subtema=subtema, area=area, limit=limit, target_institutions=target_insts
        ))
    ids = _sample_prioritized_ids(db, where, params, limit, target_insts, has_explicit_inst_filter=has_explicit_inst)
    if not ids:
        return jsonify([])
    placeholders = ",".join("?" * len(ids))
    rows = db.execute(
        f"""SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                   q.institution_label, q.topic, q.area, q.subtema, q.editorial_status
            FROM questions q WHERE q.id IN ({placeholders})""",
        ids,
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["is_autoral"] = bool(d.get("editorial_status") == "autoral" or (d.get("source_file") and "AUTORAL" in str(d.get("source_file")).upper()))
        inst = d.get("institution_code")
        d["is_target_institution"] = bool(target_insts and (inst in target_insts or (inst and inst.upper() in target_insts)))
        out.append(d)
    random.shuffle(out)
    return jsonify(out)


@bp.route("/questions/remediation")
def questions_remediation():
    db = get_db()
    limit = _bounded_int(request.args.get("limit"), default=10, minimum=1, maximum=50)
    subtema = request.args.get("subtema")
    area = request.args.get("area")
    target_insts = get_user_target_institutions(db, g.user_id)
    return jsonify(generate_remediation_queue(db, g.user_id, subtema=subtema, area=area, limit=limit, target_institutions=target_insts))


@bp.route("/questions/count")
@bp.route("/questions/counts")
def questions_count():
    normalized_args = tuple(sorted(
        (key, tuple(sorted(values)))
        for key, values in request.args.lists()
    ))
    user_dependent_keys = ("status", "unanswered_only", "favorite")
    is_user_scoped = any(k in request.args for k in user_dependent_keys)
    cache_key = (getattr(g, "user_id", None) if is_user_scoped else None, normalized_args)

    cached = count_cache.get(cache_key)
    if cached is not None:
        return jsonify({"count": cached})

    db = get_db()
    clauses, params = question_filter_clauses(request.args)
    where = " AND ".join(clauses)
    row = db.execute(f"SELECT COUNT(*) AS n FROM questions q WHERE {where}", params).fetchone()
    n = row["n"] if row else 0

    count_cache.set(cache_key, n)
    return jsonify({"count": n})


@bp.route("/questions/<int:qid>")
def question_detail(qid):
    db = get_db()
    queries = [
        ("SELECT * FROM questions WHERE id = ?", (qid,)),
        ("SELECT letter, text FROM alternatives WHERE question_id = ? ORDER BY letter", (qid,)),
        ("SELECT file_path FROM question_images WHERE question_id = ? AND file_path NOT LIKE '%question_explanation_images%' ORDER BY order_index", (qid,)),
        ("SELECT selected_letter, is_correct FROM attempts WHERE question_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", (qid, g.user_id)),
        ("SELECT COUNT(*) as n FROM attempts WHERE question_id = ? AND is_correct = 0 AND user_id = ?", (qid, g.user_id)),
        ("SELECT 1 FROM favorites WHERE question_id = ? AND user_id = ?", (qid, g.user_id))
    ]
    
    res = None
    if hasattr(db, "batch"):
        try:
            res = db.batch(queries)
        except Exception:
            res = None

    if res is not None:
        q = res[0].fetchone()
        alts = res[1].fetchall()
        imgs = res[2].fetchall()
        last_attempt = res[3].fetchone()
        times_wrong = res[4].fetchone()["n"]
        is_favorite = res[5].fetchone()
    else:
        q = db.execute(queries[0][0], queries[0][1]).fetchone()
        alts = db.execute(queries[1][0], queries[1][1]).fetchall()
        imgs = db.execute(queries[2][0], queries[2][1]).fetchall()
        last_attempt = db.execute(queries[3][0], queries[3][1]).fetchone()
        times_wrong = db.execute(queries[4][0], queries[4][1]).fetchone()["n"]
        is_favorite = db.execute(queries[5][0], queries[5][1]).fetchone()
        
    if not q:
        return jsonify({"error": "not found", "code": "QUESTION_NOT_FOUND"}), 404
    q = dict(q)
        
    cc = None
    if q.get("clinical_case_id"):
        cc_row = db.execute("SELECT stem, images FROM clinical_cases WHERE id = ?", (q["clinical_case_id"],)).fetchone()
        if cc_row:
            cc = {
                "stem": cc_row["stem"],
                "images": json.loads(cc_row["images"]) if cc_row["images"] else []
            }

    target_insts = get_user_target_institutions(db, g.user_id)
    inst = q.get("institution_code")
    is_target_inst = bool(target_insts and (inst in target_insts or (inst and inst.upper() in target_insts)))

    return jsonify({
        "id": q["id"], "source_file": q["source_file"], "source_number": q["source_number"],
        "year": q["year"], "institution_code": q["institution_code"],
        "institution_label": q["institution_label"], "topic": q["topic"],
        "area": q["area"], "subtema": q["subtema"], "stem": q["stem"],
        "is_autoral": bool(q.get("editorial_status") == "autoral" or (q.get("source_file") and "AUTORAL" in str(q.get("source_file")).upper())),
        "is_discursive": bool(len(alts) <= 1),
        "is_verified": bool(q.get("is_verified", 0)),
        "is_target_institution": is_target_inst,
        "last_updated_at": q.get("last_updated_at"),
        "technical_note": q.get("technical_note"),
        "clinical_case": cc,
        "usp_macro": q.get("usp_macro"),
        "usp_micro": q.get("usp_micro"),
        "alternatives": [dict(a) for a in alts],
        "images": [i["file_path"] for i in imgs],
        "already_answered": dict(last_attempt) if last_attempt else None,
        "is_favorite": bool(is_favorite),
        "times_wrong": times_wrong,
    })


@bp.route("/questions/<int:qid>/attempt", methods=["POST"])
def submit_attempt(qid):
    db = get_db()
    raw_payload = request.get_data()

    cached_resp, err_resp, lease_token = reserve_idempotency(db, g.user_id, request.path, request.method, raw_payload)
    if cached_resp is not None:
        return cached_resp
    if err_resp is not None:
        return err_resp

    try:
        try:
            payload = AttemptIn.model_validate(request.get_json(force=True) or {})
        except ValidationError as e:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "invalid input", "code": "INVALID_INPUT", "details": validation_errors(e)}), 400

        q_exp_sql = """
            SELECT q.correct_letter, q.area, q.subtema, e.explanation_text
            FROM questions q
            LEFT JOIN explanations e ON e.question_id = q.id
            WHERE q.id = ?
        """
        alts_sql = "SELECT letter, is_correct FROM alternatives WHERE question_id = ?"

        pre_res = None
        if hasattr(db, "batch"):
            try:
                pre_res = db.batch([(q_exp_sql, (qid,)), (alts_sql, (qid,))])
            except Exception:
                pre_res = None

        if pre_res is not None:
            q = pre_res[0].fetchone()
            alts_rows = pre_res[1].fetchall()
        else:
            q = db.execute(q_exp_sql, (qid,)).fetchone()
            alts_rows = db.execute(alts_sql, (qid,)).fetchall()

        if not q:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "not found", "code": "QUESTION_NOT_FOUND"}), 404

        alts_count = len(alts_rows)
        is_discursive = bool(alts_count <= 1)
        correct_alts_set = {
            r["letter"].strip().upper()
            for r in alts_rows
            if r["is_correct"] and r["letter"]
        }
        explanation_text = q["explanation_text"]

        with db_transaction(db, immediate=True):
            selected = (payload.selected_letter or "A").upper()
            if payload.is_correct is not None:
                is_correct = 1 if payload.is_correct else 0
            elif is_discursive and payload.confidence == "defer":
                # For discursive questions with deferred confidence, initialize as 0 pending self-assessment
                is_correct = 0
            else:
                is_correct = check_is_correct(selected, q["correct_letter"], correct_alts_set)

            observed_at = _resolve_answered_at(payload.answered_at)
            assisted_flag = 1 if getattr(payload, "assisted", False) else 0
            try:
                cursor = db.execute(
                    """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, time_spent_ms, confidence, user_id, assisted)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (qid, selected, is_correct, observed_at,
                     payload.time_spent_ms, payload.confidence, g.user_id, assisted_flag),
                )
            except Exception:
                cursor = db.execute(
                    """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, time_spent_ms, confidence, user_id)
                       VALUES (?,?,?,?,?,?,?)""",
                    (qid, selected, is_correct, observed_at,
                     payload.time_spent_ms, payload.confidence, g.user_id),
                )
            attempt_id = getattr(cursor, "lastrowid", None)
            if not attempt_id:
                att_row = db.execute(
                    "SELECT id FROM attempts WHERE question_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                    (qid, g.user_id),
                ).fetchone()
                attempt_id = att_row["id"] if att_row else None

            # Repetição espaçada (FSRS)
            next_review = None
            if payload.confidence == "defer":
                _defer_question_review(db, qid, g.user_id)
                if payload.twin_for_question_id:
                    _defer_question_review(db, payload.twin_for_question_id, g.user_id)
            if payload.confidence != "defer":
                sr = db.execute("SELECT fsrs_card FROM spaced_repetition WHERE question_id = ? AND user_id = ?", (qid, g.user_id)).fetchone()
                try:
                    card_json, next_review = srs.review(
                        sr["fsrs_card"] if sr else None,
                        is_correct,
                        payload.confidence,
                        assisted=bool(assisted_flag),
                    )
                except Exception as srs_err:
                    logger.warning("Erro ao calcular FSRS na tentativa da questão %s: %s. Usando estado limpo.", qid, srs_err)
                    card_json, next_review = srs.review(
                        None,
                        is_correct,
                        payload.confidence,
                        assisted=bool(assisted_flag),
                    )
                db.execute("""
                    INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(question_id, user_id) DO UPDATE SET
                        next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
                """, (qid, next_review, card_json, g.user_id))

                if payload.twin_for_question_id:
                    orig_qid = payload.twin_for_question_id
                    orig_sr = db.execute("SELECT fsrs_card FROM spaced_repetition WHERE question_id = ? AND user_id = ?", (orig_qid, g.user_id)).fetchone()
                    try:
                        orig_card_json, orig_next_review = srs.review(
                            orig_sr["fsrs_card"] if orig_sr else None,
                            is_correct,
                            payload.confidence,
                            assisted=bool(assisted_flag),
                        )
                    except Exception as srs_err:
                        logger.warning("Erro ao calcular FSRS na questão espelho %s: %s. Usando estado limpo.", orig_qid, srs_err)
                        orig_card_json, orig_next_review = srs.review(
                            None,
                            is_correct,
                            payload.confidence,
                            assisted=bool(assisted_flag),
                        )
                    db.execute("""
                        INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(question_id, user_id) DO UPDATE SET
                            next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
                    """, (orig_qid, orig_next_review, orig_card_json, g.user_id))

            alt_stats = None
            if not is_discursive:
                stat_rows = db.execute(
                    """SELECT UPPER(TRIM(selected_letter)) AS letter, COUNT(*) AS cnt
                       FROM attempts
                       WHERE question_id = ? AND selected_letter IS NOT NULL AND TRIM(selected_letter) != ''
                       GROUP BY UPPER(TRIM(selected_letter))""",
                    (qid,),
                ).fetchall()
                total_votes = sum(int(r["cnt"] or 0) for r in stat_rows)
                if total_votes > 0:
                    alt_stats = {
                        r["letter"]: round((int(r["cnt"]) / total_votes) * 100)
                        for r in stat_rows
                        if r["letter"]
                    }

            # If it's a discursive question being revealed (confidence == "defer" and is_correct not explicitly given),
            # return is_correct: None so frontend enters self-assessment mode.
            reported_is_correct = None if (is_discursive and payload.confidence == "defer" and payload.is_correct is None) else bool(is_correct)
            
            resp_data = {
                "is_correct": reported_is_correct,
                "correct_letter": q["correct_letter"],
                "explanation": explanation_text,
                "next_review_date": next_review,
                "is_discursive": is_discursive,
                "attempt_id": attempt_id,
                "assisted": bool(assisted_flag),
                **({"alt_stats": alt_stats} if alt_stats else {}),
            }

            if lease_token:
                complete_idempotency(db, g.user_id, 200, resp_data, lease_token)

        invalidate_user_caches(g.user_id)
        record_domain_event(
            "study_attempt_completed",
            user_id=g.user_id,
            question_id=qid,
            is_correct=reported_is_correct,
            confidence=payload.confidence,
            time_spent_ms=payload.time_spent_ms,
            area=q["area"] if q else None,
            subtema=q["subtema"] if q else None,
        )
        return jsonify(resp_data)
    except Exception:
        if lease_token:
            fail_idempotency(db, g.user_id, lease_token)
        raise


@bp.route("/questions/<int:qid>/review", methods=["POST"])
def review_fsrs(qid):
    db = get_db()
    raw_payload = request.get_data()

    cached_resp, err_resp, lease_token = reserve_idempotency(db, g.user_id, request.path, request.method, raw_payload)
    if cached_resp is not None:
        return cached_resp
    if err_resp is not None:
        return err_resp

    try:
        try:
            data = ReviewIn.model_validate(request.get_json(force=True) or {})
        except ValidationError as e:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "invalid input", "code": "INVALID_INPUT", "details": validation_errors(e)}), 400
        confidence = data.confidence

        with db_transaction(db, immediate=True):
            if getattr(data, "attempt_id", None) is not None:
                try:
                    last_attempt = db.execute(
                        "SELECT id, is_correct, confidence, assisted FROM attempts WHERE id = ? AND question_id = ? AND user_id = ?",
                        (data.attempt_id, qid, g.user_id)
                    ).fetchone()
                except Exception:
                    last_attempt = db.execute(
                        "SELECT id, is_correct, confidence FROM attempts WHERE id = ? AND question_id = ? AND user_id = ?",
                        (data.attempt_id, qid, g.user_id)
                    ).fetchone()
            else:
                last_attempt = None

            if not last_attempt:
                try:
                    last_attempt = db.execute(
                        "SELECT id, is_correct, confidence, assisted FROM attempts WHERE question_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                        (qid, g.user_id)
                    ).fetchone()
                except Exception:
                    last_attempt = db.execute(
                        "SELECT id, is_correct, confidence FROM attempts WHERE question_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                        (qid, g.user_id)
                    ).fetchone()

            if not last_attempt:
                resp_data = {"error": "No attempt found", "code": "NO_ATTEMPT_FOUND"}
                if lease_token:
                    complete_idempotency(db, g.user_id, 400, resp_data, lease_token)
                return jsonify(resp_data), 400

            prev_confidence = last_attempt["confidence"]
            prev_is_correct = int(bool(last_attempt["is_correct"]))
            attempt_dict = dict(last_attempt)
            is_assisted = bool(data.assisted) if data.assisted is not None else bool(attempt_dict.get("assisted", 0))
            is_rectification = (
                data.is_correct is not None
                and int(bool(data.is_correct)) != prev_is_correct
            )

            # Evita avanço duplo no FSRS se esta tentativa já havia sido classificada antes
            # (mesmo que o cliente envie is_correct explícito em chamadas automáticas de fallback)
            if prev_confidence not in ("defer", None) and not is_rectification:
                existing_sr = db.execute(
                    "SELECT next_review_date FROM spaced_repetition WHERE question_id = ? AND user_id = ?",
                    (qid, g.user_id),
                ).fetchone()
                resp_data = {
                    "success": True,
                    "next_review_date": existing_sr["next_review_date"] if existing_sr else None,
                    "is_correct": bool(prev_is_correct),
                    "assisted": is_assisted,
                    "warning": "Confiança atualizada, mas FSRS retido na primeira impressão para evitar avanço duplo.",
                }
                if lease_token:
                    complete_idempotency(db, g.user_id, 200, resp_data, lease_token)
                return jsonify(resp_data)

            is_correct_for_srs = last_attempt["is_correct"]
            if data.is_correct is not None:
                is_correct_for_srs = 1 if data.is_correct else 0
                db.execute(
                    "UPDATE attempts SET confidence = ?, is_correct = ? WHERE id = ?",
                    (confidence, is_correct_for_srs, last_attempt["id"])
                )
            else:
                db.execute(
                    "UPDATE attempts SET confidence = ? WHERE id = ?",
                    (confidence, last_attempt["id"])
                )

            sr = db.execute("SELECT fsrs_card FROM spaced_repetition WHERE question_id = ? AND user_id = ?", (qid, g.user_id)).fetchone()
            try:
                card_json, next_review = srs.review(
                    sr["fsrs_card"] if sr else None,
                    is_correct_for_srs,
                    confidence,
                    assisted=is_assisted,
                )
            except Exception as srs_err:
                logger.warning("Erro ao calcular FSRS na revisão da questão %s: %s. Usando estado limpo.", qid, srs_err)
                card_json, next_review = srs.review(
                    None,
                    is_correct_for_srs,
                    confidence,
                    assisted=is_assisted,
                )
            db.execute("""
                INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(question_id, user_id) DO UPDATE SET
                    next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
            """, (qid, next_review, card_json, g.user_id))

            if data.twin_for_question_id:
                orig_qid = data.twin_for_question_id
                orig_sr = db.execute("SELECT fsrs_card FROM spaced_repetition WHERE question_id = ? AND user_id = ?", (orig_qid, g.user_id)).fetchone()
                try:
                    orig_card_json, orig_next_review = srs.review(
                        orig_sr["fsrs_card"] if orig_sr else None,
                        is_correct_for_srs,
                        confidence,
                        assisted=is_assisted,
                    )
                except Exception as srs_err:
                    logger.warning("Erro ao calcular FSRS na questão espelho %s: %s. Usando estado limpo.", orig_qid, srs_err)
                    orig_card_json, orig_next_review = srs.review(
                        None,
                        is_correct_for_srs,
                        confidence,
                        assisted=is_assisted,
                    )
                db.execute("""
                    INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(question_id, user_id) DO UPDATE SET
                        next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
                """, (orig_qid, orig_next_review, orig_card_json, g.user_id))

            resp_data = {
                "success": True,
                "next_review_date": next_review,
                "is_correct": bool(is_correct_for_srs),
                "assisted": is_assisted,
            }
            if lease_token:
                complete_idempotency(db, g.user_id, 200, resp_data, lease_token)

        invalidate_user_caches(g.user_id)
        return jsonify(resp_data)
    except Exception:
        if lease_token:
            fail_idempotency(db, g.user_id, lease_token)
        raise

def _process_single_attempt(
    db,
    item,
    user_id: int,
    answered_at: str,
    q_map: dict,
    correct_alts_map: dict,
    exp_map: dict,
    srs_map: dict
) -> dict | None:
    correct_letter = q_map.get(item.question_id)
    if not correct_letter:
        return None

    selected = (item.selected_letter or "A").upper()
    if item.is_correct is not None:
        is_correct = 1 if item.is_correct else 0
    else:
        is_correct = check_is_correct(selected, correct_letter, correct_alts_map.get(item.question_id))
    conf = item.confidence or "certeza"
    is_assisted = bool(getattr(item, "assisted", False))
    item_answered_at = _resolve_answered_at(getattr(item, "answered_at", None)) if getattr(item, "answered_at", None) else answered_at

    try:
        db.execute(
            """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, time_spent_ms, confidence, user_id, assisted)
               VALUES (?,?,?,?,?,?,?,?)""",
            (item.question_id, selected, is_correct, item_answered_at, item.time_spent_ms, conf, user_id, 1 if is_assisted else 0),
        )
    except Exception:
        db.execute(
            """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, time_spent_ms, confidence, user_id)
               VALUES (?,?,?,?,?,?,?)""",
            (item.question_id, selected, is_correct, item_answered_at, item.time_spent_ms, conf, user_id),
        )

    next_review = None
    if conf == "defer":
        _defer_question_review(db, item.question_id, user_id)
        if getattr(item, "twin_for_question_id", None):
            _defer_question_review(db, item.twin_for_question_id, user_id)
    else:
        old_card = srs_map.get(item.question_id)
        try:
            card_json, next_review = srs.review(old_card, is_correct, conf, assisted=is_assisted)
        except Exception as srs_err:
            logger.warning("Erro ao calcular FSRS no lote para questão %s: %s. Usando estado limpo.", item.question_id, srs_err)
            card_json, next_review = srs.review(None, is_correct, conf, assisted=is_assisted)
        srs_map[item.question_id] = card_json
        db.execute("""
            INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(question_id, user_id) DO UPDATE SET
                next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
        """, (item.question_id, next_review, card_json, user_id))

        if getattr(item, "twin_for_question_id", None):
            orig_qid = item.twin_for_question_id
            orig_card = srs_map.get(orig_qid)
            try:
                orig_card_json, orig_next_review = srs.review(orig_card, is_correct, conf, assisted=is_assisted)
            except Exception as srs_err:
                logger.warning("Erro ao calcular FSRS no lote para questão espelho %s: %s. Usando estado limpo.", orig_qid, srs_err)
                orig_card_json, orig_next_review = srs.review(None, is_correct, conf, assisted=is_assisted)
            srs_map[orig_qid] = orig_card_json
            db.execute("""
                INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(question_id, user_id) DO UPDATE SET
                    next_review_date = excluded.next_review_date, fsrs_card = excluded.fsrs_card
            """, (orig_qid, orig_next_review, orig_card_json, user_id))

    return {
        "question_id": item.question_id,
        "is_correct": bool(is_correct),
        "correct_letter": correct_letter,
        "explanation": exp_map.get(item.question_id),
        "next_review_date": next_review,
        "assisted": is_assisted,
    }


@bp.route("/attempt/batch", methods=["POST"])
def submit_attempt_batch():
    db = get_db()
    raw_payload = request.get_data()

    cached_resp, err_resp, lease_token = reserve_idempotency(db, g.user_id, request.path, request.method, raw_payload)
    if cached_resp is not None:
        return cached_resp
    if err_resp is not None:
        return err_resp

    try:
        try:
            payload = BatchAttemptIn.model_validate(request.get_json(force=True) or {})
        except ValidationError as e:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

        results = []
        answered_at = datetime.now(timezone.utc).isoformat()

        # To avoid many SELECTs, get all correct_letters and explanations at once
        q_ids = [item.question_id for item in payload.attempts]
        if not q_ids:
            resp_data = {"results": []}
            with db_transaction(db, immediate=True):
                if lease_token:
                    complete_idempotency(db, g.user_id, 200, resp_data, lease_token)
            return jsonify(resp_data)

        q_map, correct_alts_map, exp_map = _fetch_batch_metadata(db, q_ids)
        srs_q_ids = list(q_ids)
        for item in payload.attempts:
            twin_id = getattr(item, "twin_for_question_id", None)
            if twin_id:
                srs_q_ids.append(twin_id)
                
        with db_transaction(db, immediate=True):
            # Read FSRS cards after acquiring the write transaction. Otherwise
            # a concurrent batch can advance a card between this read and UPSERT.
            srs_map = _fetch_srs_map(db, srs_q_ids, g.user_id)

            for item in payload.attempts:
                res = _process_single_attempt(
                    db, item, g.user_id, answered_at, q_map, correct_alts_map, exp_map, srs_map
                )
                if res:
                    results.append(res)

            resp_data = {"results": results}
            if lease_token:
                complete_idempotency(db, g.user_id, 200, resp_data, lease_token)

        invalidate_user_caches(g.user_id)
        return jsonify(resp_data)
    except Exception:
        if lease_token:
            fail_idempotency(db, g.user_id, lease_token)
        raise


@bp.route("/questions/<int:qid>/favorite", methods=["POST"])
def toggle_favorite(qid):
    db = get_db()
    raw_payload = request.get_data()

    cached_resp, err_resp, lease_token = reserve_idempotency(db, g.user_id, request.path, request.method, raw_payload)
    if cached_resp is not None:
        return cached_resp
    if err_resp is not None:
        return err_resp

    try:
        try:
            data = FavoriteIn.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400
        target_fav = data.is_favorite

        q = db.execute("SELECT id FROM questions WHERE id = ?", (qid,)).fetchone()
        if not q:
            if lease_token:
                fail_idempotency(db, g.user_id, lease_token)
            return jsonify({"error": "Questão não encontrada"}), 404

        with db_transaction(db, immediate=True):
            if target_fav is not None:
                if target_fav:
                    db.execute("INSERT OR IGNORE INTO favorites (question_id, user_id) VALUES (?, ?)", (qid, g.user_id))
                    is_fav = True
                else:
                    db.execute("DELETE FROM favorites WHERE question_id = ? AND user_id = ?", (qid, g.user_id))
                    is_fav = False
            else:
                fav = db.execute("SELECT 1 FROM favorites WHERE question_id = ? AND user_id = ?", (qid, g.user_id)).fetchone()
                if fav:
                    db.execute("DELETE FROM favorites WHERE question_id = ? AND user_id = ?", (qid, g.user_id))
                    is_fav = False
                else:
                    db.execute("INSERT OR IGNORE INTO favorites (question_id, user_id) VALUES (?, ?)", (qid, g.user_id))
                    is_fav = True

            resp_data = {"success": True, "is_favorite": is_fav}
            if lease_token:
                complete_idempotency(db, g.user_id, 200, resp_data, lease_token)

        invalidate_user_caches(g.user_id)
        return jsonify(resp_data)
    except Exception:
        if lease_token:
            fail_idempotency(db, g.user_id, lease_token)
        raise


def _fetch_batch_data(db, ids, user_id):
    CHUNK = 500
    q_map = {}
    alt_map = {}
    img_map = {}
    attempt_map = {}
    wrong_map = {}
    fav_set = set()

    if not ids:
        return q_map, alt_map, img_map, attempt_map, wrong_map, fav_set

    queries = []
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        ph = ",".join("?" * len(chunk))
        chunk_user = list(chunk) + [user_id]

        queries.extend([
            (f"SELECT * FROM questions WHERE id IN ({ph})", chunk),
            (f"SELECT question_id, letter, text FROM alternatives WHERE question_id IN ({ph}) ORDER BY letter", chunk),
            (f"SELECT question_id, file_path FROM question_images WHERE question_id IN ({ph}) AND file_path NOT LIKE '%question_explanation_images%' ORDER BY order_index", chunk),
            (f"""SELECT a.question_id, a.selected_letter, a.is_correct
                 FROM questions q JOIN attempts a ON a.id = (
                     SELECT latest.id FROM attempts latest
                     WHERE latest.user_id = ? AND latest.question_id = q.id
                     ORDER BY latest.id DESC LIMIT 1
                 ) WHERE q.id IN ({ph})""", [user_id] + list(chunk)),
            (f"SELECT question_id, COUNT(*) as n FROM attempts WHERE question_id IN ({ph}) AND is_correct = 0 AND user_id = ? GROUP BY question_id", chunk_user),
            (f"SELECT question_id FROM favorites WHERE question_id IN ({ph}) AND user_id = ?", chunk_user),
        ])

    results = None
    if hasattr(db, "batch"):
        try:
            results = db.batch(queries)
        except Exception:
            results = None

    if results is None:
        results = [db.execute(sql, params) for sql, params in queries]

    for c in range(0, len(results), 6):
        rows_q = results[c].fetchall()
        rows_alt = results[c + 1].fetchall()
        rows_img = results[c + 2].fetchall()
        rows_att = results[c + 3].fetchall()
        rows_wrong = results[c + 4].fetchall()
        rows_fav = results[c + 5].fetchall()

        for r in rows_q:
            q_map[r["id"]] = dict(r)

        for r in rows_alt:
            alt_map.setdefault(r["question_id"], []).append({"letter": r["letter"], "text": r["text"]})

        for r in rows_img:
            img_map.setdefault(r["question_id"], []).append(r["file_path"])

        for r in rows_att:
            if r["question_id"] not in attempt_map:
                attempt_map[r["question_id"]] = {"selected_letter": r["selected_letter"], "is_correct": bool(r["is_correct"])}

        for r in rows_wrong:
            wrong_map[r["question_id"]] = r["n"]

        for r in rows_fav:
            fav_set.add(r["question_id"])

    return q_map, alt_map, img_map, attempt_map, wrong_map, fav_set

def _fetch_clinical_cases(db, q_map):
    cc_map = {}
    cc_ids = list({q["clinical_case_id"] for q in q_map.values() if q.get("clinical_case_id")})
    if cc_ids:
        ph_cc = ",".join("?" * len(cc_ids))
        for r in db.execute(f"SELECT id, stem, images FROM clinical_cases WHERE id IN ({ph_cc})", cc_ids).fetchall():
            cc_map[r["id"]] = {
                "stem": r["stem"],
                "images": json.loads(r["images"]) if r["images"] else []
            }
    return cc_map

def _filter_alternatives(alts, correct_letter):
    incorrects = [a for a in alts if a["letter"] != correct_letter]
    if incorrects:
        # Escolhe um distrator para remover para que sobrem apenas 4 alternativas
        # Se len for 5, remove 1. Se len for N, remove N-4
        remove_count = len(alts) - 4
        to_remove = random.sample(incorrects, remove_count)
        to_remove_letters = {a["letter"] for a in to_remove}
        return [a for a in alts if a["letter"] not in to_remove_letters]
    return alts

def _format_question_dict(q, alts, imgs, attempt, wrong_count, is_favorite, cc, is_target_inst=False):
    return {
        "id": q["id"],
        "source_file": q["source_file"],
        "source_number": q["source_number"],
        "year": q["year"],
        "institution_code": q["institution_code"],
        "institution_label": q["institution_label"],
        "topic": q["topic"],
        "area": q["area"],
        "subtema": q["subtema"],
        "stem": q["stem"],
        "is_autoral": bool(q.get("editorial_status") == "autoral" or (q.get("source_file") and "AUTORAL" in str(q.get("source_file")).upper())),
        "is_discursive": bool(len(alts) <= 1),
        "is_verified": bool(q.get("is_verified", 0)),
        "is_target_institution": bool(is_target_inst),
        "last_updated_at": q.get("last_updated_at"),
        "technical_note": q.get("technical_note"),
        "clinical_case": cc,
        "usp_macro": q.get("usp_macro"),
        "usp_micro": q.get("usp_micro"),
        "alternatives": alts,
        "images": imgs,
        "already_answered": attempt,
        "is_favorite": is_favorite,
        "times_wrong": wrong_count,
    }

@bp.route("/questions/batch", methods=["POST"])
def question_batch_detail():
    """Retorna detalhes completos de múltiplas questões em uma única requisição.

    Aceita {"ids": [1, 2, ...]} com no máximo 200 IDs.
    Substitui até 120 chamadas individuais GET /questions/:id no simulado.
    """
    try:
        data = QuestionBatchIn.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"error": "invalid input", "details": validation_errors(e)}), 400

    ids = data.ids
    force_4_options = data.force_4_options
    db = get_db()
    target_insts = get_user_target_institutions(db, g.user_id)

    q_map, alt_map, img_map, attempt_map, wrong_map, fav_set = _fetch_batch_data(db, ids, g.user_id)
    cc_map = _fetch_clinical_cases(db, q_map)

    out = []
    for qid in ids:
        q = q_map.get(qid)
        if not q:
            continue
            
        alts = alt_map.get(qid, [])
        if force_4_options and len(alts) > 4:
            alts = _filter_alternatives(alts, q.get("correct_letter"))

        inst = q.get("institution_code")
        is_target = bool(target_insts and (inst in target_insts or (inst and inst.upper() in target_insts)))

        out.append(_format_question_dict(
            q,
            alts,
            img_map.get(qid, []),
            attempt_map.get(qid),
            wrong_map.get(qid, 0),
            qid in fav_set,
            cc_map.get(q.get("clinical_case_id")),
            is_target_inst=is_target,
        ))

    return jsonify({"questions": out})


# As rotas de IA (ask_ai, ai/health, prescribe_study, synthesize_explanation) foram
# desacopladas para api/ai_routes.py.
# As rotas de Curadoria e Taxonomia (taxonomy, classification, delete_question) foram
# desacopladas para api/curation.py.


@bp.route("/images/<path:filename>")
def serve_image(filename):
    import os
    from flask import send_from_directory
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    static_dir = os.path.join(backend_dir, "static")
    
    # Check if direct file exists
    if os.path.exists(os.path.join(static_dir, filename)):
        return send_from_directory(static_dir, filename)
    # Check if inside static/images/
    if os.path.exists(os.path.join(static_dir, "images", filename)):
        return send_from_directory(os.path.join(static_dir, "images"), filename)
    return send_from_directory(static_dir, filename)
