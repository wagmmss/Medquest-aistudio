import os
import json
import math
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

from flask import Blueprint, g, jsonify, request

from .cache import SimpleTTLCache
from .services.planner import USP_WEIGHTS, get_normalized_area, _load_catalogs
from .services.psychometrics import (
    _aggregate_area_records,
    _beta_continued_fraction,
    _determine_evidence_status,
    _generate_key_factors,
    _process_canonical_areas,
    beta_credible_interval,
    beta_quantile,
    calculate_bayesian_readiness,
    regularized_incomplete_beta,
    weighted_beta_credible_interval,
)

from .adaptive import build_learning_profile, fsrs_metrics
from .remediation import calculate_blindspots
from .tri_engine import evaluate_tri_performance
from .db import get_db, db_transaction
from .questions import invalidate_user_caches
from .observability import emit
from .timezones import resolve_tz_offset_minutes
from .edital_profiles import (
    EditalProfile,
    get_edital_profile,
    CANONICAL_AREAS,
    ALLOWED_ANALYSIS_INSTITUTIONS,
    resolve_institution_codes,
    get_canonical_institution,
)
from .candidate_benchmarks import (
    get_institution_benchmark,
    calculate_competitive_analysis,
)

bp = Blueprint("stats", __name__)






overview_cache = SimpleTTLCache(60)
_area_totals_cache = SimpleTTLCache(300)
_q_totals_cache = SimpleTTLCache(300)


def _db_cache_scope() -> str:
    return os.environ.get("MEDQUEST_DB") or os.environ.get("TURSO_DATABASE_URL") or "default"


def _has_assisted_column(db) -> bool:
    scope = _db_cache_scope()
    cache_key = ("has_assisted_col", scope)
    cached = _q_totals_cache.get(cache_key)
    if cached is not None:
        return bool(cached)
    try:
        cols = {r["name"] for r in db.execute("PRAGMA table_info(attempts)").fetchall()}
        has_col = "assisted" in cols
    except Exception:
        has_col = True
    _q_totals_cache.set(cache_key, has_col)
    return has_col


def _get_cached_total_questions(db) -> int:
    scope = _db_cache_scope()
    cache_key = ("total_active_q", scope)
    cached = _q_totals_cache.get(cache_key)
    if cached is not None:
        return int(cached)
    row = db.execute("SELECT COUNT(*) AS n FROM questions WHERE missing_alts = 0").fetchone()
    total = int(row["n"] or 0) if row else 0
    _q_totals_cache.set(cache_key, total)
    return total


def _get_cached_area_totals(db):
    cache_key = ("area_totals", _db_cache_scope())
    cached = _area_totals_cache.get(cache_key)
    if cached is not None:
        return cached
    totals = db.execute(
        "SELECT area, COUNT(*) n FROM questions WHERE area IS NOT NULL AND area != '' GROUP BY area"
    ).fetchall()
    _area_totals_cache.set(cache_key, totals)
    return totals


def _get_cached_q_totals_map(db):
    cache_key = ("q_totals_map", _db_cache_scope())
    cached = _q_totals_cache.get(cache_key)
    if cached is not None:
        return cached
    rows = db.execute("""
        SELECT area, subtema, COUNT(*) AS n_questions
        FROM questions
        WHERE missing_alts = 0 AND area IS NOT NULL AND area != '' AND subtema IS NOT NULL AND subtema != ''
        GROUP BY area, subtema
    """).fetchall()
    q_map = {}
    for r in rows:
        norm_a = get_normalized_area(r["area"])
        sub = r["subtema"]
        q_map[(norm_a, sub)] = r["n_questions"]
    _q_totals_cache.set(cache_key, q_map)
    return q_map



def responsible_streak(days_studied, today, days_per_week=6):
    """Count active days while honoring configured weekly rest days.

    Rest days preserve continuity but never inflate the displayed streak.
    """
    active = {str(day) for day in days_studied if day}
    target = max(1, min(7, int(days_per_week or 6)))
    rest_budget = 7 - target
    active_count = 0
    cursor = today
    examined = 0
    rests_in_block = 0
    while examined < 366:
        if str(cursor) in active:
            active_count += 1
        elif rests_in_block < rest_budget:
            rests_in_block += 1
        else:
            break
        examined += 1
        if examined % 7 == 0:
            rests_in_block = 0
        cursor -= timedelta(days=1)
    current_week_active = sum(str(today - timedelta(days=offset)) in active for offset in range(7))
    return {
        "days": active_count,
        "weekly_target": target,
        "active_days_last_7": current_week_active,
        "rest_days_available": max(0, rest_budget - (7 - current_week_active)),
        "policy": "rest_days_preserve_continuity",
    }

def _fetch_attempt_rollup(db, user_id: str, now_utc: datetime):
    last7_start = (now_utc - timedelta(days=7)).isoformat()
    prev7_start = (now_utc - timedelta(days=14)).isoformat()
    now_value = now_utc.isoformat()
    total_q = _get_cached_total_questions(db)
    has_assisted = _has_assisted_column(db)
    assisted_col = "COALESCE(assisted, 0) AS assisted" if has_assisted else "0 AS assisted"
    assisted_sum = (
        "COALESCE(SUM(CASE WHEN is_correct = 1 AND assisted = 1 THEN 1 ELSE 0 END), 0) AS assisted_correct"
        if has_assisted
        else "0 AS assisted_correct"
    )

    # Uma única varredura com CTE em attempts consolida métricas gerais,
    # janela de 7/14 dias, última tentativa, acertos com dica e caderno de erros.
    row = db.execute(f"""
        WITH user_attempts AS (
            SELECT
                question_id,
                is_correct,
                {assisted_col},
                answered_at,
                ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) AS rn
            FROM attempts
            WHERE user_id = ?
        )
        SELECT
            ? AS total_q,
            COUNT(*) AS total_attempts,
            COUNT(DISTINCT question_id) AS distinct_answered,
            COALESCE(SUM(is_correct), 0) AS correct,
            {assisted_sum},
            COALESCE(SUM(CASE WHEN rn = 1 AND is_correct = 1 THEN 1 ELSE 0 END), 0) AS last_correct,
            COALESCE(SUM(CASE WHEN answered_at >= ? THEN is_correct ELSE 0 END), 0) AS last7_correct,
            COALESCE(SUM(CASE WHEN answered_at >= ? THEN 1 ELSE 0 END), 0) AS last7_total,
            COALESCE(SUM(CASE WHEN answered_at >= ? AND answered_at < ? THEN is_correct ELSE 0 END), 0) AS prev7_correct,
            COALESCE(SUM(CASE WHEN answered_at >= ? AND answered_at < ? THEN 1 ELSE 0 END), 0) AS prev7_total,
            COUNT(DISTINCT CASE WHEN is_correct = 0 THEN question_id END) AS ever_wrong_count,
            COUNT(DISTINCT CASE WHEN rn = 1 AND is_correct = 0 THEN question_id END) AS currently_unresolved_count,
            (SELECT COUNT(*) FROM spaced_repetition
             WHERE next_review_date <= ? AND user_id = ?) AS srs_due_count
        FROM user_attempts
    """, (
        user_id,
        total_q,
        last7_start, last7_start,
        prev7_start, last7_start,
        prev7_start, last7_start,
        now_value, user_id,
    )).fetchone()
    return dict(row) if row else {}


def _get_overview_metrics(db, user_id: str, now_utc: datetime, rollup=None) -> dict:
    overview = rollup if rollup is not None else _fetch_attempt_rollup(db, user_id, now_utc)

    total_q = overview["total_q"]
    total_attempts = overview["total_attempts"]
    distinct_answered = overview["distinct_answered"]
    correct = overview["correct"]
    accuracy = (correct / total_attempts) if total_attempts else None
    last_correct = overview["last_correct"]
    accuracy_latest = (last_correct / distinct_answered) if distinct_answered else None
    coverage_pct = (distinct_answered / total_q) if total_q else None

    srs_due_count = overview["srs_due_count"]
    accuracy_last7 = (overview["last7_correct"] / overview["last7_total"]) if overview["last7_total"] else None
    accuracy_prev7 = (overview["prev7_correct"] / overview["prev7_total"]) if overview["prev7_total"] else None

    if "assisted_correct" in (overview.keys() if hasattr(overview, "keys") else {}):
        assisted_correct = int(overview["assisted_correct"] or 0)
    else:
        assisted_correct = 0

    unassisted_correct = max(0, int(correct or 0) - assisted_correct)

    return {
        "total_questions": total_q,
        "distinct_answered": distinct_answered,
        "total_attempts": total_attempts,
        "accuracy_all_attempts": accuracy,
        "accuracy_latest_attempt": accuracy_latest,
        "coverage_pct": coverage_pct,
        "srs_due_count": srs_due_count,
        "accuracy_last7": accuracy_last7,
        "accuracy_prev7": accuracy_prev7,
        "assisted_correct_count": assisted_correct,
        "unassisted_correct_count": unassisted_correct,
    }


