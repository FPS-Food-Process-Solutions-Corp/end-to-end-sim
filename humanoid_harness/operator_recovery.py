"""Offline, simulator-only operator recovery over exact durable evidence."""

import asyncio
from contextlib import contextmanager
from dataclasses import replace
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
from urllib.parse import urlparse
import uuid

from hr_client.client import HumanoidRobotClient, build_completion_payload
from hr_client.pending_completion import (CompletionIdentity, CompletionState,
                                           PendingCompletionStore, ReconciliationKind,
                                           read_order_completion)
from hr_client.pending_failure import FailureState, PendingFailureStore
from hr_client.robot_claim import RobotClaim
from hr_client.settings import load as load_settings

from .config import fingerprint as config_fingerprint
from .controller import Harness
from .integration.__main__ import (InertHardware, EXPECTED_CLIENT_SHA256, EXPECTED_COMPLETION_SHA256,
                                   EXPECTED_FAILURE_SHA256, EXPECTED_SETTINGS_SHA256)
from .integration.executor import proof_digest, unit_digest
from .storage import StateError, StateLock, read_json, write_json


SCHEMA = 1
PINNED = {"client.py": EXPECTED_CLIENT_SHA256,
          "pending_completion.py": EXPECTED_COMPLETION_SHA256,
          "pending_failure.py": EXPECTED_FAILURE_SHA256,
          "settings.py": EXPECTED_SETTINGS_SHA256}
ACTION_FILE = "operator-recovery.json"


class RecoveryInterrupted(RuntimeError):
    """Test-only interruption after one durable action boundary."""


def _utc():
    return datetime.now(timezone.utc).isoformat()


def _digest(value):
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(data).hexdigest()


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_client_source(client_source):
    selected = Path(client_source)
    if not selected.is_absolute():
        raise StateError("Selected client source must be absolute")
    source = selected.resolve()
    for name, expected in PINNED.items():
        path = source / "hr_client" / name
        content = path.read_bytes()
        actual = hashlib.sha256(content.replace(bytes([13, 10]), bytes([10]))).hexdigest()
        module = importlib.import_module("hr_client." + name[:-3])
        if actual != expected or Path(module.__file__).resolve() != path.resolve():
            raise StateError("Selected or loaded client source differs from reviewed pin: " + name)
    return source


def _validate_run_manifest(root, source):
    manifest = read_json(root / "integration-manifest.json")
    if (manifest.get("client_source") != str(source)
            or manifest.get("device_id") != "humanoid_robot"
            or manifest.get("simulator") != "humanoid_harness.StubDevice/1"):
        raise StateError("Saved run manifest source or simulated device differs")
    for name in PINNED:
        path = source / "hr_client" / name
        raw = path.read_bytes()
        value = {"path": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
                 "normalized_sha256": hashlib.sha256(raw.replace(bytes([13, 10]), bytes([10]))).hexdigest()}
        if (manifest.get("pinned_sources", {}).get(name) != value
                or manifest.get("loaded_sources", {}).get("hr_client." + name[:-3]) != value):
            raise StateError("Saved run loaded client differs from selected source: " + name)


def _actions(root):
    path = root / ACTION_FILE
    if not path.is_file():
        return {"schema": SCHEMA, "actions": {}}
    value = read_json(path)
    if value.get("schema") != SCHEMA or not isinstance(value.get("actions"), dict):
        raise StateError("Invalid operator action journal")
    return value


def _save_actions(root, document):
    write_json(root / ACTION_FILE, document)


def _state_files(root):
    names = ("device-owner.json", "device-readiness.json", "task-identities.json",
             "failure-attempts.json", "pending-completions.json", "pending-failures.json",
             "integration-manifest.json", ACTION_FILE)
    paths = [root / name for name in names]
    units = root / "units"
    if units.is_dir():
        for child in sorted(units.iterdir()):
            if child.is_dir():
                paths.extend(child / name for name in ("controller.json", "device.json", "events.jsonl"))
    return paths


def _inspection_hash(root):
    records = {str(path.relative_to(root)): _sha(path) if path.is_file() else None
               for path in _state_files(root)}
    return _digest(records)


