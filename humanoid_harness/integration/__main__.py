"""Composition launcher for the pinned, unchanged platform-client."""

import argparse
import asyncio
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import signal
import sys
from urllib.parse import urlparse

from hr_client.client import HumanoidRobotClient
from hr_client import client as client_module
from hr_client.locations import LocationTable
from hr_client.robot_claim import RobotClaim
from hr_client.settings import load as load_settings
from platform_common.pose_library import PoseLibrary

from .executor import HumanoidPickExecutor, default_config
from ..storage import read_json, write_json


EXPECTED_CLIENT_SHA256 = "65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777"


class InertHardware:
    """Detect any accidental use of the default box delivery hardware route."""

    def staged_item_count(self) -> int:
        return 0

    def __getattr__(self, name):
        raise RuntimeError(f"External assigned executor must not call humanoid hardware.{name}")


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Pinned real platform-client with simulated assigned Rack B executor")
    p.add_argument("--client-source", type=Path, required=True)
    p.add_argument("--settings", type=Path, required=True)
    p.add_argument("--state-root", type=Path, required=True)
    p.add_argument("--url", required=True, help="Socket.IO proxy URL")
    p.add_argument("--readback-url", required=True, help="Direct platform API URL for completion readback")
    p.add_argument("--device-id", default="humanoid_robot")
    p.add_argument("--faults-json", type=Path, help="JSON object mapping exact task ID to simulator fault list")
    p.add_argument("--stop-after-seconds", type=float)
    p.add_argument("--crash-after-place-once", action="store_true")
    p.add_argument("--crash-after-held-placement-once", action="store_true")
    return p


def ensure_startup_ready(executor: HumanoidPickExecutor) -> None:
    if executor._owner["status"] != "idle":
        raise ValueError("Persistent physical owner remains unresolved; client startup is held: " + str(executor._owner))


def simulation_locations(source_path: Path, state_root: Path) -> Path:
    """Make the client's validation table cover symbolic simulated counter 4."""
    source = json.loads(source_path.read_text(encoding="utf-8"))

    def resolve_trajectories(value):
        if isinstance(value, dict):
            if value.get("type") == "trajectory" and isinstance(value.get("path"), str):
                trajectory = Path(value["path"])
                if not trajectory.is_absolute():
                    value["path"] = str((source_path.parent / trajectory).resolve())
            for child in value.values():
                resolve_trajectories(child)
        elif isinstance(value, list):
            for child in value:
                resolve_trajectories(child)

    resolve_trajectories(source)
    counters = source.get("counters")
    if not isinstance(counters, list):
        raise ValueError("Location settings require a counters list")
    areas = [item.get("counter_area") for item in counters if isinstance(item, dict)]
    if len(areas) != len(counters) or len(set(areas)) != len(areas):
        raise ValueError("Location settings have malformed or duplicate counters")
    if 4 not in areas:
        source["counters"].append({"counter_area": 4, "amr": {"tag": "SIM_COUNTER_4", "theta": 0},
                                   "arm_motions": [{"type": "pose", "ref": "place_box"}]})
    path = state_root / "simulation-locations.json"
    if path.exists():
        if read_json(path) != source:
            raise ValueError("Saved simulation locations differ from requested client settings")
        return path
    write_json(path, source)
    return path


