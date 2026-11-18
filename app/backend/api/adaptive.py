"""Deterministic adaptive-learning scoring for study queues and diagnostics."""
import json
import logging
import math
from datetime import datetime, timezone

from fsrs import Card

from .cache import SimpleTTLCache
from .filters import get_user_target_institutions
from .srs import _question_scheduler as _scheduler, _safe_load_card

logger = logging.getLogger(__name__)
_profile_cache = SimpleTTLCache(60)
_last_known_profile: dict[tuple, dict] = {}


def _utc(value=None):
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def fsrs_metrics(card_json, now=None):
    """Return safe FSRS metrics using calibrated question scheduler; corrupt/legacy cards remain usable."""
    if not card_json:
        return {"retrievability": None, "stability": None, "difficulty": None}
    try:
        card = _safe_load_card(card_json)
        if card.stability is None:
            return {"retrievability": None, "stability": None, "difficulty": None}
        retrievability = _scheduler.get_card_retrievability(card, _utc(now))
        return {
            "retrievability": round(max(0.0, min(1.0, float(retrievability))), 4),
            "stability": round(float(card.stability), 4) if card.stability is not None else None,
            "difficulty": round(float(card.difficulty), 4) if card.difficulty is not None else None,
        }
    except (TypeError, ValueError, KeyError):
        return {"retrievability": None, "stability": None, "difficulty": None}


def topic_priority(attempts, correct, retrievability=None, coverage=0.0):
    """Bayesian error estimate weighted by evidence, memory risk and coverage."""
    attempts = max(0, int(attempts or 0))
    correct = max(0, min(attempts, int(correct or 0)))
    confidence = 1.0 - math.exp(-attempts / 5.0)
    error_estimate = ((attempts - correct) + 2.0) / (attempts + 4.0)
    memory_risk = 0.5 if retrievability is None else 1.0 - retrievability
    coverage_gap = 1.0 - max(0.0, min(1.0, float(coverage or 0.0)))
    score = (0.55 * error_estimate * confidence) + (0.30 * memory_risk) + (0.15 * coverage_gap)
    return round(score, 4), round(confidence, 4)


def _due(next_review_date, now):
    if not next_review_date:
        return False
    try:
        return _utc(next_review_date) <= now
    except (TypeError, ValueError):
        return False


FOCUS_CONFIGS = {
    "coverage": {
        "topic_mult": 30.0,
        "coverage_gap": 80.0,
        "review_due": 40.0,
        "latest_wrong": 30.0,
        "memory_risk": 20.0,
        "target_institution_boost": 20.0,
    },
    "balanced": {
        "topic_mult": 40.0,
        "coverage_gap": 40.0,
        "review_due": 80.0,
        "latest_wrong": 55.0,
        "memory_risk": 40.0,
        "target_institution_boost": 25.0,
    },
    "retention": {
        "topic_mult": 50.0,
        "coverage_gap": 10.0,
        "review_due": 110.0,
        "latest_wrong": 80.0,
        "memory_risk": 60.0,
        "target_institution_boost": 25.0,
    },
}


def clear_user_last_known_profile(user_id):
    """Remove cached fallback profiles for a user on stats reset or cache invalidation."""
    if user_id is None:
        return
    user_str = str(user_id)
    keys = [
        k for k in list(_last_known_profile.keys())
        if isinstance(k, tuple) and len(k) > 0 and (k[0] == user_id or str(k[0]) == user_str)
    ]
    for k in keys:
        _last_known_profile.pop(k, None)