def _saved_hold(root, owner, readiness, registry):
    hold = owner.get("recovery_hold")
    identity = owner.get("identity")
    result = {"status": owner.get("status"), "identity": identity, "hold_id": None,
              "place_execution_id": None, "placement_verified": False,
              "retract_status": None, "retract_effect_applied": None,
              "world_empty_hand": False, "world_travel_posture": False,
              "executions_quiescent": False, "unit_path": None}
    if owner.get("status") != "hold" or not isinstance(identity, dict) or not isinstance(hold, dict):
        return result
    result["hold_id"] = hold.get("hold_id")
    task_id = identity.get("task_id")
    registered = registry.get("tasks", {}).get(task_id)
    path = root / "units" / unit_digest(identity)
    if not path.is_dir() or not isinstance(registered, dict):
        return result
    result["unit_path"] = str(path)
    controller = read_json(path / "controller.json")
    device = read_json(path / "device.json")
    proof = controller.get("physical_proof")
    if not isinstance(proof, dict) or not isinstance(controller.get("config"), dict):
        return result
    result["place_execution_id"] = proof.get("place_execution_id")
    context = {"schema": 1, "version": hold.get("version"), "assignment": identity,
               "source": proof.get("source"), "config_fingerprint": proof.get("config_fingerprint"),
               "readiness_version": readiness.get("version"),
               "placement_proof_sha256": proof_digest(proof),
               "place_execution_id": proof.get("place_execution_id")}
    token = "sim-placement/" + _digest(context)
    world = device.get("world", {})
    executions = device.get("executions", {})
    task = controller["config"]["tasks"][0]
    cycle = controller.get("units", {}).get(task_id, {}).get("cycle")
    attempt = controller.get("units", {}).get(task_id, {}).get("post_place_retract_attempts")
    if isinstance(cycle, int) and isinstance(attempt, int):
        retract_id = controller.get("unit_namespace", "") + "/c%d/post_place_retract/a%d" % (cycle, attempt)
        retract = executions.get(retract_id, {})
    else:
        retract_id, retract = None, {}
    result.update({"retract_execution_id": retract_id,
                   "retract_status": retract.get("status"),
                   "retract_effect_applied": retract.get("effect_applied"),
                   "world_empty_hand": world.get("held_task_id") is None and world.get("held_bun_id") is None,
                   "world_travel_posture": world.get("posture") == controller["config"].get("poses", {}).get("travel"),
                   "executions_quiescent": all(row.get("status") not in ("RUNNING", "UNKNOWN")
                                               for row in executions.values())})
    placed = world.get("counter_bun_ids", {}).get(str(identity.get("counter")), [])
    result["placement_verified"] = (
        hold.get("hold_id") == token and owner.get("hold_version") == hold.get("version")
        and owner.get("readiness_version") == readiness.get("version")
        and readiness.get("status") == "unknown"
        and registered.get("identity") == identity and registered.get("source") == proof.get("source")
        and controller.get("assignment") == identity
        and controller.get("config_fingerprint") == proof.get("config_fingerprint")
        and config_fingerprint(controller["config"]) == controller.get("config_fingerprint")
        and proof.get("assignment") == identity and proof.get("place_status") == "COMPLETED"
        and isinstance(placed, list) and placed.count(proof.get("bun_id")) == 1
        and world.get("held_task_id") is None and world.get("held_bun_id") is None
        and task.get("task_id") == task_id and task.get("counter") == identity.get("counter"))
    return result


def _report_view(root, identity):
    path = root / "pending-completions.json"
    store = PendingCompletionStore(str(path))
    target = None
    blockers = []
    for record in store.records():
        if isinstance(identity, dict) and (record.identity.order_id, record.identity.session_id,
                                            record.identity.task_id) == (
                identity.get("order_id"), identity.get("session_id"), identity.get("task_id")):
            if target is not None:
                blockers.append("duplicate exact task completion")
            target = record
        elif record.state in (CompletionState.PENDING, CompletionState.OPERATOR_HOLD):
            blockers.append("another completion remains pending or operator-held")
    failures = PendingFailureStore(str(root / "pending-failures.json"))
    if any(row.state in (FailureState.PENDING, FailureState.OPERATOR_HOLD)
           or row.state is FailureState.CONFIRMED and not row.callback_acknowledged
           for row in failures.records()) or any(failures.incomplete_holds()):
        blockers.append("failure report/callback hold remains")
    return {"state": None if target is None else target.state.value,
            "identity": None if target is None else {"order_id": target.identity.order_id,
                                                     "session_id": target.identity.session_id,
                                                     "task_id": target.identity.task_id,
                                                     "execution_id": target.identity.execution_id},
            "attempts": None if target is None else target.attempts,
            "callback_acknowledged": None if target is None else target.callback_acknowledged,
            "platform_evidence_sha256": None if target is None or target.platform_evidence is None
            else _digest(target.platform_evidence),
            "blockers": blockers}