def _get_streak_and_target_info(db, user_id: str, now_utc: datetime, tz_offset: int, config: dict | None = None) -> dict:
    # Shift answered_at by tz_offset to get local date string
    sign = '+' if tz_offset >= 0 else '-'
    offset_str = f"{sign}{abs(tz_offset)} minutes"

    if config is None:
        config_row = db.execute(
            "SELECT * FROM planner_config WHERE user_id = ?", (user_id,)
        ).fetchone()
        config = dict(config_row) if config_row else {}

    local_today = (now_utc + timedelta(minutes=tz_offset)).date()
    # Calculate UTC boundaries for the local day
    local_start = datetime(local_today.year, local_today.month, local_today.day, tzinfo=timezone.utc) - timedelta(minutes=tz_offset)
    local_end = local_start + timedelta(days=1)

    day_rows = db.execute(
        """
        SELECT
            substr(datetime(answered_at, ?), 1, 10) AS day,
            COUNT(DISTINCT CASE WHEN answered_at >= ? AND answered_at < ? THEN question_id END) AS today_q
        FROM attempts
        WHERE user_id = ?
        GROUP BY day
        ORDER BY day DESC
        """,
        (offset_str, local_start.isoformat(), local_end.isoformat(), user_id),
    ).fetchall()
    days_studied = {r["day"] for r in day_rows if r["day"]}
    today_answered_count = sum(int(r["today_q"] or 0) for r in day_rows)

    streak = responsible_streak(days_studied, local_today, config.get("days_per_week") or 6)

    daily_target = config.get("questions_per_day") or 20
    exam_date_str = config.get("exam_date")
    days_until_exam = None
    if exam_date_str:
        try:
            ed = datetime.fromisoformat(exam_date_str.replace("Z", "+00:00")).date()
            days_until_exam = (ed - local_today).days
        except Exception:
            days_until_exam = None

    raw_inst = config.get("target_institution")
    primary_inst = None
    if raw_inst and raw_inst not in ("Todas as Bancas", "TODAS"):
        primary_inst = raw_inst.split(",")[0].strip()

    return {
        "streak_days": streak["days"],
        "streak": streak,
        "today_answered": today_answered_count,
        "daily_target": daily_target,
        "days_until_exam": days_until_exam,
        "exam_date": exam_date_str,
        "target_score": config.get("target_score"),
        "target_institution": raw_inst,
        "primary_institution": primary_inst,
    }


@bp.route("/stats/overview")
def overview():
    now_utc = datetime.now(timezone.utc)
    tz_offset = resolve_tz_offset_minutes(request.args, now_utc)

    cache_key = (g.user_id, "overview", tz_offset)
    cached = overview_cache.get(cache_key)
    if cached:
        return jsonify(cached)

    db = get_db()

    metrics = _get_overview_metrics(db, g.user_id, now_utc)
    streak_info = _get_streak_and_target_info(db, g.user_id, now_utc, tz_offset)

    result = {**metrics, **streak_info}

    overview_cache.set(cache_key, result)
    return jsonify(result)


ALLOWED_BREAKDOWN_COLS = {
    "institution_code", "institution_label", "source_file",
    "year", "topic", "area", "subtema", "specialty"
}

def _breakdown(db, group_col, label_col=None):
    if group_col not in ALLOWED_BREAKDOWN_COLS:
        raise ValueError(f"Invalid group_col for _breakdown: {group_col}")
    if label_col and label_col not in ALLOWED_BREAKDOWN_COLS:
        raise ValueError(f"Invalid label_col for _breakdown: {label_col}")

    label_expr = label_col or group_col
    rows = db.execute(f"""
        SELECT q.{group_col} AS key, MIN(q.{label_expr}) AS label,
               COUNT(a.id) AS attempts, SUM(a.is_correct) AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.{group_col} IS NOT NULL AND q.{group_col} != ''
        GROUP BY q.{group_col} ORDER BY attempts DESC
    """, (g.user_id,)).fetchall()

    if group_col == "institution_code":
        canonical_labels = {
            "USP-SP": "USP - São Paulo",
            "USP-RP": "USP - Ribeirão Preto",
            "UNICAMP": "Unicamp",
            "UNIFESP": "Unifesp / EPM",
            "SUS-SP": "SUS-SP",
        }
        aggregated: dict[str, dict] = {
            inst: {"key": inst, "label": canonical_labels[inst], "attempts": 0, "correct": 0}
            for inst in ALLOWED_ANALYSIS_INSTITUTIONS
        }
        for r in rows:
            canon = get_canonical_institution(r["key"])
            if canon and canon in aggregated:
                aggregated[canon]["attempts"] += r["attempts"]
                aggregated[canon]["correct"] += r["correct"]

        out = []
        for inst in ALLOWED_ANALYSIS_INSTITUTIONS:
            item = aggregated[inst]
            att = item["attempts"]
            cor = item["correct"]
            acc = (cor / att) if att > 0 else 0.0
            out.append({
                "key": item["key"],
                "label": item["label"],
                "attempts": att,
                "correct": cor,
                "accuracy": acc,
            })
        out.sort(key=lambda x: x["attempts"], reverse=True)
        return out

    out = []
    for r in rows:
        acc = (r["correct"] / r["attempts"]) if r["attempts"] else 0
        out.append({"key": r["key"], "label": r["label"], "attempts": r["attempts"],
                    "correct": r["correct"], "accuracy": acc})
    return out


@bp.route("/stats/breakdown")
def breakdown():
    db = get_db()
    by = request.args.get("by", "institution")
    col_map = {
        "institution": ("institution_code", "institution_label"),
        "source": ("source_file", "source_file"),
        "year": ("year", "year"), "topic": ("topic", "topic"),
        "area": ("area", "area"), "subtema": ("subtema", "subtema"),
        "specialty": ("specialty", "specialty"),
    }
    if by not in col_map:
        return jsonify({"error": "invalid 'by'"}), 400
    col, label_col = col_map[by]
    return jsonify(_breakdown(db, col, label_col))


def _get_timeline_data(
    db,
    user_id: str,
    days: int | None = None,
    tz_offset: int = -180,
    now_utc: datetime | None = None,
) -> list[dict]:
    sign = "+" if tz_offset >= 0 else "-"
    offset_str = f"{sign}{abs(tz_offset)} minutes"
    date_filter = ""
    params: tuple = (offset_str, offset_str, user_id)
    if days is not None:
        ref_now = now_utc if now_utc is not None else datetime.now(timezone.utc)
        local_today = (ref_now + timedelta(minutes=tz_offset)).date()
        window_start_local = local_today - timedelta(days=days)
        window_start_utc = (
            datetime(window_start_local.year, window_start_local.month, window_start_local.day, tzinfo=timezone.utc)
            - timedelta(minutes=tz_offset)
        ).isoformat()
        date_filter = "AND answered_at >= ?"
        params = (offset_str, offset_str, user_id, window_start_utc)

    has_assisted = _has_assisted_column(db)
    assisted_col = "COALESCE(assisted, 0) AS assisted" if has_assisted else "0 AS assisted"
    assisted_sum = (
        "SUM(CASE WHEN is_correct = 1 AND assisted = 1 THEN 1 ELSE 0 END) AS assisted_correct"
        if has_assisted
        else "0 AS assisted_correct"
    )
    rows = db.execute(f"""
        WITH ranked AS (
            SELECT
                date(answered_at, ?) AS day,
                question_id,
                is_correct,
                {assisted_col},
                time_spent_ms,
                ROW_NUMBER() OVER (
                    PARTITION BY date(answered_at, ?), question_id
                    ORDER BY answered_at DESC, id DESC
                ) AS rn
            FROM attempts
            WHERE user_id = ? {date_filter}
        )
        SELECT
            day,
            COUNT(*) AS attempts,
            SUM(is_correct) AS correct,
            {assisted_sum},
            SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS latest_attempts,
            SUM(CASE WHEN rn = 1 THEN is_correct ELSE 0 END) AS latest_correct,
            AVG(CASE WHEN time_spent_ms IS NOT NULL AND time_spent_ms > 0 AND time_spent_ms < 1800000 THEN time_spent_ms END) AS avg_time_ms,
            SUM(CASE WHEN time_spent_ms IS NOT NULL AND time_spent_ms > 0 AND time_spent_ms < 1800000 THEN time_spent_ms ELSE 0 END) AS total_time_ms,
            COUNT(CASE WHEN time_spent_ms IS NOT NULL AND time_spent_ms > 0 AND time_spent_ms < 1800000 THEN 1 END) AS timed_attempts
        FROM ranked
        GROUP BY day
        ORDER BY day
    """, params).fetchall()

    return [
        {
            "day": r["day"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "assisted_correct": int(r["assisted_correct"] or 0),
            "unassisted_correct": max(0, int(r["correct"] or 0) - int(r["assisted_correct"] or 0)),
            "accuracy": (r["correct"] / r["attempts"]) if r["attempts"] else 0,
            "latest_attempts": r["latest_attempts"],
            "latest_correct": r["latest_correct"],
            "latest_accuracy": (r["latest_correct"] / r["latest_attempts"]) if r["latest_attempts"] else 0,
            "avg_time_ms": round(r["avg_time_ms"]) if r["avg_time_ms"] is not None else None,
            "total_time_ms": int(r["total_time_ms"] or 0),
            "timed_attempts": int(r["timed_attempts"] or 0),
        }
        for r in rows
    ]


@bp.route("/stats/timeline")
def timeline():
    days_param = request.args.get("days")
    try:
        days = int(days_param) if days_param else None
    except ValueError:
        days = None
    now_utc = datetime.now(timezone.utc)
    tz_offset = resolve_tz_offset_minutes(request.args, now_utc)
    cache_key = (g.user_id, "timeline", days, tz_offset)
    cached = overview_cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)
    db = get_db()
    data = _get_timeline_data(db, g.user_id, days=days, tz_offset=tz_offset, now_utc=now_utc)
    overview_cache.set(cache_key, data)
    return jsonify(data)


def _get_weak_topics_data(db, user_id: str, min_attempts: int = 5) -> list[dict]:
    min_attempts = max(5, min(min_attempts, 1000))
    rows = db.execute("""
        SELECT TRIM(COALESCE(NULLIF(TRIM(q.subtema), ''), NULLIF(TRIM(q.topic), ''))) AS topic,
               COUNT(a.id) AS attempts, SUM(a.is_correct) AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND COALESCE(NULLIF(TRIM(q.subtema), ''), NULLIF(TRIM(q.topic), '')) IS NOT NULL
        GROUP BY topic HAVING attempts >= ?
        ORDER BY (CAST(correct AS FLOAT) / attempts) ASC LIMIT 15
    """, (user_id, min_attempts)).fetchall()
    return [
        {"topic": r["topic"], "attempts": r["attempts"], "correct": r["correct"],
         "accuracy": (r["correct"] / r["attempts"]) if r["attempts"] else 0}
        for r in rows
    ]


