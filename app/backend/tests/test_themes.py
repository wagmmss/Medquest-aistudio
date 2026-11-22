"""Theme progress must remain scoped to theme and owner."""
import pytest

THEME = 'Hipertensão Arterial Sistêmica e Crises Hipertensivas'
OTHER = 'Calendário Vacinal do PNI e Imunizações Especiais'


@pytest.fixture(autouse=True)
def canonical_seed(app):
    from api.db import get_db, db_transaction
    with app.app_context():
        db = get_db()
        with db_transaction(db):
            db.execute('UPDATE questions SET subtema=? WHERE id=1', (THEME,))
            db.execute('UPDATE questions SET subtema=? WHERE id=2', (OTHER,))


def test_theme_progress_persists_without_changing_learning_metrics(client):
    url = '/api/themes/progress'
    before = client.get('/api/stats/learning-profile', query_string={'subtema': THEME}).get_json()['topics']
    initial = client.get(url, query_string={'subtema': THEME}).get_json()
    assert initial['theory_completed'] is False
    assert initial['study_path'] == 'essential'
    saved = client.put(url, query_string={'subtema': THEME}, json={
        'theory_completed': True, 'study_path': 'complete',
    })
    assert saved.status_code == 200
    reloaded = client.get(url, query_string={'subtema': THEME}).get_json()
    assert reloaded['theory_completed'] is True
    assert reloaded['study_path'] == 'complete'
    assert reloaded['updated_at']
    other = client.get(url, query_string={'subtema': THEME}, headers={'X-User-ID': 'another'}).get_json()
    assert other['theory_completed'] is False
    assert other['updated_at'] is None
    assert client.get(url, query_string={'subtema': OTHER}).get_json()['theory_completed'] is False
    after = client.get('/api/stats/learning-profile', query_string={'subtema': THEME}).get_json()['topics']
    assert before == after
    client.put(url, query_string={'subtema': THEME}, json={'theory_completed': False, 'study_path': 'essential'})
    assert client.get(url, query_string={'subtema': THEME}).get_json()['theory_completed'] is False


def test_theme_validation_and_versioned_route(client):
    assert client.get('/api/themes/progress?subtema=unknown').status_code == 404
    assert client.get('/api/v1/themes/progress', query_string={'subtema': THEME}).status_code == 200
    for payload in [None, [], {}, {'theory_completed': 'false', 'study_path': 'complete'},
                    {'theory_completed': True, 'study_path': 'invalid'},
                    {'theory_completed': True, 'study_path': 'complete', 'user_id': 'another'}]:
        response = client.put('/api/themes/progress', query_string={'subtema': THEME}, json=payload)
        assert response.status_code == 400


def test_reset_clears_theme_progress(client):
    client.put('/api/themes/progress', query_string={'subtema': THEME}, json={'theory_completed': True, 'study_path': 'complete'})
    response = client.delete('/api/stats/reset')
    assert response.status_code == 200
    assert client.get('/api/themes/progress', query_string={'subtema': THEME}).get_json()['theory_completed'] is False