def inspect_state(state_root, client_source):
    """Read a clearly offline snapshot; a writer may make it stale immediately."""
    validate_client_source(client_source)
    root = Path(state_root).resolve()
    if not root.is_dir():
        raise StateError("Saved simulator state root is absent")
    owner = read_json(root / "device-owner.json")
    readiness = read_json(root / "device-readiness.json")
    registry = read_json(root / "task-identities.json")
    _validate_run_manifest(root, Path(client_source).resolve())
    physical = _saved_hold(root, owner, readiness, registry)
    report_identity = physical["identity"] if physical["identity"] is not None else readiness.get("identity")
    report = _report_view(root, report_identity)
    history = [{"action_id": key, "kind": value.get("kind"), "status": value.get("status"),
                "stage": value.get("stage"), "operator": value.get("operator"),
                "reason": value.get("reason"), "created_utc": value.get("created_utc")}
               for key, value in sorted(_actions(root)["actions"].items())]
    report_reasons, release_reasons = [], []
    if not physical["placement_verified"]:
        report_reasons.append("no exact verified saved placement hold")
        release_reasons.append("no exact verified saved placement hold")
    if report["state"] == CompletionState.OPERATOR_HOLD.value:
        report_reasons.append("reporting OPERATOR_HOLD requires a separate resolver")
    if report["blockers"]:
        release_reasons.extend(report["blockers"])
    if report["state"] != CompletionState.CONFIRMED.value:
        release_reasons.append("exact platform completion is not confirmed")
    if physical["retract_status"] != "COMPLETED" or physical["retract_effect_applied"] is not True:
        release_reasons.append("exact post-place retract is not completed with a saved physical effect")
    if not physical["world_empty_hand"] or not physical["world_travel_posture"] or not physical["executions_quiescent"]:
        release_reasons.append("saved physical world is not empty-hand, travel, and quiescent")
    if readiness.get("status") != "unknown":
        release_reasons.append("hold has no unknown readiness to recheck")
    return {"schema": SCHEMA, "offline_saved_snapshot": True, "state_root": str(root),
            "client_source": str(Path(client_source).resolve()),
            "inspection_sha256": _inspection_hash(root), "physical": physical,
            "report": report,
            "readiness": {"status": readiness.get("status"), "version": readiness.get("version"),
                          "proof_kind": readiness.get("proof_kind")},
            "allowed_actions": {"reconcile_report": {"allowed": not report_reasons, "reasons": report_reasons},
                                "release_hold": {"allowed": not release_reasons, "reasons": release_reasons}},
            "audit_history": history}


@contextmanager
def _owned(root, identity):
    if not (root / "device-owner.json").is_file():
        raise StateError("Saved device owner is absent; recovery cannot initialize a new device")
    lock = StateLock(root / ".device.lock")
    lock.acquire()
    try:
        saved_owner = read_json(root / "device-owner.json")
        lock_identity = saved_owner.get("identity") if isinstance(saved_owner.get("identity"), dict) else identity
        unit = root / "units" / unit_digest(lock_identity)
        if not unit.is_dir():
            raise StateError("Exact saved unit directory is absent")
        unit_lock = StateLock(unit / ".harness.lock")
        unit_lock.acquire()
        try:
            yield
        finally:
            unit_lock.release()
    finally:
        lock.release()


def _selection(snapshot, identity, hold_id, place_execution_id):
    if (not isinstance(identity, dict) or set(identity) !=
            {"order_id", "session_id", "task_id", "counter"}
            or any(not isinstance(identity[key], str) or not identity[key].strip()
                   for key in ("order_id", "session_id", "task_id"))
            or type(identity["counter"]) is not int or identity["counter"] not in (1, 2, 3, 4)
            or not isinstance(hold_id, str) or not hold_id.startswith("sim-placement/")
            or snapshot["physical"]["identity"] != identity
            or snapshot["physical"]["hold_id"] != hold_id
            or snapshot["physical"]["place_execution_id"] != place_execution_id):
        raise StateError("Exact saved assignment or recovery hold token does not match selection")


