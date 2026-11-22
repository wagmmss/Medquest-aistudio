import base64
import hashlib
import hmac
import logging
import os
import re
import time
import uuid
from functools import wraps

import jwt
from flask import Blueprint, current_app, g, jsonify, request

logger = logging.getLogger(__name__)

# Extract domain from the publishable key
pk = os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "")
configured_issuer = os.getenv("CLERK_ISSUER", "").rstrip("/") or None
if pk.startswith(("pk_test_", "pk_live_")):
    try:
        domain_b64 = pk.removeprefix("pk_test_").removeprefix("pk_live_").strip("$")
        domain_b64 += "=" * ((4 - len(domain_b64) % 4) % 4)
        domain = base64.b64decode(domain_b64).decode("utf-8")
        domain = domain.removesuffix("$")
        CLERK_ISSUER = configured_issuer or f"https://{domain}"
    except Exception:
        CLERK_ISSUER = configured_issuer
else:
    CLERK_ISSUER = configured_issuer

JWKS_URL = os.getenv(
    "CLERK_JWKS_URL",
    f"{CLERK_ISSUER}/.well-known/jwks.json" if CLERK_ISSUER else "",
) or None
CLERK_AUDIENCE = os.getenv("CLERK_JWT_AUDIENCE") or None


def is_valid_uuid_v4(val: str | None) -> bool:
    """Valida se uma string é um UUID canônico versão 4 (minúsculo, não-nil, version==4)."""
    if not val or not isinstance(val, str):
        return False
    # Nil UUID is strictly rejected
    if val == "00000000-0000-0000-0000-000000000000":
        return False
    try:
        u = uuid.UUID(val, version=4)
        # u.version == 4 checks the version bits, str(u) == val.lower() checks 8-4-4-4-12 canonical format
        return u.version == 4 and str(u) == val.lower()
    except (ValueError, AttributeError, TypeError):
        return False


# Global PyJWKClient instance to cache keys and avoid rate limits/timeouts
jwks_client = jwt.PyJWKClient(JWKS_URL, cache_keys=True, timeout=5) if JWKS_URL else None

def configured_curator_emails() -> frozenset[str]:
    """Read allowlisted curator identities from deployment configuration.

    An empty configuration deliberately denies curator access in production.
    This is safer than silently granting a role from a source-controlled email.
    """
    return frozenset(
        email.strip().lower()
        for email in os.environ.get("CURATOR_EMAILS", "").split(",")
        if email.strip()
    )


def configured_lessons_allowed_user_ids() -> frozenset[str]:
    """Read allowlisted Clerk user IDs (`sub`) for private video lessons."""
    return frozenset(
        uid.strip()
        for uid in os.environ.get("LESSONS_ALLOWED_USER_IDS", "").split(",")
        if uid.strip()
    )


def configured_lessons_allowed_emails() -> frozenset[str]:
    """Read allowlisted verified emails for private video lessons access (fail-closed when unset)."""
    return frozenset(
        email.strip().lower()
        for email in os.environ.get("LESSONS_ALLOWED_EMAILS", "").split(",")
        if email.strip()
    )


def can_access_lessons_request() -> bool:
    """Restrict private video lessons strictly to allowlisted authenticated accounts (fail-closed)."""
    user_id = str(getattr(g, "user_id", "") or "").strip()
    if not user_id or user_id.startswith("guest:"):
        return False

    if _is_testing_env(current_app) and hasattr(g, "can_access_lessons"):
        return bool(g.can_access_lessons)

    allowed_ids = configured_lessons_allowed_user_ids()
    if allowed_ids:
        return user_id in allowed_ids

    allowed_emails = configured_lessons_allowed_emails()
    if allowed_emails:
        user_email = (getattr(g, "user_email", None) or "").strip().lower()
        return bool(user_email and user_email in allowed_emails)

    return False

def _is_testing_env(app) -> bool:
    """Verifica se o ambiente de teste está ativo de forma estritamente isolada de produção."""
    return bool(
        app.config.get("TESTING")
        and os.environ.get("FLASK_ENV") != "production"
        and not os.environ.get("RENDER")
    )


