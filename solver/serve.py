import http.server
import hmac
import ipaddress
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

try:
    from .thumbnails import generate_missing_thumbnails
    from . import job_queue
except ImportError:
    from thumbnails import generate_missing_thumbnails
    import job_queue

# Azure App Service and Azure Container Apps provide the listening port through
# PORT.  CSN_PORT remains available for local overrides.
PORT = int(os.environ.get("PORT", os.environ.get("CSN_PORT", "8080")))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
COLLECTOR_PATH = os.path.join(DIRECTORY, "collector.py")
COLLECTOR_TOKEN = os.environ.get("CSN_COLLECTOR_TOKEN", "").strip()
REMOTE_WORKER = os.environ.get("CSN_REMOTE_WORKER", "0") == "1"

collector_lock = threading.Lock()
collector_state = {
    "running": False,
    "rounds": 0,
    "completed_rounds": 0,
    "message": "Сборщик готов к запуску.",
    "log": [],
    "returncode": None,
    "started_at": None,
    "finished_at": None,
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def public_collector_state():
    with collector_lock:
        state = dict(collector_state)
        state["log"] = list(collector_state["log"][-30:])
        return state


def collector_authorized(client_ip, headers, supplied_token, configured_token=None):
    if configured_token is None:
        configured_token = COLLECTOR_TOKEN
    if configured_token:
        return hmac.compare_digest(supplied_token, configured_token)
    try:
        direct_local = ipaddress.ip_address(client_ip).is_loopback
    except ValueError:
        return False
    # A reverse proxy connects from loopback, so its forwarded request is not local.
    return direct_local and not any(
        headers.get(name) for name in ("Forwarded", "X-Forwarded-For", "X-Real-IP")
    )


def run_collector(rounds):
    command = [sys.executable, "-u", COLLECTOR_PATH, "--rounds", str(rounds)]
    try:
        process = subprocess.Popen(
            command,
            cwd=os.path.dirname(DIRECTORY),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for raw_line in process.stdout:
            line = raw_line.rstrip()
            if not line:
                continue
            with collector_lock:
                collector_state["log"].append(line)
                collector_state["log"] = collector_state["log"][-100:]
                round_match = re.search(r"Раунд (\d+)(?:/\d+)? завершен", line)
                if round_match:
                    collector_state["completed_rounds"] = int(round_match.group(1))
                    collector_state["message"] = line
                elif "CSDD недоступен из этой сети" in line:
                    collector_state["message"] = (
                        "CSDD не отвечает с этого сервера. "
                        "Запустите сбор и синхронизацию с компьютера."
                    )
                elif "Ошибка раунда" in line:
                    collector_state["message"] = line

        returncode = process.wait()
        with collector_lock:
            collector_state["running"] = False
            collector_state["finished_at"] = utc_now()
            if returncode == 0 and collector_state["completed_rounds"] == rounds:
                collector_state["returncode"] = 0
                collector_state["message"] = (
                    f"Готово: обработано тестов {collector_state['completed_rounds']} из {rounds}."
                )
            elif returncode == 0:
                collector_state["returncode"] = 2
                collector_state["message"] = (
                    f"Завершено частично: обработано тестов {collector_state['completed_rounds']} из {rounds}."
                )
            else:
                collector_state["returncode"] = returncode
                if not any("CSDD недоступен из этой сети" in line for line in collector_state["log"]):
                    collector_state["message"] = f"Сборщик завершился с кодом {returncode}."
    except Exception as error:
        with collector_lock:
            collector_state["running"] = False
            collector_state["returncode"] = -1
            collector_state["finished_at"] = utc_now()
            collector_state["message"] = f"Не удалось запустить сборщик: {error}"
            collector_state["log"].append(collector_state["message"])


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def send_head(self):
        """Serve site assets, but never expose server code or hidden files."""
        root = Path(DIRECTORY).resolve()
        path = Path(self.translate_path(self.path)).resolve()
        if not path.is_relative_to(root):
            self.send_error(404)
            return None
        relative = path.relative_to(root)
        if (any(part.startswith(".") or part == "__pycache__" for part in relative.parts)
                or path.suffix.lower() in {".py", ".pyc", ".pyo"}):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing disabled")
        return None

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def can_use_collector(self):
        return collector_authorized(
            self.client_address[0],
            self.headers,
            self.headers.get("X-CSN-Collector-Token", ""),
        )

    def require_collector_access(self):
        if self.can_use_collector():
            return True
        self.send_json(
            {"error": "Неверный ключ доступа." if COLLECTOR_TOKEN else "Сбор доступен только локально."},
            401 if COLLECTOR_TOKEN else 403,
        )
        return False

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if route == "/api/collector/access":
            self.send_json({
                "available": bool(COLLECTOR_TOKEN) or self.can_use_collector(),
                "requires_token": bool(COLLECTOR_TOKEN),
                "worker_mode": REMOTE_WORKER,
            })
            return
        if route == "/api/collector/status":
            if not self.require_collector_access():
                return
            self.send_json(job_queue.snapshot() if REMOTE_WORKER else public_collector_state())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/collector/start":
            self.send_json({"error": "Маршрут не найден."}, 404)
            return
        if not self.require_collector_access():
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= content_length <= 4096:
                raise ValueError("Недопустимый размер запроса")
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            rounds = int(payload.get("rounds", 1))
            if not 1 <= rounds <= 50:
                raise ValueError("Количество тестов должно быть от 1 до 50")
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, 400)
            return

        if REMOTE_WORKER:
            try:
                self.send_json(job_queue.enqueue(rounds), 202)
            except ValueError as error:
                self.send_json({"error": str(error)}, 409)
            except RuntimeError as error:
                self.send_json({"error": str(error)}, 503)
            return

        with collector_lock:
            if collector_state["running"]:
                self.send_json({"error": "Сбор уже выполняется."}, 409)
                return
            collector_state.update(
                {
                    "running": True,
                    "rounds": rounds,
                    "completed_rounds": 0,
                    "message": f"Запущен сбор: {rounds} тест(ов).",
                    "log": [],
                    "returncode": None,
                    "started_at": utc_now(),
                    "finished_at": None,
                }
            )

        threading.Thread(target=run_collector, args=(rounds,), daemon=True).start()
        self.send_json(public_collector_state(), 202)


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def get_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def main():
    generate_missing_thumbnails()
    local_ip = get_local_ip()
    with ThreadingServer(("", PORT), Handler) as httpd:
        print("=" * 60)
        print("  CSDD EXAM TEST SOLVER ЗАПУЩЕН!")
        print(f"  • На этом компьютере:  http://localhost:{PORT}")
        print("  • На планшете / телефоне в той же сети Wi-Fi:")
        print(f"                         http://{local_ip}:{PORT}")
        print("=" * 60)
        print("Для остановки нажмите Ctrl + C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")


if __name__ == "__main__":
    main()
