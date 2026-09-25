"""Run the real staged bridge with a test-only WebSocket transport override."""

import hashlib
import json
import logging
import os
from pathlib import Path
import asyncio
from time import sleep
from typing import Any

import socketio
from hr_client import client as hr_client_client
from hr_client import pending_completion, pending_failure, settings as hr_client_settings
from platform_bridge import completion_recovery, executor, journal, journal_lock, recover_execution, recovery, ros_node, settings
from platform_bridge.ros_node import main as bridge_main


LOGGER = logging.getLogger("bridge_websocket_transport_entrypoint")
ORIGINAL_CONNECT = socketio.AsyncClient.connect
BOUNDARY = os.environ.get("COMBINED_RECOVERY_BOUNDARY", "")
BOUNDARY_MARKER = os.environ.get("COMBINED_RECOVERY_BOUNDARY_MARKER", "")


def mark_boundary(name: str) -> None:
    if not BOUNDARY_MARKER:
        raise RuntimeError("test boundary requires a marker path")
    marker = Path(BOUNDARY_MARKER)
    marker.write_text(json.dumps({"boundary": name, "pid": os.getpid()}, sort_keys=True) + "\n", encoding="ascii")


if BOUNDARY == "terminal-before-client-queue":
    original_terminal = journal.ExecutionJournal.terminal

    def terminal_boundary(self: Any, *args: Any, **kwargs: Any) -> Any:
        recorded = original_terminal(self, *args, **kwargs)
        if recorded.terminal_state == "COMPLETED":
            mark_boundary(BOUNDARY)
            while True:
                sleep(1)
        return recorded

    journal.ExecutionJournal.terminal = terminal_boundary

if BOUNDARY == "confirmed-before-callback":
    original_callback_factory = ros_node.make_completion_callback

    def callback_boundary_factory(*args: Any, **kwargs: Any) -> Any:
        original_callback = original_callback_factory(*args, **kwargs)

        async def callback_boundary(record: Any) -> None:
            if record.state.value == "confirmed":
                mark_boundary(BOUNDARY)
                while True:
                    await asyncio.sleep(1)
            await original_callback(record)

        return callback_boundary

    ros_node.make_completion_callback = callback_boundary_factory


def source_identity() -> dict[str, dict[str, str]]:
    """Record exact loaded module paths and hashes before accepting test work."""
    modules = {
        "hr_client.client": hr_client_client,
        "hr_client.pending_completion": pending_completion,
        "hr_client.pending_failure": pending_failure,
        "hr_client.settings": hr_client_settings,
        "platform_bridge.executor": executor,
        "platform_bridge.journal": journal,
        "platform_bridge.ros_node": ros_node,
        "platform_bridge.recovery": recovery,
        "platform_bridge.settings": settings,
        "platform_bridge.completion_recovery": completion_recovery,
        "platform_bridge.recover_execution": recover_execution,
        "platform_bridge.journal_lock": journal_lock,
    }
    evidence: dict[str, dict[str, str]] = {}
    for name, module in modules.items():
        module_path = Path(module.__file__ or "").resolve()
        if not module_path.is_file():
            raise RuntimeError("loaded module has no source file: %s" % name)
        evidence[name] = {"path": str(module_path), "sha256": hashlib.sha256(module_path.read_bytes()).hexdigest()}
    return evidence


async def websocket_only_connect(client: socketio.AsyncClient, *args: Any, **kwargs: Any) -> Any:
    """Force direct WebSocket only in this disposable process for proxy fidelity."""
    supplied = kwargs.get("transports")
    if supplied is not None and supplied != ["websocket"]:
        raise RuntimeError("recovery harness requires the explicit websocket transport")
    kwargs["transports"] = ["websocket"]
    LOGGER.warning(json.dumps({"event": "test_transport_override", "transport": "websocket"}, sort_keys=True, separators=(",", ":")))
    return await ORIGINAL_CONNECT(client, *args, **kwargs)


socketio.AsyncClient.connect = websocket_only_connect
LOGGER.warning(json.dumps({"event": "test_source_identity", "modules": source_identity()}, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    bridge_main()