def rank_adaptive_candidates(db, user_id, where, params, limit, now=None, adaptive_focus="balanced", target_institutions=None):
    """Rank eligible questions with twin questions and configurable focus ratios."""
    now = _utc(now)
    cfg = FOCUS_CONFIGS.get(adaptive_focus, FOCUS_CONFIGS["balanced"])
    if target_institutions is None:
        target_institutions = get_user_target_institutions(db, user_id)

    rows = db.execute(
        f"""
        WITH user_attempts_ranked AS (
            SELECT
                question_id,
                is_correct,
                ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) AS rn
            FROM attempts
            WHERE user_id = ?
        ),
        user_attempts AS (
            SELECT
                question_id,
                COUNT(*) AS attempts,
                COALESCE(SUM(is_correct), 0) AS correct,
                MAX(CASE WHEN rn = 1 THEN is_correct END) AS latest_correct
            FROM user_attempts_ranked
            GROUP BY question_id
        )
        SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
               q.institution_label, q.topic, q.area, q.subtema,
               COALESCE(ua.attempts, 0) AS attempts,
               COALESCE(ua.correct, 0) AS correct,
               ua.latest_correct,
               sr.next_review_date, sr.fsrs_card
        FROM questions q
        LEFT JOIN user_attempts ua ON ua.question_id = q.id
        LEFT JOIN spaced_repetition sr ON sr.question_id = q.id AND sr.user_id = ?
        WHERE {where}
        """,
        [user_id, user_id, *params],
    ).fetchall()

    topic_totals = {}
    for row in rows:
        topic = row["subtema"] or row["topic"] or "Sem tema"
        stats = topic_totals.setdefault(topic, [0, 0, 0, 0])
        stats[0] += row["attempts"]
        stats[1] += row["correct"]
        stats[2] += 1
        if row["attempts"] > 0:
            stats[3] += 1

    # Pool of unattempted questions from current rows, grouped by topic
    unseen_by_topic = {}
    for row in rows:
        if row["attempts"] == 0:
            topic = row["subtema"] or row["topic"] or "Sem tema"
            unseen_by_topic.setdefault(topic, []).append(row)

    # Track paired twin questions: twin_id -> (orig_id, orig_inst, topic)
    paired_twin_ids = {}
    external_twin_rows = {}
    replaced_orig_ids = set()

    for row in rows:
        is_due = _due(row["next_review_date"], now)
        if is_due and row["latest_correct"] == 1:
            orig_id = row["id"]
            orig_inst = row["institution_code"] or ""
            topic = row["subtema"] or row["topic"] or "Sem tema"

            twin_candidate = None
            candidates = unseen_by_topic.get(topic, [])
            # Prioridade 1: Candidato de banca-alvo diferente da banca de origem
            if target_institutions:
                for c in candidates:
                    c_inst = c["institution_code"] or ""
                    if c["id"] not in paired_twin_ids and c_inst != orig_inst and (c_inst in target_institutions or c_inst.upper() in target_institutions):
                        twin_candidate = c
                        break
            # Prioridade 2: Candidato de qualquer banca diferente da banca de origem
            if twin_candidate is None:
                for c in candidates:
                    if c["id"] not in paired_twin_ids:
                        if c["institution_code"] != orig_inst:
                            twin_candidate = c
                            break
            # Prioridade 3: Qualquer candidato não visto do tópico
            if twin_candidate is None:
                for c in candidates:
                    if c["id"] not in paired_twin_ids:
                        twin_candidate = c
                        break

            if twin_candidate is None and topic != "Sem tema":
                if target_institutions:
                    target_placeholders = ",".join("?" * len(target_institutions))
                    db_twin = db.execute(
                        f"""
                        SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                               q.institution_label, q.topic, q.area, q.subtema,
                               0 AS attempts, 0 AS correct, NULL AS latest_correct,
                               NULL AS next_review_date, NULL AS fsrs_card
                        FROM questions q
                        WHERE q.missing_alts = 0
                          AND COALESCE(NULLIF(q.subtema, ''), q.topic) = ?
                          AND q.id NOT IN (SELECT question_id FROM attempts WHERE user_id = ?)
                        ORDER BY (q.institution_code IN ({target_placeholders})) DESC,
                                 (q.institution_code != ?) DESC, q.id ASC
                        LIMIT 1
                        """,
                        (topic, user_id, *target_institutions, orig_inst),
                    ).fetchone()
                else:
                    db_twin = db.execute(
                        """
                        SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                               q.institution_label, q.topic, q.area, q.subtema,
                               0 AS attempts, 0 AS correct, NULL AS latest_correct,
                               NULL AS next_review_date, NULL AS fsrs_card
                        FROM questions q
                        WHERE q.missing_alts = 0
                          AND COALESCE(NULLIF(q.subtema, ''), q.topic) = ?
                          AND q.id NOT IN (SELECT question_id FROM attempts WHERE user_id = ?)
                        ORDER BY (q.institution_code != ?) DESC, q.id ASC
                        LIMIT 1
                        """,
                        (topic, user_id, orig_inst),
                    ).fetchone()

                if db_twin and db_twin["id"] not in paired_twin_ids:
                    twin_candidate = db_twin
                    external_twin_rows[db_twin["id"]] = dict(db_twin)

            if twin_candidate is not None:
                paired_twin_ids[twin_candidate["id"]] = (orig_id, orig_inst, topic)
                replaced_orig_ids.add(orig_id)

    ranked = []
    seen_ids = set()

    for row in rows:
        qid = row["id"]
        if qid in replaced_orig_ids:
            continue

        item = dict(row)
        metrics = fsrs_metrics(item.pop("fsrs_card"), now)
        topic = item["subtema"] or item["topic"] or "Sem tema"
        topic_attempts, topic_correct, topic_avail, topic_answered = topic_totals.get(topic, [0, 0, 0, 0])
        topic_coverage = (topic_answered / topic_avail) if topic_avail > 0 else 0.0
        topic_score, _ = topic_priority(topic_attempts, topic_correct, metrics["retrievability"], coverage=topic_coverage)
        is_due = _due(item.pop("next_review_date"), now)
        reasons = []

        score = topic_score * cfg["topic_mult"]

        if qid in paired_twin_ids:
            orig_id, orig_inst, orig_topic = paired_twin_ids[qid]
            score += cfg["review_due"]
            reasons.append("twin_concept_review")
            item["is_twin"] = True
            item["twin_for_question_id"] = orig_id
            item["twin_origin_institution"] = orig_inst
            item["twin_subtema"] = orig_topic
        elif is_due:
            score += cfg["review_due"]
            reasons.append("review_due")
            item["is_twin"] = False
        else:
            item["is_twin"] = False

        if item["latest_correct"] == 0:
            score += cfg["latest_wrong"]
            reasons.append("latest_attempt_wrong")

        if item["attempts"] == 0 and qid not in paired_twin_ids:
            score += cfg["coverage_gap"]
            reasons.append("coverage_gap")

        if metrics["retrievability"] is not None and metrics["retrievability"] < 0.9:
            score += (0.9 - metrics["retrievability"]) * cfg["memory_risk"]
            reasons.append("memory_at_risk")

        # Priorização de bancas alvo selecionadas no planejador de residência
        inst_code = item.get("institution_code")
        is_target_inst = bool(target_institutions and (inst_code in target_institutions or (inst_code and inst_code.upper() in target_institutions)))
        item["is_target_institution"] = is_target_inst
        if is_target_inst:
            score += cfg.get("target_institution_boost", 25.0)
            reasons.append("target_institution_focus")

        score -= min(item["attempts"], 10) * 1.5
        item["adaptive_score"] = round(score, 3)
        item["adaptive_reasons"] = reasons or ["balanced_practice"]
        item["retrievability"] = metrics["retrievability"]
        item.pop("attempts", None)
        item.pop("correct", None)
        item.pop("latest_correct", None)
        ranked.append(item)
        seen_ids.add(qid)

    for twin_id, (orig_id, orig_inst, orig_topic) in paired_twin_ids.items():
        if twin_id not in seen_ids:
            twin_row = external_twin_rows.get(twin_id)
            if twin_row is None:
                fetched = db.execute(
                    """
                    SELECT q.id, q.source_file, q.source_number, q.year, q.institution_code,
                           q.institution_label, q.topic, q.area, q.subtema
                    FROM questions q WHERE q.id = ?
                    """,
                    (twin_id,),
                ).fetchone()
                twin_row = dict(fetched) if fetched else None
            if twin_row:
                item = {
                    k: twin_row[k]
                    for k in (
                        "id", "source_file", "source_number", "year",
                        "institution_code", "institution_label", "topic", "area", "subtema",
                    )
                    if k in twin_row
                }
                topic_attempts, topic_correct, topic_avail, topic_answered = topic_totals.get(orig_topic, [0, 0, 0, 0])
                topic_coverage = (topic_answered / topic_avail) if topic_avail > 0 else 0.0
                topic_score, _ = topic_priority(topic_attempts, topic_correct, None, coverage=topic_coverage)
                score = topic_score * cfg["topic_mult"] + cfg["review_due"]
                reasons = ["twin_concept_review"]
                inst_code = item.get("institution_code")
                is_target_inst = bool(target_institutions and (inst_code in target_institutions or (inst_code and inst_code.upper() in target_institutions)))
                item["is_target_institution"] = is_target_inst
                if is_target_inst:
                    score += cfg.get("target_institution_boost", 25.0)
                    reasons.append("target_institution_focus")
                item["is_twin"] = True
                item["twin_for_question_id"] = orig_id
                item["twin_origin_institution"] = orig_inst
                item["twin_subtema"] = orig_topic
                item["adaptive_score"] = round(score, 3)
                item["adaptive_reasons"] = reasons
                item["retrievability"] = None
                ranked.append(item)
                seen_ids.add(twin_id)

    ranked.sort(key=lambda item: (-item["adaptive_score"], item["id"]))
    return ranked[:limit]


