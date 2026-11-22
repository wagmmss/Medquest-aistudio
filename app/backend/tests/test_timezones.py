"""Testes de dia local (America/Sao_Paulo) no dashboard, overview, timeline e resolução de fuso."""
import os
import sqlite3
from datetime import UTC, datetime

from api import stats as stats_mod


def _make_frozen_datetime(fixed_utc: datetime):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed_utc.replace(tzinfo=None)
            return fixed_utc.astimezone(tz)

    return FrozenDateTime


def _insert_attempt(answered_at_iso: str, question_id: int = 1, user_id: int = 1):
    con = sqlite3.connect(os.environ["MEDQUEST_DB"])
    con.execute(
        """INSERT INTO attempts (question_id, selected_letter, is_correct, answered_at, confidence, user_id)
           VALUES (?, 'B', 1, ?, 'certeza', ?)""",
        (question_id, answered_at_iso, user_id),
    )
    con.commit()
    con.close()


def test_dashboard_summary_without_params_counts_late_night_brt_as_today(client, monkeypatch):
    """Tentativas no mesmo dia local BRT (19:00 BRT e 23:30 BRT) contam juntas em 'hoje' no /dashboard/summary sem parâmetros."""
    # Agora = 23:45 BRT de 2026-11-19 -> 2026-11-20T02:45:00+00:00 (já é dia 20 em UTC)
    fixed_now = datetime(2026, 11, 20, 2, 45, 0, tzinfo=UTC)
    monkeypatch.setattr(stats_mod, "datetime", _make_frozen_datetime(fixed_now))

    # Q1 às 19:00 BRT de 2026-11-19 (22:00 UTC do dia 19) e Q2 às 23:30 BRT de 2026-11-19 (02:30 UTC do dia 20)
    # Em UTC, Q1 ficaria em "ontem" (today_answered == 1); em BRT, ambas são de "hoje" (today_answered == 2).
    _insert_attempt("2026-11-19T22:00:00+00:00", question_id=1)
    _insert_attempt("2026-11-20T02:30:00+00:00", question_id=2)

    # Sem parâmetros: deve usar America/Sao_Paulo (-180)
    resp = client.get("/api/dashboard/summary")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["stats"]["today_answered"] == 2
    assert data["stats"]["streak_days"] == 1

    # Com tz=America/Sao_Paulo explícito: mesmo resultado
    resp_tz = client.get("/api/dashboard/summary?tz=America/Sao_Paulo")
    assert resp_tz.status_code == 200
    data_tz = resp_tz.get_json()
    assert data_tz["stats"]["today_answered"] == 2
    assert data_tz["stats"]["streak_days"] == 1


def test_timeline_groups_late_night_brt_in_local_day(client, monkeypatch):
    """Timeline agrupa tentativa das 23:30 BRT (02:30 UTC do dia seguinte) no dia local (2026-11-19)."""
    fixed_now = datetime(2026, 11, 20, 2, 45, 0, tzinfo=UTC)
    monkeypatch.setattr(stats_mod, "datetime", _make_frozen_datetime(fixed_now))

    _insert_attempt("2026-11-20T02:30:00+00:00")

    resp = client.get("/api/stats/timeline?days=14")
    assert resp.status_code == 200
    rows = resp.get_json()
    assert len(rows) == 1
    assert rows[0]["day"] == "2026-11-19"
    assert rows[0]["attempts"] == 1


def test_invalid_tz_and_tz_offset_fallback_to_brt_and_clamp():
    """tz=Lixo/Invalido e tz_offset=abc usam -180 (nunca UTC 0); tz_offset fora da faixa é limitado a [-840, 840]."""
    from api.timezones import resolve_tz_offset_minutes

    fixed_now = datetime(2026, 11, 19, 15, 0, 0, tzinfo=UTC)

    assert resolve_tz_offset_minutes({}, fixed_now) == -180
    assert resolve_tz_offset_minutes({"tz": "Lixo/Invalido"}, fixed_now) == -180
    assert resolve_tz_offset_minutes({"tz_offset": "abc"}, fixed_now) == -180
    assert resolve_tz_offset_minutes({"tz": "Lixo/Invalido", "tz_offset": "abc"}, fixed_now) == -180
    assert resolve_tz_offset_minutes({"tz_offset": "99999"}, fixed_now) == 840
    assert resolve_tz_offset_minutes({"tz_offset": "-99999"}, fixed_now) == -840
    assert resolve_tz_offset_minutes({"tz": "America/Sao_Paulo"}, fixed_now) == -180
    assert resolve_tz_offset_minutes({"tz": "UTC"}, fixed_now) == 0


def test_overview_invalid_tz_offset_does_not_fallback_to_utc(client, monkeypatch):
    """GET /api/stats/overview?tz_offset=abc usa -180 em vez de cair para UTC (0)."""
    # Agora = 21:30 BRT de 2026-11-19 -> 2026-11-20T00:30:00+00:00
    # Tentativa às 19:00 BRT de 2026-11-19 -> 2026-11-19T22:00:00+00:00
    # Em UTC (0), 22:00 do dia 19 seria "ontem" (today_answered == 0); em BRT (-180), é "hoje" (today_answered == 1).
    fixed_now = datetime(2026, 11, 20, 0, 30, 0, tzinfo=UTC)
    monkeypatch.setattr(stats_mod, "datetime", _make_frozen_datetime(fixed_now))
    _insert_attempt("2026-11-19T22:00:00+00:00")

    resp = client.get("/api/stats/overview?tz_offset=abc")
    assert resp.status_code == 200
    assert resp.get_json()["today_answered"] == 1
