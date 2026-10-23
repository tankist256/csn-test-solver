"""HTTP API for Entra login, quests, test attempts and the admin panel.

serve.py calls handle() first. It returns False for anything it does not own,
so with AUTH_ENABLED off the old behaviour is unchanged (except /api/config,
which just reports that login is disabled).

The client never reports completion or points. It starts an attempt, sends
answers, and the server grades them and decides which quests are done.
"""
import json
import logging
import os
import re
import socket
import threading
from functools import lru_cache
from ipaddress import ip_address
from urllib.parse import parse_qs, urlsplit

try:
    from .auth import AuthConfig, AuthError, TokenVerifier, ROLE_USER
    from .quests import QuestService, ServiceError, load_question_bank, load_quests
except ImportError:
    from auth import AuthConfig, AuthError, TokenVerifier, ROLE_USER
    from quests import QuestService, ServiceError, load_question_bank, load_quests

log = logging.getLogger("csn.api")

_lock = threading.RLock()
_runtime = {"config": None, "verifier": None, "store": None, "service": None,
            "engine": None, "local_auth": None}


def configure(config=None, verifier=None, store=None, service=None, engine=None, local_auth=None):
    """Inject dependencies (used by tests)."""
    with _lock:
        _runtime.update(config=config, verifier=verifier, store=store, service=service,
                        engine=engine, local_auth=local_auth)


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


def _mode(config):
    return os.environ.get("AUTH_MODE", "").strip().lower() or ("entra" if config.enabled else "off")


def _engine():
    with _lock:
        if _runtime["engine"] is None:
            try:
                from .postgres_store import PostgresEngine
            except ImportError:
                from postgres_store import PostgresEngine
            _runtime["engine"] = PostgresEngine(os.environ.get("DATABASE_URL", ""))
        return _runtime["engine"]


def _local_auth():
    with _lock:
        if _runtime["local_auth"] is None:
            try:
                from .local_auth import LocalAuth
            except ImportError:
                from local_auth import LocalAuth
            _runtime["local_auth"] = LocalAuth(_engine())
        return _runtime["local_auth"]


def _store():
    with _lock:
        if _runtime["store"] is None:
            backend = os.environ.get("PROGRESS_BACKEND", "").strip() or (
                "postgres" if _mode(_config()) == "local" else "tables")
            if backend == "postgres":
                try:
                    from .postgres_store import progress_store
                except ImportError:
                    from postgres_store import progress_store
                _runtime["store"] = progress_store(_engine())
            else:
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
    if _mode(config) == "local":
        return {"auth_enabled": bool(os.environ.get("DATABASE_URL")), "auth_mode": "local"}
    if not (config.enabled and config.is_configured()):
        return {"auth_enabled": False}
    return {
        "auth_enabled": True,
        "auth_mode": "entra",
        "client_id": config.spa_client_id,
        "authority": f"https://{config.tenant_subdomain}.ciamlogin.com/{config.tenant_id}",
        "scopes": [config.api_scope] if config.api_scope else [],
    }


def _principal(handler, config):
    if _mode(config) == "local":
        try:
            from .local_auth import session_token
        except ImportError:
            from local_auth import session_token
        return _local_auth().principal(session_token(handler.headers.get("Cookie", "")))
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


def _local_post_allowed(handler):
    # A cross-origin page cannot send this non-safelisted header without CORS.
    if handler.headers.get("X-CSN-Request") != "1":
        raise AuthError(403, "csrf_rejected")


@lru_cache(maxsize=1)
def _docker_gateway():
    """Return the host address seen by this container's TCP server."""
    if not os.path.exists("/.dockerenv"):
        return ""
    try:
        with open("/proc/net/route", encoding="ascii") as routes:
            next(routes, None)
            for line in routes:
                columns = line.split()
                if (len(columns) > 3 and columns[1] == "00000000"
                        and int(columns[3], 16) & 2):
                    return socket.inet_ntoa(bytes.fromhex(columns[2])[::-1])
    except (OSError, ValueError):
        pass
    return ""


def _client_ip(handler):
    """Use X-Real-IP only from localhost or the Docker host gateway."""
    peer = handler.client_address[0]
    try:
        if ip_address(peer).is_loopback or peer == _docker_gateway():
            forwarded = handler.headers.get("X-Real-IP", "").strip()
            if forwarded:
                return str(ip_address(forwarded))
    except ValueError:
        pass
    return peer


