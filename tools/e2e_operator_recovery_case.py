"""Prepared-platform acceptance for offline humanoid operator recovery."""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

import e2e_held_placement_case as held


CASES = ("operator-unknown-retract", "operator-motion-busy-release")
ACTOR = "sim-e2e-operator"
REASON = "Reviewed exact simulated placement, reporting, and release"


def faults(task_id, case):
    if case == "operator-unknown-retract":
        return {task_id: [{"task_id": task_id, "kind": "post_place_retract",
                           "occurrence": 1, "outcome": "unknown"}]}
    if case == "operator-motion-busy-release":
        return {task_id: [{"task_id": task_id, "kind": "post_place_retract",
                           "occurrence": 1, "outcome": "success"},
                          {"task_id": task_id, "kind": "post_place_ready_check",
                           "occurrence": 1, "outcome": "motion_busy"}]}
    raise ValueError("unsupported operator recovery case")


def effect_snapshot(state):
    device = held.read(held.unit(state) / "device.json")
    return {"executions": device["executions"], "world": device["world"]}


def require_no_new_effects(before, after):
    if effect_snapshot(before) != effect_snapshot(after):
        raise RuntimeError("operator action or restart changed physical executions/world")


def retract_evidence(state, task_id, case):
    device = held.read(held.unit(state) / "device.json")
    rows = [value for value in device["executions"].values()
            if value.get("task_id") == task_id
            and value.get("kind") == "post_place_retract"]
    if len(rows) != 1 or rows[0].get("occurrence") != 1:
        raise RuntimeError("expected one original retract execution")
    record = rows[0]
    observations = device.get("release_readiness_observations", {})
    if case == "operator-unknown-retract":
        if (record.get("status") != "UNKNOWN"
                or record.get("effect_applied") is not False or observations):
            raise RuntimeError("UNKNOWN fixture contains a release effect or observation")
    else:
        first = observations.get(task_id + ":1")
        if (record.get("status") != "COMPLETED"
                or record.get("effect_applied") is not True
                or not isinstance(first, dict)
                or first.get("motion_quiescent") is not False
                or first.get("observation_version") != 1
                or first.get("recovery_execution_id") != record.get("execution_id")):
            raise RuntimeError("completed retract lacks first motion-busy observation")
    return record


def invoke(context, label, operation, extra=()):
    argv = [str(context.python), "-m", "humanoid_harness.recovery", operation,
            "--state-root", str(context.root / "humanoid-state"),
            "--client-source", str(context.client_root), "--format", "json", *extra]
    env = dict(os.environ)
    env["PYTHONPATH"] = str(context.sim_root) + ":" + str(context.client_root)
    completed = subprocess.run(argv, cwd=context.sim_root, env=env,
                               capture_output=True, text=True, timeout=40, check=False)
    result = None
    parse_error = None
    if completed.stdout.strip():
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            parse_error = str(exc)
    held.write(context.root / ("operator-" + label + ".json"),
               {"argv": argv, "returncode": completed.returncode,
                "stdout": completed.stdout, "stderr": completed.stderr,
                "result": result, "parse_error": parse_error})
    if parse_error is not None:
        raise RuntimeError("operator CLI emitted non-JSON " + label)
    return result, completed.returncode


def inspection(context, label):
    result, code = invoke(context, label, "inspect")
    if (code or not isinstance(result, dict) or result.get("schema") != 1
            or result.get("offline_saved_snapshot") is not True
            or not isinstance(result.get("inspection_sha256"), str)
            or len(result["inspection_sha256"]) != 64
            or not all(key in result for key in
                       ("physical", "report", "readiness",
                        "allowed_actions", "audit_history"))):
        raise RuntimeError("offline inspection omitted exact saved gates")
    return result


def action_args(identity, hold, inspection_sha256, action_id):
    return ("--action-id", action_id, "--operator", ACTOR,
            "--reason", REASON, "--order-id", identity["order_id"],
            "--session-id", identity["session_id"],
            "--task-id", identity["task_id"],
            "--counter", str(identity["counter"]),
            "--place-execution-id", hold["place_execution_id"],
            "--hold-id", hold["hold_id"],
            "--expected-inspection-sha256", inspection_sha256)


