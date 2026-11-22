"""Testes de isolamento de acesso (inclusive TESTING=False + JWT RS256), CRUD de progresso, concorrência/transição de teoria, continue/current-week e sync."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

THEME = "Hipertensão Arterial Sistêmica e Crises Hipertensivas"
OTHER_THEME = "Calendário Vacinal do PNI e Imunizações Especiais"
ALLOWED_EMAIL = "moraes.wagg@gmail.com"
ALLOWED_SUB = "user_wagner"


@pytest.fixture()
def seeded_lessons(app):
    from api.db import db_transaction, get_db

    with app.app_context():
        db = get_db()
        with db_transaction(db):
            db.execute("UPDATE questions SET subtema = ? WHERE id = 1", (THEME,))
            db.execute("UPDATE questions SET subtema = ? WHERE id = 2", (OTHER_THEME,))
            db.execute(
                """
                INSERT INTO lessons (
                    course_key, course_name, is_extra, area, specialty, subtema,
                    module_name, module_order, title, lesson_order, lesson_kind,
                    is_essential, media_type, provider, drive_file_id, drive_path,
                    size_bytes, duration_seconds, mapping_source, active, updated_at
                ) VALUES
                ('medway_r1_2026', 'Extensivo R1 (Medway)', 0, 'Clínica Médica', 'Cardiologia', ?,
                 'Hipertensão Arterial Sistêmica', 1, '01. Aula — Fisiopatologia e Diagnóstico', 1, 'aula',
                 1, 'video', 'gdrive', 'drive-id-1', 'Medway/HAS/01.mp4', 100000, 1800, 'auto', 1, '2026-11-21T00:00:00Z'),
                ('medway_r1_2026', 'Extensivo R1 (Medway)', 0, 'Clínica Médica', 'Cardiologia', ?,
                 'Hipertensão Arterial Sistêmica', 1, '02. Aula — Crises Hipertensivas', 2, 'aula',
                 1, 'video', 'gdrive', 'drive-id-2', 'Medway/HAS/02.mp4', 100000, 1200, 'auto', 1, '2026-11-21T00:00:00Z'),
                ('medway_r1_2026', 'Extensivo R1 (Medway)', 0, 'Clínica Médica', 'Cardiologia', ?,
                 'Hipertensão Arterial Sistêmica', 1, '03. Revisão Rápida (Flash)', 3, 'flash',
                 0, 'video', 'gdrive', 'drive-id-3', 'Medway/HAS/03.mp4', 50000, 600, 'auto', 1, '2026-11-21T00:00:00Z'),
                ('medcof_r1_2026', 'MedCof R1 (Extras)', 1, 'Clínica Médica', 'Bloco 01', ?,
                 'Bloco 01', 1, 'Hipertensão Arterial — Aula Extra', 1, 'cofexpress',
                 0, 'video', 'gdrive', 'drive-id-4', 'Medcof/Bloco1/01.mp4', 200000, 900, 'auto', 1, '2026-11-21T00:00:00Z'),
                ('medcof_r1_2026', 'MedCof R1 (Extras)', 1, 'Extras', 'Bloco 02', NULL,
                 'Bloco 02', 2, 'Tema Livre MedCof', 1, 'aula_extra',
                 0, 'video', 'gdrive', 'drive-id-5', 'Medcof/Bloco2/01.mp4', 200000, 2400, 'auto', 1, '2026-11-21T00:00:00Z')
                """,
                (THEME, THEME, THEME, THEME),
            )
            rows = db.execute("SELECT id, drive_file_id FROM lessons ORDER BY id ASC").fetchall()
            return {r["drive_file_id"]: r["id"] for r in rows}


def test_lessons_fail_closed_and_access_control(client, seeded_lessons, monkeypatch):
    lesson_id = seeded_lessons["drive-id-1"]

    # 1. Fail-closed: sem LESSONS_ALLOWED_USER_IDS nem LESSONS_ALLOWED_EMAILS, até o dono é bloqueado
    monkeypatch.delenv("LESSONS_ALLOWED_USER_IDS", raising=False)
    monkeypatch.delenv("LESSONS_ALLOWED_EMAILS", raising=False)
    owner_headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    me_unconfigured = client.get("/api/auth/me", headers=owner_headers)
    assert me_unconfigured.status_code == 200
    assert me_unconfigured.get_json()["can_access_lessons"] is False
    assert me_unconfigured.headers.get("Cache-Control") == "private, no-store"
    assert client.get("/api/lessons", headers=owner_headers).status_code == 403

    # 2. Configurando allowlist por sub (LESSONS_ALLOWED_USER_IDS)
    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)

    # Visitante (guest:) sempre bloqueado mesmo enviando email
    guest_headers = {"X-User-ID": "guest:550e8400-e29b-41d4-a716-446655440000", "X-User-Email": ALLOWED_EMAIL}
    assert client.get("/api/auth/me", headers=guest_headers).get_json()["can_access_lessons"] is False
    for method, path in [
        ("GET", "/api/lessons"),
        ("GET", "/api/lessons/summary-by-subtema"),
        ("GET", "/api/lessons/continue"),
        ("GET", "/api/lessons/current-week"),
        ("GET", f"/api/lessons/by-subtema?subtema={THEME}"),
        ("GET", f"/api/lessons/{lesson_id}"),
        ("PUT", f"/api/lessons/{lesson_id}/progress"),
        ("PATCH", f"/api/lessons/{lesson_id}/mapping"),
    ]:
        assert client.open(path, method=method, headers=guest_headers, json={"status": "completed"}).status_code == 403

    # Outro usuário mesmo com X-User-Email igual ao do dono é bloqueado quando allowlist usa sub
    other_headers = {"X-User-ID": "user_other", "X-User-Email": ALLOWED_EMAIL}
    assert client.get("/api/auth/me", headers=other_headers).get_json()["can_access_lessons"] is False
    assert client.get("/api/lessons", headers=other_headers).status_code == 403
    assert client.get("/api/lessons/continue", headers=other_headers).status_code == 403
    assert client.get("/api/lessons/current-week", headers=other_headers).status_code == 403

    # Dono autorizado recebe 200 e Cache-Control: private, no-store
    me_owner = client.get("/api/auth/me", headers=owner_headers)
    assert me_owner.status_code == 200
    assert me_owner.get_json()["can_access_lessons"] is True
    v1_resp = client.get("/api/v1/lessons", headers=owner_headers)
    assert v1_resp.status_code == 200
    assert v1_resp.headers.get("Cache-Control") == "private, no-store"


def test_lessons_real_jwt_chain_with_testing_false(app, client, seeded_lessons, monkeypatch):
    """Valida a cadeia real JWT RS256 + proxy secret + precedência do JWT sobre X-User-Email com TESTING=False."""
    from api import auth as auth_mod
    from api import db as db_mod

    monkeypatch.setattr(db_mod, "TURSO_URL", None)
    monkeypatch.setattr(db_mod, "TURSO_TOKEN", None)
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    class _FakeSigningKey:
        key = public_key

    class _FakeJwksClient:
        def get_signing_key_from_jwt(self, _token):
            return _FakeSigningKey()

    issuer = "https://clerk.example.test"
    monkeypatch.setattr(auth_mod, "CLERK_ISSUER", issuer)
    monkeypatch.setattr(auth_mod, "CLERK_AUDIENCE", None)
    monkeypatch.setattr(auth_mod, "jwks_client", _FakeJwksClient())
    monkeypatch.setenv("FLASK_API_PROXY_SECRET", "proxy-secret-test")
    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    monkeypatch.setenv("LESSONS_ALLOWED_EMAILS", ALLOWED_EMAIL)

    def make_jwt(sub: str, email: str | None = None) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "iss": issuer,
            "sub": sub,
            "exp": int((now + timedelta(minutes=10)).timestamp()),
        }
        if email:
            payload["email"] = email
        return jwt.encode(payload, pem_private, algorithm="RS256")

    old_testing = app.config.get("TESTING", False)
    app.config["TESTING"] = False
    try:
        # 1. Sem credenciais -> 401
        assert client.get("/api/lessons").status_code == 401

        # 2. Guest via proxy secret -> 403
        guest_resp = client.get(
            "/api/lessons",
            headers={
                "X-Internal-Proxy-Token": "proxy-secret-test",
                "X-Guest-ID": "550e8400-e29b-41d4-a716-446655440000",
                "X-User-Email": ALLOWED_EMAIL,
            },
        )
        assert guest_resp.status_code == 403

        # 3. JWT válido de outro sub tentando forjar X-User-Email -> 403
        attacker_jwt = make_jwt("user_attacker", email="attacker@example.com")
        attacker_resp = client.get(
            "/api/lessons",
            headers={
                "Authorization": f"Bearer {attacker_jwt}",
                "X-Internal-Proxy-Token": "proxy-secret-test",
                "X-User-Email": ALLOWED_EMAIL,
            },
        )
        assert attacker_resp.status_code == 403

        # Mesmo se allowlist fosse só por email, email do JWT prevalece sobre X-User-Email
        monkeypatch.delenv("LESSONS_ALLOWED_USER_IDS", raising=False)
        attacker_email_resp = client.get(
            "/api/lessons",
            headers={
                "Authorization": f"Bearer {attacker_jwt}",
                "X-Internal-Proxy-Token": "proxy-secret-test",
                "X-User-Email": ALLOWED_EMAIL,
            },
        )
        assert attacker_email_resp.status_code == 403

        # 4. JWT do dono -> 200 + Cache-Control: private, no-store
        monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
        owner_jwt = make_jwt(ALLOWED_SUB, email=ALLOWED_EMAIL)
        owner_resp = client.get(
            "/api/lessons",
            headers={"Authorization": f"Bearer {owner_jwt}"},
        )
        assert owner_resp.status_code == 200
        assert owner_resp.headers.get("Cache-Control") == "private, no-store"
    finally:
        app.config["TESTING"] = old_testing


def test_lessons_listing_filters_and_progress_sync(client, seeded_lessons, monkeypatch):
    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    id1 = seeded_lessons["drive-id-1"]
    id2 = seeded_lessons["drive-id-2"]
    id3 = seeded_lessons["drive-id-3"]

    # Listagem enxuta: omite drive_path/size_bytes/preview_url/open_url e usa has_notes
    all_resp = client.get("/api/lessons", headers=headers)
    assert all_resp.status_code == 200
    data = all_resp.get_json()
    assert data["summary"]["total"] == 5
    assert data["summary"]["total_duration_seconds"] == 6900
    first_item = data["lessons"][0]
    assert "drive_path" not in first_item
    assert "preview_url" not in first_item
    assert "notes" not in first_item["progress"]
    assert first_item["progress"]["has_notes"] is False

    # Detalhe completo traz preview_url, open_url e playlist completa do subtema (principais + opcionais + extras)
    id4 = seeded_lessons["drive-id-4"]
    detail = client.get(f"/api/lessons/{id1}", headers=headers).get_json()
    assert detail["lesson"]["preview_url"] == "https://drive.google.com/file/d/drive-id-1/preview"
    assert detail["lesson"]["open_url"] == "https://drive.google.com/file/d/drive-id-1/view"
    assert [item["id"] for item in detail["playlist"]] == [id1, id2, id3, id4]

    # Continue contabiliza apenas as aulas principais da Medway (id1 + id2 = 2)
    cont_before = client.get("/api/lessons/continue", headers=headers).get_json()
    assert cont_before["stats"]["primary_total"] == 2
    assert cont_before["stats"]["primary_completed"] == 0
    assert cont_before["stats"]["primary_remaining_seconds"] == 3000

    # Concluir 1a aula essencial com nota e bookmark
    p1 = client.put(
        f"/api/lessons/{id1}/progress",
        headers=headers,
        json={"status": "completed", "bookmark_seconds": 615, "notes": "Revisar IECA vs BRA"},
    )
    assert p1.status_code == 200
    assert p1.get_json()["theme_theory_completed"] is False
    assert p1.get_json()["has_notes"] is True

    # Atualização parcial (apenas bookmark) preserva status e notes
    p1_partial = client.put(
        f"/api/lessons/{id1}/progress",
        headers=headers,
        json={"bookmark_seconds": 700},
    )
    assert p1_partial.status_code == 200
    assert p1_partial.get_json()["status"] == "completed"
    assert p1_partial.get_json()["notes"] == "Revisar IECA vs BRA"
    assert p1_partial.get_json()["bookmark_seconds"] == 700

    # Concluir 2a aula essencial (transição): marca theory_completed = True
    p2 = client.put(f"/api/lessons/{id2}/progress", headers=headers, json={"status": "completed"})
    assert p2.status_code == 200
    assert p2.get_json()["theme_theory_completed"] is True

    # Desmarcar teoria manualmente e editar apenas nota na aula já concluída NÃO remarca theory_completed=1
    client.put("/api/themes/progress", query_string={"subtema": THEME}, headers=headers, json={
        "theory_completed": False, "study_path": "essential",
    })
    p2_edit_note = client.put(
        f"/api/lessons/{id2}/progress",
        headers=headers,
        json={"notes": "Nota pós-revisão"},
    )
    assert p2_edit_note.status_code == 200
    assert p2_edit_note.get_json()["theme_theory_completed"] is False
    assert client.get("/api/themes/progress", query_string={"subtema": THEME}, headers=headers).get_json()["theory_completed"] is False

    # summary-by-subtema separa theory_completed (manual) de essential_all_completed (aulas),
    # soma duração apenas das Principais Medway (1800 + 1200 = 3000s) e conta opcionais Medway separadamente
    summary = client.get("/api/lessons/summary-by-subtema", headers=headers).get_json()["subtemas"][THEME]
    assert summary["theory_completed"] is False
    assert summary["essential_all_completed"] is True
    assert summary["essential_total"] == 2
    assert summary["essential_completed"] == 2
    assert summary["medway_optional_total"] == 1
    assert summary["medway_optional_completed"] == 0
    assert summary["extra_total"] == 1
    assert summary["total_duration_seconds"] == 3000
    assert summary["remaining_duration_seconds"] == 0

    # Validação de bookmark inválido
    assert client.put(f"/api/lessons/{id1}/progress", headers=headers, json={"bookmark_seconds": -5}).status_code == 400


def test_lessons_continue_and_current_week(app, client, seeded_lessons, monkeypatch):
    from api.db import db_transaction, get_db

    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    id1 = seeded_lessons["drive-id-1"]
    id2 = seeded_lessons["drive-id-2"]

    c1 = client.get("/api/lessons/continue", headers=headers).get_json()
    assert c1["reason"] == "next_pending"
    assert c1["lesson"]["id"] == id1

    with app.app_context():
        db = get_db()
        with db_transaction(db):
            db.execute(
                """
                INSERT INTO planner_config (user_id, exam_date, start_date, days_per_week, questions_per_day, hours_per_day, updated_at, organization_mode)
                VALUES ('user_wagner', '2027-11-01', '2026-11-21', 5, 30, 3.0, '2026-11-21T00:00:00Z', 'geral')
                """
            )
            db.execute(
                """
                INSERT INTO planner_schedule (user_id, mode, week, subtema, display_order, created_at)
                VALUES ('user_wagner', 'geral_standard', 1, ?, 0, '2026-11-21T00:00:00Z')
                """,
                (THEME,),
            )

    cw = client.get("/api/lessons/current-week", headers=headers).get_json()
    assert cw["week"] == 1
    assert cw["subtemas"] == [THEME]

    client.put(f"/api/lessons/{id1}/progress", headers=headers, json={"status": "completed"})
    c2 = client.get("/api/lessons/continue", headers=headers).get_json()
    assert c2["reason"] == "planner_week"
    assert c2["lesson"]["id"] == id2

    client.put(f"/api/lessons/{id2}/progress", headers=headers, json={"status": "in_progress", "bookmark_seconds": 320})
    c3 = client.get("/api/lessons/continue", headers=headers).get_json()
    assert c3["reason"] == "in_progress"
    assert c3["lesson"]["id"] == id2
    assert c3["lesson"]["progress"]["bookmark_seconds"] == 320

    # Banco legado sem coluna organization_mode em planner_config não pode retornar 500
    with app.app_context():
        db = get_db()
        with db_transaction(db):
            db.execute("DROP TABLE planner_config")
            db.execute("CREATE TABLE planner_config (user_id TEXT PRIMARY KEY, exam_date TEXT, start_date TEXT)")
            db.execute("INSERT INTO planner_config (user_id, exam_date, start_date) VALUES ('user_wagner', '2027-11-01', '2026-11-21')")
    cw_legacy = client.get("/api/lessons/current-week", headers=headers)
    assert cw_legacy.status_code == 200
    assert cw_legacy.get_json()["subtemas"] == [THEME]
    assert client.get("/api/lessons/continue", headers=headers).status_code == 200


def test_lessons_mapping_patch_and_manual_preservation(app, client, seeded_lessons, monkeypatch):
    import sys
    from pathlib import Path

    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    id5 = seeded_lessons["drive-id-5"]

    assert client.patch(f"/api/lessons/{id5}/mapping", headers=headers, json={"subtema": "Tema Inexistente"}).status_code == 400

    ok = client.patch(
        f"/api/lessons/{id5}/mapping",
        headers=headers,
        json={"subtema": OTHER_THEME, "is_essential": False},
    )
    assert ok.status_code == 200
    body = ok.get_json()
    assert body["subtema"] == OTHER_THEME
    assert body["area"] == "Pediatria"
    assert body["mapping_source"] == "manual"

    # Simular re-sync do script: mapping_source='manual' deve preservar subtema/area/is_essential
    scripts_dir = str(Path(__file__).resolve().parents[3] / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from sync_drive_lessons import upsert_lessons

    db_path = Path(app.config["MEDQUEST_DB"] if "MEDQUEST_DB" in app.config else __import__("os").environ["MEDQUEST_DB"])
    upsert_lessons(db_path, {
        "medcof_r1_2026": [{
            "course_key": "medcof_r1_2026",
            "course_name": "MedCof R1 (Extras)",
            "is_extra": 1,
            "area": "Extras",
            "specialty": "Bloco 02",
            "subtema": None,
            "module_name": "Bloco 02",
            "module_order": 2,
            "title": "Tema Livre MedCof Atualizado",
            "lesson_order": 1,
            "lesson_kind": "aula_extra",
            "is_essential": 1,
            "media_type": "video",
            "provider": "gdrive",
            "drive_file_id": "drive-id-5",
            "drive_path": "Medcof/Bloco2/01.mp4",
            "size_bytes": 200000,
            "duration_seconds": 2500,
        }]
    })
    with app.app_context():
        from api.db import get_db
        row = get_db().execute("SELECT title, area, subtema, is_essential, mapping_source FROM lessons WHERE id = ?", (id5,)).fetchone()
        assert row["title"] == "Tema Livre MedCof Atualizado"
        assert row["area"] == "Pediatria"
        assert row["subtema"] == OTHER_THEME
        assert row["is_essential"] == 0
        assert row["mapping_source"] == "manual"


def test_lesson_native_hd_stream_and_signed_token(client, seeded_lessons, monkeypatch):
    """Valida stream_url assinado com HMAC, suporte a HTTP 206 Range e bloqueio de tokens inválidos."""
    from api import lessons as lessons_mod

    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "cid-test")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "csec-test")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "rtok-test")
    headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    id1 = seeded_lessons["drive-id-1"]
    id2 = seeded_lessons["drive-id-2"]

    detail = client.get(f"/api/lessons/{id1}", headers=headers).get_json()
    stream_url = detail["lesson"]["stream_url"]
    assert stream_url and f"/api/lessons/{id1}/stream?st=" in stream_url

    # Token assinado para id1 NÃO pode funcionar em id2 (401)
    st_token = stream_url.split("?st=", 1)[1]
    assert client.get(f"/api/lessons/{id2}/stream?st={st_token}").status_code == 401
    assert client.get(f"/api/lessons/{id1}/stream?st=invalido").status_code == 401

    # Mock do OAuth e do stream HTTP 206 da Google Drive API v3
    monkeypatch.setattr(lessons_mod, "_get_drive_access_token", lambda force_refresh=False: "fake-drive-access-token")

    class _FakeUpstreamResp:
        status_code = 206
        headers = {
            "Content-Type": "video/mp4",
            "Content-Length": "11",
            "Content-Range": "bytes 0-10/100000",
        }

        def iter_content(self, chunk_size=262144):
            yield b"0123456789A"

        def close(self):
            pass

    captured_headers = {}

    def _fake_requests_get(url, headers=None, stream=True, timeout=None):
        captured_headers.update(headers or {})
        return _FakeUpstreamResp()

    monkeypatch.setattr(lessons_mod.requests, "get", _fake_requests_get)

    resp = client.get(stream_url, headers={"Range": "bytes=0-10"})
    assert resp.status_code == 206
    assert resp.data == b"0123456789A"
    assert resp.headers.get("Content-Type") == "video/mp4"
    assert resp.headers.get("Content-Range") == "bytes 0-10/100000"
    assert resp.headers.get("Accept-Ranges") == "bytes"
    assert resp.headers.get("Cache-Control") == "private, no-store"
    assert captured_headers.get("Range") == "bytes=0-10"
    assert captured_headers.get("Authorization") == "Bearer fake-drive-access-token"


def test_lesson_study_cycle_medway_flow_and_settings(client, seeded_lessons, monkeypatch):
    """Valida ciclo Medway (5q pré-aula -> aula -> 25q pós-aula), settings e controle de acesso."""
    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    owner_headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    guest_headers = {"X-User-ID": "guest:550e8400-e29b-41d4-a716-446655440000", "X-User-Email": ALLOWED_EMAIL}
    id1 = seeded_lessons["drive-id-1"]

    # Acesso negado para visitante
    assert client.get("/api/lessons/cycle", headers=guest_headers).status_code == 403
    assert client.put("/api/lessons/cycle", headers=guest_headers, json={"subtema": THEME, "phase": "pre"}).status_code == 403
    assert client.put("/api/lessons/cycle/settings", headers=guest_headers, json={"default_pre_questions": 5}).status_code == 403

    # Padrões default: 5 pré-aula e 25 pós-aula
    initial = client.get("/api/lessons/cycle", headers=owner_headers)
    assert initial.status_code == 200
    body = initial.get_json()
    assert body["settings"] == {"default_pre_questions": 5, "default_post_questions": 25}
    assert body["cycles"] == {}

    # Registra conclusão do pré-teste (5 questões, 3 acertos = 60%)
    pre_resp = client.put(
        "/api/lessons/cycle",
        headers=owner_headers,
        json={"subtema": THEME, "phase": "pre", "target": 5, "completed": 5, "correct": 3, "done": True},
    )
    assert pre_resp.status_code == 200
    pre_cycle = pre_resp.get_json()["cycle"]
    assert pre_cycle["pre_done"] is True
    assert pre_cycle["pre_completed"] == 5
    assert pre_cycle["pre_correct"] == 3
    assert pre_cycle["pre_accuracy"] == 60
    assert pre_cycle["post_done"] is False

    # Registra conclusão do pós-aula (25 questões, 22 acertos = 88%) preservando o pré-teste
    post_resp = client.put(
        "/api/lessons/cycle",
        headers=owner_headers,
        json={"subtema": THEME, "phase": "post", "target": 25, "completed": 25, "correct": 22, "done": True},
    )
    assert post_resp.status_code == 200
    post_cycle = post_resp.get_json()["cycle"]
    assert post_cycle["pre_done"] is True
    assert post_cycle["pre_accuracy"] == 60
    assert post_cycle["post_done"] is True
    assert post_cycle["post_completed"] == 25
    assert post_cycle["post_correct"] == 22
    assert post_cycle["post_accuracy"] == 88

    # Ciclo aparece tanto no summary-by-subtema quanto no detalhe da aula
    summary_body = client.get("/api/lessons/summary-by-subtema", headers=owner_headers).get_json()
    assert summary_body["cycle_settings"] == {"default_pre_questions": 5, "default_post_questions": 25}
    assert summary_body["subtemas"][THEME]["cycle"]["pre_done"] is True
    assert summary_body["subtemas"][THEME]["cycle"]["post_done"] is True

    detail_body = client.get(f"/api/lessons/{id1}", headers=owner_headers).get_json()
    assert detail_body["cycle"]["pre_accuracy"] == 60
    assert detail_body["cycle"]["post_accuracy"] == 88
    assert detail_body["cycle_settings"]["default_post_questions"] == 25

    # Desmarcar manualmente limpa a fase específica sem afetar a outra
    reset_pre = client.put(
        "/api/lessons/cycle",
        headers=owner_headers,
        json={"subtema": THEME, "phase": "pre", "done": False},
    )
    assert reset_pre.status_code == 200
    assert reset_pre.get_json()["cycle"]["pre_done"] is False
    assert reset_pre.get_json()["cycle"]["pre_completed"] == 0
    assert reset_pre.get_json()["cycle"]["post_done"] is True

    # Atualização de configurações globais e validação de limites
    assert client.put("/api/lessons/cycle/settings", headers=owner_headers, json={"default_pre_questions": -1}).status_code == 400
    assert client.put("/api/lessons/cycle/settings", headers=owner_headers, json={"default_post_questions": 0}).status_code == 400
    upd = client.put(
        "/api/lessons/cycle/settings",
        headers=owner_headers,
        json={"default_pre_questions": 6, "default_post_questions": 30},
    )
    assert upd.status_code == 200
    assert upd.get_json()["default_pre_questions"] == 6
    assert upd.get_json()["default_post_questions"] == 30

    # Validação de payload inválido em /lessons/cycle
    assert client.put("/api/lessons/cycle", headers=owner_headers, json={"subtema": "Inexistente", "phase": "pre"}).status_code == 400
    assert client.put("/api/lessons/cycle", headers=owner_headers, json={"subtema": THEME, "phase": "mid"}).status_code == 400


def test_lessons_search_multitoken_area_alias_ranking_and_limit(app, client, seeded_lessons, monkeypatch):
    from api.db import db_transaction, get_db

    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    owner_headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}

    with app.app_context():
        db = get_db()
        with db_transaction(db):
            db.execute(
                """
                INSERT INTO lessons (
                    course_key, course_name, is_extra, area, specialty, subtema,
                    module_name, module_order, title, lesson_order, lesson_kind,
                    is_essential, media_type, provider, drive_file_id, drive_path,
                    size_bytes, duration_seconds, mapping_source, active, updated_at
                ) VALUES
                ('medway_r1_2026', 'Extensivo R1 (Medway)', 0, 'Preventiva', 'Epidemiologia', ?,
                 'Imunizações', 1, '01. Aula — Vacinação e Calendário PNI', 1, 'aula',
                 1, 'video', 'gdrive', 'drive-id-prev-1', 'Medway/Prev/01.mp4', 100000, 1500, 'auto', 1, '2026-11-21T00:00:00Z')
                """,
                (OTHER_THEME,),
            )

    # 1. Busca multi-token fora de ordem + sem acento + ignorando stopword ("de")
    multi_resp = client.get("/api/lessons?q=crises+de+hipertensao", headers=owner_headers)
    assert multi_resp.status_code == 200
    multi_data = multi_resp.get_json()
    assert len(multi_data["lessons"]) >= 2
    # Aula principal com "Crises Hipertensivas" no título deve rankear no topo
    assert multi_data["lessons"][0]["drive_file_id"] == "drive-id-2"

    # 2. Alias de área: "Medicina Preventiva" (vindo de /buscar) encontra aulas com area='Preventiva'
    alias_resp = client.get("/api/lessons?area=Medicina+Preventiva", headers=owner_headers)
    assert alias_resp.status_code == 200
    alias_data = alias_resp.get_json()
    assert len(alias_data["lessons"]) == 1
    assert alias_data["lessons"][0]["drive_file_id"] == "drive-id-prev-1"

    # 3. Parâmetro limit restringe lista retornada mas preserva summary.total com total de matches
    limited_resp = client.get("/api/lessons?q=hipertensao&limit=2", headers=owner_headers)
    assert limited_resp.status_code == 200
    limited_data = limited_resp.get_json()
    assert len(limited_data["lessons"]) == 2
    assert limited_data["summary"]["total"] == 4
    # Aulas principais Medway aparecem antes de Flash/MedCof
    assert all(
        item["course_key"] == "medway_r1_2026" and item["is_essential"]
        for item in limited_data["lessons"]
    )


def test_lesson_notes_endpoint_access_filter_and_clear(client, seeded_lessons, monkeypatch):
    monkeypatch.setenv("LESSONS_ALLOWED_USER_IDS", ALLOWED_SUB)
    owner_headers = {"X-User-ID": ALLOWED_SUB, "X-User-Email": ALLOWED_EMAIL}
    other_headers = {"X-User-ID": "user_other", "X-User-Email": "other@example.com"}

    id1 = seeded_lessons["drive-id-1"]
    id2 = seeded_lessons["drive-id-2"]

    # Acesso negado para quem não está na allowlist de aulas
    assert client.get("/api/lessons/notes", headers=other_headers).status_code == 403

    # Salva anotação na aula 1 e progresso sem anotação na aula 2
    assert client.put(
        f"/api/lessons/{id1}/progress",
        headers=owner_headers,
        json={"status": "in_progress", "bookmark_seconds": 778, "notes": "Fatores de risco CA de mama: BRCA1 e BRCA2."},
    ).status_code == 200
    assert client.put(
        f"/api/lessons/{id2}/progress",
        headers=owner_headers,
        json={"status": "completed", "notes": "   "},
    ).status_code == 200

    resp = client.get("/api/lessons/notes", headers=owner_headers)
    assert resp.status_code == 200
    assert resp.headers.get("Cache-Control") == "private, no-store"
    notes = resp.get_json()["notes"]
    assert len(notes) == 1
    assert notes[0]["lesson_id"] == id1
    assert notes[0]["bookmark_seconds"] == 778
    assert "BRCA1" in notes[0]["notes"]

    # Busca textual sem acento e filtro de área
    by_q = client.get("/api/lessons/notes?q=brca1+mama", headers=owner_headers).get_json()["notes"]
    assert len(by_q) == 1
    by_area_miss = client.get("/api/lessons/notes?area=Pediatria", headers=owner_headers).get_json()["notes"]
    assert by_area_miss == []
    by_area_hit = client.get("/api/lessons/notes?area=Cl%C3%ADnica%20M%C3%A9dica", headers=owner_headers).get_json()["notes"]
    assert len(by_area_hit) == 1

    # Limpar anotação preserva status e bookmark da aula
    clear_resp = client.put(f"/api/lessons/{id1}/progress", headers=owner_headers, json={"notes": ""})
    assert clear_resp.status_code == 200
    clear_data = clear_resp.get_json()
    assert clear_data["status"] == "in_progress"
    assert clear_data["bookmark_seconds"] == 778
    assert client.get("/api/lessons/notes", headers=owner_headers).get_json()["notes"] == []