def require_admin(handler, method="GET"):
    """Authorize collector operations using the same identity as the admin API."""
    config = _config()
    mode = _mode(config)
    if mode == "off" or (mode == "entra" and not config.enabled):
        raise AuthError(401, "unauthorized")
    if mode == "local" and method == "POST":
        _local_post_allowed(handler)
    principal = _principal(handler, config)
    if not principal.is_admin:
        raise AuthError(403, "forbidden")
    return principal


def _local_session_body(principal):
    return {"oid": principal.oid, "name": principal.name, "email": principal.email,
            "roles": sorted(principal.roles), "is_admin": principal.is_admin}


def _handle_local_auth(handler, method, route):
    try:
        from .local_auth import cookie_header, session_token
    except ImportError:
        from local_auth import cookie_header, session_token
    try:
        auth = _local_auth()
        token = session_token(handler.headers.get("Cookie", ""))
        if method == "GET" and route == "/api/auth/session":
            handler.send_json(_local_session_body(auth.principal(token)))
        elif method == "POST" and route in ("/api/auth/register", "/api/auth/login"):
            _local_post_allowed(handler)
            body = _read_json(handler)
            if route.endswith("register"):
                principal, new_token = auth.register(body.get("email"), body.get("name"),
                                                     body.get("password"), _client_ip(handler))
                status = 201
            else:
                principal, new_token = auth.login(body.get("email"), body.get("password"),
                                                  _client_ip(handler))
                status = 200
            _store().upsert_user(principal.oid, principal.email, principal.name)
            secure = os.environ.get("CSN_COOKIE_SECURE", "1") != "0"
            handler.send_json(_local_session_body(principal), status,
                              headers={"Set-Cookie": cookie_header(new_token, secure)})
        elif method == "POST" and route == "/api/auth/logout":
            _local_post_allowed(handler)
            auth.logout(token)
            secure = os.environ.get("CSN_COOKIE_SECURE", "1") != "0"
            handler.send_json({"ok": True}, headers={"Set-Cookie": cookie_header("", secure)})
        else:
            return False
    except (AuthError, ServiceError) as error:
        handler.send_json({"error": error.code}, error.status)
    except Exception:
        log.exception("Local auth error on %s %s", method, route)
        handler.send_json({"error": "server_error"}, 500)
    return True


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
    users = _store().list_users()
    if _mode(_config()) == "local":
        flags = _local_auth().admin_flags()
        for user in users:
            user["is_admin"] = flags.get(user["oid"])
    return {"users": users}, 200


def _admin_user_detail(handler, principal, match):
    oid = match.group("oid").lower()
    user = _store().get_user(oid)
    if user is None:
        raise ServiceError(404, "not_found")
    overview = _service().overview(oid)
    if _mode(_config()) == "local":
        user["is_admin"] = _local_auth().admin_flags().get(oid)
    return {"user": user, "quests": overview["quests"], "attempts": _store().list_results(oid),
            "correct_unique": overview["correct_unique"]}, 200


def _admin_user_role(handler, principal, match):
    if _mode(_config()) != "local":
        raise ServiceError(409, "role_management_unavailable")
    body = _read_json(handler)
    if set(body) != {"is_admin"} or type(body["is_admin"]) is not bool:
        raise ServiceError(400, "bad_request")
    return _local_auth().set_admin(principal.oid, match.group("oid"), body["is_admin"]), 200


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
    ("POST", re.compile(r"^/api/admin/users/(?P<oid>[0-9a-fA-F-]{36})/role$"), _admin_user_role, True),
]


def handle(handler, method, route):
    config = _config()
    if method == "GET" and route == "/api/config":
        handler.send_json(public_config(config))
        return True
    mode = _mode(config)
    if mode == "local" and route.startswith("/api/auth/"):
        return _handle_local_auth(handler, method, route)
    if mode == "off" or (mode == "entra" and not config.enabled):
        return False

    for route_method, pattern, function, admin_only in ROUTES:
        match = pattern.match(route)
        if route_method != method or not match:
            continue
        try:
            if mode == "local" and method == "POST":
                _local_post_allowed(handler)
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
