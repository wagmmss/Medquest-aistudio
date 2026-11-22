"""
Serviço de domínio para o motor de questões, amostragem, busca FTS5 e batch SRS.
Extraído de `api/questions.py` para manter os handlers HTTP finos e testáveis.
"""
import random
import re
from datetime import datetime, timedelta, timezone

from ..filters import TARGET_INSTITUTION_RATIO


def check_is_correct(selected: str, correct_letter: str | None, alts_correct: set[str] | None = None) -> int:
    """Verifica se a alternativa selecionada pelo aluno é considerada correta.

    Suporta:
    - Letras únicas (ex: 'A', 'B')
    - Múltiplas alternativas válidas / aceitas pós-recurso (ex: 'B, C', 'A, B')
    - Questões anuladas pela banca (ex: 'ANULADA'), onde todos os candidatos pontuam
    - Verificação direta contra alternativas marcadas com is_correct=1
    """
    sel = (selected or "").strip().upper()
    if not sel:
        return 0
    if alts_correct and sel in alts_correct:
        return 1
    corr = (correct_letter or "").strip().upper()
    if not corr:
        return 0
    if corr == "ANULADA":
        return 1
    valid_letters = {c.strip() for c in corr.split(",") if c.strip()}
    return 1 if sel in valid_letters else 0


def _sample_ids(db, where_clause, params, limit):
    """Amostragem rápida por faixa de IDs, evitando ORDER BY RANDOM().

    Obtém min/max ID, gera candidatos aleatórios em Python e filtra.
    Fallback para ORDER BY RANDOM() se a faixa for muito esparsa.
    """
    bounds = db.execute(
        f"SELECT MIN(q.id) AS lo, MAX(q.id) AS hi, COUNT(*) AS n FROM questions q WHERE {where_clause}",
        params,
    ).fetchone()
    lo, hi, n = bounds["lo"], bounds["hi"], bounds["n"]
    if not lo or n == 0:
        return []
    effective_limit = min(limit, n)
    if n > 0 and (hi - lo + 1) / n < 5:
        sample_size = min(effective_limit * 3, hi - lo + 1, 900)
        candidates = random.sample(range(lo, hi + 1), sample_size)
        placeholders = ",".join("?" * len(candidates))
        rows = db.execute(
            f"SELECT q.id FROM questions q WHERE q.id IN ({placeholders}) AND {where_clause} LIMIT ?",
            (*candidates, *params, effective_limit),
        ).fetchall()
        ids = [r["id"] for r in rows]
        if len(ids) >= effective_limit:
            return ids[:effective_limit]
    rows = db.execute(
        f"SELECT q.id FROM questions q WHERE {where_clause} ORDER BY RANDOM() LIMIT ?",
        (*params, effective_limit),
    ).fetchall()
    return [r["id"] for r in rows]


def _sample_prioritized_ids(db, where_clause, params, limit, target_insts, has_explicit_inst_filter=False):
    """Amostragem com proporção prioritária das bancas-alvo do aluno com fallback de diversidade."""
    if not target_insts or has_explicit_inst_filter or limit <= 0:
        return _sample_ids(db, where_clause, params, limit)

    target_quota = max(1, int(round(limit * TARGET_INSTITUTION_RATIO)))
    target_quota = min(target_quota, limit)
    placeholders = ",".join("?" * len(target_insts))
    inst_tuple = tuple(target_insts)

    where_target = f"{where_clause} AND q.institution_code IN ({placeholders})"
    target_ids = _sample_ids(db, where_target, (*params, *inst_tuple), target_quota)

    remaining_needed = limit - len(target_ids)
    if remaining_needed <= 0:
        return target_ids[:limit]

    where_other = f"{where_clause} AND (q.institution_code NOT IN ({placeholders}) OR q.institution_code IS NULL)"
    other_ids = _sample_ids(db, where_other, (*params, *inst_tuple), remaining_needed)

    combined = list(target_ids) + list(other_ids)

    shortfall = limit - len(combined)
    if shortfall > 0:
        exclude_ph = ",".join("?" * len(combined))
        where_fallback = f"{where_clause} AND q.id NOT IN ({exclude_ph})" if combined else where_clause
        fallback_params = (*params, *combined) if combined else params
        extra_ids = _sample_ids(db, where_fallback, fallback_params, shortfall)
        combined.extend(extra_ids)

    return combined[:limit]


