"""Durability and aggregated analysis regressions."""


def test_cleanup_command_is_registered_and_validates_retention(app):
    runner = app.test_cli_runner()
    assert runner.invoke(args=['cleanup-idempotency', '--max-age-days', '0']).exit_code != 0
    assert runner.invoke(args=['cleanup-idempotency']).exit_code == 0


def test_analysis_summary_aggregates_core_metrics(client):
    res = client.get('/api/stats/analysis-summary')
    assert res.status_code == 200
    payload = res.get_json()
    expected_keys = {
        'overview',
        'learning_profile',
        'exam_readiness',
        'institution_radar',
        'blindspots',
        'weak_topics',
        'distractors',
        'at_risk',
        'timeline_180',
        'coverage',
    }
    assert expected_keys.issubset(payload.keys())
    assert 'flashcards_due_count' not in payload['overview']
    assert 'areas' in payload['coverage']
