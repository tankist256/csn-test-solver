"""HTTP API for Entra login, quests, test attempts and the admin panel.

serve.py calls handle() first. It returns False for anything it does not own,
so with AUTH_ENABLED off the old behaviour is unchanged (except /api/config,
which just reports that login is disabled).

The client never reports completion or points. It starts an attempt, sends
answers, and the server grades them and decides which quests are done.
"""
import json
import logging
import re
import threading
from urllib.parse import parse_qs, urlsplit

try:
    from .auth import AuthConfig, AuthError, TokenVerifier, ROLE_USER
    from .quests import QuestService, ServiceError, load_question_bank, load_quests
except ImportError:
    from auth import AuthConfig, AuthError, TokenVerifier, ROLE_USER
    from quests import QuestService, ServiceError, load_question_bank, load_quests

log = logging.getLogger("csn.api")

_lock = threading.Lock()
_runtime = {"config": None, "verifier": None, "store": None, "service": None}


def configure(config=None, verifier=None, store=None, service=None):
    """Inject dependencies (used by tests)."""
    with _lock:
        _runtime.update(config=config, verifier=verifier, store=store, service=service)


def reset():
    configure()


def _config():
    with _lock:
        if _runtime["config"] is None:
            _runtime["config"] = AuthConfig.from_env()
        return _runtime["config"]


def _verifier(config):
    with _lock:
        if _runtime["verifier"] is None:
            _runtime["verifier"] = TokenVerifier(config)
        return _runtime["verifier"]


def _store():
    with _lock:
        if _runtime["store"] is None:
            try:
                from .progress_store import TableStore
            except ImportError:
                from progress_store import TableStore
            _runtime["store"] = TableStore.from_env()
        return _runtime["store"]


def _service():
    store = _store()
    with _lock:
        if _runtime["service"] is None:
            _runtime["service"] = QuestService(store, load_question_bank(), load_quests())
        return _runtime["service"]


def public_config(config):
    if not (config.enabled and config.is_configured()):
        return {"auth_enabled": False}
    return {
        "auth_enabled": True,
        "client_id": config.spa_client_id,
        "authority": f"https://{config.tenant_subdomain}.ciamlogin.com/{config.tenant_id}",
        "scopes": [config.api_scope] if config.api_scope else [],
    }


def _principal(handler, config):
    if not config.is_configured():
        raise AuthError(503, "auth_misconfigured")
    scheme, _, token = handler.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError(401, "unauthorized")
    principal = _verifier(config).verify(token.strip())
    if not principal.has_role(ROLE_USER):
        raise AuthError(403, "forbidden")
    return principal


def _read_json(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        if not 0 <= length <= 16384:
            raise ValueError
        payload = json.loads(handler.rfile.read(length) or b"{}")
        if not isinstance(payload, dict):
            raise ValueError
        return payload
    except (ValueError, TypeError):
        raise ServiceError(400, "bad_request")


# Route handlers take (handler, principal, match) and return (body, status).
# Every user route works on principal.oid only; there is no way to name another user.

def _me(handler, principal, match):
    return {"oid": principal.oid, "name": principal.name, "email": principal.email,
            "roles": sorted(principal.roles), "is_admin": principal.is_admin}, 200


def _quests(handler, principal, match):
    return _service().overview(principal.oid), 200


def _start_attempt(handler, principal, match):
    body = _read_json(handler)
    return _service().start_attempt(principal.oid, body.get("size", 30)), 201


def _answer_attempt(handler, principal, match):
    body = _read_json(handler)
    return _service().answer_attempt(principal.oid, match.group("attempt_id"),
                                     body.get("question_id"), body.get("option")), 200


def _get_attempt(handler, principal, match):
    return _service().get_attempt(principal.oid, match.group("attempt_id")), 200


def _list_attempts(handler, principal, match):
    return {"items": _service().list_attempts(principal.oid)}, 200


def _leaderboard(handler, principal, match):
    query = parse_qs(urlsplit(handler.path).query)
    try:
        limit = int(query.get("limit", ["50"])[0])
    except ValueError:
        limit = 50
    return {"items": _store().leaderboard(min(max(limit, 1), 200))}, 200


def _admin_users(handler, principal, match):
    return {"users": _store().list_users()}, 200


def _admin_user_detail(handler, principal, match):
    oid = match.group("oid").lower()
    user = _store().get_user(oid)
    if user is None:
        raise ServiceError(404, "not_found")
    overview = _service().overview(oid)
    return {"user": user, "quests": overview["quests"], "attempts": _store().list_results(oid),
            "correct_unique": overview["correct_unique"]}, 200


# (method, pattern, function, admin_only)
ROUTES = [
    ("GET", re.compile(r"^/api/me$"), _me, False),
    ("GET", re.compile(r"^/api/quests$"), _quests, False),
    ("GET", re.compile(r"^/api/leaderboard$"), _leaderboard, False),
    ("GET", re.compile(r"^/api/attempts$"), _list_attempts, False),
    ("POST", re.compile(r"^/api/attempts$"), _start_attempt, False),
    ("GET", re.compile(r"^/api/attempts/(?P<attempt_id>[0-9a-f]{32})$"), _get_attempt, False),
    ("POST", re.compile(r"^/api/attempts/(?P<attempt_id>[0-9a-f]{32})/answer$"), _answer_attempt, False),
    ("GET", re.compile(r"^/api/admin/users$"), _admin_users, True),
    ("GET", re.compile(r"^/api/admin/users/(?P<oid>[0-9a-fA-F-]{36})/progress$"), _admin_user_detail, True),
]


def handle(handler, method, route):
    config = _config()
    if method == "GET" and route == "/api/config":
        handler.send_json(public_config(config))
        return True
    if not config.enabled:
        return False

    for route_method, pattern, function, admin_only in ROUTES:
        match = pattern.match(route)
        if route_method != method or not match:
            continue
        try:
            principal = _principal(handler, config)
            if admin_only and not principal.is_admin:
                raise AuthError(403, "forbidden")
            _store().upsert_user(principal.oid, principal.email, principal.name)
            body, status = function(handler, principal, match)
            handler.send_json(body, status)
        except (AuthError, ServiceError) as error:
            handler.send_json({"error": error.code}, error.status)
        except Exception:
            log.exception("API error on %s %s", method, route)
            handler.send_json({"error": "server_error"}, 500)
        return True
    return False
