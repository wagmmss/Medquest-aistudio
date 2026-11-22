"""Testes de retificação FSRS, guard anti-duplo (P0-03) e fim do reset silencioso (P2-05)."""
import json
import os
import sqlite3
import time
from datetime import UTC, datetime

from api import srs


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(os.environ["MEDQUEST_DB"])
    con.row_factory = sqlite3.Row
    return con


def _get_card_row(qid: int, user_id: int = 1) -> sqlite3.Row | None:
    with _conn() as con:
        return con.execute(
            "SELECT fsrs_card, next_review_date FROM spaced_repetition WHERE question_id = ? AND user_id = ?",
            (qid, user_id),
        ).fetchone()


def _get_attempt_row(attempt_id: int) -> sqlite3.Row | None:
    with _conn() as con:
        return con.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()


def _parse_utc(iso_str: str) -> datetime:
    dt = datetime.fromisoformat(iso_str)
    return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)


def _card_state_no_id(card_json: str) -> dict:
    """Retorna o dict FSRS sem `card_id` (que usa epoch em ms quando criado de `None`)."""
    data = json.loads(card_json)
    data.pop("card_id", None)
    return data


def test_01_discursive_defer_then_review_is_first_application_not_rectification(client):
    """1. Discursiva: attempt 'defer' -> review is_correct=True -> 1a aplicação determinística, sem warning."""
    r1 = client.post(
        "/api/questions/3/attempt",
        json={"selected_letter": "DISCURSIVA", "confidence": "defer"},
    )
    assert r1.status_code == 200
    body1 = r1.get_json()
    assert body1["is_discursive"] is True
    assert body1["is_correct"] is None
    assert body1["next_review_date"] is None
    attempt_id = body1["attempt_id"]
    assert _get_card_row(3) is None

    r2 = client.post(
        "/api/questions/3/review",
        json={"attempt_id": attempt_id, "is_correct": True, "confidence": "certeza"},
    )
    assert r2.status_code == 200
    body2 = r2.get_json()
    assert body2["is_correct"] is True
    assert "warning" not in body2

    att = _get_attempt_row(attempt_id)
    assert att["fsrs_reviewed_at"] is not None
    assert att["fsrs_card_before"] is None
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])

    expected_card_json, expected_due = srs.review(None, 1, "certeza", now=reviewed_dt, assisted=False)
    sr = _get_card_row(3)
    assert sr is not None
    assert _card_state_no_id(sr["fsrs_card"]) == _card_state_no_id(expected_card_json)
    assert sr["next_review_date"] == expected_due


def test_02_rectify_wrong_to_right_matches_single_right_from_snapshot(client):
    """2. Avaliar (errou) -> retificar (acertou) -> card final idêntico a 1 avaliação 'acertou' do mesmo snapshot/data."""
    # Cria histórico prévio para garantir que o snapshot pré-existente seja preservado na retificação
    seed_dt = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    seed_card, seed_due = srs.review(None, 1, "duvida", now=seed_dt)
    with _conn() as con:
        con.execute(
            "INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id) VALUES (1, ?, ?, 1)",
            (seed_due, seed_card),
        )
        con.commit()

    # Questão 1: gabarito é B; envia A (errou)
    r1 = client.post(
        "/api/questions/1/attempt",
        json={"selected_letter": "A", "confidence": "chutei"},
    )
    assert r1.status_code == 200
    attempt_id = r1.get_json()["attempt_id"]
    assert r1.get_json()["is_correct"] is False

    # Retifica para acertou com "certeza"
    r2 = client.post(
        "/api/questions/1/review",
        json={"attempt_id": attempt_id, "is_correct": True, "confidence": "certeza"},
    )
    assert r2.status_code == 200
    body2 = r2.get_json()
    assert body2["is_correct"] is True
    assert "warning" not in body2

    att = _get_attempt_row(attempt_id)
    assert att["fsrs_card_before"] == seed_card
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])
    expected_card_json, expected_due = srs.review(seed_card, 1, "certeza", now=reviewed_dt, assisted=False)

    sr = _get_card_row(1)
    assert json.loads(sr["fsrs_card"]) == json.loads(expected_card_json)
    assert sr["next_review_date"] == expected_due


def test_03_toggle_right_wrong_right_three_times_is_idempotent(client):
    """3. Alternar certo->errado->certo 3x -> igual ao caso 2 (sem avançar o card repetidamente)."""
    seed_dt = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    seed_card, seed_due = srs.review(None, 1, "duvida", now=seed_dt)
    with _conn() as con:
        con.execute(
            "INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id) VALUES (1, ?, ?, 1)",
            (seed_due, seed_card),
        )
        con.commit()

    r1 = client.post(
        "/api/questions/1/attempt",
        json={"selected_letter": "B", "confidence": "certeza"},
    )
    assert r1.status_code == 200
    attempt_id = r1.get_json()["attempt_id"]

    # Alterna errado -> certo -> errado -> certo (3 ciclos de retificação)
    for is_corr, conf in [
        (False, "chutei"),
        (True, "certeza"),
        (False, "chutei"),
        (True, "certeza"),
        (False, "chutei"),
        (True, "certeza"),
    ]:
        resp = client.post(
            "/api/questions/1/review",
            json={"attempt_id": attempt_id, "is_correct": is_corr, "confidence": conf},
        )
        assert resp.status_code == 200
        assert "warning" not in resp.get_json()

    att = _get_attempt_row(attempt_id)
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])
    expected_card_json, expected_due = srs.review(seed_card, 1, "certeza", now=reviewed_dt, assisted=False)

    sr = _get_card_row(1)
    assert json.loads(sr["fsrs_card"]) == json.loads(expected_card_json)
    assert sr["next_review_date"] == expected_due