def _bounded_int(value, default, minimum, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def _fts_phrase(value):
    """Converte texto livre em uma expressão FTS5 segura e limitada."""
    words = re.findall(r"\w+", value or "", flags=re.UNICODE)[:12]
    return " ".join(words)


def _fts5_escape(query_str: str) -> str:
    tokens = re.findall(r"\w+", query_str, flags=re.UNICODE)
    valid_tokens = [t for t in tokens if len(t) >= 2]
    if not valid_tokens:
        return ""
    return " AND ".join(f'"{t}"*' for t in valid_tokens[:12])


def _fts5_or_query(terms: list[str]) -> str:
    tokens: list[str] = []
    for term in terms:
        for t in re.findall(r"\w+", term, flags=re.UNICODE):
            if len(t) >= 2 and t not in tokens:
                tokens.append(t)
    if not tokens:
        return ""
    return " OR ".join(f'"{t}"*' for t in tokens[:16])


def _resolve_answered_at(client_iso: str | None, fallback_now: datetime | None = None) -> str:
    """Valida e aplica clamp defensivo no timestamp da tentativa contra clock skew."""
    server_now = (fallback_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not client_iso:
        return server_now.isoformat()
    try:
        parsed = datetime.fromisoformat(str(client_iso).strip().replace("Z", "+00:00"))
        parsed_utc = parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        min_allowed = server_now - timedelta(days=30)
        if parsed_utc > server_now or parsed_utc < min_allowed:
            parsed_utc = server_now
        return parsed_utc.isoformat()
    except (ValueError, TypeError):
        return server_now.isoformat()


def _defer_question_review(db, qid, user_id):
    """Give an unrated answer a day of rest without inventing an FSRS rating."""
    resume_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    db.execute(
        """UPDATE spaced_repetition SET next_review_date = ?
           WHERE question_id = ? AND user_id = ?
             AND (next_review_date IS NULL OR next_review_date < ?)""",
        (resume_at, qid, user_id, resume_at),
    )


def _fetch_batch_metadata(db, q_ids: list[int], chunk_size: int = 500) -> tuple[dict, dict, dict]:
    q_map = {}
    correct_alts_map = {}
    exp_map = {}
    unique_ids = list(dict.fromkeys(q_ids))
    if not unique_ids:
        return q_map, correct_alts_map, exp_map

    for i in range(0, len(unique_ids), chunk_size):
        chunk = unique_ids[i:i + chunk_size]
        placeholders = ",".join("?" * len(chunk))
        q_exp_sql = f"""
            SELECT q.id, q.correct_letter, e.explanation_text
            FROM questions q
            LEFT JOIN explanations e ON e.question_id = q.id
            WHERE q.id IN ({placeholders})
        """
        alts_sql = (
            f"SELECT question_id, letter FROM alternatives "
            f"WHERE question_id IN ({placeholders}) AND is_correct = 1"
        )

        batch_res = None
        if hasattr(db, "batch"):
            try:
                batch_res = db.batch([(q_exp_sql, chunk), (alts_sql, chunk)])
            except Exception:
                batch_res = None

        if batch_res is not None:
            qs = batch_res[0].fetchall()
            alts_rows = batch_res[1].fetchall()
        else:
            qs = db.execute(q_exp_sql, chunk).fetchall()
            alts_rows = db.execute(alts_sql, chunk).fetchall()

        for q in qs:
            qid = q["id"]
            q_map[qid] = q["correct_letter"]
            if q["explanation_text"] is not None:
                exp_map[qid] = q["explanation_text"]

        for a in alts_rows:
            correct_alts_map.setdefault(a["question_id"], set()).add(a["letter"].strip().upper())

    return q_map, correct_alts_map, exp_map


def _fetch_srs_map(db, q_ids: list[int], user_id: int, chunk_size: int = 500) -> dict:
    srs_map = {}
    unique_ids = list(dict.fromkeys(q_ids))
    for i in range(0, len(unique_ids), chunk_size):
        chunk = unique_ids[i:i + chunk_size]
        placeholders = ",".join("?" * len(chunk))
        chunk_args = [*chunk, user_id]
        srs_data = db.execute(
            f"SELECT question_id, fsrs_card FROM spaced_repetition WHERE question_id IN ({placeholders}) AND user_id = ?",
            chunk_args,
        ).fetchall()
        for card in srs_data:
            srs_map[card["question_id"]] = card["fsrs_card"]
    return srs_map