def _action_arguments(action_id, operator, reason, identity, hold_id, place_execution_id, expected_inspection_sha256,
                      api_url=None, socket_url=None):
    try:
        valid_action_id = isinstance(action_id, str) and str(uuid.UUID(action_id)) == action_id
    except ValueError:
        valid_action_id = False
    if (not valid_action_id
            or not isinstance(operator, str) or not operator.strip()
            or not isinstance(reason, str) or not reason.strip()
            or not isinstance(place_execution_id, str) or not place_execution_id.strip()
            or not isinstance(expected_inspection_sha256, str)
            or len(expected_inspection_sha256) != 64):
        raise StateError("Action ID, operator, reason, and inspection SHA-256 are required")
    return {"operator": operator.strip(), "reason": reason.strip(), "identity": deepcopy(identity),
            "hold_id": hold_id, "place_execution_id": place_execution_id,
            "expected_inspection_sha256": expected_inspection_sha256,
            "api_url": api_url, "socket_url": socket_url}


def _latest_ready_version(root, identity):
    device = read_json(root / "units" / unit_digest(identity) / "device.json")
    observations = device.get("observations")
    if not isinstance(observations, dict):
        raise StateError("Saved device readiness observation counter is invalid")
    version = observations.get(identity["task_id"] + ":post_place_ready_check", 0)
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        raise StateError("Saved device readiness observation version is invalid")
    return version


def _physical_effect_hash(root, identity):
    path = root / "units" / unit_digest(identity) / "device.json"
    device = read_json(path)
    return _digest({"world": device["world"], "executions": device["executions"]})


def _start_action(root, source, kind, action_id, arguments):
    journal = _actions(root)
    existing = journal["actions"].get(action_id)
    if existing is not None:
        if existing.get("kind") != kind or existing.get("arguments") != arguments:
            raise StateError("Repeated action ID conflicts with immutable operator request")
        return journal, existing, False
    if any(row.get("status") in ("in_progress", "blocked") for row in journal["actions"].values()):
        raise StateError("Another operator action is incomplete; resume its exact action ID")
    snapshot = inspect_state(root, source)
    record = {"schema": SCHEMA, "action_id": action_id, "kind": kind,
              "arguments": arguments, "operator": arguments["operator"],
              "reason": arguments["reason"], "created_utc": _utc(),
              "stage": "intent", "status": "in_progress",
              "before": {"physical": snapshot["physical"], "report": snapshot["report"],
                         "readiness": snapshot["readiness"],
                         "inspection_sha256": snapshot["inspection_sha256"]},
              "physical_effect_sha256": _physical_effect_hash(root, snapshot["physical"]["identity"])
              if isinstance(snapshot["physical"]["identity"], dict) else None,
              "probe_baseline_version": _latest_ready_version(root, snapshot["physical"]["identity"])
              if kind == "release-hold" and isinstance(snapshot["physical"]["identity"], dict) else None,
              "evidence": {}, "after": None, "result": None}
    journal["actions"][action_id] = record
    _save_actions(root, journal)
    return journal, record, True


def _stage(root, journal, record, name, **values):
    record.update(values)
    record["stage"] = name
    _save_actions(root, journal)


def _finish(root, source, journal, record, status, message):
    view = inspect_state(root, source)
    result = {"schema": SCHEMA, "action_id": record["action_id"], "kind": record["kind"],
              "status": status, "message": message, "hold_id": record["arguments"]["hold_id"],
              "before": record["before"],
              "after": {"physical": view["physical"], "report": view["report"],
                        "readiness": view["readiness"]},
              "evidence": record["evidence"]}
    result["historical_replay"] = False
    record["after"] = result["after"]
    record["result"] = result
    record["status"] = status
    record["stage"] = "complete" if status == "complete" else status
    record["finished_utc"] = _utc()
    _save_actions(root, journal)
    return result


def _interrupt(crash_after, stage):
    if crash_after == stage:
        raise RecoveryInterrupted("Interrupted after durable " + stage + " boundary")


