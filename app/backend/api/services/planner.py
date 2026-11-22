import json
import math
import os
from datetime import datetime, timedelta
from functools import lru_cache
from api.internato_config import RODIZIOS_TURMA_J

USP_WEIGHTS = {
    "Clínica Médica": 0.30,
    "Cirurgia": 0.20,
    "Pediatria": 0.15,
    "Ginecologia e Obstetrícia": 0.15,
    "Preventiva": 0.20
}

DEFAULT_PRACTICE_HOURS_PER_SUBTEMA = 2.0


def _resolve_data_path(filename):
    """Resolve o caminho de um arquivo JSON procurando em data/ e scripts/."""
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    candidate_data = os.path.join(base_dir, "data", filename)
    if os.path.exists(candidate_data):
        return candidate_data
    candidate_scripts = os.path.join(base_dir, "scripts", filename)
    if os.path.exists(candidate_scripts):
        return candidate_scripts
    return candidate_data


def get_normalized_area(raw_area):
    if not raw_area:
        return "Outros"
    # Using substrings to avoid encoding issues with the SQLite output
    if "Cirurgia" in raw_area:
        return "Cirurgia"
    if "nica" in raw_area:
        return "Clínica Médica"
    if "Ginecologia" in raw_area:
        return "Ginecologia e Obstetrícia"
    if "Preventiva" in raw_area:
        return "Preventiva"
    if "Pediatria" in raw_area:
        return "Pediatria"
    return "Outros"


def _parse_dates_and_weeks(start_date_str, exam_date_str):
    try:
        start_date = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
        exam_date = datetime.fromisoformat(exam_date_str.replace("Z", "+00:00"))
    except ValueError:
        return None, None, {"error": "Formato de data inválido."}

    # Normaliza para naive: exam_date costuma vir só com a data (sem timezone),
    # enquanto start_date pode vir com timezone (ex.: default gerado no backend).
    if start_date.tzinfo is not None:
        start_date = start_date.replace(tzinfo=None)
    if exam_date.tzinfo is not None:
        exam_date = exam_date.replace(tzinfo=None)

    total_weeks = math.ceil((exam_date - start_date).days / 7)
    if total_weeks <= 0:
        return None, None, {"error": "A data da prova deve ser no futuro."}

    # Cap at 5 years to prevent memory/rendering issues in frontend
    total_weeks = min(total_weeks, 260)
    return start_date, total_weeks, None


@lru_cache(maxsize=1)
def _load_catalogs():
    # Carrega o mesmo catálogo pedagógico exibido no frontend.
    planner_data_path = _resolve_data_path("plannerData.json")
    try:
        with open(planner_data_path, "r", encoding="utf-8") as f:
            planner_meta = json.load(f)
    except Exception:
        planner_meta = []

    duration_catalog_path = _resolve_data_path("katomartCourseDurations.json")
    try:
        with open(duration_catalog_path, "r", encoding="utf-8") as f:
            duration_catalog = json.load(f)
    except Exception:
        duration_catalog = {}

    katomart_subtemas = duration_catalog.get("subtemas", {})
    practice_hours_per_subtema = duration_catalog.get("source", {}).get(
        "practice_hours_per_subtema",
        DEFAULT_PRACTICE_HOURS_PER_SUBTEMA,
    )
    return planner_meta, katomart_subtemas, practice_hours_per_subtema


def _build_meta_dict(planner_meta, katomart_subtemas):
    # Cria o catálogo canônico de subtemas para fácil acesso. O banco pode
    # conter classificações históricas, incompletas ou ainda não migradas; ele
    # só deve complementar as estatísticas dos temas, nunca definir o edital.
    meta_dict = {}
    for area_group in planner_meta:
        canonical_area = get_normalized_area(area_group.get("area"))
        for macro in area_group.get("macroThemes", []):
            is_high_yield = macro.get("highYield", False)
            # Fallback pedagógico para subtemas sem correspondência segura no
            # catálogo local de aulas do Katomart.
            fallback_theory_hours = max(1.0, len(macro.get("details", [])) * 0.25)

            for db_subtema in macro.get("dbSubtemas", []):
                course_match = katomart_subtemas.get(db_subtema)
                meta_dict[db_subtema] = {
                    "area": canonical_area,
                    "highYield": is_high_yield,
                    "theory_hours": (
                        course_match.get("theory_hours", fallback_theory_hours)
                        if course_match
                        else fallback_theory_hours
                    ),
                    "theory_source": "curriculum" if course_match else "pedagogical_estimate",
                    "course_module": course_match.get("module") if course_match else None,
                }
    return meta_dict


