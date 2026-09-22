"""One physical unit per platform assignment, with durable device ownership."""

import asyncio
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import threading
from typing import Callable

from hr_client.client import PickExecutionOutcome
from hr_client.models import PickFailureReason, PickSubtask, TaskContext
from hr_client.pending_completion import CompletionIdentity

from ..config import scenario_config
from ..controller import Harness
from ..storage import StateError, StateLock, read_json, write_json


PHASE_PROGRESS = {
    "navigate_pick": PickSubtask.MOVING_TO_RACK,
    "lift_pick": PickSubtask.REACHING,
    "pre_pick": PickSubtask.REACHING,
    "pick": PickSubtask.GRASPING,
    "pick_check": PickSubtask.GRASPING,
    "jolt": PickSubtask.GRASPING,
    "pick_reset": PickSubtask.GRASPING,
    "retract": PickSubtask.RETRACTING,
    "navigate_place": PickSubtask.MOVING_TO_BOX,
    "lift_place": PickSubtask.MOVING_TO_BOX,
    "pre_place": PickSubtask.PLACING_IN_BOX,
    "pre_place_check": PickSubtask.PLACING_IN_BOX,
    "place": PickSubtask.PLACING_IN_BOX,
    "report": PickSubtask.PLACED_IN_BOX,
}
CANCEL_CLEANUP_TIMEOUT_S = 30


def assignment_identity(ctx: TaskContext) -> dict:
    rack = ctx.rack_area
    if not all(isinstance(getattr(ctx, key), str) and getattr(ctx, key).strip() for key in ("order_id", "session_id", "task_id")):
        raise ValueError("Assignment lacks exact order, session or task identity")
    if rack is None or rack.rack_id.lower() not in ("rack_b", "b") or rack.level < 1 or rack.slot < 1:
        raise ValueError("Assigned executor accepts configured Rack B slots only")
    if ctx.slot_location is None or (ctx.slot_location.rack_id, ctx.slot_location.level, ctx.slot_location.slot) != (rack.rack_id, rack.level, rack.slot):
        raise ValueError("Resolved slot location does not match assigned Rack B slot")
    if ctx.counter_area not in (1, 2, 3, 4) or ctx.counter_location is None or ctx.counter_location.counter_area != ctx.counter_area:
        raise ValueError("Assignment requires a resolved counter 1 through 4")
    return {"order_id": ctx.order_id, "session_id": ctx.session_id, "task_id": ctx.task_id, "counter": ctx.counter_area}


def unit_digest(identity: dict) -> str:
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode("ascii")).hexdigest()[:20]


def physical_source(ctx: TaskContext) -> dict:
    rack = ctx.rack_area
    if not isinstance(ctx.item_id, str) or not ctx.item_id.strip() or rack is None:
        raise ValueError("Assignment lacks item or source slot identity")
    return {"item_id": ctx.item_id, "rack_id": rack.rack_id, "level": rack.level, "slot": rack.slot}


def default_config(ctx: TaskContext) -> dict:
    identity = assignment_identity(ctx)
    rack = ctx.rack_area
    config = scenario_config("happy")
    task = {**identity, **physical_source(ctx), "rack": "B"}
    config["tasks"] = [task]
    config["tags"][f"B:{rack.level}:{rack.slot}"] = f"SIM_TAG_B_{rack.level}_{rack.slot}"
    config["replacement_stock"] = {ctx.task_id: 1}
    config["faults"] = []
    return config