def _require_same_physical_effect(root, record):
    baseline = record.get("physical_effect_sha256")
    current = _physical_effect_hash(root, record["arguments"]["identity"])
    if baseline is not None and current != baseline:
        raise StateError("Physical world or execution ledger changed during operator action")


def _require_verified_placement(root, snapshot):
    identity = snapshot["physical"]["identity"]
    path = root / "units" / unit_digest(identity)
    state = read_json(path / "controller.json")
    harness = Harness(path, state["config"], resume=True, assigned=True, lock_owned_externally=True)
    try:
        if not harness._assigned_proof_valid():
            raise StateError("Saved placement does not match physical device readback")
        proof = deepcopy(harness.state["physical_proof"])
    finally:
        harness.close()
    if proof.get("assignment") != identity or proof.get("place_execution_id") != snapshot["physical"]["place_execution_id"]:
        raise StateError("Saved placement identity changed during verification")
    return proof


def _loopback_api(api_url):
    endpoint = urlparse(api_url)
    if (endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "::1", "localhost")
            or endpoint.port is None or endpoint.username is not None or endpoint.password is not None
            or endpoint.path not in ("", "/") or endpoint.query or endpoint.fragment):
        raise StateError("Report readback requires one explicit loopback HTTP API URL")
    return api_url.rstrip("/")


class _ReportOnlyClient(HumanoidRobotClient):
    """Run the pinned client's report recovery with every work entry disabled."""

    async def subscribe_tasks(self):
        return None

    async def request_next_task(self):
        return None

    async def handle_task_assigned(self, data):
        return None

    async def handle_session_created(self, data):
        return None

    async def handle_session_updated(self, data):
        return None

    async def handle_session_completed(self, data):
        return None


async def _send_saved_completion(root, manifest, completion, proof, hold_id, api_url,
                                 socket_url=None):
    if api_url != _loopback_api(manifest.get("readback_url")):
        raise StateError("Report endpoint differs from saved run API")
    endpoint = api_url if socket_url is None else _loopback_api(socket_url)
    if socket_url is not None and endpoint != _loopback_api(manifest.get("socket_url")):
        raise StateError("Report socket endpoint differs from saved run proxy")
    result = load_settings(manifest["settings_source"])
    if result.is_err or result.data is None:
        raise StateError("Saved client settings cannot be loaded: " + result.message)
    settings = result.data
    settings = replace(
        settings,
        server=replace(settings.server, url=endpoint, completion_readback_url=api_url,
                       device_id="humanoid_robot"),
        paths=replace(settings.paths, pending_completions=str(root / "pending-completions.json"),
                      pending_failures=str(root / "pending-failures.json"),
                      locations=str(root / "simulation-locations.json")),
        logging=replace(settings.logging, file=str(root / "operator-client.log")),
    )
    client = _ReportOnlyClient(settings, InertHardware(), RobotClaim(), None,
                               pending_store=PendingCompletionStore(str(root / "pending-completions.json")),
                               pending_failure_store=PendingFailureStore(str(root / "pending-failures.json")))
    client.hold_execution_for_recovery(hold_id, "Operator report-only recovery; physical hold remains",
                                       task_id=completion.task_id)
    try:
        await client.queue_recovered_completion(completion, proof)
        await client.sio.connect(endpoint, namespaces=[settings.server.namespace],
                                 transports=["websocket"], wait_timeout=10)
    finally:
        await client.stop()


