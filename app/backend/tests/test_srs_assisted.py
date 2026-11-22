from datetime import datetime, timezone
from fsrs import Rating
from api import srs


def test_assisted_attempt_caps_rating_at_hard():
    """Garante que acertos com Dica do Preceptor (assisted=True) não recebam Rating.Easy nem Good."""
    assert srs._rating(True, "certeza", assisted=False) == Rating.Easy
    assert srs._rating(True, "duvida", assisted=False) == Rating.Good
    assert srs._rating(True, "chutei", assisted=False) == Rating.Hard

    # Com assisted=True, qualquer acerto é limitado a Rating.Hard
    assert srs._rating(True, "certeza", assisted=True) == Rating.Hard
    assert srs._rating(True, "duvida", assisted=True) == Rating.Hard
    assert srs._rating(True, "chutei", assisted=True) == Rating.Hard

    # Erros permanecem Rating.Again mesmo com assisted=True
    assert srs._rating(False, "certeza", assisted=True) == Rating.Again


def test_assisted_review_produces_shorter_interval_than_unassisted_easy():
    """Garante que review(..., assisted=True) gera intervalo menor que acerto sem ajuda (Easy) e respeita piso D+1."""
    now = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
    _, due_unassisted_easy = srs.review(None, True, "certeza", now=now, assisted=False)
    _, due_assisted_easy = srs.review(None, True, "certeza", now=now, assisted=True)
    _, due_wrong = srs.review(None, False, "duvida", now=now, assisted=True)

    dt_unassisted = datetime.fromisoformat(due_unassisted_easy)
    dt_assisted = datetime.fromisoformat(due_assisted_easy)
    dt_wrong = datetime.fromisoformat(due_wrong)

    assert (dt_assisted - now).days >= 1
    assert (dt_wrong - now).days >= 1
    assert dt_assisted < dt_unassisted
