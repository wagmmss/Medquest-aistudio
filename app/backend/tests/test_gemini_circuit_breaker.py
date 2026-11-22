from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from api.gemini_pool import CircuitBreaker, circuit_breaker, generate_content_with_fallback


def test_circuit_breaker_opens_after_threshold_and_recovers() -> None:
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=0.05)
    assert cb.can_execute() is True
    assert cb.state == "CLOSED"

    cb.record_failure()
    cb.record_failure()
    assert cb.can_execute() is True

    cb.record_failure()
    assert cb.state == "OPEN"
    assert cb.can_execute() is False

    time.sleep(0.06)
    assert cb.can_execute() is True
    assert cb.state == "HALF_OPEN"

    cb.record_success()
    assert cb.state == "CLOSED"
    assert cb.failure_count == 0


def test_generate_content_with_fallback_fast_fails_when_circuit_open() -> None:
    circuit_breaker.reset()
    try:
        for _ in range(circuit_breaker.failure_threshold):
            circuit_breaker.record_failure()

        with patch("api.gemini_pool.gemini_pool") as mock_pool:
            mock_pool.total_keys = 1
            with pytest.raises(RuntimeError, match="Fast-Fail"):
                generate_content_with_fallback(prompt="teste", timeout=12)
            mock_pool.generate_content.assert_not_called()
    finally:
        circuit_breaker.reset()