def reconcile_report(state_root, client_source, *, action_id, operator, reason, identity, hold_id, place_execution_id,
                     expected_inspection_sha256, api_url, socket_url=None, crash_after=None):
    """Queue and send exact saved proof through the pinned client; never request work."""
    source = validate_client_source(client_source)
    root = Path(state_root).resolve()
    api_url = _loopback_api(api_url)
    if socket_url is not None:
        socket_url = _loopback_api(socket_url)
        manifest = read_json(root / "integration-manifest.json")
        if socket_url != _loopback_api(manifest.get("socket_url")):
            raise StateError("Report socket endpoint differs from saved run proxy")
    args = _action_arguments(action_id, operator, reason, identity, hold_id, place_execution_id,
                             expected_inspection_sha256, api_url, socket_url)
    with _owned(root, identity):
        journal, record, fresh = _start_action(root, source, "reconcile-report", action_id, args)
        if record["status"] in ("complete", "refused"):
            return {**deepcopy(record["result"]), "historical_replay": True, "current_state_not_rechecked": True}
        _interrupt(crash_after, "intent")
        view = inspect_state(root, source)
        if fresh:
            if expected_inspection_sha256 != record["before"]["inspection_sha256"]:
                return _finish(root, source, journal, record, "refused", "Inspection fingerprint changed")
            try:
                _selection(view, identity, hold_id, place_execution_id)
            except StateError as exc:
                return _finish(root, source, journal, record, "refused", str(exc))
            if not view["allowed_actions"]["reconcile_report"]["allowed"]:
                return _finish(root, source, journal, record, "refused",
                               "; ".join(view["allowed_actions"]["reconcile_report"]["reasons"]))
            record["physical_effect_sha256"] = _physical_effect_hash(root, identity)
            _stage(root, journal, record, "intent")
        if (view["physical"]["identity"] != identity or view["physical"]["hold_id"] != hold_id
                or not view["physical"]["placement_verified"]):
            raise StateError("Saved placement hold changed during report reconciliation")
        _require_same_physical_effect(root, record)
        proof = _require_verified_placement(root, view)
        completion = CompletionIdentity(identity["session_id"], identity["task_id"],
                                        identity["order_id"], proof["place_execution_id"])
        store = PendingCompletionStore(str(root / "pending-completions.json"))
        saved = store.get(completion)
        if saved is not None and saved.state is CompletionState.OPERATOR_HOLD:
            return _finish(root, source, journal, record, "refused",
                           "Reporting OPERATOR_HOLD needs its separate resolver")
        if saved is None:
            saved = store.queue(completion, build_completion_payload(identity["session_id"], identity["task_id"]), proof)
        elif saved.terminal_evidence != proof:
            return _finish(root, source, journal, record, "refused",
                           "Saved completion terminal proof conflicts with physical placement")
        _stage(root, journal, record, "queued", evidence={"completion_identity": completion.key,
                                                         "physical_proof_sha256": proof_digest(proof)})
        _interrupt(crash_after, "queued")
        if saved.state is CompletionState.CONFIRMED:
            _report_gate(root, identity, completion.execution_id, proof)
            return _finish(root, source, journal, record, "complete",
                           "Saved exact completion already confirmed; physical hold remains")
        outcome = asyncio.run(read_order_completion(api_url, completion))
        if outcome.kind is ReconciliationKind.CONFIRMED:
            current = store.get(completion)
            if current is None or current.state is not CompletionState.PENDING:
                raise StateError("Completion changed during exact readback")
            store.update(current, state=CompletionState.CONFIRMED,
                         platform_evidence=outcome.evidence, last_error="")
        elif outcome.kind is ReconciliationKind.RETRYABLE:
            manifest = read_json(root / "integration-manifest.json")
            asyncio.run(_send_saved_completion(root, manifest, completion, proof, hold_id,
                                               api_url, socket_url=socket_url))
        else:
            _stage(root, journal, record, "queued", status="blocked",
                   evidence={**record["evidence"], "readback": outcome.kind.value})
            return _finish(root, source, journal, record, "blocked",
                           "Exact platform task cannot be safely reported; physical hold remains")
        _interrupt(crash_after, "report-confirmed")
        current = PendingCompletionStore(str(root / "pending-completions.json")).get(completion)
        if current is None or current.state is not CompletionState.CONFIRMED:
            return _finish(root, source, journal, record, "blocked",
                           "Client report did not confirm exact completion; physical hold remains")
        _report_gate(root, identity, completion.execution_id, proof)
        _require_same_physical_effect(root, record)
        return _finish(root, source, journal, record, "complete",
                       "Exact platform completion confirmed through pinned client; physical hold remains")


