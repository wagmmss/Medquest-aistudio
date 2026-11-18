from __future__ import annotations


def test_presets_crud_and_user_isolation(app, client) -> None:
    resp = client.post(
        "/api/presets",
        headers={"X-User-ID": "user-a"},
        json={"name": "Clínica USP", "filters": {"area": "Clínica Médica", "limit": "25"}},
    )
    assert resp.status_code == 201
    preset_id = resp.get_json()["id"]

    list_a = client.get("/api/presets", headers={"X-User-ID": "user-a"}).get_json()["presets"]
    assert len(list_a) == 1
    assert list_a[0]["name"] == "Clínica USP"
    assert list_a[0]["filters"]["limit"] == "25"

    list_b = client.get("/api/presets", headers={"X-User-ID": "user-b"}).get_json()["presets"]
    assert list_b == []

    del_b = client.delete(f"/api/presets/{preset_id}", headers={"X-User-ID": "user-b"})
    assert del_b.status_code == 404

    del_a = client.delete(f"/api/presets/{preset_id}", headers={"X-User-ID": "user-a"})
    assert del_a.status_code == 200


def test_question_notes_and_highlights_roundtrip(app, client) -> None:
    empty = client.get("/api/questions/1/note", headers={"X-User-ID": "user-a"})
    assert empty.status_code == 200
    assert empty.get_json()["note_text"] == ""
    assert empty.get_json()["highlights"] == []

    put_resp = client.put(
        "/api/questions/1/note",
        headers={"X-User-ID": "user-a"},
        json={
            "note_text": "Macete: hPL tem homologia com GH e prolactina.",
            "highlights": [{"id": "h1", "text": "lactogênio placentário", "color": "yellow"}],
        },
    )
    assert put_resp.status_code == 200
    data = put_resp.get_json()
    assert len(data["highlights"]) == 1
    assert data["highlights"][0]["color"] == "yellow"

    notes_list = client.get("/api/notes?q=prolactina", headers={"X-User-ID": "user-a"}).get_json()["notes"]
    assert len(notes_list) == 1
    assert notes_list[0]["question_id"] == 1

    notes_b = client.get("/api/notes", headers={"X-User-ID": "user-b"}).get_json()["notes"]
    assert notes_b == []

    del_resp = client.delete("/api/questions/1/note", headers={"X-User-ID": "user-a"})
    assert del_resp.status_code == 200
    after_del = client.get("/api/questions/1/note", headers={"X-User-ID": "user-a"}).get_json()
    assert after_del["note_text"] == ""
