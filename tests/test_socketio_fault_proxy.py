"""Unit tests for the transparent Socket.IO fault-proxy frame boundary."""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from tools.socketio_fault_proxy import SocketIoFaultProxy, read_frame, should_withhold_terminal_response, socket_event_name, socket_packet_kind


def masked_text_frame(payload: str, mask: bytes = b"ABCD") -> bytes:
    """Build a small masked client-to-server WebSocket text frame."""
    body = payload.encode("utf-8")
    if len(body) >= 126:
        raise ValueError("test payload must fit the small frame form")
    encoded = bytes(value ^ mask[index % 4] for index, value in enumerate(body))
    return bytes([0x81, 0x80 | len(body)]) + mask + encoded


def server_text_frame(payload: str) -> bytes:
    """Build a small unmasked server-to-client WebSocket text frame."""
    body = payload.encode("utf-8")
    if len(body) >= 126:
        raise ValueError("test payload must fit the small frame form")
    return bytes([0x81, len(body)]) + body


class SocketIoFaultProxyTest(unittest.TestCase):
    """Verify the proxy identifies, but never fabricates, transport events."""

    def test_detects_masked_terminal_event(self) -> None:
        async def read() -> object:
            reader = asyncio.StreamReader()
            reader.feed_data(masked_text_frame('42/socket-bridge,["hr.pick_task_completed",{"pickTaskId":"task-1"}]'))
            reader.feed_eof()
            return await read_frame(reader)

        frame = asyncio.run(read())
        self.assertEqual(socket_event_name(frame), "hr.pick_task_completed")
        self.assertEqual(socket_packet_kind(frame), "socketio_event")

    def test_classifies_server_ack_without_payload_storage(self) -> None:
        async def read() -> object:
            reader = asyncio.StreamReader()
            reader.feed_data(server_text_frame('43/socket-bridge,7[{"eventType":"platform.pick_session_updated"}]'))
            reader.feed_eof()
            return await read_frame(reader)

        frame = asyncio.run(read())
        self.assertIsNone(socket_event_name(frame))
        self.assertEqual(socket_packet_kind(frame), "socketio_ack")

    def test_sequenced_control_consumes_close_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            control = root / "control.json"
            control.write_text(json.dumps({"sequence": 1, "mode": "hold_after_terminal"}), encoding="ascii")
            proxy = SocketIoFaultProxy("127.0.0.1", 3102, "127.0.0.1", 3101, control, root / "events.jsonl")
            proxy.consume_control()
            self.assertEqual(proxy._mode, "hold_after_terminal")
            self.assertFalse(proxy._close_event.is_set())
            control.write_text(json.dumps({"sequence": 2, "mode": "pass", "action": "close_active_connection"}), encoding="ascii")
            proxy.consume_control()
            self.assertEqual(proxy._mode, "pass")
            self.assertTrue(proxy._close_event.is_set())
            proxy._close_event.clear()
            proxy.consume_control()
            self.assertFalse(proxy._close_event.is_set())

    def test_hold_preserves_engineio_heartbeat_but_withholds_socketio_responses(self) -> None:
        self.assertEqual(socket_packet_kind(asyncio.run(self._read_server_text("2"))), "text")
        self.assertEqual(socket_packet_kind(asyncio.run(self._read_server_text("3"))), "text")
        self.assertFalse(should_withhold_terminal_response("hold_after_terminal", True, "server_to_bridge", "text"))
        self.assertFalse(should_withhold_terminal_response("hold_after_terminal", True, "server_to_bridge", "ping"))
        self.assertTrue(should_withhold_terminal_response("hold_after_terminal", True, "server_to_bridge", "socketio_event"))
        self.assertTrue(should_withhold_terminal_response("hold_after_terminal", True, "server_to_bridge", "socketio_ack"))

    @staticmethod
    async def _read_server_text(payload: str) -> object:
        reader = asyncio.StreamReader()
        reader.feed_data(server_text_frame(payload))
        reader.feed_eof()
        return await read_frame(reader)


if __name__ == "__main__":
    unittest.main()