_STREAM_PATH_RE = re.compile(r"^/api(?:/v1)?/lessons/(\d+)/stream$")


def _get_stream_signing_secret() -> str | None:
    secret = (
        os.environ.get("FLASK_API_PROXY_SECRET")
        or os.environ.get("TURSO_AUTH_TOKEN")
        or os.environ.get("SECRET_KEY")
        or ""
    ).strip()
    if secret:
        return secret
    try:
        if _is_testing_env(current_app):
            return "medquest-test-stream-secret"
    except RuntimeError:
        pass
    return None


def create_lesson_stream_token(
    lesson_id: int,
    user_id: str,
    user_email: str = "",
    ttl_seconds: int = 21600,
) -> str | None:
    """Gera token HMAC-SHA256 de curta duração vinculado a lesson_id e user_id para tag <video>."""
    secret = _get_stream_signing_secret()
    uid = (user_id or "").strip()
    if not secret or not uid or uid.startswith("guest:") or lesson_id <= 0:
        return None
    exp = int(time.time()) + max(60, int(ttl_seconds))
    uid_b64 = base64.urlsafe_b64encode(uid.encode("utf-8")).decode("ascii").rstrip("=")
    em_b64 = base64.urlsafe_b64encode((user_email or "").strip().lower().encode("utf-8")).decode("ascii").rstrip("=")
    payload = f"lesson-stream:{lesson_id}:{exp}:{uid_b64}:{em_b64}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"{lesson_id}.{exp}.{uid_b64}.{em_b64}.{sig}"