@bp.route("/stats/weak-topics")
def weak_topics():
    try:
        min_attempts = int(request.args.get("min_attempts", 5))
    except (TypeError, ValueError):
        min_attempts = 3
    cache_key = (g.user_id, "weak_topics", min_attempts)
    cached = overview_cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)
    db = get_db()
    data = _get_weak_topics_data(db, g.user_id, min_attempts=min_attempts)
    overview_cache.set(cache_key, data)
    return jsonify(data)


def _get_srs_due_recommendation(db, user_id):
    srs_due = db.execute(
        "SELECT COUNT(*) n FROM spaced_repetition WHERE next_review_date <= ? AND user_id = ?",
        (datetime.now(timezone.utc).isoformat(), user_id),
    ).fetchone()["n"]
    if srs_due > 0:
        return {
            "type": "srs_due", "icon": "ph-alarm",
            "title": f"{srs_due} questão(ões) para revisar hoje",
            "description": "Sua repetição espaçada tem itens prontos para revisão. Reforce agora o que você já viu antes de esquecer.",
            "cta": "Revisar agora", "filters": {"status": "srs_due"},
        }
    return None


def _get_adaptive_recommendation(db, user_id):
    attempt_count = db.execute(
        "SELECT COUNT(*) n FROM attempts WHERE user_id = ?", (user_id,)
    ).fetchone()["n"]
    if attempt_count >= 3:
        return {
            "type": "adaptive", "icon": "ph-brain",
            "title": "Sessão adaptativa personalizada",
            "description": "Uma fila equilibrada por revisões vencidas, risco de esquecimento, erros recentes e lacunas de cobertura.",
            "cta": "Iniciar sessão", "filters": {"mode": "adaptive", "limit": "30"},
        }
    return None


def _get_weak_topics_recommendations(db, user_id):
    weak_subtemas = db.execute("""
        SELECT q.subtema AS subtema, MIN(q.area) AS area,
               COUNT(a.id) AS attempts, SUM(a.is_correct) AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.subtema IS NOT NULL AND q.subtema != ''
        GROUP BY q.subtema HAVING attempts >= 3
        ORDER BY (CAST(correct AS FLOAT) / attempts) ASC LIMIT 3
    """, (user_id,)).fetchall()
    recs = []
    covered_areas = set()
    for r in weak_subtemas:
        acc = r["correct"] / r["attempts"]
        if acc < 0.65:
            covered_areas.add(r["area"])
            recs.append({
                "type": "weak_topic", "icon": "ph-warning-circle",
                "title": f"Reforce {r['subtema']}",
                "description": f"Sua acurácia aqui é de {round(acc * 100)}% em {r['attempts']} tentativas. Vale revisar a teoria e praticar mais questões.",
                "cta": "Praticar agora", "filters": {"subtema": r["subtema"]},
            })
    return recs, covered_areas


def _get_weak_area_recommendations(db, user_id, covered_areas):
    weak_areas = db.execute("""
        SELECT q.area AS area, COUNT(a.id) AS attempts, SUM(a.is_correct) AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.area IS NOT NULL AND q.area != ''
        GROUP BY q.area HAVING attempts >= 5
        ORDER BY (CAST(correct AS FLOAT) / attempts) ASC LIMIT 1
    """, (user_id,)).fetchall()
    recs = []
    for r in weak_areas:
        acc = r["correct"] / r["attempts"]
        if acc < 0.65 and r["area"] not in covered_areas:
            recs.append({
                "type": "weak_area", "icon": "ph-chart-bar",
                "title": f"Sua acurácia em {r['area']} está baixa",
                "description": f"{round(acc * 100)}% de acerto em {r['attempts']} tentativas nessa área. Considere revisar os fundamentos antes de continuar.",
                "cta": "Estudar área", "filters": {"area": r["area"]},
            })
    return recs


def _get_explore_recommendation(db, user_id):
    area_totals = _get_cached_area_totals(db)
    area_answered = db.execute("""
        SELECT q.area AS area, COUNT(DISTINCT a.question_id) n
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.area IS NOT NULL AND q.area != '' GROUP BY q.area
    """, (user_id,)).fetchall()
    answered_map = {r["area"]: r["n"] for r in area_answered}
    least_explored = None
    for r in area_totals:
        if r["n"] < 20:
            continue
        coverage = answered_map.get(r["area"], 0) / r["n"]
        if least_explored is None or coverage < least_explored["coverage"]:
            least_explored = {"area": r["area"], "coverage": coverage, "total": r["n"]}
    if least_explored is not None and least_explored["coverage"] < 0.1:
        return {
            "type": "explore", "icon": "ph-compass",
            "title": f"Explore mais {least_explored['area']}",
            "description": f"Você ainda não praticou quase nada nessa área ({round(least_explored['coverage'] * 100)}% de {least_explored['total']} questões). Bom momento para começar.",
            "cta": "Começar a explorar",
            "filters": {"area": least_explored["area"], "status": "unanswered"},
        }
    return None


def _get_fallback_recommendations(db, user_id, has_recs):
    if has_recs:
        return []
    row = db.execute("""
        WITH user_attempts AS (
            SELECT
                question_id,
                is_correct,
                ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) AS rn
            FROM attempts
            WHERE user_id = ?
        )
        SELECT
            COUNT(*) AS total_attempts,
            COUNT(DISTINCT question_id) AS distinct_answered,
            COALESCE(SUM(CASE WHEN rn = 1 AND is_correct = 1 THEN 1 ELSE 0 END), 0) AS last_correct
        FROM user_attempts
    """, (user_id,)).fetchone()
    total_attempts = int(row["total_attempts"] or 0) if row else 0
    distinct_answered = int(row["distinct_answered"] or 0) if row else 0
    last_correct = int(row["last_correct"] or 0) if row else 0
    accuracy_latest = (last_correct / distinct_answered) if distinct_answered else None

    if distinct_answered >= 10 and accuracy_latest is not None and accuracy_latest >= 0.8:
        return [{
            "type": "praise", "icon": "ph-trophy", "title": "Ótimo desempenho geral!",
            "description": f"Você está acertando {round(accuracy_latest * 100)}% das últimas tentativas. Que tal se desafiar em um simulado cronometrado?",
            "cta": "Ir para os filtros", "filters": {},
        }]
    elif total_attempts < 10:
        return [{
            "type": "start", "icon": "ph-rocket-launch", "title": "Comece a responder questões",
            "description": "Ainda não há tentativas suficientes para gerar recomendações personalizadas. Responda algumas questões para começar.",
            "cta": "Ir para os filtros", "filters": {},
        }]
    return []


@bp.route("/stats/recommendations")
def recommendations():
    user_id = g.user_id
    cache_key = (user_id, "recommendations")
    cached = overview_cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)

    db = get_db()
    recs = []

    srs_rec = _get_srs_due_recommendation(db, user_id)
    if srs_rec:
        recs.append(srs_rec)

    adaptive_rec = _get_adaptive_recommendation(db, user_id)
    if adaptive_rec:
        recs.append(adaptive_rec)

    weak_topics_recs, covered_areas = _get_weak_topics_recommendations(db, user_id)
    recs.extend(weak_topics_recs)

    weak_areas_recs = _get_weak_area_recommendations(db, user_id, covered_areas)
    recs.extend(weak_areas_recs)

    explore_rec = _get_explore_recommendation(db, user_id)
    if explore_rec:
        recs.append(explore_rec)

    fallback_recs = _get_fallback_recommendations(db, user_id, bool(recs))
    recs.extend(fallback_recs)

    out = recs[:5]
    overview_cache.set(cache_key, out)
    return jsonify(out)


@bp.route("/stats/learning-profile")
def learning_profile():
    return jsonify(build_learning_profile(get_db(), g.user_id, subtema=request.args.get("subtema")))



_institution_area_totals_cache = SimpleTTLCache(300)


def _get_available_questions_by_area(db, institution_code: str | None = None) -> dict[str, int]:
    cache_key = (institution_code or "__all__", _db_cache_scope())
    cached = _institution_area_totals_cache.get(cache_key)
    if cached is not None:
        return cached

    aliases = resolve_institution_codes(institution_code) if institution_code else []
    if aliases:
        placeholders = ",".join("?" * len(aliases))
        clause = f"AND institution_code IN ({placeholders})"
        params = list(aliases)
    else:
        clause = ""
        params = []

    rows = db.execute(f"""
        SELECT area, COUNT(id) AS available
        FROM questions
        WHERE missing_alts = 0 AND area IS NOT NULL AND area != ''
              {clause}
        GROUP BY area
    """, params).fetchall()

    totals = {row["area"]: row["available"] for row in rows}
    _institution_area_totals_cache.set(cache_key, totals)
    return totals


def _get_user_area_attempts(db, user_id: str, institution_code: str | None = None) -> dict[str, dict]:
    aliases = resolve_institution_codes(institution_code) if institution_code else []
    if aliases:
        placeholders = ",".join("?" * len(aliases))
        clause = f"AND q.institution_code IN ({placeholders})"
        params = [user_id] + list(aliases)
    else:
        clause = ""
        params = [user_id]

    rows = db.execute(f"""
        SELECT q.area,
               COUNT(DISTINCT a.question_id) AS answered,
               COUNT(a.id) AS attempts,
               COALESCE(SUM(a.is_correct), 0) AS correct
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.missing_alts = 0 AND q.area IS NOT NULL AND q.area != ''
              {clause}
        GROUP BY q.area
    """, params).fetchall()

    return {row["area"]: dict(row) for row in rows}


def _fetch_area_records(db, user_id: str, institution_code: str | None = None) -> list[dict]:
    avail_map = _get_available_questions_by_area(db, institution_code)
    user_map = _get_user_area_attempts(db, user_id, institution_code)

    all_areas = set(avail_map.keys()) | set(user_map.keys()) | set(CANONICAL_AREAS)
    records = []
    for area in all_areas:
        u = user_map.get(area, {})
        records.append({
            "area": area,
            "available": avail_map.get(area, 0),
            "answered": u.get("answered", 0),
            "attempts": u.get("attempts", 0),
            "correct": u.get("correct", 0),
        })
    records.sort(key=lambda r: r["available"], reverse=True)
    return records


