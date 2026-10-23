import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import mock_open, patch

from solver import api, serve
from solver.auth import AuthError


class ServeTest(unittest.TestCase):
    def test_detects_docker_host_gateway(self):
        route = "Iface Destination Gateway Flags\neth0 00000000 010012AC 0003\n"
        api._docker_gateway.cache_clear()
        try:
            with patch.object(api.os.path, "exists", return_value=True), \
                    patch("builtins.open", mock_open(read_data=route)):
                self.assertEqual(api._docker_gateway(), "172.18.0.1")
        finally:
            api._docker_gateway.cache_clear()

    def test_proxy_client_ip_is_used_only_for_local_peer(self):
        handler = SimpleNamespace(client_address=("127.0.0.1", 1234),
                                  headers={"X-Real-IP": "203.0.113.8"})
        self.assertEqual(api._client_ip(handler), "203.0.113.8")
        handler.headers["X-Real-IP"] = "not-an-ip"
        self.assertEqual(api._client_ip(handler), "127.0.0.1")
        with patch.object(api, "_docker_gateway", return_value="172.18.0.1"):
            handler.client_address = ("172.18.0.1", 1234)
            handler.headers["X-Real-IP"] = "203.0.113.8"
            self.assertEqual(api._client_ip(handler), "203.0.113.8")
        handler.client_address = ("198.51.100.9", 1234)
        handler.headers["X-Real-IP"] = "203.0.113.8"
        self.assertEqual(api._client_ip(handler), "198.51.100.9")

    def test_collector_is_closed_when_login_is_disabled(self):
        handler = serve.Handler.__new__(serve.Handler)
        handler.headers = {"X-CSN-Collector-Token": "legacy-token"}
        with patch.dict(os.environ, {"AUTH_MODE": "off"}):
            with self.assertRaises(AuthError) as raised:
                api.require_admin(handler, "POST")
        self.assertEqual(raised.exception.status, 401)

    def test_serves_built_page_and_assets_from_the_configured_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            build = Path(directory)
            (build / "index.html").write_text("<main>React</main>")
            (build / "assets").mkdir()
            (build / "assets" / "app.js").write_text("void 0;")
            handler = serve.Handler.__new__(serve.Handler)
            handler.directory = serve.DIRECTORY
            build_root = build.resolve()

            with patch.object(serve, "BUILD_DIRECTORY", directory):
                self.assertEqual(handler.translate_path("/"), str(build_root / "index.html"))
                self.assertEqual(handler.translate_path("/answers"), str(build_root / "index.html"))
                self.assertEqual(handler.translate_path("/tests"), str(build_root / "index.html"))
                self.assertEqual(handler.translate_path("/assets/app.js"), str(build_root / "assets" / "app.js"))

    def test_reports_invalid_json_in_latvian(self):
        handler = serve.Handler.__new__(serve.Handler)
        handler.path = "/api/collector/start"
        handler.headers = {"Content-Length": "1"}
        handler.rfile = io.BytesIO(b"{")
        responses = []
        handler.require_collector_access = lambda method="GET": True
        handler.send_json = lambda payload, status=200: responses.append((payload, status))

        handler.do_POST()

        self.assertEqual(responses, [({"error": "Pieprasījuma dati nav derīgi."}, 400)])


if __name__ == "__main__":
    unittest.main()