def verify_lesson_stream_token(token: str, expected_lesson_id: int) -> tuple[str, str] | None:
    """Valida token HMAC-SHA256 de stream de aula e retorna (user_id, user_email) ou None."""
    secret = _get_stream_signing_secret()
    if not secret or not token or expected_lesson_id <= 0:
        return None
    parts = token.strip().split(".")
    if len(parts) != 5:
        return None
    lid_str, exp_str, uid_b64, em_b64, sig = parts
    try:
        lid = int(lid_str)
        exp = int(exp_str)
    except ValueError:
        return None
    if lid != expected_lesson_id or exp < int(time.time()):
        return None
    expected_payload = f"lesson-stream:{lid}:{exp}:{uid_b64}:{em_b64}".encode("utf-8")
    expected_sig = hmac.new(secret.encode("utf-8"), expected_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        return None
    try:
        uid_pad = uid_b64 + "=" * ((4 - len(uid_b64) % 4) % 4)
        user_id = base64.urlsafe_b64decode(uid_pad.encode("ascii")).decode("utf-8").strip()
        if em_b64:
            em_pad = em_b64 + "=" * ((4 - len(em_b64) % 4) % 4)
            user_email = base64.urlsafe_b64decode(em_pad.encode("ascii")).decode("utf-8").strip().lower()
        else:
            user_email = ""
    except Exception:
        return None
    if not user_id or user_id.startswith("guest:"):
        return None
    return user_id, user_email


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        stream_match = _STREAM_PATH_RE.match(request.path or "")
        if stream_match and "st" in request.args:
            verified = verify_lesson_stream_token(
                request.args.get("st", ""),
                int(stream_match.group(1)),
            )
            if not verified:
                return jsonify({"error": "Unauthorized"}), 401
            g.user_id, g.user_email = verified
            return f(*args, **kwargs)

        if _is_testing_env(current_app):
            if "X-User-ID" in request.headers:
                g.user_id = request.headers["X-User-ID"]
            elif "X-Guest-ID" in request.headers:
                g.user_id = request.headers["X-Guest-ID"]
            else:
                g.user_id = getattr(g, "user_id", "1")
            if "X-User-Email" in request.headers:
                g.user_email = request.headers["X-User-Email"].strip().lower()
            else:
                g.user_email = getattr(g, "user_email", "moraes.wagg@gmail.com")
            return f(*args, **kwargs)


        if request.method == "OPTIONS" or request.path == "/":
            return f(*args, **kwargs)

        proxy_secret = os.environ.get("FLASK_API_PROXY_SECRET", "")
        proxy_token = request.headers.get("X-Internal-Proxy-Token", "")
        if proxy_secret and proxy_token and hmac.compare_digest(proxy_secret, proxy_token):
            g.user_email = (request.headers.get("X-User-Email") or "").strip().lower()
        else:
            g.user_email = ""

        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer ") or auth_header == "Bearer null":
            if not proxy_secret or not proxy_token:
                return jsonify({"error": "Unauthorized"}), 401

            if not hmac.compare_digest(proxy_secret, proxy_token):
                return jsonify({"error": "Unauthorized"}), 401

            guest_id = request.headers.get("X-Guest-ID")
            if not is_valid_uuid_v4(guest_id):
                return jsonify({"error": "Unauthorized"}), 401

            g.user_id = f"guest:{guest_id.lower()}"
            return f(*args, **kwargs)

        token = auth_header.removeprefix("Bearer ").strip()
        if not token:
            return jsonify({"error": "Unauthorized"}), 401
        try:
            if not jwks_client or not CLERK_ISSUER:
                return jsonify({"error": "Unauthorized"}), 401
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            decode_options = {
                "algorithms": ["RS256"],
                "issuer": CLERK_ISSUER,
                "options": {
                    "require": ["exp", "iss", "sub"],
                    "verify_aud": CLERK_AUDIENCE is not None,
                },
            }
            if CLERK_AUDIENCE:
                decode_options["audience"] = CLERK_AUDIENCE
            data = jwt.decode(token, signing_key.key, **decode_options)
            sub = data.get("sub")
            if not isinstance(sub, str) or not sub.strip():
                return jsonify({"error": "Unauthorized"}), 401
            g.user_id = sub.strip()
            
            # Extract email from verified JWT claims (takes precedence over proxy header)
            jwt_email = ""
            if "email" in data and isinstance(data["email"], str):
                jwt_email = data["email"].strip().lower()
            elif "primary_email" in data and isinstance(data["primary_email"], str):
                jwt_email = data["primary_email"].strip().lower()
            if jwt_email:
                g.user_email = jwt_email
        except Exception as exc:
            logger.info("JWT validation failed: %s", type(exc).__name__)
            return jsonify({"error": "Unauthorized"}), 401

        return f(*args, **kwargs)
    return decorated


bp = Blueprint("auth", __name__)


@bp.route("/auth/me")
@require_auth
def auth_me():
    user_email = (getattr(g, "user_email", None) or "").strip().lower()
    curator_emails = configured_curator_emails()
    is_curator = bool(user_email and user_email in curator_emails)
    if _is_testing_env(current_app) and hasattr(g, "is_curator"):
        is_curator = bool(g.is_curator)
    resp = jsonify({
        "user_id": g.user_id,
        "email": user_email,
        "is_curator": is_curator,
        "can_access_lessons": can_access_lessons_request(),
    })
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


def require_lessons_access(f):
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        if not can_access_lessons_request():
            return jsonify({"error": "Forbidden: Acesso restrito às aulas privadas"}), 403
        return f(*args, **kwargs)
    return decorated


def require_curator(f):
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        user_email = (getattr(g, "user_email", None) or "").strip().lower()
        if _is_testing_env(current_app):
            if not getattr(g, "is_curator", True):
                return jsonify({"error": "Forbidden: Acesso restrito para curadoria de conteúdo"}), 403
            if user_email and configured_curator_emails() and user_email not in configured_curator_emails():
                return jsonify({"error": "Forbidden: Acesso restrito para curadoria de conteúdo"}), 403
            return f(*args, **kwargs)

        if not user_email or user_email not in configured_curator_emails():
            return jsonify({"error": "Forbidden: Acesso restrito para curadoria de conteúdo"}), 403
        return f(*args, **kwargs)
    return decorated

