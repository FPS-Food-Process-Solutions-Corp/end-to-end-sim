"""Run one generic client Socket.IO recovery scenario against a real API."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import shutil
from time import monotonic, sleep
from urllib.request import Request, urlopen


ROOT = Path("/mnt/d/Work/FPS/Robotics/end-to-end-sim")
ENTRYPOINT = ROOT / "tools/generic_client_recovery_entrypoint.py"
PROXY = ROOT / "tools/socketio_fault_proxy.py"
CLIENT_SOURCE = Path("/mnt/c/Users/andyl/.codex/worktrees/dfcb/platform-client")
PYTHON = Path("/home/user/.venvs/end-to-end-sim-ros/bin/python")
EXPECTED_CLIENT_SHA256 = "13aa4cac6cc843a76b451e123da3784c2e7674b3dfa27e7c4a0fe00f5c924a85"
EXPECTED_PENDING_SHA256 = "006e47f6c1510bfcda9c019aef5f7741e73187ce14b64a3f6b11fc358520b402"


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="ascii")
    temporary.replace(path)


def request_json(method, url, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    with urlopen(Request(url, method=method, data=body, headers=headers), timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for(predicate, deadline, message, processes):
    while monotonic() < deadline:
        for process in processes:
            if process.poll() is not None:
                raise RuntimeError("owned process exited while waiting for %s" % message)
        result = predicate()
        if result is not None:
            return result
        sleep(0.05)
    raise RuntimeError("deadline exceeded waiting for " + message)


def events(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="ascii").splitlines() if line]


def trace_events(path):
    if not path.exists():
        return []
    result = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("CELL_TRACE "):
            result.append(json.loads(line[len("CELL_TRACE "):]))
    return result


def pending_store(path):
    return json.loads(path.read_text(encoding="ascii"))


def pending_record(path, task_id):
    if not path.exists():
        return None
    records = pending_store(path).get("records", [])
    matches = [record for record in records if record.get("identity", {}).get("task_id") == task_id]
    if len(matches) != 1:
        return None
    return matches[0]


def terminal_report_count(path):
    return sum(event.get("event") == "terminal_report_forwarded" for event in events(path))


def statuses(order):
    progress = order.get("fulfillmentProgress", {})
    session = progress.get("pickSession", {}) if isinstance(progress, dict) else {}
    tasks = session.get("tasks", []) if isinstance(session, dict) else []
    return [task.get("status") for task in tasks if isinstance(task, dict)]


def croissant_quantity(inventory):
    if isinstance(inventory, dict):
        rack = inventory.get("rackArea")
        if isinstance(rack, dict) and rack.get("areaId") == "rack_a_level_1_slot_1":
            return inventory.get("databaseQuantity")
        for item in inventory.values():
            found = croissant_quantity(item)
            if found is not None:
                return found
    if isinstance(inventory, list):
        for item in inventory:
            found = croissant_quantity(item)
            if found is not None:
                return found
    return None


def nova_device(payload):
    if isinstance(payload, dict):
        if payload.get("deviceId") == "nova5_arm":
            return payload
        for value in payload.values():
            device = nova_device(value)
            if device is not None:
                return device
    if isinstance(payload, list):
        for value in payload:
            device = nova_device(value)
            if device is not None:
                return device
    return None


def free_device(api):
    device = nova_device(request_json("GET", api + "/api/admin/devices"))
    return device if isinstance(device, dict) and device.get("state") == "FREE" else None


def paused_device(api):
    device = nova_device(request_json("GET", api + "/api/admin/devices"))
    return device if isinstance(device, dict) and device.get("state") == "PAUSED" else None


def create_order(api, label):
    return request_json("POST", api + "/api/orders", {"customerName": label, "source": "customer_ui", "paymentMethod": "alipay", "items": [{"itemId": "croissant", "quantity": 1, "selectedOptions": {}}]})


def read_order(api, order_id):
    return request_json("GET", api + "/api/orders/" + order_id)


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)


def validate_loaded_client(path, index=0):
    loaded_events = [event for event in events(path) if event.get("event") == "loaded"]
    if len(loaded_events) <= index:
        return None
    loaded = loaded_events[index]
    client_path = CLIENT_SOURCE / "hr_client/client.py"
    pending_path = CLIENT_SOURCE / "hr_client/pending_completion.py"
    if hashlib.sha256(client_path.read_bytes()).hexdigest() != EXPECTED_CLIENT_SHA256:
        raise RuntimeError("local client source hash does not match the approved recovery target")
    if hashlib.sha256(pending_path.read_bytes()).hexdigest() != EXPECTED_PENDING_SHA256:
        raise RuntimeError("local pending completion source hash does not match the approved recovery target")
    if loaded.get("client_path") != str(client_path).replace("\\", "/"):
        raise RuntimeError("entrypoint loaded a different client path")
    if loaded.get("pending_completion_path") != str(pending_path).replace("\\", "/"):
        raise RuntimeError("entrypoint loaded a different pending completion path")
    if loaded.get("client_sha256") != EXPECTED_CLIENT_SHA256 or loaded.get("pending_completion_sha256") != EXPECTED_PENDING_SHA256:
        raise RuntimeError("entrypoint loaded source hashes do not match the approved recovery target")
    return loaded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--api", default="http://127.0.0.1:3111")
    parser.add_argument("--proxy-port", type=int, default=3112)
    parser.add_argument("--label", required=True)
    parser.add_argument("--case", choices=("disconnect-after-start", "lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart", "cancel-late-success"), required=True)
    args = parser.parse_args()
    if args.api != "http://127.0.0.1:3111":
        raise RuntimeError("this harness binds only to the owned API at http://127.0.0.1:3111")
    runtime = args.runtime.resolve()
    if runtime.exists() and any(runtime.iterdir()):
        raise RuntimeError("runtime must be new and empty")
    runtime.mkdir(parents=True)
    for name in ("poses.json", "locations.json"):
        (runtime / name).write_bytes((CLIENT_SOURCE / "hr_client/config" / name).read_bytes())
    shutil.copytree(CLIENT_SOURCE / "hr_client/config/trajectories", runtime / "trajectories")
    settings = json.loads((CLIENT_SOURCE / "hr_client/config/hr_settings.json").read_text(encoding="ascii"))
    settings["server"]["url"] = "http://127.0.0.1:%d" % args.proxy_port
    settings["server"]["completion_readback_url"] = args.api
    settings["server"]["device_id"] = "nova5_arm"
    settings["server"]["report_timeout_s"] = 10.0 if args.case in ("lost-terminal-ack-queued", "abrupt-queued-report-restart") else 2.0
    settings["paths"]["pending_completions"] = str(runtime / "pending-completions.json")
    write_json(runtime / "settings.json", settings)
    hold = args.case in ("lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart")
    write_json(runtime / "proxy-control.json", {"sequence": 1, "mode": "hold_after_terminal" if hold else "pass"})
    baseline = request_json("GET", args.api + "/api/inventory")
    proxy_log = (runtime / "proxy.log").open("ab", buffering=0)
    client_log = (runtime / "client.log").open("ab", buffering=0)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(CLIENT_SOURCE)
    proxy = subprocess.Popen([str(PYTHON), str(PROXY), "--listen-port", str(args.proxy_port), "--upstream-port", "3111", "--control-path", str(runtime / "proxy-control.json"), "--events-path", str(runtime / "proxy-events.jsonl")], cwd=ROOT, stdout=proxy_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    client = None
    try:
        wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "listening"), None), monotonic() + 15, "proxy listening", [proxy])
        client = subprocess.Popen([str(PYTHON), str(ENTRYPOINT), "--settings", str(runtime / "settings.json"), "--events", str(runtime / "client-events.jsonl"), "--delay", "1"], cwd=ROOT, env=environment, stdout=client_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "upgrade_complete"), None), monotonic() + 15, "client Socket.IO registration", [proxy, client])
        loaded = wait_for(lambda: validate_loaded_client(runtime / "client-events.jsonl"), monotonic() + 15, "approved loaded client identity", [proxy, client])
        device_before = wait_for(lambda: free_device(args.api), monotonic() + 20, "actual nova5_arm FREE device snapshot before first order", [proxy, client])
        order = create_order(args.api, args.label + " first")
        start = wait_for(lambda: next((event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"), None), monotonic() + 20, "fake executor start", [proxy, client])
        if args.case == "cancel-late-success":
            request_json("PATCH", args.api + "/api/orders/" + order["id"] + "/status", {"status": "CANCELLED"})
            terminal = wait_for(lambda: next((event for event in events(runtime / "client-events.jsonl") if event.get("event") == "terminal" and event.get("task_id") == start["task_id"] and event.get("outcome") == "SUCCEEDED"), None), monotonic() + 10, "simulated terminal success after cancellation", [proxy, client])
            cancelled = wait_for(lambda: read_order(args.api, order["id"]) if read_order(args.api, order["id"]).get("status") == "CANCELLED" else None, monotonic() + 10, "original cancelled order", [proxy, client])
            def operator_hold_record():
                record = pending_record(runtime / "pending-completions.json", start["task_id"])
                if record is None or record.get("state") != "operator_hold":
                    return None
                if record.get("identity", {}).get("execution_id") != start["execution_id"] or record.get("terminal_evidence", {}).get("outcome") != "SUCCEEDED":
                    return None
                if record.get("platform_evidence") is not None or not record.get("last_error"):
                    return None
                return record
            held = wait_for(operator_hold_record, monotonic() + 20, "cancelled completion operator hold", [proxy, client])
            device_paused = wait_for(lambda: paused_device(args.api), monotonic() + 20, "actual nova5_arm PAUSED after cancellation", [proxy, client])
            follow = create_order(args.api, args.label + " follow-up")
            sleep(3)
            follow_snapshot = read_order(args.api, follow["id"])
            starts = [event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]
            after = request_json("GET", args.api + "/api/inventory")
            if follow_snapshot.get("status") != "QUEUED" or len(starts) != 1:
                raise RuntimeError("cancel hold dispatched follow-up work")
            if croissant_quantity(after) != croissant_quantity(baseline):
                raise RuntimeError("cancel hold changed inventory")
            write_json(runtime / "cancel-follow-up-snapshot.json", {"order": follow_snapshot, "starts": starts, "device": device_paused, "inventory_before": croissant_quantity(baseline), "inventory_after": croissant_quantity(after)})
            write_json(runtime / "result.json", {"case": args.case, "original_order": cancelled, "follow_up_order": follow_snapshot, "terminal": terminal, "operator_hold": held, "fake_start_count": len(starts), "loaded_client": loaded, "inventory_before": croissant_quantity(baseline), "inventory_after": croissant_quantity(after), "device_before": device_before, "device_after": device_paused, "final_client_status": device_paused["state"], "pending_completion_store": pending_store(runtime / "pending-completions.json")})
            return
        if hold:
            if args.case in ("lost-terminal-ack-queued", "abrupt-queued-report-restart"):
                def five_terminal_reports():
                    count = terminal_report_count(runtime / "proxy-events.jsonl")
                    if count > 5:
                        raise RuntimeError("terminal report retry budget exceeded before queueing: %d" % count)
                    return count if count == 5 else None
                wait_for(five_terminal_reports, monotonic() + 75, "five real terminal report attempts", [proxy, client])
            else:
                wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "terminal_report_forwarded"), None), monotonic() + 20, "terminal report forwarded", [proxy, client])
            wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "terminal_response_withheld"), None), monotonic() + 20, "terminal acknowledgement withheld", [proxy, client])
            if args.case == "lost-terminal-ack":
                committed_before_close = wait_for(lambda: read_order(args.api, order["id"]) if "COMPLETED" in statuses(read_order(args.api, order["id"])) and read_order(args.api, order["id"]).get("status") == "READY" else None, monotonic() + 20, "committed original order before forced socket close", [proxy, client])
                write_json(runtime / "committed-before-close.json", committed_before_close)
            if args.case in ("lost-terminal-ack-queued", "abrupt-queued-report-restart"):
                def queued_record():
                    record = pending_record(runtime / "pending-completions.json", start["task_id"])
                    traces = trace_events(runtime / "client.log")
                    queued = [entry for entry in traces if entry.get("event") == "completion_queued" and entry.get("task_id") == start["task_id"]]
                    if record is not None and record.get("state") == "pending" and queued:
                        return record
                    return None
                queued = wait_for(queued_record, monotonic() + 75, "exact durable queued completion trace", [proxy, client])
                queued_snapshot = {"identity": queued["identity"], "terminal_evidence": queued["terminal_evidence"], "state": queued["state"], "attempts": queued["attempts"]}
                snapshot_name = "queued-before-kill.json" if args.case == "abrupt-queued-report-restart" else "queued-before-reconnect.json"
                write_json(runtime / snapshot_name, queued_snapshot)
            if args.case == "abrupt-queued-report-restart":
                write_json(runtime / "proxy-control.json", {"sequence": 2, "mode": "pass"})
                wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "control_applied" and event.get("sequence") == 2 and event.get("mode") == "pass"), None), monotonic() + 10, "proxy pass mode before owned client kill", [proxy, client])
                first_client_pid = client.pid
                os.killpg(client.pid, signal.SIGKILL)
                client.wait(timeout=10)
                client = subprocess.Popen([str(PYTHON), str(ENTRYPOINT), "--settings", str(runtime / "settings.json"), "--events", str(runtime / "client-events.jsonl"), "--delay", "1"], cwd=ROOT, env=environment, stdout=client_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
                second_loaded = wait_for(lambda: validate_loaded_client(runtime / "client-events.jsonl", 1), monotonic() + 15, "second approved loaded client identity", [proxy, client])
                persisted_before_dispatch = pending_record(runtime / "pending-completions.json", start["task_id"])
                if persisted_before_dispatch is None or persisted_before_dispatch.get("state") != "pending" or persisted_before_dispatch.get("identity") != queued_snapshot["identity"] or persisted_before_dispatch.get("terminal_evidence") != queued_snapshot["terminal_evidence"]:
                    raise RuntimeError("restart did not preserve the exact queued completion before dispatch")
                if len([event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]) != 1:
                    raise RuntimeError("original task was repeated during generic client restart")
                write_json(runtime / "restart-proof.json", {"first_client_pid": first_client_pid, "second_client_pid": client.pid, "queued_before_kill": queued_snapshot, "second_loaded_client": second_loaded, "persisted_before_dispatch": persisted_before_dispatch})
            else:
                write_json(runtime / "proxy-control.json", {"sequence": 2, "mode": "pass", "action": "close_active_connection"})
        elif args.case == "disconnect-after-start":
            write_json(runtime / "proxy-control.json", {"sequence": 2, "mode": "pass", "action": "close_active_connection"})
        wait_for(lambda: next((event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "connection_closed"), None), monotonic() + 20, "disconnect", [proxy, client])
        if args.case != "cancel-late-success":
            wait_for(lambda: len([event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "upgrade_complete"]) if len([event for event in events(runtime / "proxy-events.jsonl") if event.get("event") == "upgrade_complete"]) >= 2 else None, monotonic() + 20, "client reconnect", [proxy, client])
        if args.case in ("lost-terminal-ack-queued", "abrupt-queued-report-restart"):
            def sixth_rejected_replay():
                count = terminal_report_count(runtime / "proxy-events.jsonl")
                if count > 6:
                    raise RuntimeError("completion replay made more than one post-reconnect request: %d" % count)
                errors = [entry for entry in trace_events(runtime / "client.log") if entry.get("event") == "socket_call_platform_error" and entry.get("event_name") == "hr.pick_task_completed" and entry.get("ack", {}).get("errorType") == "PICK_TASK_NOT_IN_PROGRESS" and entry.get("ack", {}).get("pickTaskId") == start["task_id"]]
                return count if count == 6 and errors else None
            wait_for(sixth_rejected_replay, monotonic() + 30, "sixth replay rejected as PICK_TASK_NOT_IN_PROGRESS", [proxy, client])
            def exact_readback_confirmed():
                record = pending_record(runtime / "pending-completions.json", start["task_id"])
                if record is None or record.get("state") != "confirmed":
                    return None
                evidence = record.get("platform_evidence", {})
                if evidence.get("id") != order["id"]:
                    return None
                session = evidence.get("fulfillmentProgress", {}).get("pickSession", {})
                task = next((item for item in session.get("tasks", []) if item.get("taskId") == start["task_id"]), None)
                return record if session.get("sessionId") == start["session_id"] and task is not None and task.get("status") == "COMPLETED" else None
            first_confirmed = wait_for(exact_readback_confirmed, monotonic() + 20, "exact durable readback confirmation", [proxy, client])
        wait_for(lambda: read_order(args.api, order["id"]) if "COMPLETED" in statuses(read_order(args.api, order["id"])) and read_order(args.api, order["id"]).get("status") == "READY" else None, monotonic() + 30, "original READY completion", [proxy, client])
        if args.case == "abrupt-queued-report-restart" and len([event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]) != 1:
            raise RuntimeError("original task was repeated before follow-up dispatch")
        follow = create_order(args.api, args.label + " follow-up")
        wait_for(lambda: len([event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]) if len([event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]) == 2 else None, monotonic() + 30, "distinct follow-up start", [proxy, client])
        final = wait_for(lambda: read_order(args.api, follow["id"]) if "COMPLETED" in statuses(read_order(args.api, follow["id"])) and read_order(args.api, follow["id"]).get("status") == "READY" else None, monotonic() + 30, "follow-up READY completion", [proxy, client])
        wait_for(lambda: json.loads((runtime / "pending-completions.json").read_text(encoding="ascii")) if (runtime / "pending-completions.json").exists() and all(record.get("state") == "confirmed" for record in json.loads((runtime / "pending-completions.json").read_text(encoding="ascii")).get("records", [])) and len(json.loads((runtime / "pending-completions.json").read_text(encoding="ascii")).get("records", [])) == 2 else None, monotonic() + 20, "both durable completion confirmations", [proxy, client])
        starts = [event for event in events(runtime / "client-events.jsonl") if event.get("event") == "start"]
        ids = [event.get("execution_id") for event in starts]
        if len(ids) != 2 or len(set(ids)) != 2:
            raise RuntimeError("executor IDs reveal duplicate or missing starts: %s" % ids)
        after = request_json("GET", args.api + "/api/inventory")
        if not isinstance(croissant_quantity(baseline), int) or not isinstance(croissant_quantity(after), int) or croissant_quantity(baseline) - croissant_quantity(after) != 2:
            raise RuntimeError("inventory did not deduct exactly two")
        reports = terminal_report_count(runtime / "proxy-events.jsonl")
        if reports < 2:
            raise RuntimeError("expected both real terminal reports")
        device_after = wait_for(lambda: free_device(args.api), monotonic() + 20, "actual nova5_arm FREE device snapshot after recovery", [proxy, client])
        result = {"case": args.case, "first_order_id": order["id"], "follow_up_order_id": follow["id"], "first_order": read_order(args.api, order["id"]), "follow_up_order": final, "fake_start_count": len(starts), "fake_execution_ids": ids, "loaded_client": loaded, "inventory_before": croissant_quantity(baseline), "inventory_after": croissant_quantity(after), "pending_completion_store": pending_store(runtime / "pending-completions.json"), "proxy_terminal_reports": reports, "device_before": device_before, "device_after": device_after, "final_client_status": device_after["state"]}
        if args.case == "lost-terminal-ack-queued":
            result["queued_before_reconnect"] = json.loads((runtime / "queued-before-reconnect.json").read_text(encoding="ascii"))
            result["first_readback_confirmed"] = first_confirmed
            if reports != 7:
                raise RuntimeError("expected five held reports, one rejected replay, and one follow-up report; got %d" % reports)
        if args.case == "lost-terminal-ack":
            result["committed_before_close"] = json.loads((runtime / "committed-before-close.json").read_text(encoding="ascii"))
        if args.case == "abrupt-queued-report-restart":
            result["queued_before_kill"] = json.loads((runtime / "queued-before-kill.json").read_text(encoding="ascii"))
            result["restart_proof"] = json.loads((runtime / "restart-proof.json").read_text(encoding="ascii"))
            result["first_readback_confirmed"] = first_confirmed
            if reports != 7:
                raise RuntimeError("expected five held reports, one rejected replay, and one follow-up report; got %d" % reports)
        write_json(runtime / "result.json", result)
    except BaseException as exc:
        write_json(runtime / "result.json", {"status": "failed", "error_type": type(exc).__name__, "message": str(exc), "client_events": events(runtime / "client-events.jsonl"), "proxy_events": events(runtime / "proxy-events.jsonl")})
        raise
    finally:
        if client is not None:
            stop(client)
        stop(proxy)
        proxy_log.close()
        client_log.close()


if __name__ == "__main__":
    main()
