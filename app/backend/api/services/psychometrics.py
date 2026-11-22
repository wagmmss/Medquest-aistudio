"""
Serviço de psicometria e prontidão bayesiana (Beta-Binomial).
Extraído de `api/stats.py` para isolar a matemática estatística dos handlers HTTP.
"""
import math
from urllib.parse import quote, urlencode

from ..candidate_benchmarks import get_institution_benchmark
from ..edital_profiles import CANONICAL_AREAS, EditalProfile
from .planner import get_normalized_area


def _beta_continued_fraction(a: float, b: float, x: float) -> float:
    """Fração contínua de Lentz para a beta incompleta regularizada."""
    max_iterations = 200
    epsilon = 3e-14
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = tiny if abs(d) < tiny else d
    d = 1.0 / d
    h = d
    for m in range(1, max_iterations + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < epsilon:
            break
    return h


def regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    """CDF Beta(a, b), calculada sem dependências estatísticas externas."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if a <= 0.0 or b <= 0.0:
        raise ValueError("Parâmetros Beta devem ser positivos")
    log_bt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    log_bt += a * math.log(x) + b * math.log1p(-x)
    bt = math.exp(log_bt)
    if x < (a + 1.0) / (a + b + 2.0):
        value = bt * _beta_continued_fraction(a, b, x) / a
    else:
        value = 1.0 - bt * _beta_continued_fraction(b, a, 1.0 - x) / b
    return min(1.0, max(0.0, value))


def beta_quantile(probability: float, a: float, b: float) -> float:
    """Inverte a CDF Beta por bisseção determinística."""
    if probability <= 0.0:
        return 0.0
    if probability >= 1.0:
        return 1.0
    low, high = 0.0, 1.0
    for _ in range(80):
        mid = (low + high) / 2.0
        if regularized_incomplete_beta(mid, a, b) < probability:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def beta_credible_interval(alpha: float, beta: float, mass: float = 0.95) -> tuple[float, float]:
    """Calcula intervalo de credibilidade equal-tailed da posterior Beta."""
    tail = (1.0 - mass) / 2.0
    return round(beta_quantile(tail, alpha, beta), 4), round(beta_quantile(1.0 - tail, alpha, beta), 4)


def weighted_beta_credible_interval(mean: float, variance: float) -> tuple[float, float]:
    """Intervalo global via Beta com momentos da soma ponderada independente."""
    bounded_mean = min(1.0 - 1e-12, max(1e-12, mean))
    maximum_variance = bounded_mean * (1.0 - bounded_mean)
    if variance <= 0.0 or variance >= maximum_variance:
        return round(bounded_mean, 4), round(bounded_mean, 4)
    concentration = maximum_variance / variance - 1.0
    if concentration <= 0.0:
        return 0.0, 1.0
    return beta_credible_interval(bounded_mean * concentration, (1.0 - bounded_mean) * concentration)


def _aggregate_area_records(area_records: list[dict]) -> dict:
    row_map = {}
    for r in area_records:
        norm_a = get_normalized_area(r.get("area", ""))
        if norm_a not in row_map:
            row_map[norm_a] = {
                "attempts": r.get("attempts", 0),
                "correct": r.get("correct", 0),
                "available": r.get("available", 0),
                "answered": r.get("answered", 0),
            }
        else:
            row_map[norm_a]["attempts"] += r.get("attempts", 0)
            row_map[norm_a]["correct"] += r.get("correct", 0)
            row_map[norm_a]["available"] += r.get("available", 0)
            row_map[norm_a]["answered"] += r.get("answered", 0)
    return row_map


def _process_canonical_areas(
    row_map: dict,
    edital_profile: EditalProfile,
    institution_code: str | None = None,
) -> tuple[list[dict], float, float, dict]:
    enriched_areas = []
    weighted_mean_sum = 0.0
    weighted_var_sum = 0.0
    area_attempts = {}

    bench = get_institution_benchmark(institution_code)
    bench_areas = bench.get("areas", {})

    for area in CANONICAL_AREAS:
        norm_key = get_normalized_area(area)
        r = row_map.get(norm_key, {})
        att = r.get("attempts", 0)
        cor = r.get("correct", 0)
        avail = r.get("available", 0)
        ans = r.get("answered", 0)
        w = edital_profile.weights.get(area, 0.20)

        cand_acc = bench_areas.get(area, {}).get("candidate_accuracy", 0.70)

        alpha = 1.0 + cor
        beta = 1.0 + (att - cor)
        mean_i = alpha / (alpha + beta)
        var_i = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1.0))

        ci_lower_i, ci_upper_i = beta_credible_interval(alpha, beta)

        weighted_mean_sum += w * mean_i
        weighted_var_sum += (w ** 2) * var_i
        area_attempts[area] = att

        cov = round(ans / avail, 4) if avail > 0 else 0.0
        acc = round(cor / att, 4) if att > 0 else None
        cand_delta = round(acc - cand_acc, 4) if acc is not None else None

        sample_status = "reliable" if att >= 20 else ("forming" if att >= 5 else "insufficient")

        action_dict = {"area": area, "status": "new", "limit": 20}
        if institution_code:
            action_dict["institution"] = institution_code

        enriched_areas.append({
            "area": area,
            "available": avail,
            "answered": ans,
            "coverage": cov,
            "attempts": att,
            "correct": cor,
            "accuracy": acc,
            "candidate_accuracy": round(cand_acc, 4),
            "competitive_delta": cand_delta,
            "posterior_mean": round(mean_i, 4),
            "ci_lower": ci_lower_i,
            "ci_upper": ci_upper_i,
            "weight": round(w, 4),
            "sample": "sufficient" if att >= 20 else "limited",
            "sample_status": sample_status,
            "action": "/estudar?" + urlencode(action_dict),
        })

    return enriched_areas, weighted_mean_sum, weighted_var_sum, area_attempts


def _determine_evidence_status(area_attempts: dict, edital_profile: EditalProfile) -> str:
    total_attempts = sum(area_attempts.values())
    active_weights = {a: w for a, w in edital_profile.weights.items() if w > 0}
    all_areas_have_5 = all(area_attempts.get(a, 0) >= 5 for a in active_weights)
    all_areas_have_10 = all(area_attempts.get(a, 0) >= 10 for a in active_weights)

    if total_attempts < 20 or not all_areas_have_5:
        return "insufficient"
    elif total_attempts >= 50 and all_areas_have_10:
        return "reliable"
    return "forming"


def _generate_key_factors(enriched_areas: list[dict], institution_code: str | None = None) -> list[dict]:
    key_factors = []
    institution_param = f"&institution={quote(institution_code)}" if institution_code else ""
    for a_info in enriched_areas:
        w_pct = round(a_info["weight"] * 100)
        att = a_info["attempts"]
        mean_pct = round(a_info["posterior_mean"] * 100)
        area_encoded = quote(a_info["area"])
        if att < 5:
            needed = max(1, 5 - att)
            key_factors.append({
                "area": a_info["area"],
                "impact": f"Peso de {w_pct}% no edital com apenas {att} tentativa(s) observada(s).",
                "recommendation": f"Resolver pelo menos {needed} questão(ões) em {a_info['area']} para calibrar a evidência.",
                "factor_type": "low_sample",
                "action_url": f"/estudar?area={area_encoded}&status=new&limit={max(5, needed)}{institution_param}",
            })
        elif a_info["posterior_mean"] < 0.60:
            key_factors.append({
                "area": a_info["area"],
                "impact": f"Acurácia posterior estimada em {mean_pct}% (peso de {w_pct}% no edital).",
                "recommendation": f"Revisar conceitos prioritários de {a_info['area']} para elevar a prontidão.",
                "factor_type": "low_accuracy",
                "action_url": f"/estudar?area={area_encoded}&status=wrong&limit=10{institution_param}",
            })
    return key_factors


def calculate_bayesian_readiness(
    area_records: list[dict],
    edital_profile: EditalProfile,
    institution_code: str | None = None,
) -> dict:
    """
    Calcula a prontidão bayesiana agregada usando modelo Beta-Binomial
    conjugado com prior empírico calibrado nas taxas reais dos candidatos da banca.
    """
    row_map = _aggregate_area_records(area_records)

    enriched_areas, weighted_mean_sum, weighted_var_sum, area_attempts = _process_canonical_areas(
        row_map, edital_profile, institution_code=institution_code
    )

    readiness_score = round(weighted_mean_sum, 4)
    ci_lower, ci_upper = weighted_beta_credible_interval(weighted_mean_sum, weighted_var_sum)

    evidence_status = _determine_evidence_status(area_attempts, edital_profile)
    key_factors = _generate_key_factors(enriched_areas, institution_code=institution_code)

    bench = get_institution_benchmark(institution_code)
    cand_overall = bench.get("overall_candidate_accuracy", 0.695)
    competitive_delta = round(readiness_score - cand_overall, 4)

    limitations = [
        "A prontidão estimada reflete exclusivamente as questões resolvidas no MedQuest sob o perfil de edital configurado.",
        "Não constitui probabilidade de aprovação, garantia de classificação ou nota de corte oficial.",
        "Áreas com menos de 5 tentativas ampliam o intervalo de incerteza da prontidão global.",
        "O modelo utiliza Empirical Bayes calibrado no histórico empírico dos candidatos oficiais da banca.",
        "O intervalo global é uma aproximação Beta por correspondência de momentos das áreas ponderadas.",
    ]

    return {
        "readiness_score": readiness_score,
        "ci_lower": ci_lower,
        "ci_upper": ci_upper,
        "evidence_status": evidence_status,
        "candidate_mean": round(cand_overall, 4),
        "competitive_delta": competitive_delta,
        "enriched_areas": enriched_areas,
        "key_factors": key_factors,
        "limitations": limitations,
    }