async def run(args) -> int:
    source = args.client_source.resolve()
    loaded = Path(client_module.__file__).resolve()
    expected = source / "hr_client" / "client.py"
    actual_hash = hashlib.sha256(loaded.read_bytes()).hexdigest()
    if loaded != expected or actual_hash != EXPECTED_CLIENT_SHA256:
        raise ValueError(f"Loaded platform-client is not pinned: {loaded} sha256={actual_hash}; expected {expected} sha256={EXPECTED_CLIENT_SHA256}")
    module_names = sorted(name for name in sys.modules if name in ("hr_client", "platform_common") or name.startswith(("hr_client.", "platform_common.")))
    loaded_sources = {}
    for module_name in module_names:
        module = sys.modules[module_name]
        if not getattr(module, "__file__", None):
            continue
        module_path = Path(module.__file__).resolve()
        if source not in module_path.parents:
            raise ValueError(f"Loaded {module_name} outside pinned client source: {module_path}")
        loaded_sources[module_name] = {"path": str(module_path), "sha256": hashlib.sha256(module_path.read_bytes()).hexdigest()}
    if args.stop_after_seconds is not None and args.stop_after_seconds <= 0:
        raise ValueError("Stop deadline must be positive")
    for value in (args.url, args.readback_url):
        endpoint = urlparse(value)
        if endpoint.scheme != "http" or endpoint.hostname not in ("localhost", "127.0.0.1", "::1") or endpoint.port is None:
            raise ValueError("Integration endpoints must be explicit local HTTP URLs with ports")
    if args.url == args.readback_url or args.device_id != "humanoid_robot":
        raise ValueError("Use distinct local Socket.IO and API endpoints for humanoid_robot")
    result = load_settings(str(args.settings.resolve()))
    if result.is_err or result.data is None:
        raise ValueError(result.message)
    settings = result.data
    poses = PoseLibrary.load(settings.poses_path)
    if poses.is_err or poses.data is None:
        raise ValueError(poses.message)
    root = args.state_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    location_overlay = simulation_locations(Path(settings.locations_path), root)
    locations = LocationTable.load(str(location_overlay), poses.data)
    if locations.is_err or locations.data is None:
        raise ValueError(locations.message)
    settings = replace(settings, server=replace(settings.server, url=args.url, completion_readback_url=args.readback_url, device_id=args.device_id), paths=replace(settings.paths, locations=str(location_overlay), pending_completions=str(root / "pending-completions.json")), logging=replace(settings.logging, file=str(root / "platform-client.log")))
    fault_map = {}
    if args.faults_json is not None:
        fault_map = json.loads(args.faults_json.read_text(encoding="utf-8"))
        if not isinstance(fault_map, dict) or any(not isinstance(key, str) or not isinstance(value, list) for key, value in fault_map.items()):
            raise ValueError("Fault file must map exact task ID to lists of fault rules")

    def config_factory(ctx):
        config = default_config(ctx)
        faults = fault_map.get(ctx.task_id, [])
        if any(not isinstance(fault, dict) or fault.get("task_id") != ctx.task_id for fault in faults):
            raise ValueError("Fault rule task ID must match assigned task")
        config["faults"] = faults
        return config

    executor = HumanoidPickExecutor(root, config_factory=config_factory, crash_after_place_once=args.crash_after_place_once, crash_after_held_placement_once=args.crash_after_held_placement_once)
    try:
        claim = RobotClaim()
        client = HumanoidRobotClient(settings, InertHardware(), claim, locations.data, pick_executor=executor)
        original_connect = client.sio.connect

        async def websocket_connect(url, **kwargs):
            kwargs["transports"] = ["websocket"]
            return await original_connect(url, **kwargs)

        client.sio.connect = websocket_connect
        recovered = await executor.recover_completed(client)
        ensure_startup_ready(executor)
        manifest = {"schema": 1, "client_source": str(source), "loaded_client_file": str(loaded), "loaded_client_sha256": actual_hash,
                    "loaded_sources": loaded_sources,
                    "settings_source": settings.source_path, "state_root": str(root), "socket_url": args.url, "readback_url": args.readback_url,
                    "simulation_locations": str(location_overlay),
                    "device_id": args.device_id, "recovered_completions": [item.key for item in recovered], "simulator": "humanoid_harness.StubDevice/1"}
        write_json(root / "integration-manifest.json", manifest)
        print(json.dumps(manifest, sort_keys=True), flush=True)
        stop_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        for name in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(name, stop_event.set)
            except NotImplementedError:
                signal.signal(name, lambda *_: loop.call_soon_threadsafe(stop_event.set))
        running = asyncio.create_task(client.run())
        stopping = asyncio.create_task(stop_event.wait())
        try:
            done, _ = await asyncio.wait({running, stopping}, timeout=args.stop_after_seconds, return_when=asyncio.FIRST_COMPLETED)
            if running in done:
                await running
            return 0
        finally:
            stopping.cancel()
            await executor.drain()
            await client.stop()
            running.cancel()
            try:
                await running
            except asyncio.CancelledError:
                pass
    finally:
        await executor.drain()


def main() -> int:
    try:
        return asyncio.run(run(parser().parse_args()))
    except (ValueError, OSError) as exc:
        print(f"Integration launcher refused to start: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
