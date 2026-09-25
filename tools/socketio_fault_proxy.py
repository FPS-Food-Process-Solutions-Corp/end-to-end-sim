"""Transparent local WebSocket proxy with bounded Socket.IO fault controls."""

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Optional


MAX_HTTP_HEADER_BYTES = 65536
TERMINAL_EVENTS = {"hr.pick_task_completed", "hr.pick_task_failed"}
TERMINAL_RESPONSE_EVENTS = {"platform.pick_session_updated", "platform.pick_session_completed"}


@dataclass(frozen=True)
class WebSocketFrame:
    """One decoded WebSocket frame and its original wire representation."""

    raw: bytes
    fin: bool
    opcode: int
    payload: bytes


def parse_arguments() -> argparse.Namespace:
    """Read loopback-only proxy settings and explicit file controls."""
    parser = argparse.ArgumentParser(description="Proxy one real Socket.IO WebSocket connection with explicit local fault controls.")
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--upstream-host", default="127.0.0.1")
    parser.add_argument("--upstream-port", type=int, required=True)
    parser.add_argument("--control-path", type=Path, required=True)
    parser.add_argument("--events-path", type=Path, required=True)
    arguments = parser.parse_args()
    if not 1 <= arguments.listen_port <= 65535 or not 1 <= arguments.upstream_port <= 65535:
        parser.error("ports must be from 1 through 65535")
    if arguments.listen_host not in {"127.0.0.1", "::1"} or arguments.upstream_host not in {"127.0.0.1", "::1"}:
        parser.error("only loopback listen and upstream hosts are permitted")
    return arguments


async def read_http_headers(reader: asyncio.StreamReader) -> bytes:
    """Read one bounded HTTP request or response header block."""
    return await reader.readuntil(b"\r\n\r\n")


async def read_frame(reader: asyncio.StreamReader) -> WebSocketFrame:
    """Read a complete WebSocket frame while retaining its original bytes."""
    prefix = await reader.readexactly(2)
    first, second = prefix[0], prefix[1]
    fin = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    payload_length = second & 0x7F
    extended = b""
    if payload_length == 126:
        extended = await reader.readexactly(2)
        payload_length = int.from_bytes(extended, "big")
    elif payload_length == 127:
        extended = await reader.readexactly(8)
        payload_length = int.from_bytes(extended, "big")
    if payload_length > MAX_HTTP_HEADER_BYTES:
        raise RuntimeError("WebSocket frame exceeds bounded proxy payload limit")
    mask = await reader.readexactly(4) if masked else b""
    wire_payload = await reader.readexactly(payload_length)
    if masked:
        payload = bytes(value ^ mask[index % 4] for index, value in enumerate(wire_payload))
    else:
        payload = wire_payload
    return WebSocketFrame(prefix + extended + mask + wire_payload, fin, opcode, payload)


def socket_event_name(frame: WebSocketFrame) -> Optional[str]:
    """Return a Socket.IO event name for a complete text event frame."""
    if not frame.fin or frame.opcode != 1:
        return None
    try:
        payload = frame.payload.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not payload.startswith("42"):
        return None
    bracket = payload.find("[")
    if bracket < 0:
        return None
    try:
        event_payload = json.loads(payload[bracket:])
    except json.JSONDecodeError:
        return None
    if isinstance(event_payload, list) and event_payload and isinstance(event_payload[0], str):
        return event_payload[0]
    return None


def socket_packet_kind(frame: WebSocketFrame) -> str:
    """Classify framed traffic without saving payloads that may contain data."""
    if frame.opcode == 8:
        return "close"
    if frame.opcode == 9:
        return "ping"
    if frame.opcode == 10:
        return "pong"
    if frame.opcode != 1:
        return "binary_or_continuation"
    try:
        payload = frame.payload.decode("utf-8")
    except UnicodeDecodeError:
        return "text_non_utf8"
    if payload.startswith("43"):
        return "socketio_ack"
    if payload.startswith("42"):
        return "socketio_event"
    return "text"


def should_withhold_terminal_response(mode: str, terminal_report_seen: bool, direction: str, packet_kind: str) -> bool:
    """Withhold only Socket.IO application responses while preserving Engine.IO liveness."""
    return direction == "server_to_bridge" and mode == "hold_after_terminal" and terminal_report_seen and packet_kind in {"socketio_event", "socketio_ack"}