class HumanoidPickExecutor:
    """Async public PickExecutor backed by one serialized synchronous worker."""

    def __init__(self, state_root: Path, *, config_factory: Callable[[TaskContext], dict] | None = None, crash_after_place_once: bool = False):
        self.root = Path(state_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.units_root = self.root / "units"
        self.units_root.mkdir(exist_ok=True)
        self.assignments_root = self.root / "assignments"
        self.assignments_root.mkdir(exist_ok=True)
        self.owner_path = self.root / "device-owner.json"
        self.registry_path = self.root / "task-identities.json"
        self.lock = StateLock(self.root / ".device.lock")
        self.lock.acquire()
        self.config_factory = config_factory or default_config
        self.crash_after_place_once = crash_after_place_once
        self._serial = asyncio.Lock()
        self._cancel = threading.Event()
        self._worker: asyncio.Future | None = None
        self._closed = False
        try:
            if self.owner_path.exists():
                self._owner = read_json(self.owner_path)
                if self._owner.get("schema") != 1 or self._owner.get("status") not in ("idle", "active", "hold"):
                    raise StateError("Invalid device owner record")
            else:
                self._owner = {"schema": 1, "status": "idle", "identity": None, "reason": ""}
                write_json(self.owner_path, self._owner)
            if self.registry_path.exists():
                self._registry = read_json(self.registry_path)
                if self._registry.get("schema") != 1 or not isinstance(self._registry.get("tasks"), dict):
                    raise StateError("Invalid task identity registry")
            else:
                self._registry = {"schema": 1, "tasks": {}}
                write_json(self.registry_path, self._registry)
        except BaseException:
            self.lock.release()
            raise

    def _save_owner(self, status: str, identity: dict | None, reason: str = "") -> None:
        self._owner = {"schema": 1, "status": status, "identity": identity, "reason": reason}
        write_json(self.owner_path, self._owner)

    def _unit_dir(self, identity: dict) -> Path:
        return self.units_root / unit_digest(identity)

    def _worker_run(self, ctx: TaskContext, config: dict, identity: dict, loop: asyncio.AbstractEventLoop, progress_cb) -> dict:
        unit_dir = self._unit_dir(identity)
        resume = unit_dir.exists()
        self._save_owner("active", identity)
        last_percent = 0

        def phase_progress(phase: str) -> None:
            nonlocal last_percent
            if phase == "report" and self.crash_after_place_once:
                marker = self.root / "crash-after-place.used"
                if not marker.exists():
                    marker.write_text(unit_digest(identity), encoding="ascii")
                    os._exit(76)
            subtask = PHASE_PROGRESS.get(phase)
            if subtask is None:
                return
            last_percent = max(last_percent, subtask.percent)
            asyncio.run_coroutine_threadsafe(progress_cb(subtask, last_percent), loop).result(timeout=30)

        harness = Harness(unit_dir, config, resume=resume, assigned=True, cancel_requested=self._cancel.is_set, phase_callback=phase_progress)
        try:
            summary = harness.run()
            proof = harness.state.get("physical_proof")
            if summary["phase"] == "done" and proof is not None and harness.state["units"][ctx.task_id]["status"] == "complete":
                if self._cancel.is_set():
                    self._save_owner("hold", identity, "physical completion after cancellation requires public recovery queue")
                else:
                    self._save_owner("idle", None)
                return {"status": "complete", "proof": proof}
            if summary["phase"] == "done" and harness.state["units"][ctx.task_id]["status"] == "failed":
                reason = harness.state.get("failure_reason", "known safe physical failure")
                if self._cancel.is_set():
                    self._save_owner("hold", identity, "terminal physical failure after cancellation was not reported")
                else:
                    self._save_owner("idle", None)
                return {"status": "failed", "reason": reason}
            reason = summary.get("hold_reason") or "physical state unresolved"
            self._save_owner("hold", identity, reason)
            return {"status": "hold", "reason": reason}
        except BaseException as exc:
            self._save_owner("hold", identity, f"worker interrupted: {exc!r}")
            raise

    async def run(self, task: TaskContext, progress_cb) -> PickExecutionOutcome:
        try:
            identity = assignment_identity(task)
            source = physical_source(task)
            config = self.config_factory(task)
            if len(config.get("tasks", [])) != 1 or {key: config["tasks"][0].get(key) for key in identity} != identity:
                raise ValueError("Physical configuration does not match immutable assignment")
            physical_task = config["tasks"][0]
            if any(physical_task.get(key) != value for key, value in source.items()) or physical_task.get("rack") != "B":
                raise ValueError("Physical configuration does not match assigned pastry and Rack B slot")
        except (ValueError, KeyError, TypeError) as exc:
            return PickExecutionOutcome.failed(PickFailureReason.NOT_CONFIGURED, str(exc))
        async with self._serial:
            if self._closed:
                return PickExecutionOutcome.unresolved("Executor is stopping")
            if self._worker is not None and not self._worker.done():
                return PickExecutionOutcome.unresolved("Previous physical worker is still active")
            recorded = self._registry["tasks"].get(identity["task_id"])
            if recorded is not None and (recorded.get("identity") != identity or recorded.get("source") != source):
                return PickExecutionOutcome.unresolved("Task ID conflicts with immutable physical assignment")
            if self._owner["status"] in ("active", "hold") and self._owner["identity"] != identity:
                return PickExecutionOutcome.unresolved("Another physical unit owns the device: " + str(self._owner["identity"]))
            if recorded is None:
                recorded = {"identity": identity, "source": source, "retry_counts": []}
                self._registry["tasks"][identity["task_id"]] = recorded
            if task.retry_count not in recorded["retry_counts"]:
                recorded["retry_counts"].append(task.retry_count)
            write_json(self.registry_path, self._registry)
            write_json(self.assignments_root / (unit_digest(identity) + ".json"), {"schema": 1, **recorded})
            self._cancel.clear()
            loop = asyncio.get_running_loop()
            self._worker = asyncio.create_task(asyncio.to_thread(self._worker_run, task, deepcopy(config), identity, loop, progress_cb))
            try:
                result = await asyncio.shield(self._worker)
            except asyncio.CancelledError:
                self._cancel.set()
                try:
                    await asyncio.wait_for(asyncio.shield(self._worker), timeout=CANCEL_CLEANUP_TIMEOUT_S)
                except Exception:
                    pass
                raise
            except Exception as exc:
                return PickExecutionOutcome.unresolved(f"Physical worker raised: {exc!r}")
            if result["status"] == "complete":
                proof = result["proof"]
                return PickExecutionOutcome.completed("Verified simulator counter placement", execution_id=proof["place_execution_id"], terminal_evidence=proof)
            if result["status"] == "failed":
                return PickExecutionOutcome.failed(PickFailureReason.UNKNOWN, result["reason"], ready_for_next=False)
            return PickExecutionOutcome.unresolved(result["reason"])

    async def recover_completed(self, client) -> list[CompletionIdentity]:
        """Seed the unchanged client's public durable completion queue before it connects."""
        if self._owner["status"] in ("active", "hold") and self._owner["identity"] is not None:
            owner_unit = self._unit_dir(self._owner["identity"])
            checkpoint = read_json(owner_unit / "controller.json") if owner_unit.exists() else {}
            phase = checkpoint.get("phase")
            intent = checkpoint.get("intent")
            if phase == "report" or (phase == "place" and isinstance(intent, dict) and intent.get("dispatch_started") is True):
                config = checkpoint.get("config")
                if isinstance(config, dict):
                    harness = Harness(owner_unit, config, resume=True, assigned=True)
                    harness.run()
        recovered = []
        for unit_dir in sorted(self.units_root.iterdir()):
            if not unit_dir.is_dir():
                continue
            controller_path = unit_dir / "controller.json"
            if not controller_path.exists():
                continue
            state = read_json(controller_path)
            if state.get("phase") != "done" or not isinstance(state.get("physical_proof"), dict):
                continue
            config = state.get("config")
            if not isinstance(config, dict):
                raise StateError("Recovery unit has corrupt config")
            harness = Harness(unit_dir, config, resume=True, assigned=True)
            try:
                if not harness._assigned_proof_valid():
                    raise StateError("Recovery physical proof no longer matches readback")
                proof = deepcopy(harness.state["physical_proof"])
            finally:
                harness.close()
            identity = proof["assignment"]
            if unit_dir.name != unit_digest(identity):
                raise StateError("Recovery unit directory identity mismatch")
            completion = CompletionIdentity(identity["session_id"], identity["task_id"], identity["order_id"], proof["place_execution_id"])
            await client.queue_recovered_completion(completion, proof)
            recovered.append(completion)
        if self._owner["status"] in ("active", "hold") and self._owner["identity"] is not None:
            owner_unit = self._unit_dir(self._owner["identity"])
            state = read_json(owner_unit / "controller.json") if owner_unit.exists() else {}
            if state.get("phase") == "done" and state.get("physical_proof"):
                self._save_owner("idle", None)
        return recovered

    async def drain(self) -> None:
        self._closed = True
        self._cancel.set()
        if self._worker is not None:
            try:
                await asyncio.shield(self._worker)
            except Exception:
                pass
        self.lock.release()
