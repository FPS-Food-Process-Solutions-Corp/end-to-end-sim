"""Run the real generic HR client with a disposable deterministic executor."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from time import time

import socketio
import hr_client.client as client_module
import hr_client.pending_completion as pending_completion_module
from hr_client.client import HumanoidRobotClient, PickExecutionOutcome
from hr_client.hardware import SimulatedHardware
from hr_client.locations import LocationTable
from hr_client.robot_claim import RobotClaim
from hr_client.settings import load as load_settings
from platform_common.pose_library import PoseLibrary


def append(path: Path, event: str, **fields: object) -> None:
    entry = {"timestamp": time(), "event": event}
    entry.update(fields)
    with path.open("a", encoding="ascii") as stream:
        stream.write(json.dumps(entry, sort_keys=True, separators=(",", ":")) + "\n")


class DeterministicExecutor:
    """Test-only executor that performs no hardware or ROS work."""

    def __init__(self, events: Path, delay: float) -> None:
        self.events = events
        self.delay = delay

    async def run(self, context, progress_cb):
        execution_id = "generic-" + context.task_id + "-" + str(context.retry_count or 0)
        append(self.events, "start", execution_id=execution_id, session_id=context.session_id, task_id=context.task_id, order_id=context.order_id)
        await asyncio.sleep(self.delay)
        append(self.events, "terminal", execution_id=execution_id, session_id=context.session_id, task_id=context.task_id, outcome="SUCCEEDED")
        return PickExecutionOutcome.completed(execution_id=execution_id, terminal_evidence={"executor": "generic-sim", "execution_id": execution_id, "outcome": "SUCCEEDED", "ready_for_next": True, "simulated": True})


async def websocket_only(client, *args, **kwargs):
    kwargs["transports"] = ["websocket"]
    return await ORIGINAL_CONNECT(client, *args, **kwargs)


ORIGINAL_CONNECT = socketio.AsyncClient.connect


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--settings", type=Path, required=True)
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--delay", type=float, default=0.2)
    args = parser.parse_args()
    settings_result = load_settings(str(args.settings))
    if settings_result.is_err:
        raise RuntimeError(settings_result.message)
    settings = settings_result.data
    poses_result = PoseLibrary.load(settings.poses_path)
    if poses_result.is_err:
        raise RuntimeError(poses_result.message)
    locations_result = LocationTable.load(settings.locations_path, poses_result.data)
    if locations_result.is_err:
        raise RuntimeError(locations_result.message)
    claim = RobotClaim()
    hardware = SimulatedHardware(claim, locations_result.data.box_station, motion_seconds=0.0, home_motion_seconds=0.0)
    args.events.parent.mkdir(parents=True, exist_ok=True)
    append(args.events, "loaded", client_path=str(Path(client_module.__file__).resolve()), client_sha256=hashlib.sha256(Path(client_module.__file__).read_bytes()).hexdigest(), pending_completion_path=str(Path(pending_completion_module.__file__).resolve()), pending_completion_sha256=hashlib.sha256(Path(pending_completion_module.__file__).read_bytes()).hexdigest())
    socketio.AsyncClient.connect = websocket_only
    client = HumanoidRobotClient(settings, hardware, claim, locations_result.data, pick_executor=DeterministicExecutor(args.events, args.delay))
    try:
        asyncio.run(client.run())
    finally:
        socketio.AsyncClient.connect = ORIGINAL_CONNECT
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
