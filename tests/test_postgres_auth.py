"""Integration checks against a disposable PostgreSQL database (DATABASE_URL)."""
import http.cookiejar
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from unittest.mock import patch

from solver import api, serve
from solver.auth import AuthError
from solver.local_auth import LocalAuth
from solver.postgres_store import PostgresEngine, progress_store
from solver.quests import QuestService, ServiceError, load_question_bank, load_quests


class LocalAuthThrottleTests(unittest.TestCase):
    def test_registration_attempts_are_limited_even_when_payloads_are_invalid(self):
        auth = LocalAuth.__new__(LocalAuth)
        auth._lock = threading.Lock()
        auth._failures = {}
        for _ in range(11):
            with self.assertRaises(AuthError) as raised:
                auth.register(None, None, None, "203.0.113.8")
            self.assertEqual(raised.exception.code, "bad_account")
        with self.assertRaises(AuthError) as raised:
            auth.register(None, None, None, "203.0.113.8")
        self.assertEqual(raised.exception.status, 429)


@unittest.skipUnless(os.environ.get("DATABASE_URL"), "set DATABASE_URL for PostgreSQL integration tests")
class PostgresAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = PostgresEngine(os.environ["DATABASE_URL"])
        cls.store = progress_store(cls.engine)
        cls.local_auth = LocalAuth(cls.engine)
        cls.service = QuestService(cls.store, load_question_bank(), load_quests())

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def setUp(self):
        self.mode = patch.dict(os.environ, {"AUTH_MODE": "local", "PROGRESS_BACKEND": "postgres",
                                         "CSN_COOKIE_SECURE": "0"})
        self.mode.start()
        api.configure(store=self.store, service=self.service, engine=self.engine,
                      local_auth=self.local_auth)
        self.server = serve.ThreadingServer(("127.0.0.1", 0), serve.Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        self.server.shutdown()
        self.worker.join()
        self.server.server_close()
        api.reset()
        self.mode.stop()

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, client, method, path, body=None, csrf=True, extra_headers=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        if csrf and method == "POST":
            headers["X-CSN-Request"] = "1"
        headers.update(extra_headers or {})
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with client.open(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_accounts_sessions_private_progress_and_admin(self):
        alice, bob = self.client(), self.client()
        suffix = uuid.uuid4().hex
        status, a = self.call(alice, "POST", "/api/auth/register", {
            "name": "Alice", "email": f"alice-{suffix}@example.com", "password": "long test password A"})
        self.assertEqual(status, 201)
        status, b = self.call(bob, "POST", "/api/auth/register", {
            "name": "Bob", "email": f"bob-{suffix}@example.com", "password": "long test password B"})
        self.assertEqual(status, 201)
        self.assertNotEqual(a["oid"], b["oid"])
        self.assertEqual(self.call(alice, "GET", "/api/auth/session")[1]["oid"], a["oid"])
        self.assertEqual(self.call(bob, "GET", "/api/admin/users")[0], 403)
        self.assertEqual(self.call(self.client(), "GET", "/api/collector/access")[0], 401)
        self.assertEqual(self.call(bob, "GET", "/api/collector/access",
                                   extra_headers={"X-CSN-Collector-Token": "legacy-token"})[0], 403)
        self.assertEqual(self.call(bob, "GET", "/api/collector/status")[0], 403)
        self.assertEqual(self.call(bob, "POST", "/api/collector/start", {"rounds": 1})[0], 403)
        self.assertEqual(self.call(alice, "POST", "/api/attempts", {"size": 30}, csrf=False)[0], 403)

        status, attempt = self.call(alice, "POST", "/api/attempts", {"size": 30})
        self.assertEqual(status, 201)
        self.assertEqual(attempt["size"], 30)
        self.assertNotIn("correct", attempt["question"])
        self.assertEqual(self.call(bob, "GET", f"/api/attempts/{attempt['attempt_id']}")[0], 404)
        self.assertEqual(self.call(alice, "GET", "/api/attempts")[1]["items"][0]["attempt_id"],
                         attempt["attempt_id"])

        self.local_auth.promote(a["oid"])
        self.assertEqual(self.call(alice, "GET", "/api/collector/access")[1]["available"], True)
        self.assertEqual(self.call(alice, "GET", "/api/collector/status")[0], 200)
        self.assertEqual(self.call(alice, "POST", "/api/collector/start", {"rounds": 1}, csrf=False)[0], 403)
        self.assertEqual(self.call(alice, "POST", "/api/collector/start", {"rounds": 0})[0], 400)
        status, users = self.call(alice, "GET", "/api/admin/users")
        self.assertEqual(status, 200)
        self.assertTrue(any(u["oid"] == b["oid"] and u["is_admin"] is False
                            for u in users["users"]))
        self.assertEqual(self.call(alice, "GET", f"/api/admin/users/{b['oid']}/progress")[0], 200)

        self.assertEqual(self.call(alice, "POST", "/api/auth/logout")[0], 200)
        self.assertEqual(self.call(alice, "GET", "/api/auth/session")[0], 401)
        status, logged_in = self.call(alice, "POST", "/api/auth/login", {
            "email": f"alice-{suffix}@example.com", "password": "long test password A"})
        self.assertEqual(status, 200)
        self.assertTrue(logged_in["is_admin"])
        self.assertEqual(logged_in["oid"], a["oid"])

    def test_admin_can_delegate_and_revoke_without_client_side_trust(self):
        alice, bob = self.client(), self.client()
        suffix = uuid.uuid4().hex
        _, a = self.call(alice, "POST", "/api/auth/register", {
            "name": "Role owner", "email": f"owner-{suffix}@example.com", "password": "long test password A"})
        _, b = self.call(bob, "POST", "/api/auth/register", {
            "name": "Role recipient", "email": f"recipient-{suffix}@example.com", "password": "long test password B"})
        role_url = f"/api/admin/users/{b['oid']}/role"
        self.assertEqual(self.call(bob, "POST", role_url, {"is_admin": True})[0], 403)
        self.local_auth.promote(a["oid"])
        self.assertEqual(self.call(alice, "POST", role_url, {"is_admin": True}, csrf=False)[0], 403)
        self.assertEqual(self.call(alice, "POST", role_url, {"is_admin": "true"})[0], 400)
        self.assertEqual(self.call(alice, "POST", role_url, {"is_admin": True, "email": "x"})[0], 400)
        self.assertEqual(self.call(alice, "POST", f"/api/admin/users/{'a' * 36}/role",
                                   {"is_admin": True})[0], 400)
        self.assertEqual(self.call(alice, "POST", f"/api/admin/users/{uuid.uuid4()}/role",
                                   {"is_admin": True})[0], 404)
        status, changed = self.call(alice, "POST", role_url, {"is_admin": True})
        self.assertEqual((status, changed["oid"], changed["is_admin"]), (200, b["oid"], True))
        self.assertEqual(self.call(bob, "GET", "/api/admin/users")[0], 200)
        self.assertEqual(self.call(bob, "POST", f"/api/admin/users/{a['oid']}/role",
                                   {"is_admin": False})[0], 200)
        self.assertEqual(self.call(alice, "GET", "/api/admin/users")[0], 403)
        self.assertEqual(self.call(bob, "POST", f"/api/admin/users/{b['oid']}/role",
                                   {"is_admin": False})[1]["error"], "self_demote")
        self.assertEqual(self.call(bob, "GET", "/api/admin/users")[0], 200)
        self.assertEqual(self.call(bob, "POST", f"/api/admin/users/{a['oid']}/role",
                                   {"is_admin": True})[0], 200)
        self.assertEqual(self.call(alice, "GET", "/api/admin/users")[0], 200)

    def test_bad_password_and_duplicate_email(self):
        client = self.client()
        email = f"duplicate-{uuid.uuid4().hex}@example.com"
        self.assertEqual(self.call(client, "POST", "/api/auth/register", {
            "email": email, "name": "One", "password": "short"})[0], 400)
        self.assertEqual(self.call(client, "POST", "/api/auth/register", {
            "email": email, "name": "One", "password": "long test password"})[0], 201)
        self.assertEqual(self.call(self.client(), "POST", "/api/auth/register", {
            "email": email.upper(), "name": "Two", "password": "long test password"})[0], 409)
        self.assertEqual(self.call(self.client(), "POST", "/api/auth/login", {
            "email": email, "password": "wrong password"})[0], 401)

    def test_postgres_grading_and_single_quest_reward(self):
        oid = str(uuid.uuid4())
        self.store.upsert_user(oid, "", "Progress Test")
        state = self.service.start_attempt(oid, 30)
        attempt_id = state["attempt_id"]
        stale = self.store.get_attempt(oid, attempt_id)
        for index in range(30):
            question = self.service.bank.by_id[state["question"]["id"]]
            option = question.correct if index < 24 else next(
                item["id"] for item in question.options if item["id"] != question.correct)
            state = self.service.answer_attempt(oid, attempt_id, question.id, option)
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["result"]["correct"], 24)
        self.assertEqual(self.service.overview(oid)["total_points"], 30)
        self.assertEqual(self.service.get_attempt(oid, attempt_id)["result"]["correct"], 24)
        self.assertEqual(len(self.store.list_user_quests(oid)), 1)
        self.assertTrue(any(item["oid"] == oid and item["score"] == 30
                            for item in self.store.leaderboard(200)))
        with self.assertRaises(ServiceError) as context:
            self.store.advance_attempt(oid, stale, None, 1, stale["question_started_at"])
        self.assertEqual(context.exception.status, 409)


if __name__ == "__main__":
    unittest.main()