class SocketIoFaultProxy:
    """Forward real Socket.IO frames and consume sequenced local fault controls."""

    def __init__(self, listen_host: str, listen_port: int, upstream_host: str, upstream_port: int, control_path: Path, events_path: Path) -> None:
        self._listen_host = listen_host
        self._listen_port = listen_port
        self._upstream_host = upstream_host
        self._upstream_port = upstream_port
        self._control_path = control_path
        self._events_path = events_path
        self._server: Optional[asyncio.AbstractServer] = None
        self._last_control_sequence = -1
        self._mode = "pass"
        self._close_event = asyncio.Event()
        self._terminal_report_seen = False
        self._terminal_response_seen = False

    def record(self, event: str, **fields: object) -> None:
        """Append compact evidence without storing Socket.IO payload bodies."""
        self._events_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"timestamp": round(time(), 6), "event": event}
        entry.update(fields)
        with self._events_path.open("a", encoding="ascii") as stream:
            stream.write(json.dumps(entry, sort_keys=True, separators=(",", ":")) + "\n")

    def consume_control(self) -> None:
        """Apply a sequenced JSON command once so reconnect can use pass mode."""
        try:
            payload = json.loads(self._control_path.read_text(encoding="ascii"))
        except FileNotFoundError:
            return
        except json.JSONDecodeError as exc:
            raise RuntimeError("invalid proxy control JSON: %s" % exc) from exc
        if not isinstance(payload, dict):
            raise RuntimeError("proxy control must be a JSON object")
        sequence = payload.get("sequence")
        mode = payload.get("mode")
        action = payload.get("action")
        if not isinstance(sequence, int) or sequence <= self._last_control_sequence:
            return
        if mode is not None and mode not in {"pass", "hold_after_terminal"}:
            raise RuntimeError("unsupported proxy mode: %r" % mode)
        if action is not None and action != "close_active_connection":
            raise RuntimeError("unsupported proxy action: %r" % action)
        self._last_control_sequence = sequence
        if mode is not None:
            self._mode = mode
            self._terminal_report_seen = False
            self._terminal_response_seen = False
        if action == "close_active_connection":
            self._close_event.set()
        self.record("control_applied", sequence=sequence, mode=self._mode, action=action)

    async def watch_control(self) -> None:
        """Poll the explicit local control file while a connection is open."""
        while not self._close_event.is_set():
            self.consume_control()
            await asyncio.sleep(0.02)

    async def forward(self, source: asyncio.StreamReader, target: asyncio.StreamWriter, direction: str) -> None:
        """Forward frames, withholding only server responses after a real terminal report."""
        while not self._close_event.is_set():
            frame = await read_frame(source)
            event_name = socket_event_name(frame)
            packet_kind = socket_packet_kind(frame)
            if direction == "bridge_to_server" and event_name in TERMINAL_EVENTS:
                self._terminal_report_seen = True
                self.record("terminal_report_forwarded", event_name=event_name, packet_kind=packet_kind, payload_bytes=len(frame.payload))
            withhold = should_withhold_terminal_response(self._mode, self._terminal_report_seen, direction, packet_kind)
            is_terminal_response = direction == "server_to_bridge" and self._terminal_report_seen and (event_name in TERMINAL_RESPONSE_EVENTS or packet_kind == "socketio_ack")
            if is_terminal_response:
                self._terminal_response_seen = True
                self.record("terminal_response_withheld" if withhold else "terminal_response_forwarded", event_name=event_name, packet_kind=packet_kind, payload_bytes=len(frame.payload))
            if direction == "server_to_bridge" and self._mode == "hold_after_terminal" and self._terminal_report_seen and not withhold:
                self.record("heartbeat_or_control_forwarded_during_hold", packet_kind=packet_kind, payload_bytes=len(frame.payload))
            self.record("frame", direction=direction, packet_kind=packet_kind, event_name=event_name, payload_bytes=len(frame.payload), withheld=withhold)
            if not withhold:
                target.write(frame.raw)
                await target.drain()

    async def handle(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        """Proxy one upgraded WebSocket connection to the real API."""
        server_reader: Optional[asyncio.StreamReader] = None
        server_writer: Optional[asyncio.StreamWriter] = None
        control_task: Optional[asyncio.Task] = None
        forward_tasks: list[asyncio.Task] = []
        self._close_event = asyncio.Event()
        self._terminal_report_seen = False
        self._terminal_response_seen = False
        try:
            request_headers = await read_http_headers(client_reader)
            server_reader, server_writer = await asyncio.open_connection(self._upstream_host, self._upstream_port)
            server_writer.write(request_headers)
            await server_writer.drain()
            response_headers = await read_http_headers(server_reader)
            client_writer.write(response_headers)
            await client_writer.drain()
            if not response_headers.startswith(b"HTTP/1.1 101"):
                self.record("upgrade_rejected", response=response_headers.split(b"\r\n", 1)[0].decode("ascii", errors="replace"))
                return
            self.record("upgrade_complete")
            control_task = asyncio.create_task(self.watch_control())
            forward_tasks = [asyncio.create_task(self.forward(client_reader, server_writer, "bridge_to_server")), asyncio.create_task(self.forward(server_reader, client_writer, "server_to_bridge"))]
            close_waiter = asyncio.create_task(self._close_event.wait())
            done, pending = await asyncio.wait(forward_tasks + [close_waiter], return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                if task is not close_waiter:
                    exception = task.exception()
                    if exception is not None and not isinstance(exception, asyncio.IncompleteReadError):
                        raise exception
        finally:
            if control_task is not None:
                control_task.cancel()
                await asyncio.gather(control_task, return_exceptions=True)
            for task in forward_tasks:
                if not task.done():
                    task.cancel()
            if forward_tasks:
                await asyncio.gather(*forward_tasks, return_exceptions=True)
            client_writer.close()
            await client_writer.wait_closed()
            if server_writer is not None:
                server_writer.close()
                await server_writer.wait_closed()
            self.record("connection_closed")

    async def serve(self) -> None:
        """Listen only on the requested local address until interrupted."""
        self.consume_control()
        self._server = await asyncio.start_server(self.handle, self._listen_host, self._listen_port)
        self.record("listening", listen_host=self._listen_host, listen_port=self._listen_port, upstream_host=self._upstream_host, upstream_port=self._upstream_port)
        async with self._server:
            await self._server.serve_forever()


def main() -> int:
    """Run the local proxy until the process receives an interrupt."""
    arguments = parse_arguments()
    proxy = SocketIoFaultProxy(arguments.listen_host, arguments.listen_port, arguments.upstream_host, arguments.upstream_port, arguments.control_path, arguments.events_path)
    try:
        asyncio.run(proxy.serve())
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