def _get_exam_readiness_data(db, user_id: str, raw_institution: str = "", emit_event: bool = True) -> dict:
    raw_institution = (raw_institution or "").strip()[:64]
    canonical = get_canonical_institution(raw_institution)
    if canonical:
        institution = canonical
    elif raw_institution in ALLOWED_ANALYSIS_INSTITUTIONS:
        institution = raw_institution
    else:
        institution = "USP-SP"

    area_records = _fetch_area_records(db, user_id, institution)
    profile = get_edital_profile(institution)
    bayesian_calc = calculate_bayesian_readiness(area_records, profile, institution_code=institution)

    aliases = resolve_institution_codes(institution) if institution else []
    if aliases:
        placeholders = ",".join("?" * len(aliases))
        clause = f"AND q.institution_code IN ({placeholders})"
        params = [user_id] + list(aliases)
    else:
        clause = ""
        params = [user_id]

    attempts_rows = db.execute(f"""
        SELECT a.question_id, a.is_correct
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.missing_alts = 0 {clause}
    """, params).fetchall()

    attempts_records = [dict(r) for r in attempts_rows]
    competitive_analysis = calculate_competitive_analysis(attempts_records, institution)

    areas = bayesian_calc["enriched_areas"]
    total_available = sum(item["available"] for item in areas)
    total_answered = sum(item["answered"] for item in areas)

    if emit_event:
        emit(
            "exam_readiness_viewed",
            profile_status=profile.status,
            evidence_status=bayesian_calc["evidence_status"],
        )

    return {
        "institution": institution,
        "institution_label": profile.institution_label,
        "coverage": round(total_answered / total_available, 4) if total_available else 0,
        "answered": total_answered,
        "available": total_available,
        "readiness_score": bayesian_calc["readiness_score"],
        "ci_lower": bayesian_calc["ci_lower"],
        "ci_upper": bayesian_calc["ci_upper"],
        "evidence_status": bayesian_calc["evidence_status"],
        "candidate_mean": competitive_analysis.get("candidate_mean"),
        "competitive_delta": competitive_analysis.get("competitive_delta"),
        "competitive_analysis": competitive_analysis,
        "edital_profile": profile.model_dump(),
        "areas": areas,
        "key_factors": bayesian_calc["key_factors"],
        "limitations": bayesian_calc["limitations"],
        "disclaimer": "Prontidão estimada calculada via modelo Empirical Bayes ponderado por edital e calibrado na concorrência da banca.",
    }


@bp.route("/stats/exam-readiness")
def exam_readiness():
    """Prontidão estimada por instituição/edital com modelo bayesiano Beta-Binomial."""
    db = get_db()
    raw_institution = request.args.get("institution", "")
    return jsonify(_get_exam_readiness_data(db, g.user_id, raw_institution=raw_institution))



@bp.route("/stats/predictive-score")
def predictive_score():
    db = get_db()
    # Pega o target_score do planner_config
    config_row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (g.user_id,)).fetchone()
    target_score = config_row["target_score"] if config_row and "target_score" in config_row.keys() else None

    # Calcula acurácia por área
    areas_stats = db.execute("""
        SELECT q.area AS area, COUNT(a.id) AS attempts, SUM(a.is_correct) AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.area IS NOT NULL AND q.area != ''
        GROUP BY q.area
    """, (g.user_id,)).fetchall()

    if not areas_stats:
        return jsonify({
            "projected_score": 0,
            "target_score": target_score,
            "areas": []
        })

    areas_acc = []
    projected_score_weighted = 0.0
    area_attempts = {}

    for r in areas_stats:
        norm_area = get_normalized_area(r["area"])
        weight = USP_WEIGHTS.get(norm_area, 0.1)

        # Penaliza acurácia se tiver menos de 5 tentativas
        acc = (r["correct"] / r["attempts"]) if r["attempts"] >= 5 else (r["correct"] / 5.0)
        acc_pct = round(acc * 100, 1)
        areas_acc.append({
            "area": r["area"],
            "accuracy": acc_pct,
            "attempts": r["attempts"]
        })
        area_attempts[norm_area] = r["attempts"]

        projected_score_weighted += acc_pct * weight

    # Não normalizamos pelos temas já estudados: isso superestimaria quem
    # praticou apenas as próprias áreas fortes. A projeção só é considerada
    # confiável com pelo menos 20 tentativas em cada grande área.
    projected_score = round(projected_score_weighted, 1)
    is_reliable = all(area_attempts.get(area, 0) >= 20 for area in USP_WEIGHTS)

    return jsonify({
        "projected_score": projected_score,
        "target_score": target_score,
        "areas": sorted(areas_acc, key=lambda x: x["accuracy"], reverse=True),
        "is_reliable": is_reliable,
        "total_attempts": sum(area_attempts.values()),
        "minimum_attempts_per_area": 20,
    })

def _get_at_risk_data(db, user_id: str) -> list[dict]:
    rows = db.execute("""
        SELECT q.subtema, sr.fsrs_card, sr.next_review_date
        FROM spaced_repetition sr
        JOIN questions q ON sr.question_id = q.id
        WHERE sr.user_id = ? AND sr.fsrs_card IS NOT NULL
        ORDER BY sr.next_review_date ASC
    """, (user_id,)).fetchall()

    topics_risk = {}
    for r in rows:
        subtema = r["subtema"]
        if not subtema:
            continue
        metrics = fsrs_metrics(r["fsrs_card"])
        retrievability = metrics["retrievability"]
        if retrievability is None:
            continue

        if subtema not in topics_risk:
            topics_risk[subtema] = {"count": 0, "min_retrievability": retrievability}

        topics_risk[subtema]["count"] += 1
        topics_risk[subtema]["min_retrievability"] = min(topics_risk[subtema]["min_retrievability"], retrievability)

    # A retenção desejada padrão do FSRS para questões médicas é 85% (api/srs.py).
    DESIRED_RETENTION = 0.85
    at_risk_list = []
    for subtema, data in topics_risk.items():
        if data["min_retrievability"] < DESIRED_RETENTION:
            at_risk_list.append({
                "subtema": subtema,
                "items_count": data["count"],
                "retrievability": round(data["min_retrievability"], 4),
                "stability": None,
            })

    at_risk_list.sort(key=lambda x: (x["retrievability"], x["subtema"]))
    return at_risk_list[:10]


@bp.route("/stats/at-risk")
def at_risk():
    db = get_db()
    return jsonify(_get_at_risk_data(db, g.user_id))


@bp.route("/stats/reset", methods=["DELETE"])
def reset_stats():
    db = get_db()
    try:
        with db_transaction(db, immediate=True):
            db.execute("DELETE FROM attempts WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM spaced_repetition WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_topic_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM theme_progress WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM favorites WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_config WHERE user_id = ?", (g.user_id,))
            db.execute("DELETE FROM planner_schedule WHERE user_id = ?", (g.user_id,))
    except Exception:
        raise

    invalidate_user_caches(g.user_id)
    return jsonify({"success": True})


def _get_planner_metadata():
    planner_meta, kat_subs, _ = _load_catalogs()
    return planner_meta, kat_subs


def _build_coverage_structure(planner_meta, kat_subs, q_map, u_map, summary_only):
    areas_dict = {}
    for area_group in planner_meta:
        raw_area_name = area_group.get("area", "")
        area_name = get_normalized_area(raw_area_name)
        if area_name == "Outros":
            area_name = raw_area_name

        area_obj = areas_dict.setdefault(area_name, {
            "area": area_name,
            "n_questions": 0,
            "n_subtemas": 0,
            "answered_questions": 0,
            "attempts": 0,
            "correct": 0,
            "mastered": 0,
            "proficient": 0,
            "in_progress": 0,
            "not_started": 0,
            "subtemas": [],
            "high_yield_count": 0,
            "high_yield_mastered": 0
        })

        for macro in area_group.get("macroThemes", []):
            theme = macro.get("theme", "")
            is_high_yield = macro.get("highYield", False)
            db_subs = macro.get("dbSubtemas", [theme])

            theme_theory = 0.0
            for s in db_subs:
                k = kat_subs.get(s, {})
                theme_theory += k.get("theory_hours", 1.5)
            theory_hours = round(theme_theory, 2)

            total_n_q = sum(q_map.get((area_name, s), 0) for s in db_subs)
            total_ans = sum(u_map.get((area_name, s), {}).get("answered", 0) for s in db_subs)
            total_att = sum(u_map.get((area_name, s), {}).get("attempts", 0) for s in db_subs)
            total_cor = sum(u_map.get((area_name, s), {}).get("correct", 0) for s in db_subs)

            accuracy = (total_cor / total_att) if total_att > 0 else None
            coverage_pct = (total_ans / total_n_q) if total_n_q > 0 else 0.0

            # Duas questões não são evidência suficiente para afirmar domínio
            # de um tema; exigimos mais amostra antes de marcar como consolidado.
            if total_ans == 0:
                status = "not_started"
            elif total_att >= 10 and accuracy is not None and accuracy >= 0.7 and coverage_pct >= 0.5:
                status = "mastered"
            elif total_att >= 5 and accuracy is not None and accuracy >= 0.7:
                status = "proficient"
            else:
                status = "in_progress"

            area_obj["n_questions"] += total_n_q
            area_obj["n_subtemas"] += 1
            area_obj["answered_questions"] += total_ans
            area_obj["attempts"] += total_att
            area_obj["correct"] += total_cor
            area_obj[status] += 1
            if is_high_yield:
                area_obj["high_yield_count"] += 1
                if status == "mastered":
                    area_obj["high_yield_mastered"] += 1

            # O resumo é usado pelo dashboard e não devolve subtemas. Evitar
            # montar e ordenar centenas de objetos reduz alocação e latência.
            if not summary_only:
                area_obj["subtemas"].append({
                    "subtema": theme,
                    "area": area_name,
                    "n_questions": total_n_q,
                    "answered": total_ans,
                    "attempts": total_att,
                    "correct": total_cor,
                    "accuracy": accuracy,
                    "coverage_pct": round(coverage_pct, 4),
                    "status": status,
                    "highYield": is_high_yield,
                    "theory_hours": theory_hours,
                })
    return areas_dict