def _report_gate(root, identity, place_execution_id, proof):
    store = PendingCompletionStore(str(root / "pending-completions.json"))
    exact = [row for row in store.records()
             if (row.identity.order_id, row.identity.session_id, row.identity.task_id) ==
             (identity["order_id"], identity["session_id"], identity["task_id"])]
    if (len(exact) != 1 or exact[0].identity.execution_id != place_execution_id
            or exact[0].state is not CompletionState.CONFIRMED
            or exact[0].terminal_evidence != proof):
        raise StateError("Exact physical completion is not durably platform-confirmed")
    evidence = exact[0].platform_evidence
    if not isinstance(evidence, dict):
        raise StateError("Confirmed completion has no platform evidence")
    event = evidence.get("eventType")
    if event in ("platform.pick_session_completed", "platform.pick_session_updated"):
        valid = (evidence.get("orderId") == identity["order_id"]
                 and evidence.get("pickSessionId") == identity["session_id"]
                 and evidence.get("pickTaskId", identity["task_id"]) == identity["task_id"])
    else:
        session = (evidence.get("fulfillmentProgress") or {}).get("pickSession") or {}
        tasks = session.get("tasks") or []
        valid = (evidence.get("id") == identity["order_id"]
                 and session.get("sessionId") == identity["session_id"]
                 and any(isinstance(task, dict) and task.get("taskId") == identity["task_id"]
                         and task.get("status") == "COMPLETED" for task in tasks))
    if not valid:
        raise StateError("Saved platform confirmation changed exact task identity")
    view = _report_view(root, identity)
    if view["blockers"]:
        raise StateError("Independent reporting/failure gate remains: " + "; ".join(view["blockers"]))
    return exact[0]


def _release_readiness(before, identity, proof, source):
    observed = proof["readiness_observation"]
    if (proof.get("assignment") != identity or proof.get("readiness_scope") != "at_unit_release"
            or proof.get("recovery_status") != "COMPLETED" or proof.get("provenance") != "humanoid_harness.StubDevice/1"
            or observed.get("held_task_id") is not None or observed.get("motion_quiescent") is not True
            or observed.get("navigation_safe") is not True
            or observed.get("placement_verified") is not True
            or observed.get("posture") != proof.get("recovery_target")):
        raise StateError("Fresh post-place readiness evidence is unsafe or mismatched")
    return {"schema": 1, "status": "ready", "version": before["version"] + 1,
            "identity": identity, "source": source,
            "config_fingerprint": proof["config_fingerprint"],
            "proof_kind": "post_place_retract", "proof_action_id": proof["recovery_execution_id"],
            "proof_sha256": proof_digest(proof), "action_generation": proof["recovery_generation"],
            "observation_version": observed["observation_version"],
            "location": observed["location"], "posture": observed["posture"],
            "held_task_id": None, "held_bun_id": None, "provenance": proof["provenance"]}


def _release_owner(before, ready):
    return {"schema": 1, "status": "idle", "identity": None, "reason": "",
            "readiness_version": ready["version"],
            "hold_version": before["hold_version"], "recovery_hold": None}


def _probe_or_resume(root, identity, record):
    path = root / "units" / unit_digest(identity)
    state = read_json(path / "controller.json")
    harness = Harness(path, state["config"], resume=True, assigned=True, lock_owned_externally=True)
    try:
        if not harness._assigned_proof_valid():
            raise StateError("Saved placement proof failed exact physical readback")
        baseline = record.get("probe_baseline_version")
        if isinstance(baseline, bool) or not isinstance(baseline, int):
            raise StateError("Operator action lacks a durable readiness baseline")
        latest = _latest_ready_version(root, identity)
        if latest < baseline:
            raise StateError("Saved readiness version regressed after operator intent")
        existing = harness.state.get("post_place_readiness_proof")
        owned = (isinstance(existing, dict)
                 and existing.get("operator_action_id") == record["action_id"]
                 and isinstance(existing.get("readiness_observation"), dict)
                 and existing["readiness_observation"].get("observation_version") == latest
                 and latest > baseline)
        if owned:
            if not harness._post_place_proof_valid():
                raise StateError("Saved action-bound readiness proof failed exact readback")
            proof = deepcopy(existing)
        elif latest > baseline:
            if record["stage"] not in ("intent", "probing"):
                raise StateError("Recorded operator readiness proof is absent or belongs to another action")
            proof = None
        elif record["stage"] in ("intent", "probing"):
            proof = harness.operator_probe_post_place_release(record["action_id"])
        else:
            raise StateError("Operator action has no matching durable readiness probe")
    finally:
        harness.close()
    _require_same_physical_effect(root, record)
    return proof


