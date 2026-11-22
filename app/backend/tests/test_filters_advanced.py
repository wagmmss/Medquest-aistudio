from __future__ import annotations

from werkzeug.datastructures import MultiDict


def test_question_filter_clauses_supports_combinable_status_and_advanced_flags(app, client) -> None:
    with app.app_context():
        from flask import g
        from api.filters import question_filter_clauses

        g.user_id = "user-filter-test"
        args = MultiDict([
            ("status", "unanswered,wrong"),
            ("has_images", "1"),
            ("exclude_annulled", "1"),
            ("question_type", "objetiva"),
        ])
        clauses, params = question_filter_clauses(args)
        sql = " AND ".join(clauses)
        assert "OR" in sql
        assert "question_images" in sql
        assert "ANULADA" in sql
        assert "alternatives" in sql
        assert params.count("user-filter-test") == 3

    resp = client.get(
        "/api/questions/count?status=unanswered,wrong&exclude_annulled=1&question_type=objetiva",
        headers={"X-User-ID": "user-filter-test"},
    )
    assert resp.status_code == 200
    assert "count" in resp.get_json()