def _format_coverage_response(areas_dict, area_filter, summary_only):
    area_order = ["Clínica Médica", "Cirurgia", "Ginecologia e Obstetrícia", "Pediatria", "Medicina Preventiva"]
    out = []
    for name in area_order:
        if name in areas_dict:
            a = areas_dict[name]
            a["accuracy"] = (a["correct"] / a["attempts"]) if a["attempts"] > 0 else None
            if not summary_only:
                a["subtemas"].sort(key=lambda s: (not s["highYield"], -s["n_questions"]))
            out.append(a)

    for k, a in areas_dict.items():
        if k not in area_order:
            a["accuracy"] = (a["correct"] / a["attempts"]) if a["attempts"] > 0 else None
            if not summary_only:
                a["subtemas"].sort(key=lambda s: (not s["highYield"], -s["n_questions"]))
            out.append(a)

    if area_filter:
        norm_filter = get_normalized_area(area_filter)
        out = [a for a in out if a["area"] == norm_filter or a["area"] == area_filter]

    summary_out = []
    if summary_only:
        for a in out:
            summary_out.append({
                "area": a["area"],
                "n_questions": a["n_questions"],
                "n_subtemas": a["n_subtemas"],
                "answered_questions": a["answered_questions"],
                "attempts": a["attempts"],
                "correct": a["correct"],
                "accuracy": a["accuracy"],
                "mastered": a["mastered"],
                "proficient": a["proficient"],
                "in_progress": a["in_progress"],
                "not_started": a["not_started"],
                "high_yield_count": a["high_yield_count"],
                "high_yield_mastered": a["high_yield_mastered"]
            })
    return out, summary_out


def _get_user_coverage_stats(db, user_id):
    user_rows = db.execute("""
        SELECT q.area, q.subtema,
               COUNT(DISTINCT a.question_id) AS answered,
               COUNT(a.id) AS attempts,
               COALESCE(SUM(a.is_correct), 0) AS correct
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND q.missing_alts = 0 AND q.area IS NOT NULL AND q.area != '' AND q.subtema IS NOT NULL AND q.subtema != ''
        GROUP BY q.area, q.subtema
    """, (user_id,)).fetchall()

    u_map = {}
    for r in user_rows:
        norm_a = get_normalized_area(r["area"])
        sub = r["subtema"]
        u_map[(norm_a, sub)] = {
            "answered": r["answered"],
            "attempts": r["attempts"],
            "correct": r["correct"]
        }
    return u_map


def _get_coverage_data(db, user_id: str, area_filter: str = "", summary_only: bool = False) -> dict:
    planner_meta, kat_subs = _get_planner_metadata()
    q_map = _get_cached_q_totals_map(db)
    u_map = _get_user_coverage_stats(db, user_id)
    areas_dict = _build_coverage_structure(planner_meta, kat_subs, q_map, u_map, summary_only)
    out, summary_out = _format_coverage_response(areas_dict, area_filter, summary_only)
    if summary_only:
        return {"areas": summary_out, "summary": True}
    return {"areas": out}


@bp.route("/coverage")
def coverage():
    db = get_db()
    area_filter = request.args.get("area", "").strip()
    summary_only = request.args.get("summary_only", "false").lower() == "true"
    return jsonify(_get_coverage_data(db, g.user_id, area_filter=area_filter, summary_only=summary_only))


def _get_distractors_data(db, user_id: str) -> list[dict]:
    rows = db.execute("""
        SELECT q.subtema AS subtema, a.selected_letter AS letter, COUNT(*) AS n
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ? AND a.is_correct = 0 AND q.subtema IS NOT NULL AND q.subtema != ''
        GROUP BY q.subtema, a.selected_letter
        ORDER BY q.subtema, n DESC
    """, (user_id,)).fetchall()
    by_sub = {}
    for r in rows:
        by_sub.setdefault(r["subtema"], []).append({"letter": r["letter"], "count": r["n"]})
    out = [{"subtema": s, "wrong_choices": v, "total_wrong": sum(x["count"] for x in v)}
           for s, v in by_sub.items()]
    out.sort(key=lambda x: x["total_wrong"], reverse=True)
    return out[:20]


@bp.route("/stats/distractors")
def distractors():
    """NOVO: análise de distratores — qual alternativa errada você mais escolhe por subtema."""
    db = get_db()
    return jsonify(_get_distractors_data(db, g.user_id))


def _get_benchmark_data(
    db,
    user_id: str,
    now_utc: datetime,
    rollup=None,
    config: dict | None = None,
) -> dict:
    if rollup is not None:
        total_attempts = rollup["total_attempts"] or 0
        total_correct = rollup["correct"] or 0
        last7_attempts = rollup["last7_total"] or 0
        last7_correct = rollup["last7_correct"] or 0
    else:
        last7_start = (now_utc - timedelta(days=7)).isoformat()

        stats_row = db.execute("""
            SELECT
                COUNT(a.id) AS total_attempts,
                SUM(a.is_correct) AS total_correct,
                SUM(CASE WHEN a.answered_at >= ? THEN 1 ELSE 0 END) AS last7_attempts,
                SUM(CASE WHEN a.answered_at >= ? THEN a.is_correct ELSE 0 END) AS last7_correct
            FROM attempts a
            WHERE a.user_id = ?
        """, (last7_start, last7_start, user_id)).fetchone()

        total_attempts = stats_row["total_attempts"] or 0
        total_correct = stats_row["total_correct"] or 0
        last7_attempts = stats_row["last7_attempts"] or 0
        last7_correct = stats_row["last7_correct"] or 0

    accuracy_overall = (total_correct / total_attempts) if total_attempts > 0 else None
    accuracy_last7 = (last7_correct / last7_attempts) if last7_attempts > 0 else None

    if config is None:
        try:
            config_row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
            if config_row:
                config = dict(config_row)
        except Exception:
            config = None

    target_score_pct = (config.get("target_score") if config and config.get("target_score") else 76.0)
    target_score = target_score_pct / 100.0

    weekly_target_questions = 80
    if config and config.get("days_per_week"):
        daily_q = config.get("questions_per_day") or 15
        weekly_target_questions = max(20, config["days_per_week"] * daily_q)

    diff_pct = round((accuracy_overall - target_score) * 100, 1) if accuracy_overall is not None else None
    weekly_progress_pct = min(100.0, round((last7_attempts / weekly_target_questions) * 100, 1)) if weekly_target_questions > 0 else 0.0

    status_label = "iniciando"
    if accuracy_overall is not None:
        if diff_pct >= 0:
            status_label = "aprovado"
        elif diff_pct >= -10:
            status_label = "competitivo"
        else:
            status_label = "em_evolucao"

    return {
        "accuracy_overall": accuracy_overall,
        "accuracy_last7": accuracy_last7,
        "target_score": target_score,
        "target_score_pct": target_score_pct,
        "diff_pct": diff_pct,
        "status_label": status_label,
        "total_attempts": total_attempts,
        "total_correct": total_correct,
        "is_reliable_sample": total_attempts >= 20,
        "last7_attempts": last7_attempts,
        "weekly_target_questions": weekly_target_questions,
        "weekly_progress_pct": weekly_progress_pct,
        "competitors_average_pct": 76.0
    }


@bp.route("/stats/benchmark")
def benchmark():
    """Inspirado no benchmark de concorrentes/corte da Medway (MedBrain)."""
    db = get_db()
    now_utc = datetime.now(timezone.utc)
    return jsonify(_get_benchmark_data(db, g.user_id, now_utc))


