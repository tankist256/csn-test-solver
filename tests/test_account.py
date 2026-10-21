import io
import json
import time
import threading
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from solver import api
from solver import serve
from solver.auth import AuthConfig, AuthError, Principal, TokenVerifier
from solver.progress_store import TableStore
from solver.quests import QuestService, ServiceError, load_question_bank, load_quests

USER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
ISSUER = "https://tenant.ciamlogin.com/tenant/v2.0"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def config():
    return AuthConfig(True, "tenant", "tenant", ("api-client",), "spa-client",
                      "api://api-client/access_as_user", "access_as_user", True,
                      "https://tenant.ciamlogin.com/tenant/v2.0/.well-known/openid-configuration")


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 22, tzinfo=timezone.utc)
        self.store = TableStore.in_memory()
        self.store.upsert_user(USER, "one@example.com", "One")
        self.bank = load_question_bank()
        self.service = QuestService(self.store, self.bank, load_quests(), lambda: self.now)

    def answer_current(self, oid, attempt_id, correct=True):
        state = self.service.get_attempt(oid, attempt_id)
        question = self.bank.by_id[state["question"]["id"]]
        option = question.correct if correct else next(
            o["id"] for o in question.options if o["id"] != question.correct)
        return self.service.answer_attempt(oid, attempt_id, question.id, option)

    def test_real_question_bank_and_supported_sizes(self):
        self.assertGreaterEqual(len(self.bank.by_id), 120)
        for size in (30, 60, 120):
            state = self.service.start_attempt(USER, size)
            self.assertEqual(state["size"], size)
            self.assertNotIn("correct_id", state["question"])
            self.assertEqual(state["number"], 1)
        for size in (1, 50, "30", True):
            with self.assertRaises(ServiceError):
                self.service.start_attempt(USER, size)

    def test_server_timer_skips_late_answers(self):
        state = self.service.start_attempt(USER, 30)
        first = state["question"]["id"]
        self.now += timedelta(seconds=61)
        state = self.service.get_attempt(USER, state["attempt_id"])
        self.assertEqual(state["number"], 2)
        with self.assertRaises(ServiceError) as context:
            self.service.answer_attempt(USER, state["attempt_id"], first, self.bank.by_id[first].correct)
        self.assertEqual(context.exception.status, 409)
        self.now += timedelta(seconds=29 * 60)
        finished = self.service.get_attempt(USER, state["attempt_id"])
        self.assertEqual(finished["result"]["correct"], 0)
        self.assertEqual(finished["result"]["total"], 30)

    def test_grade_reward_idempotence_and_private_results(self):
        state = self.service.start_attempt(USER, 30)
        attempt_id = state["attempt_id"]
        with self.assertRaises(ServiceError):
            self.service.get_attempt(OTHER, attempt_id)
        for _ in range(24):
            state = self.answer_current(USER, attempt_id)
        for _ in range(6):
            state = self.answer_current(USER, attempt_id, False)
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["result"]["correct"], 24)
        self.assertEqual(self.service.overview(USER)["total_points"], 30)
        self.assertEqual(self.service.overview(USER)["correct_unique"], 24)
        self.assertEqual(self.service.get_attempt(USER, attempt_id)["result"]["correct"], 24)
        self.assertEqual(self.service.overview(USER)["total_points"], 30)
        self.assertEqual(self.store.leaderboard()[0]["oid"], USER)
        self.assertNotIn("email", self.store.leaderboard()[0])
        self.assertEqual(len(self.store.list_results(USER)), 1)

    def test_bad_options_and_answers_cannot_set_score(self):
        state = self.service.start_attempt(USER, 30)
        stale = self.store.get_attempt(USER, state["attempt_id"])
        with self.assertRaises(ServiceError):
            self.service.answer_attempt(USER, state["attempt_id"], state["question"]["id"], "fake")
        self.assertEqual(self.service.get_attempt(USER, state["attempt_id"])["number"], 1)
        self.answer_current(USER, state["attempt_id"])
        with self.assertRaises(ServiceError) as context:
            self.store.advance_attempt(USER, stale, None, 1, self.now.isoformat())
        self.assertEqual(context.exception.status, 409)

    def test_token_validation_and_admin_role(self):
        verifier = TokenVerifier(config(), fetch_json=lambda _: {
            "issuer": ISSUER, "jwks_uri": "https://example.com/jwks"},
            key_resolver=lambda _: KEY.public_key())
        claims = {"iss": ISSUER, "aud": "api-client", "oid": USER, "scp": "access_as_user",
                  "exp": int(time.time()) + 300, "roles": ["Admin"]}
        token = jwt.encode(claims, KEY, algorithm="RS256")
        self.assertTrue(verifier.verify(token).is_admin)
        for change in ({"aud": "spa-client"}, {"scp": "wrong"}, {"oid": "bad"}):
            with self.subTest(change=change), self.assertRaises(AuthError):
                verifier.verify(jwt.encode({**claims, **change}, KEY, algorithm="RS256"))

    def test_api_admin_boundary(self):
        class Handler:
            path = "/api/admin/users"
            headers = {"Authorization": "Bearer test"}
            rfile = io.BytesIO()
            sent = None

            def send_json(self, payload, status=200):
                self.sent = (status, payload)

        handler = Handler()
        api.configure(config(), SimpleNamespace(verify=lambda _: Principal(
            USER, "One", "one@example.com", frozenset({"User"}))),
            self.store, self.service)
        self.addCleanup(api.reset)
        self.assertTrue(api.handle(handler, "GET", handler.path))
        self.assertEqual(handler.sent[0], 403)
        api.configure(config(), SimpleNamespace(verify=lambda _: Principal(
            USER, "One", "one@example.com", frozenset({"Admin"}))),
            self.store, self.service)
        handler.sent = None
        self.assertTrue(api.handle(handler, "GET", handler.path))
        self.assertEqual(handler.sent[0], 200)

    def test_http_server_keeps_existing_page_and_exposes_config(self):
        disabled = config()
        disabled = AuthConfig(False, disabled.tenant_id, disabled.tenant_subdomain,
                              disabled.audiences, disabled.spa_client_id, disabled.api_scope,
                              disabled.required_scope, disabled.default_user_role,
                              disabled.openid_config_url)
        api.configure(disabled, None, self.store, self.service)
        self.addCleanup(api.reset)
        with serve.ThreadingServer(("127.0.0.1", 0), serve.Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                base = f"http://127.0.0.1:{server.server_address[1]}"
                with urllib.request.urlopen(base + "/api/config") as response:
                    self.assertEqual(json.load(response), {"auth_enabled": False})
                with urllib.request.urlopen(base + "/index.html") as response:
                    self.assertIn(b"CSDD", response.read())
                api.configure(config(), SimpleNamespace(verify=lambda _: Principal(
                    USER, "One", "one@example.com", frozenset({"User"}))),
                    self.store, self.service)
                request = urllib.request.Request(base + "/api/me",
                                                 headers={"Authorization": "Bearer test"})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["oid"], USER)
            finally:
                server.shutdown()
                worker.join()


if __name__ == "__main__":
    unittest.main()