def _consolidate_row_stats(rows, meta_dict):
    # Consolida as estatísticas do banco apenas para os 170 temas do catálogo.
    # Isso também protege contra a mesma classificação aparecer em mais de uma
    # área durante uma migração de dados.
    row_stats = {
        subtema: {"q_count": 0, "target_q_count": 0, "subtopics": []}
        for subtema in meta_dict
    }
    for row in rows:
        subtema = row["subtema"]
        if subtema not in row_stats:
            continue
        stats = row_stats[subtema]
        try:
            stats["q_count"] += int(row["q_count"] or 0)
        except (TypeError, ValueError):
            pass
        raw_target_q = (
            row.get("target_q_count")
            if isinstance(row, dict)
            else (row["target_q_count"] if "target_q_count" in row.keys() else 0)
        )
        try:
            stats["target_q_count"] += int(raw_target_q or 0)
        except (TypeError, ValueError):
            pass
        topics = row.get("topics") if isinstance(row, dict) else (row["topics"] if "topics" in row.keys() else None)
        if topics:
            stats["subtopics"].extend(topic for topic in str(topics).split(",") if topic)
    return row_stats


def _compute_empirical_incidence(meta_dict, row_stats, use_bank_incidence=False):
    """
    Calcula incidência empírica normalizada dentro de cada grande área a partir
    das questões reais das bancas-alvo selecionadas pelo estudante.

    Quando não há bancas-alvo ou não existem questões dessas bancas no catálogo,
    retorna `({}, False)` preservando integralmente o comportamento legado.
    """
    if not use_bank_incidence:
        return {}, False

    total_target_q = sum(stats.get("target_q_count", 0) for stats in row_stats.values())
    if total_target_q <= 0:
        return {}, False

    by_area = {}
    for subtema, meta in meta_dict.items():
        area = meta["area"]
        by_area.setdefault(area, []).append(
            (subtema, row_stats[subtema].get("target_q_count", 0), bool(meta["highYield"]))
        )

    incidence_map = {}
    for area, items in by_area.items():
        max_area_q = max((item[1] for item in items), default=0)
        if max_area_q <= 0:
            for subtema, tq, is_hy in items:
                incidence_map[subtema] = {
                    "target_q_count": tq,
                    "effective_high_yield": is_hy,
                    "incidence_bonus": 0.0,
                    "incidence_source": "national_catalog",
                }
            continue

        static_hy_count = sum(1 for item in items if item[2])
        cutoff = max(1, static_hy_count) if static_hy_count > 0 else max(1, round(len(items) * 0.5))
        ranked = sorted(items, key=lambda x: (x[1], 1 if x[2] else 0), reverse=True)
        top_subtemas = {item[0] for item in ranked[:cutoff]}
        denom = math.log1p(max_area_q)

        for subtema, tq, _is_hy in items:
            ratio = (math.log1p(tq) / denom) if denom > 0 and tq > 0 else 0.0
            incidence_map[subtema] = {
                "target_q_count": tq,
                "effective_high_yield": subtema in top_subtemas,
                "incidence_bonus": round(ratio * 25.0, 2),
                "incidence_source": "target_banks",
            }

    return incidence_map, True