def release_hold(state_root, client_source, *, action_id, operator, reason, identity, hold_id, place_execution_id,
                 expected_inspection_sha256, crash_after=None):
    """Release only a completed, genuinely re-observed simulated physical hold."""
    source = validate_client_source(client_source)
    root = Path(state_root).resolve()
    args = _action_arguments(action_id, operator, reason, identity, hold_id, place_execution_id,
                             expected_inspection_sha256)
    with _owned(root, identity):
        journal, record, fresh = _start_action(root, source, "release-hold", action_id, args)
        if record["status"] in ("complete", "refused"):
            return {**deepcopy(record["result"]), "historical_replay": True, "current_state_not_rechecked": True}
        _interrupt(crash_after, "intent")
        view = inspect_state(root, source)
        if fresh:
            if expected_inspection_sha256 != record["before"]["inspection_sha256"]:
                return _finish(root, source, journal, record, "refused", "Inspection fingerprint changed")
            try:
                _selection(view, identity, hold_id, place_execution_id)
            except StateError as exc:
                return _finish(root, source, journal, record, "refused", str(exc))
            if not view["allowed_actions"]["release_hold"]["allowed"]:
                return _finish(root, source, journal, record, "refused",
                               "; ".join(view["allowed_actions"]["release_hold"]["reasons"]))
            record["physical_effect_sha256"] = _physical_effect_hash(root, identity)
            _stage(root, journal, record, "intent")
        _require_same_physical_effect(root, record)
        saved_controller = read_json(root / "units" / unit_digest(identity) / "controller.json")
        _report_gate(root, identity, saved_controller["physical_proof"]["place_execution_id"], saved_controller["physical_proof"])
        before_owner = record["before"]["owner"] if "owner" in record["before"] else None
        before_ready = record["before"]["readiness_record"] if "readiness_record" in record["before"] else None
        if before_owner is None or before_ready is None:
            before_owner = read_json(root / "device-owner.json")
            before_ready = read_json(root / "device-readiness.json")
            record["before"]["owner"] = deepcopy(before_owner)
            record["before"]["readiness_record"] = deepcopy(before_ready)
            _stage(root, journal, record, "intent")
        if record["stage"] in ("intent", "probing"):
            if read_json(root / "device-owner.json") != before_owner or read_json(root / "device-readiness.json") != before_ready:
                raise StateError("Owner/readiness changed before operator proof was committed")
            if record["stage"] == "intent":
                _stage(root, journal, record, "probing", probe_started_utc=_utc())
                _interrupt(crash_after, "probe-start")
            proof = _probe_or_resume(root, identity, record)
            _interrupt(crash_after, "probe")
            if proof is None:
                return _finish(root, source, journal, record, "refused",
                               "Fresh saved-action readiness observation is not safe; hold remains")
            _stage(root, journal, record, "probed",
                   evidence={"release_proof_sha256": proof_digest(proof),
                             "recovery_execution_id": proof["recovery_execution_id"],
                             "observation_version": proof["readiness_observation"]["observation_version"]})
        proof = _probe_or_resume(root, identity, record)
        if proof is None or proof_digest(proof) != record["evidence"]["release_proof_sha256"]:
            raise StateError("Operator release proof changed after fresh probe")
        unit_controller = read_json(root / "units" / unit_digest(identity) / "controller.json")
        physical_source = unit_controller["physical_proof"]["source"]
        next_ready = _release_readiness(before_ready, identity, proof, physical_source)
        next_owner = _release_owner(before_owner, next_ready)
        current_ready = read_json(root / "device-readiness.json")
        if current_ready == before_ready:
            write_json(root / "device-readiness.json", next_ready)
            _interrupt(crash_after, "readiness")
        elif current_ready != next_ready:
            raise StateError("Readiness changed outside the recorded operator transition")
        _stage(root, journal, record, "readiness-written")
        _report_gate(root, identity, saved_controller["physical_proof"]["place_execution_id"], saved_controller["physical_proof"])
        current_owner = read_json(root / "device-owner.json")
        if current_owner == before_owner:
            write_json(root / "device-owner.json", next_owner)
            _interrupt(crash_after, "owner")
        elif current_owner != next_owner:
            raise StateError("Owner changed outside the recorded operator transition")
        _stage(root, journal, record, "owner-written")
        if read_json(root / "device-owner.json") != next_owner or read_json(root / "device-readiness.json") != next_ready:
            raise StateError("Operator physical release did not persist exact owner/readiness")
        return _finish(root, source, journal, record, "complete",
                       "Exact physical hold released after fresh no-motion readiness; reporting gates remain independent")