def wait_for_settlement(context, order_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        value = context.snapshot("post-report-api-snapshot", order_id)
        order = value["order"]
        session = (order.get("fulfillmentProgress") or {}).get("pickSession") or {}
        if order.get("status") == "READY" and session.get("status") == "COMPLETED":
            return value
        time.sleep(0.2)
    raise RuntimeError("operator report did not settle exact platform order")


def check_report(before, after, public, ids, hold):
    oid, sid, tid = ids
    for name in ("device-owner.json", "device-readiness.json"):
        if held.read(before / name) != held.read(after / name):
            raise RuntimeError("reconcile-report changed the physical hold")
    require_no_new_effects(before, after)
    order, session, task = held.queue(public, oid, sid, tid)
    if (order.get("status") != "READY" or session.get("status") != "COMPLETED"
            or task.get("status") != "COMPLETED" or task.get("retryCount") != 0
            or held.moon(public) != (7, 7)):
        raise RuntimeError("reconcile-report changed exact task/inventory")
    records = held.read(after / "pending-completions.json").get("records", [])
    if (len(records) != 1
            or records[0].get("identity") !=
            {"execution_id": hold["place_execution_id"],
             "order_id": oid, "session_id": sid, "task_id": tid}
            or records[0].get("state") != "confirmed"
            or records[0].get("attempts") != 1):
        raise RuntimeError("report ledger lacks one confirmed exact completion")
    return records[0]


def ready_observation(before, after, task_id):
    old = held.read(held.unit(before) / "device.json")
    new = held.read(held.unit(after) / "device.json")
    first = old.get("release_readiness_observations", {}).get(task_id + ":1")
    observations = new.get("release_readiness_observations", {})
    if not isinstance(first, dict) or first.get("motion_quiescent") is not False:
        raise RuntimeError("first readiness check was not motion busy")
    later = [value for key, value in observations.items()
             if key.startswith(task_id + ":")
             and key.rsplit(":", 1)[1].isdigit()
             and int(key.rsplit(":", 1)[1]) > 1]
    if not any(row.get("motion_quiescent") is True
               and row.get("navigation_safe") is True
               and row.get("placement_verified") is True for row in later):
        raise RuntimeError("release did not use a later fresh safe observation")
    return max(row["observation_version"] for row in later)


def run_case(context, case):
    if case not in CASES:
        raise ValueError("unknown operator recovery case")
    root = context.root
    if held.moon(context.baseline_snapshot) != (8, 8):
        raise RuntimeError("fresh seed stock differs")
    order = context.api_request(
        "POST", "/api/orders",
        {"customerName": "Operator recovery " + case, "source": "customer_ui",
         "paymentMethod": "alipay",
         "items": [{"itemId": "moon-cake", "quantity": 1,
                    "selectedOptions": {}}]})
    if not isinstance(order, dict) or not isinstance(order.get("id"), str):
        raise RuntimeError("one operator order has no ID")
    oid = order["id"]
    held.write(root / "created-order.json", order)
    sid, tid = asyncio.run(held.bootstrap(context, oid))
    ids = (oid, sid, tid)
    held.write(root / "faults.json", faults(tid, case))
    held.write(root / "humanoid-proxy-control.json", {"sequence": 1, "mode": "pass"})
    env = dict(os.environ)
    env["PYTHONPATH"] = str(context.client_root) + ":" + str(context.sim_root)
    env["PYTHONUNBUFFERED"] = "1"
    proxy = context.managed_process(
        "operator-proxy",
        [str(context.python), str(context.sim_root / "tools/socketio_status_capture_proxy.py"),
         "--listen-port", str(context.humanoid_port),
         "--upstream-port", str(context.api_port),
         "--control-path", str(root / "humanoid-proxy-control.json"),
         "--events-path", str(root / "humanoid-proxy-events.jsonl")],
        context.sim_root, root / "humanoid-proxy.log", dict(env))
    context.children.append(proxy)
    proxy.start()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if proxy.process.poll() is not None:
            raise RuntimeError("operator proxy exited before listen")
        if any(row.get("event") == "listening"
               for row in held.events(root / "humanoid-proxy-events.jsonl")):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("operator proxy did not listen")
    launcher = [str(context.python), "-m", "humanoid_harness.integration",
                "--client-source", str(context.client_root),
                "--settings", str(context.settings_path),
                "--state-root", str(root / "humanoid-state"),
                "--url", "http://127.0.0.1:%d" % context.humanoid_port,
                "--readback-url", "http://127.0.0.1:%d" % context.api_port,
                "--device-id", "humanoid_robot",
                "--faults-json", str(root / "faults.json"),
                "--stop-after-seconds", "35"]
    first = context.managed_process(
        "operator-phase1", [*launcher, "--crash-after-held-placement-once"],
        context.sim_root, root / "operator-phase1.log", dict(env))
    context.children.append(first)
    first.start()
    first.process.wait(timeout=45)
    if first.process.returncode != 78:
        raise RuntimeError("operator fixture did not reach exit-78 held placement")
    checkpoint = held.capture_state(context, "held-crash-checkpoint", oid)
    boundary = held.validate_boundary(root, checkpoint, *ids)
    first_state = root / "held-crash-checkpoint-durable-state"
    retract = retract_evidence(first_state, tid, case)
    checkpoint_frames = held.events(root / "humanoid-proxy-events.jsonl")
    checkpoint_assignments = sum(row.get("event") == "frame"
                                 and row.get("event_name") == "platform.pick_task_assigned"
                                 for row in checkpoint_frames)
    checkpoint_next_requests = sum(row.get("event") == "frame"
                                   and row.get("direction") == "bridge_to_server"
                                   and row.get("event_name") == "hr.pick_next_pick_task"
                                   for row in checkpoint_frames)
    initial = inspection(context, "before-report-inspection")
    if (initial["physical"]["hold_id"] != boundary["recovery_hold"]["hold_id"]
            or initial["physical"]["place_execution_id"] != boundary["place_execution_id"]
            or initial["physical"]["placement_verified"] is not True
            or initial["allowed_actions"]["reconcile_report"]["allowed"] is not True
            or initial["allowed_actions"]["release_hold"]["allowed"] is not False):
        raise RuntimeError("initial operator inspection gates are wrong")
    report_id = str(uuid4())
    report_args = (*action_args(boundary["identity"], boundary["recovery_hold"],
                                initial["inspection_sha256"], report_id),
                   "--api-url", "http://127.0.0.1:%d" % context.api_port,
                   "--socket-url", "http://127.0.0.1:%d" % context.humanoid_port)
    report_result, report_code = invoke(
        context, "reconcile-report", "reconcile-report", report_args)
    if (report_code or not isinstance(report_result, dict)
            or report_result.get("status") != "complete"
            or report_result.get("action_id") != report_id
            or report_result.get("hold_id") != boundary["recovery_hold"]["hold_id"]):
        raise RuntimeError("offline report reconciliation failed")
    report_frames = held.events(root / "humanoid-proxy-events.jsonl")
    reports_after_reconcile = [row for row in report_frames
                               if row.get("event") == "terminal_report_forwarded"]
    if (sum(row.get("event") == "frame" and row.get("event_name") == "platform.pick_task_assigned"
            for row in report_frames) != checkpoint_assignments
            or sum(row.get("event") == "frame" and row.get("direction") == "bridge_to_server"
                   and row.get("event_name") == "hr.pick_next_pick_task"
                   for row in report_frames) != checkpoint_next_requests):
        raise RuntimeError("report-only recovery requested or accepted new work")
    if (len(reports_after_reconcile) != 1
            or reports_after_reconcile[0].get("event_name") != "hr.pick_task_completed"):
        raise RuntimeError("guarded report-only client did not send one exact completion through proxy")
    public_report = wait_for_settlement(context, oid)
    held.capture_state(context, "post-report", oid)
    report_state = root / "post-report-durable-state"
    report_record = check_report(
        first_state, report_state, public_report, ids, boundary["recovery_hold"])
    after_report = inspection(context, "before-release-inspection")
    if (after_report["report"]["state"] != "confirmed"
            or after_report["physical"]["hold_id"] != boundary["recovery_hold"]["hold_id"]
            or (case == "operator-unknown-retract"
                and after_report["allowed_actions"]["release_hold"]["allowed"] is not False)
            or (case == "operator-motion-busy-release"
                and after_report["allowed_actions"]["release_hold"]["allowed"] is not True)):
        raise RuntimeError("report reconciliation bypassed or failed physical release gate")
    release_id = str(uuid4())
    release_args = action_args(boundary["identity"], boundary["recovery_hold"],
                               after_report["inspection_sha256"], release_id)
    release_result, release_code = invoke(
        context, "release-hold", "release-hold", release_args)
    held.capture_state(context, "post-release-attempt", oid)
    release_state = root / "post-release-attempt-durable-state"
    require_no_new_effects(first_state, release_state)
    owner = held.read(release_state / "device-owner.json")
    readiness = held.read(release_state / "device-readiness.json")
    if case == "operator-unknown-retract":
        if (release_code != 2 or not isinstance(release_result, dict)
                or release_result.get("status") != "refused"
                or release_result.get("action_id") != release_id
                or owner != held.read(report_state / "device-owner.json")
                or readiness != held.read(report_state / "device-readiness.json")):
            raise RuntimeError("UNKNOWN retract was released or hold changed")
        observation_version = None
    else:
        if (release_code or not isinstance(release_result, dict)
                or release_result.get("status") != "complete"
                or release_result.get("action_id") != release_id
                or owner.get("status") != "idle"
                or owner.get("recovery_hold") is not None
                or readiness.get("status") != "ready"
                or readiness.get("identity") != boundary["identity"]):
            raise RuntimeError("fresh physical release was not published")
        observation_version = ready_observation(first_state, release_state, tid)
        before_repeat = {
            name: (root / "humanoid-state" / name).read_bytes()
            for name in ("device-owner.json", "device-readiness.json",
                         "operator-recovery.json")
            if (root / "humanoid-state" / name).is_file()}
        repeated, repeated_code = invoke(
            context, "release-hold-repeat", "release-hold", release_args)
        after_repeat = {
            name: (root / "humanoid-state" / name).read_bytes()
            for name in before_repeat}
        if (repeated_code or not isinstance(repeated, dict)
                or repeated.get("historical_replay") is not True
                or repeated.get("current_state_not_rechecked") is not True
                or {key: value for key, value in repeated.items()
                    if key not in ("historical_replay", "current_state_not_rechecked")} !=
                   {key: value for key, value in release_result.items()
                    if key not in ("historical_replay", "current_state_not_rechecked")}
                or before_repeat != after_repeat):
            raise RuntimeError("replayed action ID changed first release or audit")
        conflicting_args = list(release_args)
        conflicting_args[conflicting_args.index("--reason") + 1] = "Different operator intent"
        conflict, conflict_code = invoke(
            context, "release-hold-conflicting-intent", "release-hold", conflicting_args)
        after_conflict = {
            name: (root / "humanoid-state" / name).read_bytes()
            for name in before_repeat}
        if conflict_code == 0 or after_conflict != before_repeat:
            raise RuntimeError("reused action ID accepted changed operator intent")
    audit = inspection(context, "after-release-inspection")
    selected = [row for row in audit["audit_history"]
                if row.get("action_id") in (report_id, release_id)]
    if (len(selected) != 2
            or {row.get("kind") for row in selected} != {"reconcile-report", "release-hold"}
            or any(row.get("operator") != ACTOR or row.get("reason") != REASON
                   for row in selected)):
        raise RuntimeError("durable operator audit lost exact actor, reason, or action IDs")
    second = context.managed_process(
        "operator-phase2", launcher, context.sim_root,
        root / "operator-phase2.log", dict(env))
    context.children.append(second)
    second.start()
    second.process.wait(timeout=45)
    if second.process.returncode != 0:
        raise RuntimeError("ordinary client restart did not stop normally")
    final = held.capture_state(context, "final", oid)
    final_state = root / "final-durable-state"
    require_no_new_effects(first_state, final_state)
    if held.moon(final) != (7, 7):
        raise RuntimeError("restart changed once-only inventory")
    final_records = held.read(final_state / "pending-completions.json")["records"]
    if (len(final_records) != 1
            or final_records[0].get("identity") != report_record.get("identity")
            or final_records[0].get("state") != "confirmed"
            or final_records[0].get("attempts") != report_record.get("attempts")
            or final_records[0].get("terminal_evidence") != report_record.get("terminal_evidence")
            or final_records[0].get("platform_evidence") != report_record.get("platform_evidence")
            or final_records[0].get("callback_acknowledged") != report_record.get("callback_acknowledged")):
        raise RuntimeError("restart rewrote or resent exact completion")
    held.validate_client(held.read(final_state / "integration-manifest.json"),
                         context.client_root, context.client_hashes)
    frames = held.events(root / "humanoid-proxy-events.jsonl")
    reports = [row for row in frames if row.get("event") == "terminal_report_forwarded"]
    assignments = [row for row in frames if row.get("event") == "frame"
                   and row.get("event_name") == "platform.pick_task_assigned"]
    next_requests = [row for row in frames if row.get("event") == "frame"
                     and row.get("direction") == "bridge_to_server"
                     and row.get("event_name") == "hr.pick_next_pick_task"]
    if (len(reports) != 1
            or reports[0] != reports_after_reconcile[0]
            or len(assignments) != checkpoint_assignments
            or (case == "operator-unknown-retract"
                and len(next_requests) != checkpoint_next_requests)):
        raise RuntimeError("restart duplicated completion or accepted new task")
    human = [row for row in final["devices"]["devices"]
             if row.get("deviceId") == "humanoid_robot"]
    expected = "PAUSED" if case == "operator-unknown-retract" else "FREE"
    if len(human) != 1 or human[0].get("state") != expected:
        raise RuntimeError("post-restart device state violates readiness gate")
    return {"case": case, "database": context.database_name,
            "order_id": oid, "session_id": sid, "task_id": tid,
            "place_execution_id": boundary["place_execution_id"],
            "retract_execution_id": retract["execution_id"],
            "hold_id": boundary["recovery_hold"]["hold_id"],
            "report_action_id": report_id, "release_action_id": release_id,
            "report_result": report_result, "release_result": release_result,
            "release_returncode": release_code,
            "fresh_observation_version": observation_version,
            "final_device_state": expected, "phase1_returncode": 78,
            "phase2_returncode": 0, "completion_wire_reports": len(reports),
            "duplicate_completion_reports": len(reports) - 1,
            "new_physical_effects": 0,
            "new_assignments": len(assignments) - checkpoint_assignments,
            "next_task_requests_before_reconcile": checkpoint_next_requests,
            "next_task_requests_after_restart": len(next_requests)}
