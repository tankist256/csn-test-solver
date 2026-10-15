import http.server
import os
import socket
import socketserver

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    local_ip = get_local_ip()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("=" * 60)
        print("  CSDD EXAM TEST SOLVER ЗАПУЩЕН!")
        print(f"  • На этом компьютере:  http://localhost:{PORT}")
        print(f"  • На планшете / телефоне в той же сети Wi-Fi:")
        print(f"                         http://{local_ip}:{PORT}")
        print("=" * 60)
        print("Для остановки нажмите Ctrl + C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")


if __name__ == "__main__":
    main()