def test_04_twin_reviewed_later_is_preserved_while_original_is_rectified(client):
    """4. Espelho revisado diretamente depois -> retificar -> espelho preservado, original corrigido, warning."""
    # Responde questão 1 (errou: A, gabarito B) com espelho na questão 2
    r1 = client.post(
        "/api/questions/1/attempt",
        json={"selected_letter": "A", "confidence": "chutei", "twin_for_question_id": 2},
    )
    assert r1.status_code == 200
    attempt_id = r1.get_json()["attempt_id"]

    # Garante diferença de timestamp e revisa diretamente a questão 2 (espelho)
    time.sleep(0.01)
    r_twin = client.post(
        "/api/questions/2/attempt",
        json={"selected_letter": "A", "confidence": "certeza"},
    )
    assert r_twin.status_code == 200
    twin_card_after_direct = _get_card_row(2)["fsrs_card"]
    twin_due_after_direct = _get_card_row(2)["next_review_date"]

    # Retifica tentativa da questão 1 para acertou, informando o espelho 2
    r_rect = client.post(
        "/api/questions/1/review",
        json={
            "attempt_id": attempt_id,
            "is_correct": True,
            "confidence": "certeza",
            "twin_for_question_id": 2,
        },
    )
    assert r_rect.status_code == 200
    body = r_rect.get_json()
    assert body["is_correct"] is True
    assert body.get("warning")

    # Espelho (Q2) preservado intacto
    twin_sr = _get_card_row(2)
    assert twin_sr["fsrs_card"] == twin_card_after_direct
    assert twin_sr["next_review_date"] == twin_due_after_direct

    # Original (Q1) corrigido determinísticamente
    att = _get_attempt_row(attempt_id)
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])
    expected_q1_card, expected_q1_due = srs.review(None, 1, "certeza", now=reviewed_dt, assisted=False)
    q1_sr = _get_card_row(1)
    assert _card_state_no_id(q1_sr["fsrs_card"]) == _card_state_no_id(expected_q1_card)
    assert q1_sr["next_review_date"] == expected_q1_due


def test_05_rectify_older_attempt_preserves_card_and_updates_only_attempt(client):
    """5. Retificar attempt antigo (existe tentativa mais nova) -> nenhum card muda; só attempts.is_correct."""
    r1 = client.post("/api/questions/1/attempt", json={"selected_letter": "A", "confidence": "chutei"})
    assert r1.status_code == 200
    old_attempt_id = r1.get_json()["attempt_id"]

    r2 = client.post("/api/questions/1/attempt", json={"selected_letter": "B", "confidence": "certeza"})
    assert r2.status_code == 200
    card_before_rect = _get_card_row(1)["fsrs_card"]
    due_before_rect = _get_card_row(1)["next_review_date"]

    r_rect = client.post(
        "/api/questions/1/review",
        json={"attempt_id": old_attempt_id, "is_correct": True, "confidence": "duvida"},
    )
    assert r_rect.status_code == 200
    body = r_rect.get_json()
    assert body["is_correct"] is True
    assert body.get("warning")

    sr = _get_card_row(1)
    assert sr["fsrs_card"] == card_before_rect
    assert sr["next_review_date"] == due_before_rect

    old_att = _get_attempt_row(old_attempt_id)
    assert old_att["is_correct"] == 1
    assert old_att["confidence"] == "duvida"


def test_06_legacy_attempt_without_snapshot_preserves_card_on_rectification(client):
    """6. Legado: attempt com confidence 'certeza' e colunas de snapshot NULL -> retificação não muda o card."""
    seed_dt = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    seed_card, seed_due = srs.review(None, 1, "certeza", now=seed_dt)
    with _conn() as con:
        con.execute(
            "INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id) VALUES (1, ?, ?, 1)",
            (seed_due, seed_card),
        )
        cur = con.execute(
            """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, confidence, user_id)
               VALUES (1, 'B', 1, ?, 'certeza', 1)""",
            (seed_dt.isoformat(),),
        )
        legacy_attempt_id = cur.lastrowid
        con.commit()

    r_rect = client.post(
        "/api/questions/1/review",
        json={"attempt_id": legacy_attempt_id, "is_correct": False, "confidence": "chutei"},
    )
    assert r_rect.status_code == 200
    body = r_rect.get_json()
    assert body["is_correct"] is False
    assert body.get("warning")

    sr = _get_card_row(1)
    assert sr["fsrs_card"] == seed_card
    assert sr["next_review_date"] == seed_due

    att = _get_attempt_row(legacy_attempt_id)
    assert att["is_correct"] == 0
    assert att["confidence"] == "chutei"