def _build_topic_item(
    subtema,
    meta,
    stats,
    prog,
    practice_hours_per_subtema,
    adaptive_signals=None,
    completed_subtemas=None,
    incidence_info=None,
):
    norm_area = meta["area"]
    q_count = stats["q_count"] if stats else 0

    prog_dict = dict(prog) if prog else {}
    ans_count = prog_dict.get("ans_count") or 0
    attempts = prog_dict.get("attempts") or 0
    correct_count = prog_dict.get("correct_count") or 0
    acc = (correct_count / attempts) if attempts > 0 else 0

    remaining_q = max(0, q_count - ans_count)

    theory_hours = meta["theory_hours"]
    practice_hours = practice_hours_per_subtema
    total_topic_hours = theory_hours + practice_hours

    use_empirical = bool(incidence_info and incidence_info.get("incidence_source") == "target_banks")
    effective_high_yield = (
        bool(incidence_info["effective_high_yield"])
        if incidence_info is not None
        else bool(meta["highYield"])
    )
    incidence_bonus = float(incidence_info.get("incidence_bonus", 0.0)) if use_empirical else 0.0
    target_q_count = int(incidence_info.get("target_q_count", 0)) if use_empirical else None

    # Priority score: High Yield = 100, plus empirical bank incidence (when active), plus area weight
    weight = USP_WEIGHTS.get(norm_area, 0.1)
    priority = 100 if effective_high_yield else 0
    priority += incidence_bonus
    priority += weight * 10

    priority_reasons = []
    if adaptive_signals is not None:
        sig = adaptive_signals.get(subtema)
        if sig:
            reasons = sig.get("reasons", [])
            if reasons:
                # Sinais adaptativos com evidências reais de dificuldade ou revisão pendente
                score = float(sig.get("priority_score", 0.0) or 0.0)
                priority += round(score * 50.0, 2)
                priority_reasons = list(reasons)
    else:
        # Fallback retrocompatível para chamadas sem sinais adaptativos
        if attempts >= 3 and acc < 0.6:
            priority += 50
            priority_reasons.append("low_accuracy")

    # Tier and explanation
    if priority >= 130:
        priority_tier = "Diamante"
    elif priority >= 100:
        priority_tier = "Alta"
    elif priority >= 50:
        priority_tier = "Média"
    else:
        priority_tier = "Normal"

    explanation_parts = []
    if effective_high_yield:
        if use_empirical and target_q_count and target_q_count > 0:
            q_label = "1 questão" if target_q_count == 1 else f"{target_q_count} questões"
            explanation_parts.append(f"tem alta incidência nas suas bancas ({q_label})")
        else:
            explanation_parts.append("é de alto rendimento nas provas")
    if "low_accuracy" in priority_reasons:
        explanation_parts.append("houve baixo desempenho recente")
    if "reviews_due" in priority_reasons:
        explanation_parts.append("há revisões vencidas")
    if "memory_at_risk" in priority_reasons:
        explanation_parts.append("há risco de esquecimento")
    if "low_coverage" in priority_reasons:
        explanation_parts.append("você ainda não cobriu este assunto")

    if explanation_parts:
        if len(explanation_parts) > 1:
            exp = ", ".join(explanation_parts[:-1]) + " e " + explanation_parts[-1]
        else:
            exp = explanation_parts[0]
        priority_explanation = f"Recomendado porque {exp}."
    else:
        priority_explanation = "Recomendado para cobrir o edital equilibradamente."

    topic_obj = {
        "area": norm_area,
        "subtema": subtema,
        "subtopics": stats["subtopics"] if stats else [],
        "questions_available": remaining_q,
        "estimated_theory_hours": round(theory_hours, 2),
        "estimated_practice_hours": round(practice_hours, 2),
        "estimated_hours": round(total_topic_hours, 2),
        "theory_source": meta["theory_source"],
        "course_module": meta["course_module"],
        "priority": round(priority, 2),
        "priority_reasons": priority_reasons,
        "priority_tier": priority_tier,
        "priority_explanation": priority_explanation,
        "completed": bool(completed_subtemas and subtema in completed_subtemas),
        "incidence_source": "target_banks" if use_empirical else "national_catalog",
    }
    if use_empirical:
        topic_obj["target_questions_count"] = target_q_count
    return topic_obj, total_topic_hours


