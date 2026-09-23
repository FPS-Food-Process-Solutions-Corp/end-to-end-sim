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
from hr_client.pending_failure import FailureIdentity, FailureState, PendingFailure, PendingFailureStore

from ..config import scenario_config
from ..controller import Harness
from ..storage import StateError, StateLock, read_json, write_json
from .failure_attempts import FailureAttemptLedger


PHASE_PROGRESS = {
    "navigate_pick": PickSubtask.MOVING_TO_RACK,
    "lift_pick": PickSubtask.REACHING,
    "pre_pick": PickSubtask.REACHING,
    "pick": PickSubtask.GRASPING,
    "pick_check": PickSubtask.GRASPING,
    "jolt": PickSubtask.GRASPING,
    "pick_reset": PickSubtask.GRASPING,
    "retract": PickSubtask.RETRACTING,
    "failure_retract": PickSubtask.RETRACTING,
    "navigate_place": PickSubtask.MOVING_TO_BOX,
    "lift_place": PickSubtask.MOVING_TO_BOX,
    "pre_place": PickSubtask.PLACING_IN_BOX,
    "pre_place_check": PickSubtask.PLACING_IN_BOX,
    "place": PickSubtask.PLACING_IN_BOX,
    "report": PickSubtask.PLACED_IN_BOX,
    "post_place_retract": PickSubtask.RETRACTING,
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


def proof_digest(proof: dict) -> str:
    return hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def physical_source(ctx: TaskContext) -> dict:
    rack = ctx.rack_area
    if not isinstance(ctx.item_id, str) or not ctx.item_id.strip() or rack is None:
        raise ValueError("Assignment lacks item or source slot identity")
    return {"item_id": ctx.item_id, "rack_id": rack.rack_id, "level": rack.level, "slot": rack.slot}


def exact_retry_count(ctx: TaskContext) -> int:
    retry = ctx.retry_count
    if isinstance(retry, bool) or not isinstance(retry, int) or retry < 0:
        raise ValueError("Assignment lacks exact nonnegative retry generation")
    return retry


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

    def __init__(self, state_root: Path, *, config_factory: Callable[[TaskContext], dict] | None = None, crash_after_place_once: bool = False, crash_after_held_placement_once: bool = False, pending_failure_store: PendingFailureStore | None = None):
        self.root = Path(state_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.units_root = self.root / "units"
        self.units_root.mkdir(exist_ok=True)
        self.assignments_root = self.root / "assignments"
        self.assignments_root.mkdir(exist_ok=True)
        self.owner_path = self.root / "device-owner.json"
        self.registry_path = self.root / "task-identities.json"
        self.readiness_path = self.root / "device-readiness.json"
        self.failure_attempts_path = self.root / "failure-attempts.json"
        public_failure_records = pending_failure_store is not None and (any(pending_failure_store.records()) or any(pending_failure_store.incomplete_holds()))
        fresh_device = not self.owner_path.exists() and not self.registry_path.exists() and not self.readiness_path.exists() and not self.failure_attempts_path.exists() and not any(self.units_root.iterdir()) and not any(self.assignments_root.iterdir()) and not public_failure_records
        self.lock = StateLock(self.root / ".device.lock")
        self.lock.acquire()
        self.config_factory = config_factory or default_config
        self.crash_after_place_once = crash_after_place_once
        self.crash_after_held_placement_once = crash_after_held_placement_once
        self.pending_failure_store = pending_failure_store
        self._serial = asyncio.Lock()
        self._cancel = threading.Event()
        self._worker: asyncio.Future | None = None
        self._hold_client = None
        self._installed_hold_id = None
        self._closed = False
        try:
            if not fresh_device and (not self.owner_path.exists() or not self.registry_path.exists() or not self.readiness_path.exists()):
                raise StateError("Existing device journals lack owner, identity registry or readiness record")
            if self.owner_path.exists():
                self._owner = read_json(self.owner_path)
                if self._owner.get("schema") != 1 or self._owner.get("status") not in ("idle", "active", "hold") or not isinstance(self._owner.get("readiness_version"), int):
                    raise StateError("Invalid device owner record")
                self._owner.setdefault("hold_version", 0)
                self._owner.setdefault("recovery_hold", None)
                if (isinstance(self._owner["hold_version"], bool) or not isinstance(self._owner["hold_version"], int)
                        or self._owner["hold_version"] < 0 or self._owner["status"] != "hold" and self._owner["recovery_hold"] is not None):
                    raise StateError("Invalid device recovery hold")
            else:
                self._owner = {"schema": 1, "status": "idle", "identity": None, "reason": "", "readiness_version": 0,
                               "hold_version": 0, "recovery_hold": None}
                write_json(self.owner_path, self._owner)
            if self.registry_path.exists():
                self._registry = read_json(self.registry_path)
                if self._registry.get("schema") != 1 or not isinstance(self._registry.get("tasks"), dict):
                    raise StateError("Invalid task identity registry")
            else:
                self._registry = {"schema": 1, "tasks": {}}
                write_json(self.registry_path, self._registry)
            if self.readiness_path.exists():
                self._readiness = read_json(self.readiness_path)
                if self._readiness.get("schema") != 1 or self._readiness.get("status") not in ("ready", "unknown") or not isinstance(self._readiness.get("version"), int):
                    raise StateError("Invalid device readiness record")
            elif fresh_device:
                self._readiness = {"schema": 1, "status": "ready", "version": 0, "identity": None, "source": None,
                                   "config_fingerprint": None, "proof_kind": "simulator_bootstrap", "proof_action_id": "simulator/bootstrap",
                                   "proof_sha256": None, "action_generation": 0, "location": "SIM_TAG_FRONT_COUNTER", "posture": "SIM_POSE_IDLE",
                                   "held_task_id": None, "held_bun_id": None, "provenance": "humanoid_harness.StubDevice/1"}
                write_json(self.readiness_path, self._readiness)
            else:
                raise StateError("Existing device journals lack a current readiness record")
            if not self.failure_attempts_path.exists() and not fresh_device:
                for unit_dir in self.units_root.iterdir():
                    controller = unit_dir / "controller.json"
                    if controller.exists() and any(unit.get("status") == "failed" for unit in read_json(controller).get("units", {}).values()):
                        raise StateError("Existing failed unit lacks bridge failure-attempt journal")
            self.failure_attempts = FailureAttemptLedger(self.failure_attempts_path)
            if self._owner["status"] == "idle":
                if (self._readiness["status"] != "ready" or self._owner["readiness_version"] != self._readiness["version"]
                        or not isinstance(self._readiness.get("proof_action_id"), str) or not isinstance(self._readiness.get("location"), str)
                        or not isinstance(self._readiness.get("posture"), str) or self._readiness.get("held_task_id") is not None
                        or self._readiness.get("held_bun_id") is not None):
                    raise StateError("Idle owner has no matching verified current release")
                if not self._current_release_valid():
                    raise StateError("Current device release does not match its physical proof")
        except BaseException:
            self.lock.release()
            raise

    def _save_owner(self, status: str, identity: dict | None, reason: str = "", recovery_hold: dict | None = None,
                    hold_version: int | None = None) -> None:
        next_owner = {"schema": 1, "status": status, "identity": identity, "reason": reason, "readiness_version": self._readiness["version"],
                      "hold_version": self._owner.get("hold_version", 0) if hold_version is None else hold_version,
                      "recovery_hold": recovery_hold}
        write_json(self.owner_path, next_owner)
        self._owner = next_owner

    def _invalidate_readiness(self, reason: str) -> None:
        next_readiness = {"schema": 1, "status": "unknown", "version": self._readiness["version"] + 1,
                          "identity": self._owner["identity"], "reason": reason, "provenance": "humanoid_harness.StubDevice/1"}
        write_json(self.readiness_path, next_readiness)
        self._readiness = next_readiness

    def _publish_readiness(self, identity: dict, source: dict, proof: dict, kind: str) -> None:
        if proof.get("assignment") != identity:
            raise StateError("Device release proof changed immutable assignment")
        if kind == "failure_retract":
            proven_source = proof.get("source")
        elif kind == "post_place_retract":
            state = read_json(self._unit_dir(identity) / "controller.json")
            placement = state.get("physical_proof")
            if (not isinstance(placement, dict) or placement.get("assignment") != identity
                    or proof.get("physical_place_execution_id") != placement.get("place_execution_id")):
                raise StateError("Post-place release lacks matching placement proof")
            proven_source = placement.get("source")
        else:
            raise StateError("Unknown device release proof kind")
        if proven_source != source:
            raise StateError("Device release source differs from physical proof")
        observed = proof["readiness_observation"]
        if (observed.get("held_task_id") is not None or observed.get("posture") != proof["recovery_target"]
                or observed.get("motion_quiescent") is not True or observed.get("navigation_safe") is not True):
            raise StateError("Cannot publish unsafe device release")
        next_readiness = {"schema": 1, "status": "ready", "version": self._readiness["version"] + 1,
                           "identity": identity, "source": source, "config_fingerprint": proof["config_fingerprint"],
                           "proof_kind": kind, "proof_action_id": proof["recovery_execution_id"], "proof_sha256": proof_digest(proof),
                           "action_generation": proof["recovery_generation"], "observation_version": observed["observation_version"],
                           "location": observed["location"], "posture": observed["posture"], "held_task_id": None,
                           "held_bun_id": None, "provenance": "humanoid_harness.StubDevice/1"}
        write_json(self.readiness_path, next_readiness)
        self._readiness = next_readiness

    def _unit_dir(self, identity: dict) -> Path:
        return self.units_root / unit_digest(identity)

    def _hold_verified_placement(self, identity: dict, source: dict, proof: dict, reason: str) -> None:
        if proof.get("assignment") != identity or proof.get("source") != source:
            raise StateError("Verified placement HOLD source differs from physical assignment")
        if self._owner["status"] == "hold" and self._owner.get("recovery_hold") is not None:
            saved = self._owner["recovery_hold"]
            if (saved.get("assignment") != identity or saved.get("source") != source
                    or saved.get("placement_proof_sha256") != proof_digest(proof) or not self._recovery_hold_valid()):
                raise StateError("Saved physical recovery hold conflicts with placement proof")
            return
        if self._owner["status"] != "hold":
            self._invalidate_readiness(reason)
        if self._readiness["status"] != "unknown":
            raise StateError("Verified placement hold requires invalidated current readiness")
        version = self._owner.get("hold_version", 0) + 1
        context = {"schema": 1, "version": version, "assignment": deepcopy(identity), "source": deepcopy(source),
                   "config_fingerprint": proof["config_fingerprint"], "readiness_version": self._readiness["version"],
                   "placement_proof_sha256": proof_digest(proof), "place_execution_id": proof["place_execution_id"]}
        token = hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()
        hold = {**context, "hold_id": "sim-placement/" + token, "message": reason, "task_id": identity["task_id"]}
        self._save_owner("hold", identity, reason, hold, hold_version=version)
        if read_json(self.owner_path) != self._owner or read_json(self.readiness_path) != self._readiness:
            raise StateError("Verified placement HOLD was not durably committed")

    def _recovery_hold_valid(self) -> bool:
        hold = self._owner.get("recovery_hold")
        if self._owner["status"] != "hold" or not isinstance(hold, dict) or self._readiness["status"] != "unknown":
            return False
        identity = self._owner["identity"]
        if not isinstance(identity, dict) or hold.get("assignment") != identity or hold.get("version") != self._owner["hold_version"]:
            return False
        if hold.get("readiness_version") != self._readiness["version"] or self._owner["readiness_version"] != self._readiness["version"]:
            return False
        registered = self._registry["tasks"].get(identity.get("task_id"))
        if not isinstance(registered, dict) or registered.get("identity") != identity or registered.get("source") != hold.get("source"):
            return False
        unit_dir = self._unit_dir(identity)
        try:
            state = read_json(unit_dir / "controller.json")
            harness = Harness(unit_dir, state["config"], resume=True, assigned=True)
            try:
                if not harness._assigned_proof_valid():
                    return False
                proof = harness.state["physical_proof"]
            finally:
                harness.close()
            if proof.get("assignment") != identity or proof.get("source") != registered["source"]:
                return False
            context = {"schema": 1, "version": hold["version"], "assignment": identity, "source": registered["source"],
                       "config_fingerprint": proof["config_fingerprint"], "readiness_version": self._readiness["version"],
                       "placement_proof_sha256": proof_digest(proof), "place_execution_id": proof["place_execution_id"]}
            token = hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()
            return (hold == {**context, "hold_id": "sim-placement/" + token, "message": self._owner["reason"],
                             "task_id": identity["task_id"]} and state.get("config_fingerprint") == proof["config_fingerprint"])
        except (OSError, StateError, ValueError, KeyError, TypeError):
            return False

    def recovery_hold_spec(self) -> dict | None:
        if self._owner["status"] != "hold":
            return None
        if self._owner.get("recovery_hold") is None:
            identity = self._owner["identity"]
            if not isinstance(identity, dict):
                raise StateError("Unknown physical HOLD has no verified placement")
            registered = self._registry["tasks"].get(identity.get("task_id"))
            if not isinstance(registered, dict) or registered.get("identity") != identity:
                raise StateError("Physical HOLD lacks immutable assignment registry")
            unit_dir = self._unit_dir(identity)
            state = read_json(unit_dir / "controller.json")
            harness = Harness(unit_dir, state["config"], resume=True, assigned=True)
            try:
                if not harness._assigned_proof_valid():
                    raise StateError("Physical HOLD lacks exact verified placement")
                proof = deepcopy(harness.state["physical_proof"])
            finally:
                harness.close()
            self._hold_verified_placement(identity, registered["source"], proof, self._owner["reason"])
        if not self._recovery_hold_valid():
            raise StateError("Physical owner HOLD lacks exact verified placement recovery token")
        hold = self._owner["recovery_hold"]
        return {"hold_id": hold["hold_id"], "message": hold["message"], "task_id": hold["task_id"]}

    def install_recovery_hold(self, client) -> dict | None:
        """Synchronously block client scheduling before any recovery queue await."""
        spec = self.recovery_hold_spec()
        if spec is None:
            return None
        client.hold_execution_for_recovery(spec["hold_id"], spec["message"], task_id=spec["task_id"])
        self._hold_client = client
        self._installed_hold_id = spec["hold_id"]
        return spec

    def _require_public_hold(self, client) -> None:
        if self._owner["status"] != "hold":
            return
        spec = self.recovery_hold_spec()
        if self._hold_client is not client or self._installed_hold_id != spec["hold_id"]:
            raise StateError("Public client physical recovery hold was not installed before queueing")

    def _failure_intent(self, identity: dict, source: dict, retry_count: int, proof: dict, message: str) -> dict:
        registered = self._registry["tasks"].get(identity["task_id"])
        if (not isinstance(registered, dict) or registered.get("identity") != identity or registered.get("source") != source
                or registered.get("dispatch_retry_count") != retry_count
                or registered.get("attempt_contexts", {}).get(str(retry_count)) !=
                {"assignment": identity, "source": source, "retry_count": retry_count}):
            raise StateError("Failure report lacks explicitly persisted dispatch retry context")
        if proof.get("assignment") != identity or proof.get("failure_reason") != message:
            raise StateError("Failure report differs from physical source or reason")
        return self.failure_attempts.ensure_intent(identity, source, retry_count, proof, PickFailureReason.UNKNOWN, message)

    def _prior_failure_confirmed(self, identity: dict, retry_count: int) -> bool:
        attempts = [record for record in self.failure_attempts.records() if record["assignment"]["task_id"] == identity["task_id"]]
        if not attempts:
            return retry_count == 0
        previous = [record for record in attempts if record["identity"]["retry_count"] < retry_count]
        if not previous:
            return retry_count == 0 and all(record["identity"]["retry_count"] == 0 for record in attempts)
        if retry_count != max(record["identity"]["retry_count"] for record in previous) + 1:
            return False
        if self.pending_failure_store is None:
            return False
        for record in previous:
            if record["state"] != "confirmed":
                return False
            public = self.pending_failure_store.get(FailureIdentity(**record["identity"]))
            if (public is None or public.state is not FailureState.CONFIRMED or not public.callback_acknowledged
                    or public.terminal_evidence != record["terminal_evidence"]
                    or public.platform_evidence != record["platform_evidence"]):
                return False
        return True

    def _public_failure_history_ready(self) -> bool:
        attempts = self.failure_attempts.records()
        if self.pending_failure_store is None:
            return not attempts
        owned = {FailureIdentity(**attempt["identity"]).key: attempt for attempt in attempts}
        public_records = tuple(self.pending_failure_store.records())
        if any(record.identity.key not in owned for record in public_records):
            return False
        for key, attempt in owned.items():
            public = self.pending_failure_store.get(FailureIdentity(**attempt["identity"]))
            if (public is None or public.reason != attempt["reason"] or public.message != attempt["message"]
                    or public.terminal_evidence != attempt["terminal_evidence"]
                    or attempt["state"] != "confirmed" or public.state is not FailureState.CONFIRMED
                    or not public.callback_acknowledged or public.platform_evidence != attempt["platform_evidence"]):
                return False
        return not any(self.pending_failure_store.incomplete_holds())

    async def audit_failure_confirmation(self, record: PendingFailure) -> None:
        if self.pending_failure_store is None:
            raise StateError("Failure callback has no shared public failure store")
        attempt = self.failure_attempts.get(record.identity)
        if attempt is None:
            raise StateError("Failure callback has no bridge report intent")
        self._validate_failure_attempt_physical(attempt)
        self.failure_attempts.audit(record, self.pending_failure_store)

    def _validate_failure_attempt_physical(self, attempt: dict) -> None:
        identity = attempt["assignment"]
        registered = self._registry["tasks"].get(identity["task_id"])
        if (not isinstance(registered, dict) or registered.get("identity") != identity
                or registered.get("source") != attempt["source"]):
            raise StateError("Saved failure attempt has no matching assignment registry")
        unit_dir = self._unit_dir(identity)
        controller_path = unit_dir / "controller.json"
        if not controller_path.exists():
            raise StateError("Saved failure attempt has no physical unit controller")
        state = read_json(controller_path)
        if (state.get("phase") != "done" or state.get("assignment") != identity
                or state.get("units", {}).get(identity["task_id"], {}).get("status") != "failed"):
            raise StateError("Saved failure attempt is not a terminal failed physical unit")
        harness = Harness(unit_dir, state["config"], resume=True, assigned=True)
        try:
            if not harness._failure_proof_valid():
                raise StateError("Saved failure attempt lost exact physical readiness proof")
            proof = harness.state["failure_readiness_proof"]
        finally:
            harness.close()
        if (proof != attempt["terminal_evidence"]["failure_readiness_proof"]
                or proof_digest(proof) != attempt["terminal_evidence"]["physical_proof_sha256"]
                or state.get("failure_reason") != attempt["message"]):
            raise StateError("Saved failure attempt differs from current physical proof")

    def _crash_after_held_placement(self, identity: dict, proof: dict) -> None:
        if not self.crash_after_held_placement_once:
            return
        marker = self.root / "crash-after-held-placement.used.json"
        if marker.exists():
            return
        if (self._owner["status"] != "hold" or self._owner["identity"] != identity
                or self._readiness["status"] != "unknown"
                or read_json(self.owner_path) != self._owner or read_json(self.readiness_path) != self._readiness):
            raise StateError("Held-placement crash hook requires durable owner HOLD and invalidated readiness")
        write_json(marker, {"schema": 1, "identity": identity, "place_execution_id": proof["place_execution_id"]})
        os._exit(78)

    def _current_release_valid(self) -> bool:
        record = self._readiness
        if self._owner["status"] != "idle" or record.get("status") != "ready" or self._owner["readiness_version"] != record.get("version"):
            return False
        if record.get("proof_kind") == "simulator_bootstrap":
            return (record.get("version") == 0 and record.get("identity") is None and record.get("source") is None
                    and record.get("config_fingerprint") is None and record.get("proof_action_id") == "simulator/bootstrap"
                    and record.get("proof_sha256") is None
                    and record.get("action_generation") == 0 and record.get("location") == "SIM_TAG_FRONT_COUNTER"
                    and record.get("posture") == "SIM_POSE_IDLE" and record.get("held_task_id") is None
                    and record.get("held_bun_id") is None and record.get("provenance") == "humanoid_harness.StubDevice/1"
                    and not any(self.units_root.iterdir()) and not any(self.assignments_root.iterdir()) and not self._registry["tasks"]
                    and not self.failure_attempts.records()
                    and (self.pending_failure_store is None or
                         not any(self.pending_failure_store.records()) and not any(self.pending_failure_store.incomplete_holds())))
        identity = record.get("identity")
        if not isinstance(identity, dict) or unit_digest(identity) not in {path.name for path in self.units_root.iterdir() if path.is_dir()}:
            return False
        registered = self._registry["tasks"].get(identity.get("task_id"))
        if not isinstance(registered, dict) or registered.get("identity") != identity or registered.get("source") != record.get("source"):
            return False
        unit_dir = self._unit_dir(identity)
        try:
            state = read_json(unit_dir / "controller.json")
            if state.get("phase") != "done" or state.get("config_fingerprint") != record.get("config_fingerprint"):
                return False
            harness = Harness(unit_dir, state["config"], resume=True, assigned=True)
            try:
                kind = record.get("proof_kind")
                if kind == "failure_retract" and harness._failure_proof_valid():
                    proof = state["failure_readiness_proof"]
                elif kind == "post_place_retract" and harness._post_place_proof_valid():
                    proof = state["post_place_readiness_proof"]
                else:
                    return False
            finally:
                harness.close()
            observed = proof["readiness_observation"]
            proven_source = proof.get("source") if kind == "failure_retract" else state.get("physical_proof", {}).get("source")
            return (record.get("proof_action_id") == proof["recovery_execution_id"]
                    and proof.get("assignment") == identity and proven_source == record.get("source")
                    and record.get("proof_sha256") == proof_digest(proof)
                    and record.get("action_generation") == proof["recovery_generation"]
                    and record.get("observation_version") == observed["observation_version"]
                    and record.get("location") == observed["location"] and record.get("posture") == observed["posture"]
                    and record.get("held_task_id") is None and record.get("held_bun_id") is None
                    and record.get("provenance") == proof["provenance"])
        except (OSError, StateError, ValueError, KeyError, TypeError):
            return False

    def _worker_run(self, ctx: TaskContext, config: dict, identity: dict, loop: asyncio.AbstractEventLoop, progress_cb, initial_world: dict | None) -> dict:
        unit_dir = self._unit_dir(identity)
        resume = unit_dir.exists()
        last_percent = 0
        holding_placement = False

        def phase_progress(phase: str) -> None:
            nonlocal last_percent
            if phase == "post_place_ready_check" and self.crash_after_place_once:
                marker = self.root / "crash-after-place.used"
                if not marker.exists():
                    marker.write_text(unit_digest(identity), encoding="ascii")
                    os._exit(76)
            subtask = PHASE_PROGRESS.get(phase)
            if subtask is None:
                return
            last_percent = max(last_percent, subtask.percent)
            asyncio.run_coroutine_threadsafe(progress_cb(subtask, last_percent), loop).result(timeout=30)

        try:
            harness = Harness(unit_dir, config, resume=resume, assigned=True, cancel_requested=self._cancel.is_set, phase_callback=phase_progress, initial_world=initial_world)
            summary = harness.run()
            proof = harness.state.get("physical_proof")
            if proof is not None:
                if not harness._assigned_proof_valid():
                    self._save_owner("hold", identity, "saved placement proof is inconsistent")
                    self._invalidate_readiness("saved placement proof is inconsistent")
                    return {"status": "hold", "reason": "saved placement proof is inconsistent"}
                release = harness.state.get("post_place_readiness_proof")
                if self._cancel.is_set():
                    holding_placement = True
                    self._hold_verified_placement(identity, physical_source(ctx), proof, "physical completion after cancellation requires public recovery queue")
                    self._crash_after_held_placement(identity, proof)
                    return {"status": "complete", "proof": proof, "ready": False}
                if summary["phase"] == "done" and isinstance(release, dict) and harness._post_place_proof_valid():
                    self._publish_readiness(identity, physical_source(ctx), release, "post_place_retract")
                    self._save_owner("idle", None)
                    return {"status": "complete", "proof": proof, "ready": True}
                else:
                    holding_placement = True
                    self._hold_verified_placement(identity, physical_source(ctx), proof, summary.get("hold_reason") or "placement complete but post-place readiness unverified")
                    self._crash_after_held_placement(identity, proof)
                    return {"status": "complete", "proof": proof, "ready": False}
            if summary["phase"] == "done" and harness.state["units"][ctx.task_id]["status"] == "failed":
                reason = harness.state.get("failure_reason", "known safe physical failure")
                failure_proof = harness.state.get("failure_readiness_proof")
                if not isinstance(failure_proof, dict) or not harness._failure_proof_valid():
                    self._save_owner("hold", identity, "failed unit lacks matching release readiness proof")
                    self._invalidate_readiness("failed unit lacks matching release readiness proof")
                    return {"status": "hold", "reason": "failed unit lacks matching release readiness proof"}
                if self._cancel.is_set():
                    self._save_owner("hold", identity, "terminal physical failure after cancellation was not reported")
                    self._invalidate_readiness("terminal physical failure after cancellation")
                    return {"status": "hold", "reason": "terminal physical failure after cancellation was not reported"}
                else:
                    self._publish_readiness(identity, physical_source(ctx), failure_proof, "failure_retract")
                    self._save_owner("idle", None)
                return {"status": "failed", "reason": reason, "proof": failure_proof, "ready": True}
            reason = summary.get("hold_reason") or "physical state unresolved"
            self._save_owner("hold", identity, reason)
            self._invalidate_readiness(reason)
            return {"status": "hold", "reason": reason}
        except BaseException as exc:
            if holding_placement:
                raise
            if "harness" in locals() and isinstance(harness.state.get("physical_proof"), dict) and harness._assigned_proof_valid():
                proof = harness.state["physical_proof"]
                holding_placement = True
                self._hold_verified_placement(identity, physical_source(ctx), proof, f"worker interrupted: {exc!r}")
                self._crash_after_held_placement(identity, proof)
                return {"status": "complete", "proof": proof, "ready": False}
            self._save_owner("hold", identity, f"worker interrupted: {exc!r}")
            self._invalidate_readiness(f"worker interrupted: {exc!r}")
            raise

    async def run(self, task: TaskContext, progress_cb) -> PickExecutionOutcome:
        try:
            identity = assignment_identity(task)
            source = physical_source(task)
            retry_count = exact_retry_count(task)
            config = self.config_factory(task)
            if len(config.get("tasks", [])) != 1 or {key: config["tasks"][0].get(key) for key in identity} != identity:
                raise ValueError("Physical configuration does not match immutable assignment")
            physical_task = config["tasks"][0]
            if any(physical_task.get(key) != value for key, value in source.items()) or physical_task.get("rack") != "B":
                raise ValueError("Physical configuration does not match assigned pastry and Rack B slot")
        except (ValueError, KeyError, TypeError) as exc:
            async with self._serial:
                if self._closed or self._worker is not None and not self._worker.done() or self._owner["status"] != "idle":
                    return PickExecutionOutcome.unresolved("Preflight cannot bypass an active or unresolved physical owner")
                if not self._current_release_valid():
                    self._save_owner("hold", None, "preflight found invalid current device release")
                    self._invalidate_readiness("preflight found invalid current device release")
                    return PickExecutionOutcome.unresolved(self._owner["reason"])
                self._save_owner("hold", None, f"assignment preflight cannot prove device readiness: {exc}")
                self._invalidate_readiness("assignment preflight could not establish physical configuration")
                return PickExecutionOutcome.unresolved(self._owner["reason"])
        async with self._serial:
            if self._closed:
                return PickExecutionOutcome.unresolved("Executor is stopping")
            if self._worker is not None and not self._worker.done():
                return PickExecutionOutcome.unresolved("Previous physical worker is still active")
            recorded = self._registry["tasks"].get(identity["task_id"])
            if recorded is not None and (recorded.get("identity") != identity or recorded.get("source") != source):
                return PickExecutionOutcome.unresolved("Task ID conflicts with immutable physical assignment")
            if self._owner["status"] != "idle":
                return PickExecutionOutcome.unresolved("Physical device is " + self._owner["status"] + ": " + self._owner["reason"])
            if not self._current_release_valid():
                self._save_owner("hold", identity, "current device release does not match physical proof")
                self._invalidate_readiness("current device release does not match physical proof")
                return PickExecutionOutcome.unresolved(self._owner["reason"])
            if recorded is None:
                try:
                    for attempt in self.failure_attempts.records():
                        self._validate_failure_attempt_physical(attempt)
                except (StateError, ValueError, KeyError, TypeError) as exc:
                    return PickExecutionOutcome.unresolved(f"Saved failure history is not physically verified: {exc}")
            if recorded is None and not self._public_failure_history_ready():
                return PickExecutionOutcome.unresolved("Earlier failure report callback has not been durably audited")
            unit_dir = self._unit_dir(identity)
            saved_complete = False
            if unit_dir.exists():
                saved = read_json(unit_dir / "controller.json")
                saved_complete = saved.get("phase") == "done" and saved.get("units", {}).get(identity["task_id"], {}).get("status") == "complete"
            if not saved_complete and not self._prior_failure_confirmed(identity, retry_count):
                return PickExecutionOutcome.unresolved("Previous exact failure report and callback are not confirmed")
            next_registry = deepcopy(self._registry)
            recorded = next_registry["tasks"].get(identity["task_id"])
            if recorded is None:
                recorded = {"identity": identity, "source": source, "retry_counts": [], "attempt_contexts": {}}
                next_registry["tasks"][identity["task_id"]] = recorded
            context = {"assignment": identity, "source": source, "retry_count": retry_count}
            contexts = recorded.setdefault("attempt_contexts", {})
            if str(retry_count) in contexts and contexts[str(retry_count)] != context:
                return PickExecutionOutcome.unresolved("Saved retry dispatch context conflicts with assignment")
            contexts[str(retry_count)] = context
            recorded["dispatch_retry_count"] = retry_count
            if retry_count not in recorded["retry_counts"]:
                recorded["retry_counts"].append(retry_count)
            write_json(self.registry_path, next_registry)
            self._registry = next_registry
            write_json(self.assignments_root / (unit_digest(identity) + ".json"), {"schema": 1, **recorded})
            if unit_dir.exists():
                checkpoint = read_json(unit_dir / "controller.json")
                if checkpoint.get("phase") == "done":
                    try:
                        harness = Harness(unit_dir, config, resume=True, assigned=True)
                        try:
                            if checkpoint["units"][identity["task_id"]]["status"] == "failed" and harness._failure_proof_valid():
                                proof = checkpoint["failure_readiness_proof"]
                                message = checkpoint["failure_reason"]
                                try:
                                    intent = self._failure_intent(identity, source, retry_count, proof, message)
                                except (StateError, ValueError, KeyError, TypeError) as exc:
                                    return PickExecutionOutcome.unresolved(f"Failure report intent was not durably established: {exc}")
                                return PickExecutionOutcome.failed(PickFailureReason.UNKNOWN, message, ready_for_next=self._readiness["status"] == "ready", execution_id=proof["recovery_execution_id"], terminal_evidence=intent["terminal_evidence"])
                            if checkpoint["units"][identity["task_id"]]["status"] == "complete" and harness._assigned_proof_valid():
                                proof = checkpoint["physical_proof"]
                                return PickExecutionOutcome.completed("Verified simulator counter placement", ready_for_next=self._readiness["status"] == "ready", execution_id=proof["place_execution_id"], terminal_evidence=proof)
                        finally:
                            harness.close()
                    except (StateError, ValueError, KeyError, TypeError) as exc:
                        self._save_owner("hold", identity, f"saved terminal unit invalid: {exc}")
                        self._invalidate_readiness("saved terminal unit invalid")
                        return PickExecutionOutcome.unresolved(self._owner["reason"])
                    self._save_owner("hold", identity, "saved terminal unit lacks exact proof")
                    self._invalidate_readiness("saved terminal unit lacks exact proof")
                    return PickExecutionOutcome.unresolved(self._owner["reason"])
                self._save_owner("hold", identity, "idle device has unfinished assigned unit")
                self._invalidate_readiness("idle device has unfinished assigned unit")
                return PickExecutionOutcome.unresolved(self._owner["reason"])
            if self._readiness["status"] != "ready" or self._owner["readiness_version"] != self._readiness["version"]:
                self._save_owner("hold", identity, "current device readiness is not verified")
                return PickExecutionOutcome.unresolved(self._owner["reason"])
            initial_world = {key: self._readiness[key] for key in ("location", "posture", "held_task_id", "held_bun_id")}
            self._save_owner("active", identity)
            self._invalidate_readiness("assigned physical motion started")
            self._save_owner("active", identity)
            self._cancel.clear()
            loop = asyncio.get_running_loop()
            self._worker = asyncio.create_task(asyncio.to_thread(self._worker_run, task, deepcopy(config), identity, loop, progress_cb, initial_world))
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
                return PickExecutionOutcome.completed("Verified simulator counter placement", ready_for_next=result["ready"], execution_id=proof["place_execution_id"], terminal_evidence=proof)
            if result["status"] == "failed":
                try:
                    intent = self._failure_intent(identity, source, retry_count, result["proof"], result["reason"])
                except (StateError, ValueError, KeyError, TypeError) as exc:
                    return PickExecutionOutcome.unresolved(f"Failure report intent was not durably established: {exc}")
                return PickExecutionOutcome.failed(PickFailureReason.UNKNOWN, result["reason"], ready_for_next=result["ready"], execution_id=result["proof"]["recovery_execution_id"], terminal_evidence=intent["terminal_evidence"])
            return PickExecutionOutcome.unresolved(result["reason"])

    def reconcile_active(self) -> None:
        """Reconcile only an ACTIVE crash checkpoint before client construction."""
        if self._owner["status"] == "active" and self._owner["identity"] is not None:
            owner_unit = self._unit_dir(self._owner["identity"])
            checkpoint = read_json(owner_unit / "controller.json") if owner_unit.exists() else {}
            phase = checkpoint.get("phase")
            intent = checkpoint.get("intent")
            resumable = phase in ("report", "failure_ready_check", "post_place_ready_check") or (phase in ("place", "failure_retract", "post_place_retract") and isinstance(intent, dict) and intent.get("dispatch_started") is True)
            if resumable and isinstance(checkpoint.get("config"), dict):
                harness = Harness(owner_unit, checkpoint["config"], resume=True, assigned=True)
                harness.run()
            current = read_json(owner_unit / "controller.json") if owner_unit.exists() else {}
            identity = self._owner["identity"]
            source_record = self._registry["tasks"].get(identity["task_id"])
            if current.get("phase") == "done" and isinstance(source_record, dict) and isinstance(current.get("config"), dict):
                harness = Harness(owner_unit, current["config"], resume=True, assigned=True)
                try:
                    if current.get("failure_readiness_proof") and harness._failure_proof_valid():
                        self._publish_readiness(identity, source_record["source"], current["failure_readiness_proof"], "failure_retract")
                        self._save_owner("idle", None)
                    elif current.get("post_place_readiness_proof") and harness._post_place_proof_valid():
                        self._publish_readiness(identity, source_record["source"], current["post_place_readiness_proof"], "post_place_retract")
                        self._save_owner("idle", None)
                finally:
                    harness.close()
            if self._owner["status"] == "active":
                if isinstance(current.get("physical_proof"), dict) and isinstance(current.get("config"), dict) and isinstance(source_record, dict):
                    harness = Harness(owner_unit, current["config"], resume=True, assigned=True)
                    try:
                        if harness._assigned_proof_valid():
                            self._hold_verified_placement(identity, source_record["source"], harness.state["physical_proof"],
                                                          current.get("hold_reason") or "active crash placement requires physical recovery hold")
                    finally:
                        harness.close()
                if self._owner["status"] == "active":
                    self._save_owner("hold", identity, "active crash checkpoint lacks verified current release")
                    self._invalidate_readiness("active crash checkpoint lacks verified current release")

    async def recover_completed(self, client) -> list[CompletionIdentity]:
        """Seed exact public durable completion queue before client connects."""
        self.reconcile_active()
        self._require_public_hold(client)
        recovered = []
        for unit_dir in sorted(self.units_root.iterdir()):
            if not unit_dir.is_dir():
                continue
            controller_path = unit_dir / "controller.json"
            if not controller_path.exists():
                continue
            state = read_json(controller_path)
            if not isinstance(state.get("physical_proof"), dict):
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
        return recovered

    async def recover_failures(self, client) -> list[FailureIdentity]:
        """Seed only exact pending bridge intents through the public client queue."""
        if self.pending_failure_store is None:
            raise StateError("Failure recovery requires an explicitly shared public store")
        self.reconcile_active()
        self._require_public_hold(client)
        for unit_dir in sorted(self.units_root.iterdir()):
            controller_path = unit_dir / "controller.json"
            if not unit_dir.is_dir() or not controller_path.exists():
                continue
            state = read_json(controller_path)
            assignment = state.get("assignment")
            if not isinstance(assignment, dict) or state.get("phase") != "done" or state.get("units", {}).get(assignment.get("task_id"), {}).get("status") != "failed":
                continue
            registered = self._registry["tasks"].get(assignment["task_id"])
            if not isinstance(registered, dict) or registered.get("identity") != assignment or unit_dir != self._unit_dir(assignment):
                raise StateError("Failed unit has no exact assignment registry")
            retry = registered.get("dispatch_retry_count")
            if isinstance(retry, bool) or not isinstance(retry, int) or retry < 0:
                raise StateError("Failed unit has no exact saved dispatch retry generation")
            harness = Harness(unit_dir, state["config"], resume=True, assigned=True)
            try:
                if not harness._failure_proof_valid():
                    raise StateError("Failed unit lacks matching physical readiness proof")
                self._failure_intent(assignment, registered["source"], retry, harness.state["failure_readiness_proof"], state["failure_reason"])
            finally:
                harness.close()
        known = {FailureIdentity(**record["identity"]).key for record in self.failure_attempts.records()}
        for public in self.pending_failure_store.records():
            if public.identity.key not in known:
                raise StateError("Public failure store contains an unowned report attempt")
        seeded = []
        for attempt in sorted(self.failure_attempts.records(), key=lambda item: (item["identity"]["task_id"], item["identity"]["retry_count"])):
            self._validate_failure_attempt_physical(attempt)
            identity = FailureIdentity(**attempt["identity"])
            public = self.pending_failure_store.get(identity)
            if public is not None:
                if (public.reason != attempt["reason"] or public.message != attempt["message"]
                        or public.terminal_evidence != attempt["terminal_evidence"]):
                    raise StateError("Public failure store conflicts with bridge report intent")
                if attempt["state"] == "confirmed":
                    if public.state is not FailureState.CONFIRMED or public.platform_evidence != attempt["platform_evidence"]:
                        raise StateError("Bridge confirmation conflicts with public failure store")
                    continue
                if public.state is FailureState.CONFIRMED:
                    if public.callback_acknowledged:
                        raise StateError("Public callback acknowledgment lacks bridge audit")
                    continue
                if public.state is not FailureState.PENDING:
                    raise StateError("Public failure attempt is held or ambiguous")
            elif attempt["state"] == "confirmed":
                raise StateError("Confirmed bridge attempt vanished from public failure store")
            await client.queue_recovered_failure(identity, PickFailureReason.UNKNOWN, attempt["message"], attempt["terminal_evidence"])
            seeded.append(identity)
        return seeded

    async def drain(self) -> None:
        self._closed = True
        self._cancel.set()
        if self._worker is not None:
            try:
                await asyncio.shield(self._worker)
            except Exception:
                pass
        self.lock.release()