def test_07_legacy_defer_without_snapshot_applies_first_review_normally(client):
    """7. Legado defer: attempt 'defer' sem snapshot com card preexistente -> review aplica 1a avaliação normalmente."""
    seed_dt = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    seed_card, seed_due = srs.review(None, 1, "duvida", now=seed_dt)
    with _conn() as con:
        con.execute(
            "INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id) VALUES (1, ?, ?, 1)",
            (seed_due, seed_card),
        )
        cur = con.execute(
            """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, confidence, user_id)
               VALUES (1, 'B', 1, ?, 'defer', 1)""",
            (seed_dt.isoformat(),),
        )
        legacy_defer_id = cur.lastrowid
        con.commit()

    r_rev = client.post(
        "/api/questions/1/review",
        json={"attempt_id": legacy_defer_id, "confidence": "certeza"},
    )
    assert r_rev.status_code == 200
    body = r_rev.get_json()
    assert "warning" not in body

    att = _get_attempt_row(legacy_defer_id)
    assert att["fsrs_card_before"] == seed_card
    assert att["fsrs_reviewed_at"] is not None
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])
    expected_card, expected_due = srs.review(seed_card, 1, "certeza", now=reviewed_dt, assisted=False)

    sr = _get_card_row(1)
    assert _card_state_no_id(sr["fsrs_card"]) == _card_state_no_id(expected_card)
    assert sr["next_review_date"] == expected_due


def test_08_p0_03_attempt_with_confidence_none_does_not_double_advance_on_review(client):
    """8. P0-03: attempt com confidence None (FSRS aplicado como Good) -> /review sem mudar is_correct -> card não avança."""
    r1 = client.post("/api/questions/1/attempt", json={"selected_letter": "B"})
    assert r1.status_code == 200
    attempt_id = r1.get_json()["attempt_id"]
    card_after_attempt = _get_card_row(1)["fsrs_card"]
    due_after_attempt = _get_card_row(1)["next_review_date"]

    r2 = client.post(
        "/api/questions/1/review",
        json={"attempt_id": attempt_id, "confidence": "certeza"},
    )
    assert r2.status_code == 200
    body2 = r2.get_json()
    assert body2.get("warning")

    sr = _get_card_row(1)
    assert sr["fsrs_card"] == card_after_attempt
    assert sr["next_review_date"] == due_after_attempt


def test_09_sequential_rectifications_match_last_rating(client):
    """9. Duas retificações sequenciais com notas diferentes -> card e attempts.is_correct coerentes com a última."""
    r1 = client.post("/api/questions/1/attempt", json={"selected_letter": "B", "confidence": "certeza"})
    assert r1.status_code == 200
    attempt_id = r1.get_json()["attempt_id"]

    # 1ª retificação: acertou -> errou
    r2 = client.post(
        "/api/questions/1/review",
        json={"attempt_id": attempt_id, "is_correct": False, "confidence": "chutei"},
    )
    assert r2.status_code == 200
    assert r2.get_json()["is_correct"] is False

    # 2ª retificação: errou -> acertou com "duvida"
    r3 = client.post(
        "/api/questions/1/review",
        json={"attempt_id": attempt_id, "is_correct": True, "confidence": "duvida"},
    )
    assert r3.status_code == 200
    assert r3.get_json()["is_correct"] is True

    att = _get_attempt_row(attempt_id)
    assert att["is_correct"] == 1
    assert att["confidence"] == "duvida"
    reviewed_dt = _parse_utc(att["fsrs_reviewed_at"])
    expected_card, expected_due = srs.review(None, 1, "duvida", now=reviewed_dt, assisted=False)

    sr = _get_card_row(1)
    assert _card_state_no_id(sr["fsrs_card"]) == _card_state_no_id(expected_card)
    assert sr["next_review_date"] == expected_due


def test_10_p2_05_srs_review_exception_returns_500_without_resetting_card(app, client, monkeypatch):
    """10. P2-05: monkeypatch de srs.review para lançar exceção -> 500 e spaced_repetition inalterado."""
    seed_dt = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    seed_card, seed_due = srs.review(None, 1, "certeza", now=seed_dt)
    with _conn() as con:
        con.execute(
            "INSERT INTO spaced_repetition (question_id, next_review_date, fsrs_card, user_id) VALUES (1, ?, ?, 1)",
            (seed_due, seed_card),
        )
        con.commit()

    real_review = srs.review

    def boom_on_existing(card_json, *args, **kwargs):
        if card_json is not None:
            raise RuntimeError("simulated srs failure")
        return real_review(card_json, *args, **kwargs)

    monkeypatch.setattr(srs, "review", boom_on_existing)
    app.config["PROPAGATE_EXCEPTIONS"] = False

    resp = client.post(
        "/api/questions/1/attempt",
        json={"selected_letter": "B", "confidence": "certeza"},
    )
    assert resp.status_code == 500

    sr = _get_card_row(1)
    assert sr is not None
    assert sr["fsrs_card"] == seed_card
    assert sr["next_review_date"] == seed_due