def _prepare_topics(
    meta_dict,
    row_stats,
    user_progress,
    intensive,
    practice_hours_per_subtema,
    adaptive_signals=None,
    completed_subtemas=None,
    incidence_map=None,
):
    # Prepara exatamente os tópicos canônicos, calculando as horas de cada um.
    all_topics = []
    total_required_hours = 0.0
    pending_required_hours = 0.0

    if user_progress is None:
        user_progress = {}

    for subtema, meta in meta_dict.items():
        inc_info = incidence_map.get(subtema) if incidence_map else None
        effective_hy = inc_info["effective_high_yield"] if inc_info is not None else meta["highYield"]
        if intensive and not effective_hy:
            continue

        stats = row_stats[subtema]
        prog = user_progress.get(subtema)
        topic_obj, topic_hours = _build_topic_item(
            subtema,
            meta,
            stats,
            prog,
            practice_hours_per_subtema,
            adaptive_signals,
            completed_subtemas=completed_subtemas,
            incidence_info=inc_info,
        )
        total_required_hours += topic_hours
        if not topic_obj["completed"]:
            pending_required_hours += topic_hours
        all_topics.append(topic_obj)

    # Sort topics by priority (descending)
    all_topics.sort(key=lambda x: x["priority"], reverse=True)
    return all_topics, total_required_hours, pending_required_hours


WEEK_OVERFLOW_TOLERANCE_HOURS = 1.0
INTERNATO_ANCHOR_RATIO = 0.70


def _normalize_internato_area(raw_area):
    if not raw_area:
        return None
    lower = raw_area.lower().strip()
    if lower in ("geral", "equilibrado", "férias", "ferias", "misto", "todas"):
        return None
    if "intensiva" in lower or "anestes" in lower or "especialidades" in lower or "oftalmo" in lower or "orl" in lower:
        return "Clínica Médica"
    if "mfc" in lower:
        return "Preventiva"
    if "emerg" in lower or "trauma" in lower:
        return "Cirurgia"
    norm = get_normalized_area(raw_area)
    return None if norm == "Outros" else norm


