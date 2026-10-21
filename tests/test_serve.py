import io
import unittest

from solver import serve


class ServeTest(unittest.TestCase):
    def test_reports_invalid_json_in_latvian(self):
        handler = serve.Handler.__new__(serve.Handler)
        handler.path = "/api/collector/start"
        handler.headers = {"Content-Length": "1"}
        handler.rfile = io.BytesIO(b"{")
        responses = []
        handler.require_collector_access = lambda: True
        handler.send_json = lambda payload, status=200: responses.append((payload, status))

        handler.do_POST()

        self.assertEqual(responses, [({"error": "Pieprasījuma dati nav derīgi."}, 400)])


if __name__ == "__main__":
    unittest.main()
