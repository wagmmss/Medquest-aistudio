from __future__ import annotations

import io
import json
import time
import urllib.error
from unittest.mock import patch

from api.gemini_pool import DEFAULT_FALLBACK_MODELS, GeminiPool


class _FakeHTTPResponse:
    def __init__(self, payload: dict):
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _http_error(code: int, body: dict | str, url: str = "https://example.test") -> urllib.error.HTTPError:
    raw = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body.encode("utf-8")
    return urllib.error.HTTPError(url, code, f"HTTP {code}", {}, io.BytesIO(raw))


def _ok_payload(text: str = "Resposta clínica válida") -> _FakeHTTPResponse:
    return _FakeHTTPResponse({
        "candidates": [{"content": {"parts": [{"text": text}]}}]
    })


def test_http_402_depleted_credits_isolates_key_and_falls_back_to_next_key() -> None:
    pool = GeminiPool(
        keys=["AQ.key_depleted_111111111", "AQ.key_healthy_222222222"],
        default_model="gemini-3.1-flash-lite",
    )
    called_keys: list[str] = []

    def fake_urlopen(req, timeout=10):
        api_key = req.headers.get("X-goog-api-key") or req.headers.get("x-goog-api-key")
        called_keys.append(api_key)
        if api_key == "AQ.key_depleted_111111111":
            raise _http_error(
                402,
                {
                    "error": {
                        "code": 402,
                        "status": "RESOURCE_EXHAUSTED",
                        "message": "Your prepayment credits are depleted.",
                    }
                },
            )
        return _ok_payload("Conduta correta")

    with patch("api.gemini_pool.urllib.request.urlopen", side_effect=fake_urlopen):
        res = pool.generate_content(prompt="Teste 402", timeout=10)

    assert res["text"] == "Conduta correta"
    assert res["key_index"] == 2
    assert called_keys == ["AQ.key_depleted_111111111", "AQ.key_healthy_222222222"]
    # Chave #1 deve estar em cooldown global (indisponível para qualquer modelo)
    assert pool._keys[0].is_available is False
    assert pool._keys[0].is_available_for("gemini-3.5-flash-lite") is False
    assert pool._keys[1].is_available is True


def test_http_403_and_400_invalid_key_fallback_to_healthy_key() -> None:
    pool = GeminiPool(
        keys=[
            "AQ.key_forbidden_11111111",
            "AQ.key_invalid_222222222",
            "AQ.key_healthy_333333333",
        ],
        default_model="gemini-3.1-flash-lite",
    )

    def fake_urlopen(req, timeout=10):
        api_key = req.headers.get("X-goog-api-key") or req.headers.get("x-goog-api-key")
        if api_key == "AQ.key_forbidden_11111111":
            raise _http_error(403, {"error": {"code": 403, "message": "Permission denied"}})
        if api_key == "AQ.key_invalid_222222222":
            raise _http_error(400, {"error": {"code": 400, "message": "API_KEY_INVALID"}})
        return _ok_payload("OK chave 3")

    with patch("api.gemini_pool.urllib.request.urlopen", side_effect=fake_urlopen):
        res = pool.generate_content(prompt="Teste 403/400", timeout=10)

    assert res["text"] == "OK chave 3"
    assert res["key_index"] == 3
    assert pool._keys[0].is_available is False
    assert pool._keys[1].is_available is False
    assert pool._keys[2].is_available is True


def test_single_timeout_tries_next_key_on_same_model_before_switching_model() -> None:
    pool = GeminiPool(
        keys=["AQ.key_slow_111111111111", "AQ.key_fast_222222222222"],
        default_model="gemini-3.1-flash-lite",
    )
    calls: list[tuple[str, str]] = []

    def fake_urlopen(req, timeout=10):
        api_key = req.headers.get("X-goog-api-key") or req.headers.get("x-goog-api-key")
        calls.append((req.full_url, api_key))
        if api_key == "AQ.key_slow_111111111111":
            raise TimeoutError("The read operation timed out")
        return _ok_payload("Rápido na chave 2")

    with patch("api.gemini_pool.urllib.request.urlopen", side_effect=fake_urlopen):
        res = pool.generate_content(prompt="Teste timeout isolado", timeout=10)

    assert res["text"] == "Rápido na chave 2"
    assert res["model"] == pool.models[0]
    assert len(calls) == 2
    assert calls[0][0] == calls[1][0]  # mesmo modelo, outra chave


def test_two_consecutive_503_switch_immediately_to_next_fallback_model(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_MODELS", "gemini-3.6-flash,gemini-3.1-flash-lite")
    pool = GeminiPool(
        keys=[
            "AQ.key_one_1111111111111",
            "AQ.key_two_2222222222222",
            "AQ.key_three_33333333333",
            "AQ.key_four_444444444444",
        ],
        default_model="gemini-3.6-flash",
    )
    urls_called: list[str] = []

    def fake_urlopen(req, timeout=10):
        urls_called.append(req.full_url)
        if "gemini-3.6-flash" in req.full_url:
            raise _http_error(503, {"error": {"code": 503, "message": "high demand"}})
        return _ok_payload("Resposta do fallback rápido")

    with patch("api.gemini_pool.urllib.request.urlopen", side_effect=fake_urlopen):
        res = pool.generate_content(prompt="Teste 503", timeout=10)

    assert res["text"] == "Resposta do fallback rápido"
    assert res["model"] == "gemini-3.1-flash-lite"
    # Deve parar após 2 erros 503 em gemini-3.6-flash (não desperdiçar as 4 chaves)
    assert sum("gemini-3.6-flash" in u for u in urls_called) == 2


def test_load_models_appends_default_fallbacks_after_configured_env(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_MODELS", "gemini-3.5-flash-lite,gemini-3.6-flash")
    pool = GeminiPool(keys=["AQ.key_one_1111111111111"])
    assert pool.models[:2] == ["gemini-3.5-flash-lite", "gemini-3.6-flash"]
    for fallback_model in DEFAULT_FALLBACK_MODELS:
        assert fallback_model in pool.models


def test_get_available_key_does_not_busy_loop_when_global_cooldown_overrides_expired_model_cooldown() -> None:
    pool = GeminiPool(keys=["AQ.key_global_cd_11111111"], default_model="gemini-3.1-flash-lite")
    pool._keys[0].cooldown_until = time.time() + 3600
    pool._keys[0].model_cooldown_until["gemini-3.1-flash-lite"] = time.time() - 10

    t0 = time.monotonic()
    key_state, err = pool.get_available_key(max_wait_seconds=0.15, model="gemini-3.1-flash-lite")
    elapsed = time.monotonic() - t0

    assert key_state is None
    assert "cooldown" in err.lower()
    # Deve sair imediatamente no break (min_wait > max_wait_seconds), sem ficar em busy-loop
    assert elapsed < 0.08
