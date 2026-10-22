"""Temporary PostgreSQL-backed accounts and opaque browser sessions.

Emails are login names, not verified addresses. They must never be used alone
to link a future Entra identity or grant an administrator role.
"""
import hashlib
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from psycopg.errors import UniqueViolation

try:
    from .auth import AuthError, Principal, ROLE_ADMIN, ROLE_USER
except ImportError:
    from auth import AuthError, Principal, ROLE_ADMIN, ROLE_USER

COOKIE_NAME = "csn_session"
SESSION_DAYS = 7
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def session_token(cookie_header):
    try:
        jar = SimpleCookie()
        jar.load(cookie_header or "")
        token = jar[COOKIE_NAME].value
        return token if re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token) else ""
    except (KeyError, ValueError):
        return ""


def cookie_header(token, secure=True):
    parts = [f"{COOKIE_NAME}={token}", "HttpOnly", "SameSite=Lax", "Path=/",
             f"Max-Age={SESSION_DAYS * 86400 if token else 0}"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


class LocalAuth:
    def __init__(self, engine):
        self.engine = engine
        self.hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
        self._lock = threading.Lock()
        self._failures = {}
        with engine.pool.connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS local_accounts (
                    id uuid PRIMARY KEY,
                    email text NOT NULL UNIQUE,
                    name text NOT NULL,
                    password_hash text NOT NULL,
                    is_admin boolean NOT NULL DEFAULT false,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS local_sessions (
                    token_hash text PRIMARY KEY,
                    user_id uuid NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
                    expires_at timestamptz NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS local_sessions_expiry ON local_sessions (expires_at)")

    @staticmethod
    def _view(row):
        oid, email, name, is_admin = row
        roles = frozenset({ROLE_USER, ROLE_ADMIN} if is_admin else {ROLE_USER})
        return Principal(str(oid), name, email, roles)

    @staticmethod
    def _new_session(conn, user_id):
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
        conn.execute("INSERT INTO local_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                     (digest, user_id, expires))
        return token

    def _throttle(self, key, failed=False):
        now = time.monotonic()
        with self._lock:
            start, count = self._failures.get(key, (now, 0))
            if now - start > 900:
                start, count = now, 0
            if failed:
                count += 1
            self._failures[key] = (start, count)
            if count >= 12:
                raise AuthError(429, "too_many_attempts")

    def register(self, email, name, password, client_ip=""):
        self._throttle("register:" + client_ip)
        if not isinstance(email, str) or not isinstance(name, str) or not isinstance(password, str):
            raise AuthError(400, "bad_account")
        email = email.strip().casefold()
        name = name.strip()
        if (len(email) > 254 or not EMAIL_RE.fullmatch(email) or not 1 <= len(name) <= 80 or
                not 12 <= len(password) <= 128):
            raise AuthError(400, "bad_account")
        user_id = uuid.uuid4()
        password_hash = self.hasher.hash(password)
        try:
            with self.engine.pool.connection() as conn:
                conn.execute("""
                    INSERT INTO local_accounts (id, email, name, password_hash)
                    VALUES (%s, %s, %s, %s)
                """, (user_id, email, name, password_hash))
                token = self._new_session(conn, user_id)
        except UniqueViolation:
            self._throttle("register:" + client_ip, failed=True)
            raise AuthError(409, "account_exists")
        return Principal(str(user_id), name, email, frozenset({ROLE_USER})), token

    def login(self, email, password, client_ip=""):
        key = "login:" + client_ip
        self._throttle(key)
        if not isinstance(email, str) or not isinstance(password, str):
            raise AuthError(401, "invalid_credentials")
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                SELECT id, email, name, is_admin, password_hash
                FROM local_accounts WHERE email = %s
            """, (email.strip().casefold(),)).fetchone()
        try:
            valid = row is not None and self.hasher.verify(row[4], password)
        except VerificationError:
            valid = False
        if not valid:
            self._throttle(key, failed=True)
            raise AuthError(401, "invalid_credentials")
        with self.engine.pool.connection() as conn:
            token = self._new_session(conn, row[0])
        with self._lock:
            self._failures.pop(key, None)
        return self._view(row[:4]), token

    def principal(self, token):
        if not token:
            raise AuthError(401, "unauthorized")
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                SELECT a.id, a.email, a.name, a.is_admin
                FROM local_sessions s JOIN local_accounts a ON a.id = s.user_id
                WHERE s.token_hash = %s AND s.expires_at > now()
            """, (digest,)).fetchone()
        if row is None:
            raise AuthError(401, "unauthorized")
        return self._view(row)

    def logout(self, token):
        if token:
            digest = hashlib.sha256(token.encode()).hexdigest()
            with self.engine.pool.connection() as conn:
                conn.execute("DELETE FROM local_sessions WHERE token_hash = %s", (digest,))

    def promote(self, user_id):
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                UPDATE local_accounts SET is_admin = true WHERE id = %s
                RETURNING email
            """, (user_id,)).fetchone()
        if row is None:
            raise ValueError("account not found")
        return row[0]

    def admin_flags(self):
        """Return roles for local accounts, keyed by their stable user UUID."""
        with self.engine.pool.connection() as conn:
            rows = conn.execute("SELECT id, is_admin FROM local_accounts").fetchall()
        return {str(user_id): is_admin for user_id, is_admin in rows}

    def set_admin(self, actor_id, target_id, enabled):
        """Change a local role under one lock so concurrent requests keep an admin."""
        if type(enabled) is not bool:
            raise AuthError(400, "bad_request")
        try:
            actor_id, target_id = uuid.UUID(str(actor_id)), uuid.UUID(str(target_id))
        except ValueError:
            raise AuthError(400, "bad_request")
        with self.engine.pool.connection() as conn:
            # Serialize role changes, including checks for the last administrator.
            conn.execute("SELECT pg_advisory_xact_lock(609281724193)")
            actor = conn.execute(
                "SELECT is_admin FROM local_accounts WHERE id = %s", (actor_id,)
            ).fetchone()
            if actor is None or not actor[0]:
                raise AuthError(403, "forbidden")
            target = conn.execute(
                "SELECT email, is_admin FROM local_accounts WHERE id = %s", (target_id,)
            ).fetchone()
            if target is None:
                raise AuthError(404, "not_found")
            if not enabled and actor_id == target_id:
                raise AuthError(409, "self_demote")
            if not enabled and target[1]:
                count = conn.execute(
                    "SELECT count(*) FROM local_accounts WHERE is_admin = true"
                ).fetchone()[0]
                if count <= 1:
                    raise AuthError(409, "last_admin")
            if target[1] != enabled:
                conn.execute(
                    "UPDATE local_accounts SET is_admin = %s WHERE id = %s",
                    (enabled, target_id),
                )
        return {"oid": str(target_id), "email": target[0], "is_admin": enabled}


if __name__ == "__main__":
    import argparse
    try:
        from .postgres_store import PostgresEngine
    except ImportError:
        from postgres_store import PostgresEngine

    parser = argparse.ArgumentParser(description="Server-only account administration")
    parser.add_argument("action", choices=["promote"])
    parser.add_argument("user_id", type=uuid.UUID)
    args = parser.parse_args()
    engine = PostgresEngine(os.environ.get("DATABASE_URL", ""))
    try:
        auth = LocalAuth(engine)
        if args.action == "promote":
            print(f"Admin role assigned to {auth.promote(args.user_id)}")
    finally:
        engine.close()