def get_adaptive_signals_by_topic(db, user_id, now=None):
    """Compute deterministic adaptive signals for ALL topics for the given user."""
    use_cache = now is None
    signals_cache_key = (user_id, "__signals__")
    if use_cache:
        cached_signals = _profile_cache.get(signals_cache_key)
        if cached_signals is not None:
            return cached_signals

    now = _utc(now)
    topics_sql = """
        WITH AttemptRanks AS (
            SELECT
                q.id AS question_id,
                COALESCE(NULLIF(q.subtema, ''), q.topic) AS topic,
                a.is_correct,
                ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(NULLIF(q.subtema, ''), q.topic)
                    ORDER BY a.answered_at ASC
                ) AS rn
            FROM attempts a
            JOIN questions q ON q.id = a.question_id
            WHERE a.user_id = ? AND q.missing_alts = 0
                  AND COALESCE(NULLIF(q.subtema, ''), q.topic) IS NOT NULL
        ),
        TopicStats AS (
            SELECT
                topic,
                COUNT(DISTINCT question_id) AS answered,
                SUM(CASE WHEN rn <= 5 THEN is_correct ELSE 0 END) AS diag_correct,
                SUM(CASE WHEN rn <= 5 THEN 1 ELSE 0 END) AS diag_attempts,
                SUM(CASE WHEN rn > 5 THEN is_correct ELSE 0 END) AS prac_correct,
                SUM(CASE WHEN rn > 5 THEN 1 ELSE 0 END) AS prac_attempts,
                SUM(is_correct) AS correct,
                COUNT(is_correct) AS attempts
            FROM AttemptRanks
            GROUP BY topic
        ),
        QuestionTopics AS (
            SELECT
                COALESCE(NULLIF(q.subtema, ''), q.topic) AS topic,
                MIN(q.area) AS area,
                COUNT(q.id) AS available
            FROM questions q
            WHERE q.missing_alts = 0
                  AND COALESCE(NULLIF(q.subtema, ''), q.topic) IS NOT NULL
            GROUP BY COALESCE(NULLIF(q.subtema, ''), q.topic)
        )
        SELECT qt.topic, qt.area, qt.available,
               COALESCE(ts.attempts, 0) AS attempts,
               COALESCE(ts.answered, 0) AS answered,
               COALESCE(ts.correct, 0) AS correct,
               COALESCE(ts.diag_correct, 0) AS diag_correct,
               COALESCE(ts.diag_attempts, 0) AS diag_attempts,
               COALESCE(ts.prac_correct, 0) AS prac_correct,
               COALESCE(ts.prac_attempts, 0) AS prac_attempts
        FROM QuestionTopics qt
        LEFT JOIN TopicStats ts ON ts.topic = qt.topic
    """
    fsrs_sql = """
        SELECT COALESCE(NULLIF(q.subtema, ''), q.topic) AS topic,
               sr.fsrs_card, sr.next_review_date
        FROM spaced_repetition sr
        JOIN questions q ON q.id = sr.question_id
        WHERE sr.user_id = ?
    """

    batch_res = None
    if hasattr(db, "batch"):
        try:
            batch_res = db.batch([(topics_sql, (user_id,)), (fsrs_sql, (user_id,))])
        except Exception:
            batch_res = None

    if batch_res is not None:
        rows = batch_res[0].fetchall()
        fsrs_rows = batch_res[1].fetchall()
    else:
        rows = db.execute(topics_sql, (user_id,)).fetchall()
        fsrs_rows = db.execute(fsrs_sql, (user_id,)).fetchall()

    memory = {}
    for row in fsrs_rows:
        metrics = fsrs_metrics(row["fsrs_card"], now)
        bucket = memory.setdefault(row["topic"], {"values": [], "due": 0})
        if metrics["retrievability"] is not None:
            bucket["values"].append(metrics["retrievability"])
        if _due(row["next_review_date"], now):
            bucket["due"] += 1

    signals = {}
    for row in rows:
        topic_name = row["topic"]
        mem = memory.get(topic_name, {"values": [], "due": 0})
        retrievability = min(mem["values"]) if mem["values"] else None
        coverage = row["answered"] / row["available"] if row["available"] else 0.0
        score, confidence = topic_priority(row["attempts"], row["correct"], retrievability, coverage)
        reasons = []
        if row["attempts"] and row["correct"] / row["attempts"] < 0.65:
            reasons.append("low_accuracy")
        if mem["due"]:
            reasons.append("reviews_due")
        if retrievability is not None and retrievability < 0.9:
            reasons.append("memory_at_risk")
        if row["attempts"] > 0 and coverage < 0.2:
            reasons.append("low_coverage")
        signals[topic_name] = {
            "topic": topic_name, "area": row["area"], "available": row["available"],
            "attempts": row["attempts"], "correct": row["correct"], "answered": row["answered"],
            "accuracy": round(row["correct"] / row["attempts"], 4) if row["attempts"] else None,
            "diag_accuracy": round(row["diag_correct"] / row["diag_attempts"], 4) if row["diag_attempts"] else None,
            "prac_accuracy": round(row["prac_correct"] / row["prac_attempts"], 4) if row["prac_attempts"] else None,
            "coverage": round(coverage, 4), "confidence": round(confidence, 4),
            "retrievability": retrievability, "due_count": mem["due"],
            "priority_score": score, "reasons": reasons,
        }
    if use_cache:
        _profile_cache.set(signals_cache_key, signals)
    return signals