def _get_bottlenecks_data(db, user_id: str, limit: int = 5) -> list:
    limit = max(1, min(limit, 20))

    rows = db.execute("""
        WITH latest_attempts AS (
            SELECT question_id, is_correct,
                   ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) as rn
            FROM attempts
            WHERE user_id = ?
        )
        SELECT
            q.subtema,
            MIN(q.area) AS area,
            COUNT(DISTINCT CASE WHEN la.is_correct = 0 THEN q.id END) AS unresolved_count,
            COUNT(a.id) AS attempts,
            SUM(a.is_correct) AS correct,
            SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_count
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        LEFT JOIN latest_attempts la ON la.question_id = q.id AND la.rn = 1
        WHERE a.user_id = ? AND q.subtema IS NOT NULL AND q.subtema != ''
        GROUP BY q.subtema
        HAVING unresolved_count > 0
        ORDER BY
            unresolved_count DESC,
            wrong_count DESC,
            attempts DESC
        LIMIT ?
    """, (user_id, user_id, limit)).fetchall()

    out = []
    for r in rows:
        acc = (r["correct"] / r["attempts"]) if r["attempts"] > 0 else 0.0
        out.append({
            "subtema": r["subtema"],
            "area": r["area"],
            "unresolved_count": r["unresolved_count"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "wrong_count": r["wrong_count"],
            "accuracy": round(acc, 3),
            "accuracy_pct": round(acc * 100, 1),
            "practice_url": f"/estudar?subtema={quote(r['subtema'])}&status=wrong&limit=10"
        })
    return out


@bp.route("/stats/bottlenecks")
def bottlenecks():
    """Identifica os tópicos prioritários do Caderno de Erros (com questões pendentes de retificação)."""
    db = get_db()
    try:
        limit = int(request.args.get("limit", 5))
    except (ValueError, TypeError):
        limit = 5
    return jsonify(_get_bottlenecks_data(db, g.user_id, limit))


@bp.route("/stats/blindspots")
def blindspots():
    """Diagnóstico multidimensional dos pontos cegos do aluno e métricas de superação."""
    db = get_db()
    try:
        limit = int(request.args.get("limit", 6))
    except (ValueError, TypeError):
        limit = 6
    return jsonify(calculate_blindspots(db, g.user_id, limit=limit))


@bp.route("/stats/tri-readiness")
def tri_readiness():
    """Calcula a proficiência TRI acumulada do aluno com projeção para editais."""
    db = get_db()
    institution = request.args.get("institution", "ENARE")

    rows = db.execute("""
        WITH latest_attempts AS (
            SELECT question_id, is_correct,
                   ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) as rn
            FROM attempts
            WHERE user_id = ?
        )
        SELECT question_id, is_correct
        FROM latest_attempts
        WHERE rn = 1
    """, (g.user_id,)).fetchall()

    responses = [{"question_id": r["question_id"], "is_correct": bool(r["is_correct"])} for r in rows]
    return jsonify(evaluate_tri_performance(db, responses, institution_code=institution))


def _create_area_stats(area_name: str) -> dict:
    return {
        "area": area_name,
        "total_subtemas": 0,
        "mastered_subtemas": 0,
        "proficient_subtemas": 0,
        "in_progress_subtemas": 0,
        "not_started_subtemas": 0,
        "attempts": 0,
        "correct": 0,
        "accuracy": None,
        "domain_pct": 0.0
    }

def _update_area_stats(item: dict, attempts: int, correct: int) -> None:
    item["total_subtemas"] += 1
    item["attempts"] += attempts
    item["correct"] += correct

    if attempts == 0:
        item["not_started_subtemas"] += 1
    else:
        acc = correct / attempts
        # Critério pedagógico robusto:
        # - Dominado/Consolidado: >= 15 tentativas e acurácia >= 75%
        # - Proficiente / Sinal de domínio: 5 a 14 tentativas e acurácia >= 70%
        if attempts >= 15 and acc >= 0.75:
            item["mastered_subtemas"] += 1
        elif attempts >= 5 and acc >= 0.70:
            item["proficient_subtemas"] += 1
        else:
            item["in_progress_subtemas"] += 1

def _calculate_area_metrics(item: dict) -> None:
    if item["attempts"] > 0:
        item["accuracy"] = round(item["correct"] / item["attempts"], 3)
    if item["total_subtemas"] > 0:
        item["domain_pct"] = round((item["mastered_subtemas"] / item["total_subtemas"]) * 100, 1)

def _get_domain_summary_data(db, user_id: str) -> dict:
    rows = db.execute("""
        WITH user_subtema_attempts AS (
            SELECT
                q.area,
                q.subtema,
                COUNT(a.id) AS attempts,
                COALESCE(SUM(a.is_correct), 0) AS correct
            FROM attempts a
            JOIN questions q ON q.id = a.question_id
            WHERE a.user_id = ?
                  AND q.missing_alts = 0
                  AND q.area IS NOT NULL AND q.area != ''
                  AND q.subtema IS NOT NULL AND q.subtema != ''
            GROUP BY q.area, q.subtema
        ),
        question_subtemas AS (
            SELECT
                q.area,
                q.subtema,
                COUNT(q.id) AS total_questions
            FROM questions q
            WHERE q.missing_alts = 0
                  AND q.area IS NOT NULL AND q.area != ''
                  AND q.subtema IS NOT NULL AND q.subtema != ''
            GROUP BY q.area, q.subtema
        )
        SELECT
            qs.area,
            qs.subtema,
            qs.total_questions,
            COALESCE(ua.attempts, 0) AS attempts,
            COALESCE(ua.correct, 0) AS correct
        FROM question_subtemas qs
        LEFT JOIN user_subtema_attempts ua
          ON ua.area = qs.area AND ua.subtema = qs.subtema
    """, (user_id,)).fetchall()

    areas_map = {}
    canonical_order = ["Clínica Médica", "Cirurgia", "Ginecologia e Obstetrícia", "Pediatria", "Medicina Preventiva"]

    for area_name in canonical_order:
        areas_map[area_name] = _create_area_stats(area_name)

    for r in rows:
        area = r["area"]
        if area not in areas_map:
            areas_map[area] = _create_area_stats(area)

        att = r["attempts"] or 0
        cor = r["correct"] or 0
        _update_area_stats(areas_map[area], att, cor)

    result = []
    for area_name in canonical_order:
        if area_name in areas_map:
            item = areas_map.pop(area_name)
            _calculate_area_metrics(item)
            result.append(item)

    for item in areas_map.values():
        _calculate_area_metrics(item)
        result.append(item)

    total_subtemas_all = sum(x["total_subtemas"] for x in result)
    total_mastered_all = sum(x["mastered_subtemas"] for x in result)
    overall_domain_pct = round((total_mastered_all / total_subtemas_all) * 100, 1) if total_subtemas_all > 0 else 0.0

    return {
        "overall_domain_pct": overall_domain_pct,
        "total_mastered": total_mastered_all,
        "total_subtemas": total_subtemas_all,
        "areas": result
    }


@bp.route("/stats/domain-summary")
def domain_summary():
    """Inspirado no MedBrain da Medway: progresso de domínio de focos/subtemas por Grande Área."""
    db = get_db()
    return jsonify(_get_domain_summary_data(db, g.user_id))


def _get_error_notebook_summary_data(db, user_id: str, rollup=None) -> dict:
    if rollup is not None:
        ever_wrong = rollup["ever_wrong_count"] or 0
        currently_unresolved = rollup["currently_unresolved_count"] or 0
    else:
        row = db.execute("""
            WITH latest_attempts AS (
                SELECT question_id, is_correct,
                       ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) as rn
                FROM attempts
                WHERE user_id = ?
            )
            SELECT
                COUNT(DISTINCT a.question_id) AS ever_wrong_count,
                COUNT(DISTINCT CASE WHEN la.is_correct = 0 THEN a.question_id END) AS currently_unresolved_count
            FROM attempts a
            LEFT JOIN latest_attempts la ON la.question_id = a.question_id AND la.rn = 1
            WHERE a.user_id = ? AND a.is_correct = 0
        """, (user_id, user_id)).fetchone()

        ever_wrong = row["ever_wrong_count"] if row and row["ever_wrong_count"] else 0
        currently_unresolved = row["currently_unresolved_count"] if row and row["currently_unresolved_count"] else 0

    return {
        "ever_wrong_count": ever_wrong,
        "currently_unresolved_count": currently_unresolved,
        "practice_url": "/estudar?status=wrong&limit=20"
    }


@bp.route("/stats/error-notebook-summary")
def error_notebook_summary():
    """Inspirado no ever-answered-wrong da Medcof: contador e resumo de questões erradas."""
    db = get_db()
    return jsonify(_get_error_notebook_summary_data(db, g.user_id))


def _format_planner_config_from_row(raw_config: dict | None) -> dict | None:
    if not raw_config:
        return None
    inst_str = raw_config.get("target_institution")
    inst_list = [i.strip() for i in inst_str.split(",") if i.strip()] if inst_str else []
    primary_inst = None
    if inst_list and inst_list[0] not in ("Todas as Bancas", "TODAS"):
        primary_inst = inst_list[0]
    return {
        "exam_date": raw_config.get("exam_date"),
        "start_date": raw_config.get("start_date"),
        "days_per_week": raw_config.get("days_per_week"),
        "hours_per_day": raw_config.get("hours_per_day", raw_config.get("questions_per_day")),
        "target_score": raw_config.get("target_score"),
        "target_institution": inst_str,
        "target_institutions": inst_list,
        "primary_institution": primary_inst,
        "target_specialty": raw_config.get("target_specialty"),
    }


@bp.route("/dashboard/summary")
def dashboard_summary():
    """Retorna todas as métricas agregadas do Dashboard em um único round-trip com cache por usuário."""
    db = get_db()
    user_id = g.user_id
    now_utc = datetime.now(timezone.utc)
    tz_offset = resolve_tz_offset_minutes(request.args, now_utc)

    cache_key = (user_id, "dashboard_summary", tz_offset)
    cached_payload = overview_cache.get(cache_key)
    if cached_payload is not None:
        return jsonify(cached_payload)

    rollup = _fetch_attempt_rollup(db, user_id, now_utc)
    planner_queries = [
        ("SELECT * FROM planner_config WHERE user_id = ?", (user_id,)),
        ("SELECT * FROM planner_progress WHERE user_id = ?", (user_id,)),
        ("SELECT week, subtema, completed FROM planner_topic_progress WHERE user_id = ?", (user_id,)),
    ]
    batch_res = None
    if hasattr(db, "batch"):
        try:
            batch_res = db.batch(planner_queries)
        except Exception:
            batch_res = None

    if batch_res is not None:
        config_row = batch_res[0].fetchone()
        prog_rows = batch_res[1].fetchall()
        topic_rows = batch_res[2].fetchall()
        planner_prog = {
            str(r["week"]): {
                "studied": bool(r["studied"]),
                "studied_at": r["studied_at"],
                "rev24h": bool(r["rev24h"]),
                "rev7d": bool(r["rev7d"]),
                "rev30d": bool(r["rev30d"]),
            }
            for r in prog_rows
        }
        planner_topics = {}
        for r in topic_rows:
            val = bool(r["completed"])
            planner_topics[f"{r['week']}:{r['subtema']}"] = val
            if val:
                planner_topics[r["subtema"]] = True
    else:
        config_row = db.execute(planner_queries[0][0], planner_queries[0][1]).fetchone()
        from .plan import get_planner_progress_data, get_planner_topic_progress_data
        planner_prog = get_planner_progress_data(db, user_id)
        planner_topics = get_planner_topic_progress_data(db, user_id)

    raw_config = dict(config_row) if config_row else {}

    overview = _get_overview_metrics(db, user_id, now_utc, rollup=rollup)
    streak_info = _get_streak_and_target_info(db, user_id, now_utc, tz_offset, config=raw_config)
    overview.update(streak_info)

    benchmark_data = _get_benchmark_data(db, user_id, now_utc, rollup=rollup, config=raw_config)
    bottlenecks_data = _get_bottlenecks_data(db, user_id, limit=3)
    domain_data = _get_domain_summary_data(db, user_id)
    error_data = _get_error_notebook_summary_data(db, user_id, rollup=rollup)
    planner_cfg = _format_planner_config_from_row(raw_config)

    payload = {
        "stats": overview,
        "benchmark": benchmark_data,
        "bottlenecks": bottlenecks_data,
        "domain_summary": domain_data,
        "error_notebook": error_data,
        "planner": {
            "config": planner_cfg,
            "progress": planner_prog,
            "topic_progress": planner_topics,
        }
    }
    overview_cache.set(cache_key, payload)
    return jsonify(payload)


def calculate_wilson_ci(k: int, n: int, confidence: float = 0.95) -> tuple[float | None, float | None]:
    """Calcula o Intervalo de Confiança de Wilson para uma proporção binomial.

    Reproduzível e matematicamente estável para taxas de acerto com amostras pequenas ou grandes.
    Retorna (ci_lower, ci_upper) limitados no intervalo [0.0, 1.0].
    Se n == 0, retorna (None, None).
    """
    if n <= 0:
        return None, None

    z = 1.959964  # z-score para 95% de confiança
    p_hat = k / n
    z2 = z * z
    denominator = 1.0 + (z2 / n)
    center = (p_hat + (z2 / (2.0 * n))) / denominator
    margin = (z / denominator) * math.sqrt((p_hat * (1.0 - p_hat) / n) + (z2 / (4.0 * n * n)))

    lower = max(0.0, round(center - margin, 4))
    upper = min(1.0, round(center + margin, 4))
    return lower, upper


def get_sample_status(attempts: int) -> str:
    """Classifica a robustez estatística da amostra.

    - 'insufficient': < 20 tentativas (bloqueia qualquer conclusão de competitividade).
    - 'forming': 20 a 49 tentativas.
    - 'reliable': >= 50 tentativas.
    """
    if attempts < 20:
        return "insufficient"
    if attempts < 50:
        return "forming"
    return "reliable"


def _get_institution_label(db, institution_code: str | None) -> str:
    """Retorna o rótulo de uma instituição."""
    if not institution_code:
        return "Desempenho Geral"

    canonical_labels = {
        "USP-SP": "USP - São Paulo",
        "USP-RP": "USP - Ribeirão Preto",
        "UNICAMP": "Unicamp",
        "UNIFESP": "Unifesp / EPM",
        "SUS-SP": "SUS-SP",
    }
    canon = get_canonical_institution(institution_code) or institution_code
    if canon in canonical_labels:
        return canonical_labels[canon]

    l_row = db.execute(
        "SELECT institution_label FROM questions WHERE institution_code = ? LIMIT 1",
        (institution_code,)
    ).fetchone()
    return l_row["institution_label"] if l_row else institution_code


def _fetch_all_priority_topics(db, user_id: str, institution_code: str | None, inst_clause: str, aliases: list[str] | None = None) -> dict[str, list[dict]]:
    """Busca em lote os tópicos prioritários para todas as áreas baseados nas estatísticas de desempenho."""
    inst_params = []
    if inst_clause and "?" in inst_clause:
        if aliases:
            inst_params.extend(aliases)
        elif institution_code:
            inst_params.append(institution_code)

    sub_params = [user_id, *inst_params, *inst_params]
    sub_rows = db.execute(f"""
        WITH user_subtema_attempts AS (
            SELECT
                q.area,
                q.subtema,
                COUNT(DISTINCT a.question_id) AS sub_answered,
                COUNT(a.id) AS sub_attempts,
                COALESCE(SUM(a.is_correct), 0) AS sub_correct
            FROM attempts a
            JOIN questions q ON q.id = a.question_id
            WHERE a.user_id = ? AND q.missing_alts = 0 AND q.area IS NOT NULL AND q.area != '' {inst_clause}
                  AND q.subtema IS NOT NULL AND q.subtema != ''
            GROUP BY q.area, q.subtema
        ),
        question_subtemas AS (
            SELECT
                q.area,
                q.subtema,
                COUNT(q.id) AS sub_available
            FROM questions q
            WHERE q.missing_alts = 0 AND q.area IS NOT NULL AND q.area != '' {inst_clause}
                  AND q.subtema IS NOT NULL AND q.subtema != ''
            GROUP BY q.area, q.subtema
        ),
        ranked_topics AS (
            SELECT
                qs.area,
                qs.subtema,
                qs.sub_available,
                COALESCE(ua.sub_answered, 0) AS sub_answered,
                COALESCE(ua.sub_attempts, 0) AS sub_attempts,
                COALESCE(ua.sub_correct, 0) AS sub_correct,
                ROW_NUMBER() OVER (
                    PARTITION BY qs.area
                    ORDER BY
                        (CASE WHEN COALESCE(ua.sub_attempts, 0) = 0 THEN 0 WHEN (CAST(COALESCE(ua.sub_correct, 0) AS FLOAT) / ua.sub_attempts) < 0.65 THEN 1 ELSE 2 END) ASC,
                        (CASE WHEN COALESCE(ua.sub_attempts, 0) > 0 THEN (CAST(COALESCE(ua.sub_correct, 0) AS FLOAT) / ua.sub_attempts) ELSE 0 END) ASC,
                        qs.sub_available DESC
                ) AS rnk
            FROM question_subtemas qs
            LEFT JOIN user_subtema_attempts ua
              ON ua.area = qs.area AND ua.subtema = qs.subtema
        )
        SELECT area, subtema, sub_available, sub_answered, sub_attempts, sub_correct
        FROM ranked_topics
        WHERE rnk <= 3
        ORDER BY area, rnk
    """, sub_params).fetchall()

    priority_map: dict[str, list[dict]] = {}
    for sr in sub_rows:
        area_name = sr["area"]
        s_att = sr["sub_attempts"]
        s_cor = sr["sub_correct"]
        s_acc = round(s_cor / s_att, 4) if s_att > 0 else None

        if s_att == 0:
            gap_type = "unanswered"
        elif s_acc is not None and s_acc < 0.65:
            gap_type = "low_accuracy"
        else:
            gap_type = "low_coverage"

        study_params = {"area": area_name, "subtema": sr["subtema"], "status": "all", "limit": 20}
        simulado_params = {"area": area_name}
        if institution_code:
            study_params["institution"] = institution_code
            simulado_params["institutions"] = institution_code

        if area_name not in priority_map:
            priority_map[area_name] = []

        priority_map[area_name].append({
            "subtema": sr["subtema"],
            "available": sr["sub_available"],
            "answered": sr["sub_answered"],
            "attempts": s_att,
            "correct": s_cor,
            "accuracy": s_acc,
            "gap_type": gap_type,
            "study_url": f"/estudar?{urlencode(study_params)}",
            "simulado_url": f"/simulado?{urlencode(simulado_params)}",
            "review_url": "/estudar?status=srs_due",
        })

    return priority_map


def _build_institution_stats(db, user_id: str, institution_code: str | None = None, include_priority: bool = True):
    canonical_order = [
        "Clínica Médica",
        "Cirurgia",
        "Ginecologia e Obstetrícia",
        "Pediatria",
        "Medicina Preventiva",
    ]

    canon = get_canonical_institution(institution_code) if institution_code else None
    target_code = canon or institution_code

    avail_map = _get_available_questions_by_area(db, target_code)
    user_map = _get_user_area_attempts(db, user_id, target_code)

    bench = get_institution_benchmark(target_code)
    bench_areas = bench.get("areas", {})
    cand_overall = bench.get("overall_candidate_accuracy", 0.695)

    aliases = resolve_institution_codes(target_code) if target_code else []
    if aliases:
        placeholders = ",".join("?" * len(aliases))
        inst_clause = f"AND q.institution_code IN ({placeholders})"
    else:
        inst_clause = ""
    label = _get_institution_label(db, target_code)
    priority_map = _fetch_all_priority_topics(db, user_id, target_code, inst_clause, aliases=aliases) if include_priority else {}

    areas = []
    total_available = 0
    total_answered = 0
    total_attempts = 0
    total_correct = 0

    for area_name in canonical_order:
        u = user_map.get(area_name, {})
        avail = avail_map.get(area_name, 0)
        ans = u.get("answered", 0)
        att = u.get("attempts", 0)
        cor = u.get("correct", 0)

        total_available += avail
        total_answered += ans
        total_attempts += att
        total_correct += cor

        acc = round(cor / att, 4) if att > 0 else None
        cov = round(ans / avail, 4) if avail > 0 else 0.0
        ci_lower, ci_upper = calculate_wilson_ci(cor, att)
        sample_status = get_sample_status(att)

        c_acc = bench_areas.get(area_name, {}).get("candidate_accuracy", 0.70)
        c_delta = round(acc - c_acc, 4) if acc is not None else None

        priority_topics = priority_map.get(area_name, [])

        areas.append({
            "area": area_name,
            "available": avail,
            "answered": ans,
            "coverage": cov,
            "attempts": att,
            "correct": cor,
            "accuracy": acc,
            "candidate_accuracy": round(c_acc, 4),
            "competitive_delta": c_delta,
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
            "sample_status": sample_status,
            "priority_topics": priority_topics,
        })

    overall_acc = round(total_correct / total_attempts, 4) if total_attempts > 0 else None
    overall_cov = round(total_answered / total_available, 4) if total_available > 0 else 0.0
    overall_ci_lower, overall_ci_upper = calculate_wilson_ci(total_correct, total_attempts)
    overall_sample_status = get_sample_status(total_attempts)
    overall_cand_delta = round(overall_acc - cand_overall, 4) if overall_acc is not None else None

    return {
        "code": target_code,
        "label": label,
        "total_available": total_available,
        "total_answered": total_answered,
        "coverage": overall_cov,
        "total_attempts": total_attempts,
        "total_correct": total_correct,
        "accuracy": overall_acc,
        "candidate_accuracy": round(cand_overall, 4),
        "competitive_delta": overall_cand_delta,
        "ci_lower": overall_ci_lower,
        "ci_upper": overall_ci_upper,
        "sample_status": overall_sample_status,
        "areas": areas,
    }


def _get_institution_radar_data(
    db,
    user_id: str,
    raw_inst: str = "",
    raw_compare: str = "",
    emit_event: bool = True,
    config: dict | None = None,
) -> dict:
    raw_inst = (raw_inst or "").strip()[:64]
    raw_compare = (raw_compare or "").strip()[:64]

    if raw_inst in ("Todas as Bancas", "TODAS") or "," in raw_inst:
        raw_inst = raw_inst.split(",")[0].strip() if "," in raw_inst else ""
    if raw_compare in ("Todas as Bancas", "TODAS") or "," in raw_compare:
        raw_compare = raw_compare.split(",")[0].strip() if "," in raw_compare else ""

    canon_inst = get_canonical_institution(raw_inst)
    institution = canon_inst or (raw_inst if raw_inst in ALLOWED_ANALYSIS_INSTITUTIONS else "")

    canon_compare = get_canonical_institution(raw_compare)
    compare_institution = canon_compare or (raw_compare if raw_compare in ALLOWED_ANALYSIS_INSTITUTIONS else "")

    # Se nenhuma instituição foi passada ou não pertence às 5 permitidas:
    if not institution:
        allowed_aliases = []
        for a_code in ALLOWED_ANALYSIS_INSTITUTIONS:
            allowed_aliases.extend(resolve_institution_codes(a_code))
        placeholders = ",".join("?" * len(allowed_aliases))
        top_inst_row = db.execute(f"""
            SELECT q.institution_code, COUNT(a.id) AS n
            FROM attempts a
            JOIN questions q ON q.id = a.question_id
            WHERE a.user_id = ? AND q.institution_code IN ({placeholders})
            GROUP BY q.institution_code
            ORDER BY n DESC
            LIMIT 1
        """, [user_id] + allowed_aliases).fetchone()
        if top_inst_row:
            institution = get_canonical_institution(top_inst_row["institution_code"]) or top_inst_row["institution_code"]
        else:
            if config is not None:
                target_inst_val = config.get("target_institution")
            else:
                cfg_row = db.execute("SELECT target_institution FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
                target_inst_val = cfg_row["target_institution"] if cfg_row else None
            if target_inst_val:
                planner_inst = target_inst_val.strip().split(",")[0].strip()
                canonical_planner = get_canonical_institution(planner_inst)
                if canonical_planner in ALLOWED_ANALYSIS_INSTITUTIONS:
                    institution = canonical_planner
                else:
                    institution = "USP-SP"
            else:
                institution = "USP-SP"

    primary_data = _build_institution_stats(db, user_id, institution, include_priority=True)

    # Comparison data (não precisa de priority_topics, economizando queries de banco)
    if raw_compare.upper() in ("CANDIDATES", "CONCORRENCIA", "BENCHMARK"):
        bench = get_institution_benchmark(institution)
        bench_areas = bench.get("areas", {})
        cand_areas = []
        canonical_order = [
            "Clínica Médica",
            "Cirurgia",
            "Ginecologia e Obstetrícia",
            "Pediatria",
            "Medicina Preventiva",
        ]
        for area_name in canonical_order:
            c_acc = bench_areas.get(area_name, {}).get("candidate_accuracy", 0.70)
            q_cnt = bench_areas.get(area_name, {}).get("question_count", 0)
            cand_areas.append({
                "area": area_name,
                "available": q_cnt,
                "answered": q_cnt,
                "coverage": 1.0,
                "attempts": q_cnt,
                "correct": int(round(c_acc * q_cnt)),
                "accuracy": round(c_acc, 4),
                "ci_lower": round(c_acc, 4),
                "ci_upper": round(c_acc, 4),
                "candidate_accuracy": round(c_acc, 4),
                "competitive_delta": 0.0,
                "sample_status": "reliable",
                "priority_topics": [],
            })
        cand_overall = bench.get("overall_candidate_accuracy", 0.695)
        total_q = bench.get("total_questions", 0)
        comparison_data = {
            "type": "candidates",
            "code": f"{institution}_CANDIDATES",
            "label": f"Média Candidatos ({primary_data['label']})",
            "total_available": total_q,
            "total_answered": total_q,
            "coverage": 1.0,
            "total_attempts": total_q,
            "total_correct": int(round(cand_overall * total_q)),
            "accuracy": round(cand_overall, 4),
            "ci_lower": round(cand_overall, 4),
            "ci_upper": round(cand_overall, 4),
            "candidate_accuracy": round(cand_overall, 4),
            "competitive_delta": 0.0,
            "sample_status": "reliable",
            "areas": cand_areas,
        }
    elif compare_institution and compare_institution.upper() != institution.upper():
        comp_stats = _build_institution_stats(db, user_id, compare_institution, include_priority=False)
        comparison_data = {
            "type": "institution",
            **comp_stats,
        }
    else:
        comp_stats = _build_institution_stats(db, user_id, None, include_priority=False)
        comparison_data = {
            "type": "global",
            **comp_stats,
        }

    has_comparator = bool(
        raw_compare.upper() in ("CANDIDATES", "CONCORRENCIA", "BENCHMARK")
        or (compare_institution and compare_institution.upper() != institution.upper())
    )
    if emit_event:
        emit(
            "institution_radar_viewed",
            has_comparator=has_comparator,
            sample_status=primary_data["sample_status"],
        )

    return {
        "institution": primary_data,
        "comparison": comparison_data,
        "disclaimer": "As métricas refletem exclusivamente o histórico resolvido no MedQuest. Menos de 20 tentativas por área indicam amostra limitada e incerteza elevada.",
        "sample_thresholds": {
            "insufficient": "< 20 tentativas (conclusões bloqueadas)",
            "forming": "20 a 49 tentativas",
            "reliable": "≥ 50 tentativas"
        }
    }


@bp.route("/stats/institution-radar")
def institution_radar():
    """Radar Comparativo de Bancas por Grande Área e Incerteza Estatística."""
    db = get_db()
    raw_inst = request.args.get("institution", "")
    raw_compare = request.args.get("compare_institution", "")
    return jsonify(_get_institution_radar_data(db, g.user_id, raw_inst=raw_inst, raw_compare=raw_compare))


@bp.route("/stats/analysis-summary")
def analysis_summary():
    """Consolida todas as métricas de Análise, Radar, Pontos Cegos, Cobertura e Prontidão em um único round-trip."""
    db = get_db()
    user_id = g.user_id
    raw_inst = request.args.get("institution", "").strip()[:64]
    raw_compare = request.args.get("compare_institution", "").strip()[:64]
    now_utc = datetime.now(timezone.utc)
    tz_offset = resolve_tz_offset_minutes(request.args, now_utc)

    cache_key = (user_id, "analysis_summary", raw_inst, raw_compare, tz_offset)
    cached = overview_cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)

    rollup = _fetch_attempt_rollup(db, user_id, now_utc)
    config_row = db.execute("SELECT * FROM planner_config WHERE user_id = ?", (user_id,)).fetchone()
    raw_config = dict(config_row) if config_row else {}
    overview = {
        **_get_overview_metrics(db, user_id, now_utc, rollup=rollup),
        **_get_streak_and_target_info(db, user_id, now_utc, tz_offset, config=raw_config),
    }

    radar_data = _get_institution_radar_data(
        db, user_id, raw_inst=raw_inst, raw_compare=raw_compare, emit_event=False, config=raw_config
    )
    resolved_inst = raw_inst or radar_data["institution"]["code"]

    payload = {
        "overview": overview,
        "learning_profile": build_learning_profile(db, user_id, config_row=raw_config),
        "exam_readiness": _get_exam_readiness_data(
            db, user_id, raw_institution=resolved_inst, emit_event=False
        ),
        "institution_radar": radar_data,
        "blindspots": calculate_blindspots(db, user_id, limit=6),
        "weak_topics": _get_weak_topics_data(db, user_id, min_attempts=5),
        "distractors": _get_distractors_data(db, user_id),
        "at_risk": _get_at_risk_data(db, user_id),
        "timeline_180": _get_timeline_data(db, user_id, days=180, tz_offset=tz_offset, now_utc=now_utc),
        "coverage": _get_coverage_data(db, user_id, area_filter="", summary_only=False),
    }
    overview_cache.set(cache_key, payload)
    return jsonify(payload)


ALLOWED_RADAR_ACTIONS = {"study", "simulado", "review"}


@bp.route("/stats/institution-radar/action", methods=["POST"])
def log_radar_action():
    """Registra evento de ação originada no Radar Comparativo de Bancas."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400
    action = data.get("action")
    if not isinstance(action, str) or action not in ALLOWED_RADAR_ACTIONS:
        return jsonify({"error": "Invalid action", "allowed": sorted(ALLOWED_RADAR_ACTIONS)}), 400

    emit(
        "institution_radar_action_clicked",
        action=action,
    )
    return jsonify({"success": True})


@bp.route("/stats/focus-radar", methods=["GET"])
def focus_radar():
    """Retorna Domínio de Focos por Prevalência e URL Sniper para a banca selecionada."""
    from .services.focus_radar import build_focus_radar

    db = get_db()
    user_id = getattr(g, "user_id", "1")
    institution = (request.args.get("institution") or "").strip()
    prevalence = (request.args.get("prevalence") or "all").strip().lower()
    if prevalence not in ("all", "prioritario", "alta", "media"):
        prevalence = "all"

    cache_key = (user_id, "focus_radar", institution, prevalence)
    cached = overview_cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)

    payload = build_focus_radar(db, user_id=user_id, institution=institution, prevalence=prevalence)
    overview_cache.set(cache_key, payload)
    return jsonify(payload)
