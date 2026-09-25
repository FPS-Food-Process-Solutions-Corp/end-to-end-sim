"""Fresh simulated held-placement crash, restart, and exact proof."""

import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import socketio


def utc():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def events(path):
    path = Path(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.is_file() else []


def unit(state):
    rows = [path for path in (state / "units").iterdir() if path.is_dir()]
    if len(rows) != 1:
        raise RuntimeError("expected one exact physical unit")
    return rows[0]


def queue(snapshot, oid, sid, tid):
    rows = [row for section in ("preparing", "ready", "queued") for row in snapshot["queue"][section]
            if row.get("order", {}).get("id") == oid]
    if len(rows) != 1:
        raise RuntimeError("public queue lost exact order")
    row = rows[0]
    session = row.get("pickSession", {})
    tasks = session.get("tasks", [])
    if (session.get("pickSessionId") != sid or len(tasks) != 1 or tasks[0].get("pickTaskId") != tid):
        raise RuntimeError("public queue lost exact session or task")
    return row["order"], session, tasks[0]


def moon(snapshot):
    rows = [row for row in snapshot["inventory"]["snacks"]["items"] if row.get("itemId") == "moon-cake"]
    if len(rows) != 1:
        raise RuntimeError("moon-cake inventory row missing")
    return rows[0]["databaseQuantity"], rows[0]["availableQuantity"]


def digest(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(raw).hexdigest()


def effects(state):
    rows = [row for row in events(unit(state) / "events.jsonl") if row.get("event") == "execution_terminal"]
    keys = [(row.get("execution_id"), row.get("phase"), row.get("status")) for row in rows]
    if len(keys) != len(set(keys)):
        raise RuntimeError("duplicate physical terminal event")
    return rows, set(keys)


def validate_boundary(root, snapshot, oid, sid, tid):
    state = root / "held-crash-checkpoint-durable-state"
    marker = read(state / "crash-after-held-placement.used.json")
    owner = read(state / "device-owner.json")
    readiness = read(state / "device-readiness.json")
    proof = read(unit(state) / "controller.json").get("physical_proof")
    world = read(unit(state) / "summary.json").get("world", {})
    rows, terminals = effects(state)
    place = [row for row in rows if row.get("phase") == "place" and row.get("status") == "COMPLETED"]
    identity = {"order_id": oid, "session_id": sid, "task_id": tid, "counter": snapshot["order"].get("counterArea")}
    hold = owner.get("recovery_hold")
    if not isinstance(proof, dict) or not isinstance(hold, dict) or not isinstance(hold.get("version"), int):
        raise RuntimeError("held boundary has no durable place proof or hold")
    context = {"schema": 1, "version": hold["version"], "assignment": identity,
               "source": proof.get("source"), "config_fingerprint": proof.get("config_fingerprint"),
               "readiness_version": readiness.get("version"), "placement_proof_sha256": digest(proof),
               "place_execution_id": proof.get("place_execution_id")}
    token = "sim-placement/" + digest(context)
    if (identity["counter"] != 2 or len(place) != 1
            or place[0].get("execution_id") != proof.get("place_execution_id")
            or marker.get("place_execution_id") != proof.get("place_execution_id")
            or marker.get("identity") != identity or owner.get("status") != "hold"
            or owner.get("identity") != identity or hold.get("hold_id") != token
            or hold.get("task_id") != tid or hold.get("version") != owner.get("hold_version")
            or owner.get("readiness_version") != readiness.get("version")
            or any(hold.get(key) != value for key, value in context.items())
            or readiness.get("status") != "unknown"
            or len(world.get("counter_bun_ids", {}).get("2", [])) != 1
            or world.get("held_bun_id") is not None or world.get("rack_buns", {}).get(tid) is not False
            or (state / "pending-completions.json").exists()
            or any(row.get("event_name") == "hr.pick_task_completed"
                   for row in events(root / "humanoid-proxy-events.jsonl"))):
        raise RuntimeError("exit-78 boundary lacks exact placement, hold, or empty completion queue")
    order, session, task = queue(snapshot, oid, sid, tid)
    if (snapshot["order"].get("id") != oid or snapshot["order"].get("status") != "PREPARING"
            or order.get("status") != "PREPARING" or session.get("status") != "CREATED"
            or task.get("status") != "IN_PROGRESS" or task.get("retryCount") != 0
            or moon(snapshot) != (8, 7)):
        raise RuntimeError("held checkpoint public task/inventory changed")
    return {"identity": identity, "place_execution_id": proof["place_execution_id"],
            "recovery_hold": hold, "terminal_effects": terminals}


def validate_client(manifest, root, hashes):
    root = Path(root).resolve()
    if (manifest.get("client_source") != str(root)
            or manifest.get("loaded_client_file") != str(root / "hr_client/client.py")
            or manifest.get("device_id") != "humanoid_robot"
            or manifest.get("client_pin_scheme") != "sha256-crlf-to-lf-v1"):
        raise RuntimeError("held launcher selected wrong client source or device")
    for name in ("client.py", "pending_completion.py", "pending_failure.py", "settings.py"):
        path = root / "hr_client" / name
        content = path.read_bytes()
        raw = hashlib.sha256(content).hexdigest()
        normalized = hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()
        pin = manifest.get("pinned_sources", {}).get(name, {})
        loaded = manifest.get("loaded_sources", {}).get("hr_client." + name[:-3], {})
        if (raw != hashes.get(name) or pin.get("path") != str(path)
                or pin.get("sha256") != raw or pin.get("normalized_sha256") != normalized
                or loaded.get("path") != str(path) or loaded.get("sha256") != raw
                or loaded.get("normalized_sha256") != normalized):
            raise RuntimeError("held launcher loaded wrong client module: " + name)
    content = (root / "hr_client/client.py").read_bytes()
    if (manifest.get("loaded_client_sha256") != hashes["client.py"]
            or manifest.get("loaded_client_normalized_sha256") !=
            hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()):
        raise RuntimeError("held launcher top-level client hash mismatch")


def validate_settlement(root, baseline, checkpoint, final, ids, boundary, client_root, client_hashes):
    oid, sid, tid = ids
    before = root / "held-crash-checkpoint-durable-state"
    after = root / "final-durable-state"
    if [moon(s) for s in (baseline, checkpoint, final)] != [(8, 8), (8, 7), (7, 7)]:
        raise RuntimeError("held inventory chronology changed")
    owner0, owner1 = read(before / "device-owner.json"), read(after / "device-owner.json")
    ready0, ready1 = read(before / "device-readiness.json"), read(after / "device-readiness.json")
    manifest = read(after / "integration-manifest.json")
    validate_client(manifest, client_root, client_hashes)
    if (owner0 != owner1 or ready0 != ready1 or owner1.get("status") != "hold"
            or ready1.get("status") != "unknown" or owner1.get("recovery_hold") != boundary["recovery_hold"]
            or manifest.get("recovery_hold_id") != boundary["recovery_hold"]["hold_id"]
            or len(manifest.get("recovered_completions", [])) != 1):
        raise RuntimeError("held owner/readiness changed during recovery")
    records = read(after / "pending-completions.json").get("records", [])
    if len(records) != 1:
        raise RuntimeError("expected one exact completion record")
    record = records[0]
    proof = read(unit(after) / "controller.json").get("physical_proof")
    platform = record.get("platform_evidence", {})
    if (record.get("identity") != {"execution_id": boundary["place_execution_id"],
                                   "order_id": oid, "session_id": sid, "task_id": tid}
            or record.get("state") != "confirmed" or record.get("attempts") != 1
            or record.get("callback_acknowledged") is not False
            or record.get("terminal_evidence") != proof
            or platform.get("eventType") != "platform.pick_session_completed"
            or platform.get("orderId") != oid or platform.get("pickSessionId") != sid):
        raise RuntimeError("held completion or platform ack identity changed")
    order, session, task = queue(final, oid, sid, tid)
    if (final["order"].get("id") != oid or final["order"].get("status") != "READY"
            or order.get("status") != "READY" or session.get("status") != "COMPLETED"
            or task.get("status") != "COMPLETED" or task.get("retryCount") != 0):
        raise RuntimeError("original held task did not settle")
    if read(unit(before) / "device.json") != read(unit(after) / "device.json"):
        raise RuntimeError("restart changed physical device or effect counts")
    before_rows, before_effects = effects(before)
    after_rows, after_effects = effects(after)
    counts = Counter((phase, status) for _, phase, status in after_effects)
    if (before_effects != after_effects or len(before_rows) != len(after_rows)
            or counts[("pick", "COMPLETED")] != 1 or counts[("place", "COMPLETED")] != 1
            or sum(count for (phase, _), count in counts.items() if phase == "post_place_retract") != 1):
        raise RuntimeError("restart added or changed physical terminal effects")
    world = read(unit(after) / "summary.json").get("world", {})
    if world.get("counter_bun_ids", {}).get("2") != [proof.get("bun_id")] or world.get("held_task_id") is not None:
        raise RuntimeError("held bun location changed after restart")
    return {"order_id": oid, "session_id": sid, "task_id": tid,
            "place_execution_id": boundary["place_execution_id"], "recovery_hold_id": boundary["recovery_hold"]["hold_id"],
            "platform_order": "READY", "platform_session": "COMPLETED", "platform_task": "COMPLETED",
            "client_completion_state": "confirmed", "client_completion_attempts": 1,
            "completion_callback_acknowledged": False,
            "inventory": {"database_quantity": [8, 8, 7], "available_quantity": [8, 7, 7]},
            "physical_effects_unchanged": True}


def phase2_hold_sustained(rows, started_epoch, observations):
    upgrades = [row for row in rows if row.get("event") == "upgrade_complete"
                and row.get("timestamp", 0) >= started_epoch]
    if len(upgrades) != 1:
        return False, []
    current = [row for row in rows if row.get("timestamp", 0) >= upgrades[0]["timestamp"]]
    statuses = [row for row in current if row.get("event") == "humanoid_status_report_observed"]
    valid = (bool(statuses)
             and all(row.get("valid") is True and row.get("state") == "PAUSED" for row in statuses)
             and not any(row.get("event_name") == "hr.pick_next_pick_task" for row in current)
             and any(row.get("device", {}).get("state") == "PAUSED" for row in observations)
             and not any(row.get("device", {}).get("state") == "FREE" for row in observations))
    return valid, statuses


async def bootstrap(context, oid):
    records = []
    client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    @client.on("platform.pick_session_created", namespace="/socket-bridge")
    async def created(payload):
        records.append({"utc": utc(), "direction": "received", "event": "platform.pick_session_created", "payload": payload})
    await client.connect("http://127.0.0.1:%d" % context.api_port,
                         namespaces=["/socket-bridge"], transports=["websocket"], wait_timeout=8)
    try:
        pairs = (("hr.subscribe_tasks", {}),
                 ("hr.status_reported", {"devices": [{"deviceId": "humanoid_robot", "state": "FREE",
                                                       "online": True, "currentTaskId": None,
                                                       "message": "Fresh simulated front, idle, empty hands, no motion"}]}))
        for name, payload in pairs:
            records.append({"utc": utc(), "direction": "sent", "event": name, "payload": payload})
            ack = await client.call(name, payload, namespace="/socket-bridge", timeout=8)
            records.append({"utc": utc(), "direction": "ack", "event": name, "payload": ack})
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            order = context.api_request("GET", "/api/orders/" + oid)
            session = (order.get("fulfillmentProgress") or {}).get("pickSession") or {}
            tasks = session.get("tasks") or []
            if (order.get("id") == oid and len(tasks) == 1 and tasks[0].get("status") == "UNASSIGNED"
                    and isinstance(session.get("sessionId"), str) and session["sessionId"]
                    and isinstance(tasks[0].get("taskId"), str) and tasks[0]["taskId"]):
                write(context.root / "bootstrap-order.json", order)
                return session["sessionId"], tasks[0]["taskId"]
            await asyncio.sleep(0.2)
        raise RuntimeError("held bootstrap did not expose one exact UNASSIGNED task")
    finally:
        await client.disconnect()
        write(context.root / "bootstrap-socket-events.json",
              {"allowed_sent_events": ["hr.subscribe_tasks", "hr.status_reported"], "events": records})


def capture_state(context, name, oid):
    snapshot = context.snapshot(name + "-api-snapshot", oid)
    shutil.copytree(context.root / "humanoid-state", context.root / (name + "-durable-state"))
    return snapshot


def run_case(context):
    root = context.root
    baseline = context.baseline_snapshot
    if moon(baseline) != (8, 8):
        raise RuntimeError("fresh held baseline inventory changed")
    order = context.api_request("POST", "/api/orders",
                                {"customerName": "Simulated held placement restart", "source": "customer_ui",
                                 "paymentMethod": "alipay",
                                 "items": [{"itemId": "moon-cake", "quantity": 1, "selectedOptions": {}}]})
    if not isinstance(order, dict) or not isinstance(order.get("id"), str) or not order["id"]:
        raise RuntimeError("held order creation returned no ID")
    oid = order["id"]
    write(root / "created-order.json", order)
    sid, tid = asyncio.run(bootstrap(context, oid))
    ids = (oid, sid, tid)
    write(root / "exact-task-before-fault.json",
          {"order_id": oid, "session_id": sid, "task_id": tid,
           "source": "public order readback after public socket bootstrap"})
    write(root / "faults.json", {tid: [{"task_id": tid, "kind": "post_place_retract",
                                      "occurrence": 1, "outcome": "unknown"}]})
    write(root / "humanoid-proxy-control.json", {"sequence": 1, "mode": "pass"})
    env = dict(os.environ)
    env["PYTHONPATH"] = str(context.client_root) + ":" + str(context.sim_root)
    env["PYTHONUNBUFFERED"] = "1"
    proxy = context.managed_process(
        "humanoid-proxy", [str(context.python), str(context.sim_root / "tools/socketio_status_capture_proxy.py"),
                           "--listen-port", str(context.humanoid_port), "--upstream-port", str(context.api_port),
                           "--control-path", str(root / "humanoid-proxy-control.json"),
                           "--events-path", str(root / "humanoid-proxy-events.jsonl")],
        context.sim_root, root / "humanoid-proxy.log", dict(env))
    context.children.append(proxy)
    proxy.start()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if proxy.process.poll() is not None:
            raise RuntimeError("held proxy exited before listening")
        if any(row.get("event") == "listening" for row in events(root / "humanoid-proxy-events.jsonl")):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("held proxy did not listen")
    launcher = [str(context.python), "-m", "humanoid_harness.integration",
                "--client-source", str(context.client_root), "--settings", str(context.settings_path),
                "--state-root", str(root / "humanoid-state"),
                "--url", "http://127.0.0.1:%d" % context.humanoid_port,
                "--readback-url", "http://127.0.0.1:%d" % context.api_port,
                "--device-id", "humanoid_robot", "--faults-json", str(root / "faults.json"),
                "--crash-after-held-placement-once", "--stop-after-seconds", "45"]
    first = context.managed_process("held-phase1", launcher, context.sim_root, root / "held-phase1.log", dict(env))
    context.children.append(first)
    first.start()
    first.process.wait(timeout=45)
    if first.process.returncode != 78:
        raise RuntimeError("first launcher did not exit at held-placement boundary 78")
    checkpoint = capture_state(context, "held-crash-checkpoint", oid)
    boundary = validate_boundary(root, checkpoint, *ids)
    write(root / "held-crash-checkpoint-summary.json",
          {"utc": utc(), "launcher_returncode": 78,
           "identity": boundary["identity"], "place_execution_id": boundary["place_execution_id"],
           "recovery_hold": boundary["recovery_hold"]})
    context.emit("held_crash_boundary_verified", place_execution_id=boundary["place_execution_id"])
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if any(row.get("event") == "connection_closed" for row in events(root / "humanoid-proxy-events.jsonl")):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("phase1 proxy connection did not close before restart")
    started = time.time()
    second = context.managed_process("held-phase2", launcher, context.sim_root, root / "held-phase2.log", dict(env))
    context.children.append(second)
    second.start()
    observations = []
    deadline = time.monotonic() + 90
    while second.process.poll() is None and time.monotonic() < deadline:
        try:
            devices = context.api_request("GET", "/api/admin/devices")
            matches = [row for row in devices.get("devices", []) if row.get("deviceId") == "humanoid_robot"]
            if len(matches) == 1:
                observations.append({"utc": utc(), "device": matches[0]})
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    write(root / "phase2-device-observations.json", observations)
    if second.process.poll() is None:
        raise RuntimeError("restart launcher exceeded bounded stop deadline")
    if second.process.returncode != 0:
        raise RuntimeError("restart launcher did not stop normally")
    final = capture_state(context, "final", oid)
    settled = validate_settlement(root, baseline, checkpoint, final, ids, boundary,
                                  context.client_root, context.client_hashes)
    sustained, statuses = phase2_hold_sustained(events(root / "humanoid-proxy-events.jsonl"),
                                                started, observations)
    if not sustained:
        raise RuntimeError("restart emitted non-PAUSED status or requested another task")
    write(root / "phase2-proxy-status-summary.json",
          {"started_epoch": started, "statuses": statuses, "next_task_requests": 0,
           "observations": len(observations)})
    return {"case": "held-placement-restart", "database": context.database_name, **settled,
            "phase1_returncode": 78, "phase2_returncode": 0, "phase2_paused_reports": len(statuses),
            "admin_paused_observations": sum(row["device"].get("state") == "PAUSED" for row in observations),
            "admin_free_observations": 0, "next_task_requests": 0}
