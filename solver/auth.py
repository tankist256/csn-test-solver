"""Microsoft Entra External ID token validation and role checks.

Nothing here runs unless AUTH_ENABLED is set. PyJWT is imported lazily, so the
server starts normally without the package while the feature is off.
"""
import json
import os
import re
import threading
import time
import urllib.request
from dataclasses import dataclass

ROLE_USER = "User"
ROLE_ADMIN = "Admin"
KNOWN_ROLES = (ROLE_USER, ROLE_ADMIN)
OID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _csv(name):
    return tuple(v.strip() for v in os.environ.get(name, "").split(",") if v.strip())


class AuthError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class AuthConfig:
    enabled: bool
    tenant_id: str
    tenant_subdomain: str
    audiences: tuple
    spa_client_id: str
    api_scope: str
    required_scope: str
    default_user_role: bool
    openid_config_url: str

    @classmethod
    def from_env(cls):
        tenant_id = os.environ.get("ENTRA_TENANT_ID", "").strip()
        subdomain = os.environ.get("ENTRA_TENANT_SUBDOMAIN", "").strip()
        url = os.environ.get("ENTRA_OPENID_CONFIG_URL", "").strip()
        if not url and tenant_id and subdomain:
            url = f"https://{subdomain}.ciamlogin.com/{tenant_id}/v2.0/.well-known/openid-configuration"
        return cls(
            enabled=_flag("AUTH_ENABLED"),
            tenant_id=tenant_id,
            tenant_subdomain=subdomain,
            audiences=_csv("ENTRA_API_AUDIENCE"),
            spa_client_id=os.environ.get("ENTRA_SPA_CLIENT_ID", "").strip(),
            api_scope=os.environ.get("ENTRA_API_SCOPE", "").strip(),
            required_scope=os.environ.get("ENTRA_REQUIRED_SCOPE", "").strip(),
            default_user_role=_flag("AUTH_DEFAULT_USER_ROLE", "1"),
            openid_config_url=url,
        )

    def is_configured(self):
        return bool(self.enabled and self.tenant_id and self.tenant_subdomain and
                    self.openid_config_url and self.audiences and self.spa_client_id and
                    self.api_scope and self.required_scope)


@dataclass(frozen=True)
class Principal:
    oid: str
    name: str
    email: str
    roles: frozenset

    @property
    def is_admin(self):
        return ROLE_ADMIN in self.roles

    def has_role(self, role):
        # Admin includes everything a User can do.
        return role in self.roles or self.is_admin


def _http_get_json(url):
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


class TokenVerifier:
    """Validates access tokens issued for this API.

    fetch_json and key_resolver can be replaced in tests.
    """

    METADATA_TTL = 3600

    def __init__(self, config, fetch_json=None, key_resolver=None):
        self.config = config
        self._fetch_json = fetch_json or _http_get_json
        self._key_resolver = key_resolver
        self._lock = threading.Lock()
        self._meta = None
        self._meta_at = 0.0
        self._jwk_client = None

    def _metadata(self):
        with self._lock:
            if self._meta is None or time.time() - self._meta_at > self.METADATA_TTL:
                try:
                    meta = self._fetch_json(self.config.openid_config_url)
                    self._meta = {"issuer": meta["issuer"], "jwks_uri": meta["jwks_uri"]}
                except Exception:
                    raise AuthError(503, "auth_unavailable")
                self._meta_at = time.time()
                self._jwk_client = None
            return self._meta

    def _signing_key(self, token, meta):
        if self._key_resolver is not None:
            return self._key_resolver(token)
        import jwt

        with self._lock:
            if self._jwk_client is None:
                self._jwk_client = jwt.PyJWKClient(meta["jwks_uri"], cache_keys=True, lifespan=3600)
            client = self._jwk_client
        try:
            return client.get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError:
            raise AuthError(503, "auth_unavailable")
        except jwt.PyJWTError:
            raise AuthError(401, "invalid_token")

    def verify(self, token):
        import jwt

        meta = self._metadata()
        key = self._signing_key(token, meta)
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=list(self.config.audiences),
                issuer=meta["issuer"],
                options={"require": ["exp", "iss", "aud"]},
                leeway=60,
            )
        except jwt.PyJWTError:
            raise AuthError(401, "invalid_token")

        required = self.config.required_scope
        if required and required not in str(claims.get("scp", "")).split():
            raise AuthError(403, "missing_scope")

        oid = str(claims.get("oid", ""))
        if not OID_RE.match(oid):
            raise AuthError(401, "invalid_token")

        raw_roles = claims.get("roles") or []
        if isinstance(raw_roles, str):
            raw_roles = [raw_roles]
        roles = {role for role in raw_roles if role in KNOWN_ROLES}
        if not roles and self.config.default_user_role:
            roles.add(ROLE_USER)

        return Principal(
            oid=oid.lower(),
            name=str(claims.get("name", "")),
            email=str(claims.get("email") or claims.get("preferred_username") or ""),
            roles=frozenset(roles),
        )