def _build_fallback_profile(now: datetime, cache_key: tuple) -> dict:
    """Retorna último perfil conhecido ou fallback determinístico seguro em falha de banco."""
    stale = _last_known_profile.get(cache_key)
    if stale is not None:
        return {
            **stale,
            "method": {
                **stale.get("method", {}),
                "stale_fallback": True,
            },
        }
    return {
        "generated_at": now.isoformat(),
        "goal": {
            "questions_today": 30,
            "configured_daily_questions": 30,
            "reviews_due": 0,
            "reviews_to_do_today": 0,
            "backlog_pending": 0,
            "hours_budget": 4,
            "max_capacity": 80,
            "target_score": None,
            "exam_date": None,
        },
        "topics": [],
        "method": {
            "deterministic": True,
            "fallback": True,
            "signals": ["FSRS retrievability", "accuracy with evidence confidence", "coverage", "due reviews"],
        },
    }


def build_learning_profile(db, user_id, now=None, subtema=None, limit=15, config_row=None):
    """Build a transparent personalized diagnosis and daily goal."""
    use_cache = now is None
    cache_key = (user_id, subtema, limit)
    if use_cache:
        cached = _profile_cache.get(cache_key)
        if cached is not None:
            return cached

    raw_now = now
    now = _utc(now)
    try:
        signals = get_adaptive_signals_by_topic(db, user_id, now=raw_now)
        due_total = sum(item["due_count"] for item in signals.values())

        topics = []
        for item in signals.values():
            reasons = list(item["reasons"])
            if item["coverage"] < 0.2 and "low_coverage" not in reasons:
                reasons.append("low_coverage")
            topics.append({
                **item,
                "reasons": reasons or ["balanced_practice"],
            })

        topics.sort(key=lambda item: (-item["priority_score"], item["topic"]))
        if subtema is not None:
            topics = [item for item in topics if item["topic"] == subtema]
        if config_row is not None:
            config = config_row
        else:
            config = db.execute(
                "SELECT questions_per_day, target_score, exam_date, hours_per_day FROM planner_config WHERE user_id=?",
                (user_id,),
            ).fetchone()
    except Exception as exc:
        logger.warning("Fallback de perfil adaptativo acionado para user_id=%s: %s", user_id, exc)
        return _build_fallback_profile(now, cache_key)

    cfg_dict = dict(config) if config else {}
    daily_goal = int(cfg_dict.get("questions_per_day") or 30)
    hours_per_day = int(cfg_dict.get("hours_per_day") or 4)
    target_score = cfg_dict.get("target_score")
    exam_date = cfg_dict.get("exam_date")
    
    # Orçamento de tempo: 1 questão = 3 min (resolução + leitura comentada) -> 20 q/h
    max_capacity = hours_per_day * 20
    reviews_to_do_today = min(due_total, max_capacity)
    backlog_pending = max(0, due_total - max_capacity)
    questions_today = max(daily_goal, reviews_to_do_today)

    result = {
        "generated_at": now.isoformat(),
        "goal": {
            "questions_today": questions_today, 
            "configured_daily_questions": daily_goal,
            "reviews_due": due_total,
            "reviews_to_do_today": reviews_to_do_today,
            "backlog_pending": backlog_pending,
            "hours_budget": hours_per_day,
            "max_capacity": max_capacity,
            "target_score": target_score,
            "exam_date": exam_date,
        },
        "topics": topics[:limit] if limit is not None else topics,
        "method": {
            "deterministic": True,
            "signals": ["FSRS retrievability", "accuracy with evidence confidence", "coverage", "due reviews"],
        },
    }
    _last_known_profile[cache_key] = result
    if use_cache:
        _profile_cache.set(cache_key, result)
    return result


