"""
Serviço de Domínio de Focos por Prevalência e Raio-X Sniper da Banca.
Cruza a incidência histórica de subtemas na banca-alvo com a acurácia do aluno.
"""
from __future__ import annotations

from urllib.parse import urlencode

from ..edital_profiles import resolve_institution_codes


def build_focus_radar(
    db,
    user_id: str,
    institution: str = "",
    prevalence: str = "all",
) -> dict:
    """Calcula domínio de focos por prevalência (prioritario, alta, media) para uma banca."""
    inst_codes = resolve_institution_codes(institution) if institution else []
    where_q = "q.missing_alts = 0 AND q.area IS NOT NULL AND q.area != '' AND q.subtema IS NOT NULL AND q.subtema != ''"
    params_q: list[object] = []
    if inst_codes:
        placeholders = ",".join("?" * len(inst_codes))
        where_q += f" AND q.institution_code IN ({placeholders})"
        params_q.extend(inst_codes)

    q_rows = db.execute(
        f"""
        SELECT q.area, q.subtema, COUNT(*) AS available
        FROM questions q
        WHERE {where_q}
        GROUP BY q.area, q.subtema
        ORDER BY available DESC, q.area ASC, q.subtema ASC
        """,
        params_q,
    ).fetchall()

    if not q_rows:
        return {
            "institution": institution or "Todas",
            "prevalence_filter": prevalence,
            "summary": {
                "total_focuses": 0,
                "mastered_focuses": 0,
                "priority_total": 0,
                "priority_mastered": 0,
            },
            "areas": [],
            "focuses": [],
            "sniper_url": "/estudar",
        }

    # Busca tentativas agregadas por (area, subtema) para o usuário
    att_where = "a.user_id = ? AND q.missing_alts = 0 AND q.area IS NOT NULL AND q.subtema IS NOT NULL"
    att_params: list[object] = [user_id]
    if inst_codes:
        placeholders = ",".join("?" * len(inst_codes))
        att_where += f" AND q.institution_code IN ({placeholders})"
        att_params.extend(inst_codes)

    att_rows = db.execute(
        f"""
        SELECT q.area, q.subtema,
               COUNT(*) AS attempts,
               SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               COUNT(DISTINCT a.question_id) AS answered
        FROM attempts a
        JOIN questions q ON q.id = a.question_id
        WHERE {att_where}
        GROUP BY q.area, q.subtema
        """,
        att_params,
    ).fetchall()

    att_map = {
        (r["area"], r["subtema"]): {
            "attempts": int(r["attempts"] or 0),
            "correct": int(r["correct"] or 0),
            "answered": int(r["answered"] or 0),
        }
        for r in att_rows
    }

    total_focuses = len(q_rows)
    priority_cutoff = max(1, int(round(total_focuses * 0.25)))
    high_cutoff = max(priority_cutoff, int(round(total_focuses * 0.60)))

    all_focuses: list[dict] = []
    area_agg: dict[str, dict] = {}
    priority_total = 0
    priority_mastered = 0
    total_mastered = 0

    for idx, row in enumerate(q_rows):
        area = row["area"]
        subtema = row["subtema"]
        available = int(row["available"] or 0)
        if idx < priority_cutoff:
            tier = "prioritario"
        elif idx < high_cutoff:
            tier = "alta"
        else:
            tier = "media"

        stats = att_map.get((area, subtema), {"attempts": 0, "correct": 0, "answered": 0})
        attempts = stats["attempts"]
        correct = stats["correct"]
        answered = stats["answered"]
        accuracy = round(correct / attempts, 4) if attempts > 0 else None
        mastered = attempts >= 3 and (accuracy is not None and accuracy >= 0.75)

        if mastered:
            total_mastered += 1
        if tier == "prioritario":
            priority_total += 1
            if mastered:
                priority_mastered += 1

        q_params: dict[str, str] = {"area": area, "subtema": subtema, "limit": "20"}
        if institution:
            q_params["institution"] = institution
        sniper_url = "/estudar?" + urlencode(q_params)

        item = {
            "area": area,
            "subtema": subtema,
            "prevalence": tier,
            "available": available,
            "answered": answered,
            "attempts": attempts,
            "correct": correct,
            "accuracy": accuracy,
            "mastered": mastered,
            "sniper_url": sniper_url,
        }
        all_focuses.append(item)

        if area not in area_agg:
            area_agg[area] = {
                "area": area,
                "focuses_count": 0,
                "mastered_count": 0,
                "available": 0,
                "answered": 0,
                "attempts": 0,
                "correct": 0,
            }
        agg = area_agg[area]
        if prevalence in ("all", "", tier):
            agg["focuses_count"] += 1
            if mastered:
                agg["mastered_count"] += 1
            agg["available"] += available
            agg["answered"] += answered
            agg["attempts"] += attempts
            agg["correct"] += correct

    filtered_focuses = [
        f for f in all_focuses if prevalence in ("all", "", f["prevalence"])
    ]

    # Top lacunas vermelhas (prioritárias não dominadas) para o botão "Gerar Bateria Sniper"
    red_zone = [
        f for f in all_focuses
        if f["prevalence"] in ("prioritario", "alta") and not f["mastered"]
    ][:5]
    sniper_params: list[tuple[str, str]] = [("limit", "20")]
    if institution:
        sniper_params.append(("institution", institution))
    for rz in red_zone:
        sniper_params.append(("subtema", rz["subtema"]))
    sniper_batch_url = "/estudar?" + urlencode(sniper_params)

    areas_list = []
    for agg in area_agg.values():
        if agg["focuses_count"] == 0:
            continue
        acc = round(agg["correct"] / agg["attempts"], 4) if agg["attempts"] > 0 else None
        areas_list.append({**agg, "accuracy": acc})
    areas_list.sort(key=lambda a: (-a["available"], a["area"]))

    return {
        "institution": institution or "Todas",
        "prevalence_filter": prevalence or "all",
        "summary": {
            "total_focuses": total_focuses,
            "mastered_focuses": total_mastered,
            "priority_total": priority_total,
            "priority_mastered": priority_mastered,
        },
        "areas": areas_list,
        "focuses": filtered_focuses[:80],
        "sniper_url": sniper_batch_url,
    }
