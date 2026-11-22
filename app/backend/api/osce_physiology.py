"""
Motor de fisiologia dinâmica e ausculta semiológica para estações OSCE.
Extraído de `api/osce.py` para manter o orquestrador de sessão mais enxuto.
"""
from __future__ import annotations

import re
from typing import Any

from .osce_evaluation import _normalize_text


def _build_physiology_engine(physical_exam: dict[str, Any], subtema: str = "", title: str = "") -> dict[str, Any]:
    """Retorna o motor de fisiologia dinâmica da estação com fallback determinístico sanitizado."""
    if physical_exam.get("physiology_engine"):
        return physical_exam["physiology_engine"]

    vitals = physical_exam.get("vitals", {})
    if not vitals:
        return {
            "initial_state": {
                "hr": 75,
                "sbp": 120,
                "dbp": 80,
                "spo2": 98,
                "rr": 16,
                "temp": 36.5,
                "gcs": 15,
                "rhythm": "NORMAL_SINUS",
                "etco2": 38,
                "perfusion_index": 2.5,
            },
            "natural_progression": [],
            "intervention_modifiers": {},
        }

    fc_val = 80
    fc_match = re.search(r"\b(\d{2,3})\b", vitals.get("fc", ""))
    if fc_match:
        fc_val = int(fc_match.group(1))

    sbp_val = 120
    dbp_val = 80
    pa_match = re.search(r"(\d{2,3})\s*[xX/]\s*(\d{2,3})", vitals.get("pa", ""))
    if pa_match:
        sbp_val = int(pa_match.group(1))
        dbp_val = int(pa_match.group(2))

    spo2_val = 97
    spo2_match = re.search(r"(\d{2,3})%", vitals.get("sato2", ""))
    if spo2_match:
        spo2_val = int(spo2_match.group(1))

    rr_val = 16
    rr_match = re.search(r"\b(\d{1,2})\b", vitals.get("fr", ""))
    if rr_match:
        rr_val = int(rr_match.group(1))

    temp_val = 36.5
    temp_match = re.search(r"(\d{2}[.,]\d)", vitals.get("temp", ""))
    if temp_match:
        temp_val = float(temp_match.group(1).replace(",", "."))

    norm_meta = _normalize_text(f"{subtema} {title}")
    if "taquicardia ventricular" in norm_meta or "monomorfica" in norm_meta:
        rhythm = "VENTRICULAR_TACHYCARDIA"
    elif "fibrilacao" in norm_meta:
        rhythm = "AFIB"
    elif "supraventricular" in norm_meta or "tsv" in norm_meta:
        rhythm = "UNSTABLE_SVT"
    elif fc_val >= 100:
        rhythm = "SINUS_TACHYCARDIA"
    elif fc_val < 50:
        rhythm = "SINUS_BRADYCARDIA"
    else:
        rhythm = "NORMAL_SINUS"

    return {
        "initial_state": {
            "hr": fc_val,
            "sbp": sbp_val,
            "dbp": dbp_val,
            "spo2": spo2_val,
            "rr": rr_val,
            "temp": temp_val,
            "gcs": 15 if sbp_val >= 90 else 13,
            "rhythm": rhythm,
            "etco2": 38 if rr_val <= 24 else 28,
            "perfusion_index": 2.2 if sbp_val >= 90 else 0.8,
        },
        "natural_progression": [],
        "intervention_modifiers": {},
    }


def _build_auscultation_foci(physical_exam: dict[str, Any], subtema: str = "", title: str = "") -> list[dict[str, Any]]:
    """Gera o mapa de focos anatômicos de ausculta com síntese acústica semiológica procedural."""
    if physical_exam.get("auscultation_foci"):
        return physical_exam["auscultation_foci"]

    findings = physical_exam.get("findings", {})
    resp_text = _normalize_text(findings.get("respiratorio", ""))
    card_text = _normalize_text(findings.get("cardiovascular", ""))
    norm_meta = _normalize_text(f"{subtema} {title}")

    if "atrito" in card_text or "pericard" in norm_meta:
        cardiac_sound = "PERICARDIAL_RUB"
    elif "sopro" in card_text or "estenose" in norm_meta or "insuficiencia mitral" in norm_meta:
        cardiac_sound = "SYSTOLIC_MURMUR"
    else:
        cardiac_sound = "NORMAL_HEART"

    if "sibilo" in resp_text or "bronquio" in norm_meta or "asma" in norm_meta:
        pulm_sound_ant = "EXPIRATORY_WHEEZES"
        pulm_sound_post = "EXPIRATORY_WHEEZES"
    elif "estertor" in resp_text or "crepit" in resp_text or "congestao" in resp_text or "pneumonia" in norm_meta:
        pulm_sound_ant = "NORMAL_VESICULAR"
        pulm_sound_post = "COARSE_CRACKLES"
    else:
        pulm_sound_ant = "NORMAL_VESICULAR"
        pulm_sound_post = "NORMAL_VESICULAR"

    return [
        {"id": "FA", "label": "2º EIC Direito (Foco Aórtico)", "x": 42, "y": 28, "soundType": cardiac_sound if cardiac_sound != "NORMAL_HEART" else "NORMAL_HEART"},
        {"id": "FP", "label": "2º EIC Esquerdo (Foco Pulmonar)", "x": 58, "y": 28, "soundType": "NORMAL_HEART"},
        {"id": "FM", "label": "5º EIC Esquerdo (Foco Mitral)", "x": 64, "y": 48, "soundType": cardiac_sound},
        {"id": "APD", "label": "Terço Inferior Hemitorax Direito", "x": 35, "y": 54, "soundType": pulm_sound_post},
        {"id": "APE", "label": "Terço Médio Hemitorax Esquerdo", "x": 66, "y": 38, "soundType": pulm_sound_ant},
    ]
