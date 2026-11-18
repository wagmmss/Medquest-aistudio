"""
Planejamento e consolidação de Circuito Oficial de 2ª Fase (5 estações OSCE).
Extraído de `api/osce.py` para separar circuitos de sessão individual.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional


def get_circuit_plan(db, institution: Optional[str] = "USP-RP") -> dict[str, Any]:
    """
    Monta o Circuito Oficial de 2ª Fase com 5 estações cobrindo as 5 especialidades nucleares:
    1. Clínica Médica
    2. Cirurgia Geral
    3. Pediatria
    4. Ginecologia e Obstetrícia
    5. Medicina Preventiva
    """
    areas_order = [
        "Clínica Médica",
        "Cirurgia Geral",
        "Pediatria",
        "Ginecologia e Obstetrícia",
        "Medicina Preventiva",
    ]
    circuit_id = f"circuit-{uuid.uuid4().hex[:10]}"
    stations_selected = []

    for step_idx, area in enumerate(areas_order, 1):
        row = None
        if institution and institution != "Todas as Bancas":
            row = db.execute(
                """
                SELECT id, code, title, area, subtema, institution, duration_seconds
                FROM osce_stations
                WHERE area = ? AND institution = ?
                ORDER BY year DESC, id ASC
                LIMIT 1
                """,
                (area, institution),
            ).fetchone()

        if not row:
            row = db.execute(
                """
                SELECT id, code, title, area, subtema, institution, duration_seconds
                FROM osce_stations
                WHERE area = ?
                ORDER BY year DESC, id ASC
                LIMIT 1
                """,
                (area,),
            ).fetchone()

        if row:
            stations_selected.append({
                "step": step_idx,
                "station_id": row["id"],
                "code": row["code"],
                "area": row["area"],
                "subtema": row["subtema"],
                "title": row["title"],
                "institution": row["institution"],
                "duration_seconds": row["duration_seconds"],
            })

    return {
        "circuit_id": circuit_id,
        "institution": institution or "USP-RP",
        "total_steps": len(stations_selected),
        "stations": stations_selected,
    }


def get_circuit_summary(db, circuit_id: str, user_id: str) -> dict[str, Any]:
    """
    Consolida as notas e avaliações do Circuito de 2ª Fase de 5 estações (escala 0.0 a 50.0).
    """
    sessions = db.execute(
        """
        SELECT s.id, s.station_id, s.status, s.final_score, s.elapsed_seconds,
               s.checklist_evaluation_json, s.preceptor_feedback_json,
               st.code, st.title, st.area, st.institution
        FROM osce_sessions s
        JOIN osce_stations st ON s.station_id = st.id
        WHERE s.circuit_session_id = ? AND s.user_id = ?
        ORDER BY s.start_time ASC
        """,
        (circuit_id, user_id),
    ).fetchall()

    station_summaries = []
    total_score = 0.0
    total_completed = 0
    total_critical_errors = 0

    for idx, sess in enumerate(sessions, 1):
        score = float(sess["final_score"] or 0.0)
        is_completed = sess["status"] == "completed"
        if is_completed:
            total_completed += 1
            total_score += score

        fb = json.loads(sess["preceptor_feedback_json"] or "{}")
        crit_warns = fb.get("critical_warnings", [])
        total_critical_errors += len(crit_warns)

        station_summaries.append({
            "step": idx,
            "session_id": sess["id"],
            "station_id": sess["station_id"],
            "code": sess["code"],
            "area": sess["area"],
            "title": sess["title"],
            "institution": sess["institution"],
            "final_score": round(score, 1),
            "approved": score >= 7.0,
            "status": sess["status"],
            "critical_warnings": crit_warns,
        })

    max_score = 50.0
    avg_score = round(total_score / max(1, total_completed), 1) if total_completed > 0 else 0.0
    percentage = round((total_score / max_score) * 100, 1)
    approved = total_completed >= 5 and total_score >= 35.0

    if approved:
        board_feedback = (
            f"Parabéns! Desempenho aprovado no Circuito Oficial de 2ª Fase com {total_score:.1f}/50.0 pontos ({percentage}%). "
            "Atendimento beira-leito seguro, comunicação empática consistente e raciocínio clínico maduro nas 5 grandes áreas da residência."
        )
    elif total_completed < 5:
        board_feedback = f"Circuito em andamento: {total_completed} de 5 estações concluídas. Total acumulado: {total_score:.1f}/50.0 pontos."
    else:
        board_feedback = (
            f"Pontuação de {total_score:.1f}/50.0 pontos ({percentage}%) insuficiente para aprovação na 2ª Fase (nota de corte: 35.0/50.0). "
            f"Identificamos {total_critical_errors} falta(s) crítica(s) de segurança clínica. Revise o espelho oficial e pratique novamente."
        )

    return {
        "circuit_id": circuit_id,
        "user_id": user_id,
        "total_score": round(total_score, 1),
        "max_score": max_score,
        "average_score": avg_score,
        "percentage": percentage,
        "approved": approved,
        "stations_completed": total_completed,
        "total_stations": 5,
        "critical_errors_count": total_critical_errors,
        "stations": station_summaries,
        "board_feedback": board_feedback,
    }
