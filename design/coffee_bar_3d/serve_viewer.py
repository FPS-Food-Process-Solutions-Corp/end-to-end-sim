#!/usr/bin/env python3
"""Serve Layout Studio, on loopback by default."""

import argparse
import socket
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=HOST, help=f"Bind address (default: {HOST}); use 0.0.0.0 for LAN access")
    parser.add_argument("--port", type=int, default=PORT, help=f"Listen port (default: {PORT}); 0 selects an available port")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")

    class ViewerServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6 if ":" in args.host else socket.AF_INET

    try:
        server = ViewerServer((args.host, args.port), ViewerHandler)
    except OSError as error:
        parser.exit(2, f"Cannot listen on {args.host}:{args.port}: {error}\n")
    port = server.server_port
    url_host = {"0.0.0.0": "127.0.0.1", "::": "::1"}.get(args.host, args.host)
    if ":" in url_host:
        url_host = f"[{url_host}]"
    print(f"Coffee bar viewer: http://{url_host}:{port}/viewer.html", flush=True)
    if args.host in {"0.0.0.0", "::"}:
        print(f"Listening on all interfaces. Other computers: http://<server-ip>:{port}/viewer.html", flush=True)
    print("Serving this folder read-only. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping viewer server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
