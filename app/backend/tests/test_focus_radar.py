from __future__ import annotations


def test_focus_radar_endpoint_and_prevalence_tiers(app, client) -> None:
    resp = client.get("/api/stats/focus-radar?prevalence=prioritario", headers={"X-User-ID": "user-radar"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "summary" in data
    assert "areas" in data
    assert "focuses" in data
    assert "sniper_url" in data
    assert data["prevalence_filter"] == "prioritario"
    for item in data["focuses"]:
        assert item["prevalence"] == "prioritario"
        assert "sniper_url" in item
