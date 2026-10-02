#!/usr/bin/env python3
"""Serve the local bakery-cell viewer on loopback only."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HERE = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8766


class ViewerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), ViewerHandler)
    print(f"Coffee bar viewer: http://{HOST}:{PORT}/viewer.html")
    print("Serving this folder read-only. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping viewer server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