def get_block_for_date(date_obj, internato_blocks=None):
    blocks = internato_blocks if internato_blocks is not None else RODIZIOS_TURMA_J
    for bloco in blocks:
        try:
            inicio = datetime.strptime(bloco["start"], "%Y-%m-%d")
            fim = datetime.strptime(bloco["end"], "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        except (KeyError, ValueError, TypeError):
            continue
        if inicio <= date_obj <= fim:
            raw_area = bloco.get("area")
            norm_area = _normalize_internato_area(raw_area)
            raw_hours = bloco.get("hours_per_week")
            block_hours = None
            if raw_hours is not None:
                try:
                    val = float(raw_hours)
                    if 1.0 <= val <= 168.0:
                        block_hours = val
                except (TypeError, ValueError):
                    pass
            return {
                "area": norm_area,
                "raw_area": raw_area,
                "label": bloco.get("label") or raw_area,
                "hours_per_week": block_hours,
            }
    return None


def get_area_for_date(date_obj, internato_blocks=None):
    block = get_block_for_date(date_obj, internato_blocks)
    return block["area"] if block else None


def _pick_best_fitting_topic(area_topics, current_week_hours, target_hours, max_week_hours):
    """Escolhe o tópico ideal da área respeitando prioridade e fechando perto da meta sem passar do teto."""
    if not area_topics:
        return -1

    # Primeiro tópico da semana: sempre prioriza o mais importante disponível
    if current_week_hours == 0:
        return 0

    remaining_to_max = max_week_hours - current_week_hours
    fitting = [
        (idx, t)
        for idx, t in enumerate(area_topics)
        if t["estimated_hours"] <= remaining_to_max + 1e-6
    ]
    if not fitting:
        return -1

    # Se ainda cabe folgado mais de um tópico médio depois deste, mantém a ordem de prioridade
    first_idx, first_topic = fitting[0]
    if (current_week_hours + first_topic["estimated_hours"]) < (target_hours - 2.25):
        return first_idx

    # Perto de fechar a semana: faz best-fit para atingir [target_hours - 0.5, max_week_hours]
    # evitando semanas curtas (8h-9h) enquanto respeita prioridade entre candidatos equivalentes.
    def _fit_score(item):
        idx, t = item
        new_total = current_week_hours + t["estimated_hours"]
        # Penaliza ficar muito abaixo da meta quando há alternativas que fecham melhor
        in_sweet_spot = 1 if (target_hours - 0.5) <= new_total <= (max_week_hours + 1e-6) else 0
        # Dentro da faixa boa, prefere o mais próximo de target_hours..max_week_hours e maior prioridade
        # Fora da faixa boa (ainda abaixo), prefere preencher mais horas
        if in_sweet_spot:
            # Preferência leve por ficar próximo da meta (ex.: 12.0h-12.8h)
            distance_penalty = abs(new_total - (target_hours + 0.3))
            priority_bonus = t["priority"] / 500.0
            return (2, -distance_penalty + priority_bonus, -idx)
        # Se nenhum atinge a faixa ideal em um único passo, prefere o que melhor preenche ou permite próximo encaixe
        leaves_room_for_more = 1 if (max_week_hours - new_total) >= 2.25 else 0
        return (1 if leaves_room_for_more else 0, new_total, t["priority"], -idx)

    best_idx, _ = max(fitting, key=_fit_score)
    return best_idx


def _rank_balanced_areas(active_areas, topics_by_area, initial_counts, week_area_counts, exclude_area=None):
    """Ordena áreas de forma equilibrada proporcionalmente ao restante, evitando repetir área na semana."""
    pool = [a for a in active_areas if a != exclude_area]
    if not pool:
        pool = list(active_areas)

    def _area_key(area):
        remaining = len(topics_by_area[area])
        initial = max(1, initial_counts.get(area, remaining))
        ratio = remaining / initial
        used_this_week = week_area_counts.get(area, 0)
        top_priority = topics_by_area[area][0]["priority"] if topics_by_area[area] else 0.0
        # 1) Áreas ainda não usadas nesta semana primeiro
        # 2) Maior fração ainda pendente (mantém todas as 5 áreas evoluindo juntas do início ao fim)
        # 3) Maior prioridade do próximo tópico
        # 4) Peso da área
        return (
            -used_this_week,
            round(ratio, 3),
            1 if top_priority >= 100 else 0,
            USP_WEIGHTS.get(area, 0.1),
            remaining,
        )

    return sorted(pool, key=_area_key, reverse=True)


def _try_improve_underfilled_week(
    week_topics,
    current_week_hours,
    topics_by_area,
    target_hours,
    max_week_hours,
    preferred_area=None,
):
    """Se a semana fechou curta (< target - 1.0h), tenta trocar o último tópico para fechar em [target-0.5, max]."""
    if not week_topics or current_week_hours >= (target_hours - 1.0):
        return current_week_hours

    last_topic = week_topics[-1]
    base_hours = current_week_hours - last_topic["estimated_hours"]
    best_swap = None

    # Procura um tópico único mais longo ou um par de tópicos curtos que feche melhor a semana
    candidate_areas = [a for a, lst in topics_by_area.items() if lst]
    if preferred_area and preferred_area in candidate_areas:
        candidate_areas = [preferred_area] + [a for a in candidate_areas if a != preferred_area]

    # 1) Tenta substituir o último tópico por um mais longo (priorizando mesma área)
    search_areas = [last_topic["area"]] + [a for a in candidate_areas if a != last_topic["area"]]
    for area in search_areas:
        for idx, cand in enumerate(topics_by_area.get(area, [])):
            new_h = base_hours + cand["estimated_hours"]
            if current_week_hours + 0.3 < new_h <= max_week_hours + 1e-6:
                same_area_bonus = 1 if area == last_topic["area"] else 0
                score = (same_area_bonus, new_h, cand["priority"])
                if best_swap is None or score > best_swap[0]:
                    best_swap = (score, "single", area, idx)

    if best_swap is not None:
        _, _, swap_area, swap_idx = best_swap
        replacement = topics_by_area[swap_area].pop(swap_idx)
        topics_by_area.setdefault(last_topic["area"], []).append(last_topic)
        topics_by_area[last_topic["area"]].sort(key=lambda x: x["priority"], reverse=True)
        week_topics[-1] = replacement
        return base_hours + replacement["estimated_hours"]

    return current_week_hours


def _build_weekly_plan(
    all_topics,
    start_date,
    total_weeks,
    hours_per_week,
    organization="geral",
    internato_blocks=None,
):
    pending_topics = [t for t in all_topics if not t.get("completed")]
    completed_topics = [t for t in all_topics if t.get("completed")]

    topics_by_area = {}
    for t in pending_topics:
        topics_by_area.setdefault(t["area"], []).append(t)

    initial_counts = {area: len(lst) for area, lst in topics_by_area.items()}
    plan = []

    for week in range(1, total_weeks + 1):
        week_topics = []
        current_week_hours = 0.0
        week_area_counts = {}
        week_date = start_date + timedelta(weeks=week - 1)

        block_info = (
            get_block_for_date(week_date, internato_blocks)
            if organization == "internato"
            else None
        )
        area_foco = block_info["area"] if block_info else None
        week_target_hours = (
            block_info["hours_per_week"]
            if block_info and block_info.get("hours_per_week") is not None
            else float(hours_per_week)
        )
        max_week_hours = week_target_hours + WEEK_OVERFLOW_TOLERANCE_HOURS
        anchor_target_hours = week_target_hours * INTERNATO_ANCHOR_RATIO
        anchor_hours_allocated = 0.0

        while current_week_hours < (week_target_hours - 0.5):
            active_areas = [a for a, t_list in topics_by_area.items() if len(t_list) > 0]
            if not active_areas:
                break

            ordered_areas = []
            if organization == "internato" and area_foco and area_foco in active_areas:
                other_areas = [a for a in active_areas if a != area_foco]
                # Híbrido 70/30: garante ~70% com o rodízio-âncora e ~30% com a trilha paralela.
                # Coloca 2 temas da âncora e então 1 da trilha paralela (repetindo a proporção em semanas maiores).
                parallel_hours_allocated = current_week_hours - anchor_hours_allocated
                parallel_target_hours = week_target_hours * (1.0 - INTERNATO_ANCHOR_RATIO)
                anchor_count_week = week_area_counts.get(area_foco, 0)
                parallel_count_week = len(week_topics) - anchor_count_week
                need_parallel_now = (
                    bool(other_areas)
                    and anchor_count_week >= 2
                    and (
                        parallel_count_week == 0
                        or (
                            anchor_hours_allocated >= anchor_target_hours
                            and parallel_hours_allocated < parallel_target_hours
                        )
                    )
                )
                need_anchor = not need_parallel_now and (
                    anchor_hours_allocated == 0.0
                    or anchor_hours_allocated < anchor_target_hours
                    or not other_areas
                )
                if need_anchor:
                    ordered_areas = [area_foco] + _rank_balanced_areas(
                        active_areas, topics_by_area, initial_counts, week_area_counts, exclude_area=area_foco
                    )
                else:
                    ordered_areas = _rank_balanced_areas(
                        active_areas, topics_by_area, initial_counts, week_area_counts, exclude_area=area_foco
                    ) + [area_foco]
            else:
                ordered_areas = _rank_balanced_areas(
                    active_areas, topics_by_area, initial_counts, week_area_counts
                )

            candidate_area = None
            candidate_idx = -1
            for area in ordered_areas:
                idx = _pick_best_fitting_topic(
                    topics_by_area[area],
                    current_week_hours,
                    week_target_hours,
                    max_week_hours,
                )
                if idx != -1:
                    candidate_area = area
                    candidate_idx = idx
                    break

            if candidate_area is not None:
                topic = topics_by_area[candidate_area].pop(candidate_idx)
                week_topics.append(topic)
                current_week_hours += topic["estimated_hours"]
                week_area_counts[candidate_area] = week_area_counts.get(candidate_area, 0) + 1
                if candidate_area == area_foco:
                    anchor_hours_allocated += topic["estimated_hours"]
            else:
                break

        # Passo de refinamento: se ainda houver temas pendentes e a semana fechou curta (< meta - 1h), tenta swap
        has_remaining = any(len(lst) > 0 for lst in topics_by_area.values())
        if has_remaining and current_week_hours < (week_target_hours - 1.0):
            current_week_hours = _try_improve_underfilled_week(
                week_topics,
                current_week_hours,
                topics_by_area,
                week_target_hours,
                max_week_hours,
                preferred_area=area_foco,
            )

        week_entry = {
            "week": week,
            "date": week_date.isoformat(),
            "topics": week_topics,
            "recommended_hours": round(week_target_hours, 1) if week_target_hours % 1 else int(week_target_hours),
            "allocated_hours": round(current_week_hours, 1),
        }
        if organization == "internato" and block_info:
            week_entry["internato_block_label"] = block_info["label"]
            week_entry["internato_block_area"] = block_info["area"] or block_info["raw_area"]
        plan.append(week_entry)

    return plan, completed_topics


def generate_annual_plan(
    rows,
    start_date_str,
    exam_date_str,
    hours_per_week,
    intensive=False,
    user_progress=None,
    adaptive_signals=None,
    organization="geral",
    internato_blocks=None,
    completed_subtemas=None,
    use_bank_incidence=False,
):
    """
    Gera um plano de estudos fatiado por semanas conforme o modo de organização
    ('geral' ou 'internato') e filtro intensivo, preservando aulas já concluídas
    sem consumir horas semanais de estudo pendente.
    """
    start_date, total_weeks, err = _parse_dates_and_weeks(start_date_str, exam_date_str)
    if err:
        return err

    planner_meta, katomart_subtemas, practice_hours_per_subtema = _load_catalogs()
    meta_dict = _build_meta_dict(planner_meta, katomart_subtemas)
    row_stats = _consolidate_row_stats(rows, meta_dict)
    incidence_map, _using_empirical = _compute_empirical_incidence(
        meta_dict, row_stats, use_bank_incidence=use_bank_incidence
    )

    all_topics, _total_required_hours, pending_required_hours = _prepare_topics(
        meta_dict,
        row_stats,
        user_progress,
        intensive,
        practice_hours_per_subtema,
        adaptive_signals=adaptive_signals,
        completed_subtemas=completed_subtemas,
        incidence_map=incidence_map or None,
    )

    plan, completed_topics = _build_weekly_plan(
        all_topics,
        start_date,
        total_weeks,
        hours_per_week,
        organization=organization,
        internato_blocks=internato_blocks,
    )

    total_available_hours = sum(float(w["recommended_hours"]) for w in plan)
    scheduled_pending_count = sum(
        1 for w in plan for t in w.get("topics", []) if not t.get("completed")
    )
    target_pending_count = sum(1 for t in all_topics if not t.get("completed"))
    warning_msg = None
    if scheduled_pending_count < target_pending_count and pending_required_hours > total_available_hours:
        warning_msg = f"Você tem {round(total_available_hours)} horas disponíveis, mas precisa de {round(pending_required_hours)} horas para cobrir {'este plano' if intensive else 'todo o edital'}."

    result = {"plan": plan, "completed_topics": completed_topics}
    if warning_msg:
        result["warning"] = warning_msg
        result["total_required_hours"] = round(pending_required_hours)
        result["total_available_hours"] = round(total_available_hours)

    return result


def build_plan_from_schedule(
    schedule_rows,
    start_date_str,
    hours_per_week,
    exam_date_str=None,
    rows=None,
    user_progress=None,
    adaptive_signals=None,
    intensive=False,
    completed_subtemas=None,
    organization="geral",
    internato_blocks=None,
    use_bank_incidence=False,
):
    """
    Reconstrói a estrutura semanal do plano a partir do cronograma congelado em banco,
    enriquecendo em tempo real os badges e motivos adaptativos de cada aula sem alterar
    a ordem ou alocação das semanas.
    """
    if not schedule_rows:
        return None

    try:
        start_date = datetime.fromisoformat(str(start_date_str).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        start_date = datetime.now()
    if start_date.tzinfo is not None:
        start_date = start_date.replace(tzinfo=None)

    planner_meta, katomart_subtemas, practice_hours_per_subtema = _load_catalogs()
    meta_dict = _build_meta_dict(planner_meta, katomart_subtemas)
    row_stats = _consolidate_row_stats(rows or [], meta_dict)
    incidence_map, _using_empirical = _compute_empirical_incidence(
        meta_dict, row_stats, use_bank_incidence=use_bank_incidence
    )

    if user_progress is None:
        user_progress = {}

    all_topics, _total_required_hours, pending_required_hours = _prepare_topics(
        meta_dict,
        row_stats,
        user_progress,
        intensive,
        practice_hours_per_subtema,
        adaptive_signals=adaptive_signals,
        completed_subtemas=completed_subtemas,
        incidence_map=incidence_map or None,
    )

    weeks_map = {}
    scheduled_subtemas = set()
    for r in schedule_rows:
        w_num = int(r["week"])
        weeks_map.setdefault(w_num, []).append(r["subtema"])
        scheduled_subtemas.add(r["subtema"])

    total_weeks = None
    if exam_date_str:
        _, total_weeks_calc, err = _parse_dates_and_weeks(start_date_str, exam_date_str)
        if not err and total_weeks_calc:
            total_weeks = total_weeks_calc

    max_scheduled_week = max([int(r["week"]) for r in schedule_rows], default=1)
    num_weeks = max(total_weeks or 0, max_scheduled_week)
    all_week_numbers = list(range(1, num_weeks + 1)) if num_weeks > 0 else sorted(weeks_map.keys())

    plan = []

    for week_num in all_week_numbers:
        week_topics = []
        current_week_hours = 0.0
        week_date = start_date + timedelta(weeks=week_num - 1)
        block_info = (
            get_block_for_date(week_date, internato_blocks)
            if organization == "internato"
            else None
        )
        week_target_hours = (
            block_info["hours_per_week"]
            if block_info and block_info.get("hours_per_week") is not None
            else float(hours_per_week)
        )
        for subtema in weeks_map.get(week_num, []):
            meta = meta_dict.get(subtema)
            if not meta:
                continue
            stats = row_stats.get(subtema, {"q_count": 0, "target_q_count": 0, "subtopics": []})
            prog = user_progress.get(subtema)
            topic_obj, topic_hours = _build_topic_item(
                subtema,
                meta,
                stats,
                prog,
                practice_hours_per_subtema,
                adaptive_signals,
                completed_subtemas=completed_subtemas,
                incidence_info=incidence_map.get(subtema) if incidence_map else None,
            )
            if not topic_obj["completed"]:
                current_week_hours += topic_hours
            week_topics.append(topic_obj)

        week_entry = {
            "week": week_num,
            "date": week_date.isoformat(),
            "topics": week_topics,
            "recommended_hours": round(week_target_hours, 1) if week_target_hours % 1 else int(week_target_hours),
            "allocated_hours": round(current_week_hours, 1),
        }
        if organization == "internato" and block_info:
            week_entry["internato_block_label"] = block_info["label"]
            week_entry["internato_block_area"] = block_info["area"] or block_info["raw_area"]
        plan.append(week_entry)

    # Tópicos concluídos que não estão alocados em nenhuma semana da grade
    completed_outside_schedule = [
        t for t in all_topics if t.get("completed") and t["subtema"] not in scheduled_subtemas
    ]

    total_available_hours = sum(float(w["recommended_hours"]) for w in plan)

    scheduled_pending_count = sum(
        1 for w in plan for t in w.get("topics", []) if not t.get("completed")
    )
    target_pending_count = sum(1 for t in all_topics if not t.get("completed"))
    warning_msg = None
    if scheduled_pending_count < target_pending_count and pending_required_hours > total_available_hours:
        warning_msg = f"Você tem {round(total_available_hours)} horas disponíveis, mas precisa de {round(pending_required_hours)} horas para cobrir {'este plano' if intensive else 'todo o edital'}."

    result = {"plan": plan, "completed_topics": completed_outside_schedule}
    if warning_msg:
        result["warning"] = warning_msg
        result["total_required_hours"] = round(pending_required_hours)
        result["total_available_hours"] = round(total_available_hours)

    return result

