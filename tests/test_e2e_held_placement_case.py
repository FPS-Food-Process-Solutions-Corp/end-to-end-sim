"""No-service proof checks for the held placement restart case."""

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import e2e_held_placement_case as held


OID, SID, TID = "order-1", "session-1", "task-1"
PLACE = "place-1"
BUN = "bun-1"


def snapshot(order_status, session_status, task_status, database, available):
    row = {"order": {"id": OID, "status": order_status},
           "pickSession": {"pickSessionId": SID, "status": session_status,
                           "tasks": [{"pickTaskId": TID, "status": task_status, "retryCount": 0}]}}
    return {"order": {"id": OID, "status": order_status, "counterArea": 2},
            "queue": {"preparing": [row] if order_status == "PREPARING" else [],
                      "ready": [row] if order_status == "READY" else [], "queued": []},
            "inventory": {"snacks": {"items": [{"itemId": "moon-cake",
                                               "databaseQuantity": database,
                                               "availableQuantity": available}]}}}


def make_case(root):
    before = root / "held-crash-checkpoint-durable-state"
    after = root / "final-durable-state"
    client = root / "client"
    proof = {"source": "simulated", "config_fingerprint": "fingerprint",
             "place_execution_id": PLACE, "bun_id": BUN}
    identity = {"order_id": OID, "session_id": SID, "task_id": TID, "counter": 2}
    readiness = {"version": 5, "status": "unknown"}
    hold_context = {"schema": 1, "version": 3, "assignment": identity,
                    "source": proof["source"], "config_fingerprint": proof["config_fingerprint"],
                    "readiness_version": readiness["version"],
                    "placement_proof_sha256": held.digest(proof), "place_execution_id": PLACE}
    hold = {**hold_context, "hold_id": "sim-placement/" + held.digest(hold_context), "task_id": TID}
    owner = {"status": "hold", "identity": identity, "hold_version": 3,
             "readiness_version": 5, "recovery_hold": hold}
    device = {"executions": {"pick": 1, "place": 1, "retract": 1},
              "world": {"counter_bun_ids": {"2": [BUN]}, "held_bun_id": None}}
    world = {"counter_bun_ids": {"2": [BUN]}, "held_bun_id": None,
             "held_task_id": None, "rack_buns": {TID: False}}
    physical = [{"event": "execution_terminal", "phase": "pick", "status": "COMPLETED",
                 "execution_id": "pick-1"},
                {"event": "execution_terminal", "phase": "place", "status": "COMPLETED",
                 "execution_id": PLACE},
                {"event": "execution_terminal", "phase": "post_place_retract",
                 "status": "FAILED", "execution_id": "retract-1"}]
    hashes = {}
    pinned = {}
    loaded = {}
    for name in ("client.py", "pending_completion.py", "pending_failure.py", "settings.py"):
        path = client / "hr_client" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(("module " + name + "\r\n").encode("ascii"))
        raw = path.read_bytes()
        hashes[name] = hashlib.sha256(raw).hexdigest()
        value = {"path": str(path), "sha256": hashes[name],
                 "normalized_sha256": hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()}
        pinned[name] = value
        loaded["hr_client." + name[:-3]] = value
    manifest = {"client_source": str(client.resolve()), "loaded_client_file": str(client / "hr_client/client.py"),
                "loaded_client_sha256": hashes["client.py"],
                "loaded_client_normalized_sha256": pinned["client.py"]["normalized_sha256"],
                "client_pin_scheme": "sha256-crlf-to-lf-v1", "device_id": "humanoid_robot",
                "pinned_sources": pinned, "loaded_sources": loaded,
                "recovery_hold_id": hold["hold_id"], "recovered_completions": ["completion-1"]}
    for state in (before, after):
        path = state / "units/unit-1"
        path.mkdir(parents=True)
        held.write(state / "device-owner.json", owner)
        held.write(state / "device-readiness.json", readiness)
        held.write(path / "controller.json", {"physical_proof": proof})
        held.write(path / "summary.json", {"world": world})
        held.write(path / "device.json", device)
        (path / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in physical), encoding="utf-8")
    held.write(before / "crash-after-held-placement.used.json",
               {"place_execution_id": PLACE, "identity": identity})
    held.write(after / "integration-manifest.json", manifest)
    held.write(after / "pending-completions.json",
               {"records": [{"identity": {"execution_id": PLACE, "order_id": OID,
                                           "session_id": SID, "task_id": TID},
                             "state": "confirmed", "attempts": 1,
                             "callback_acknowledged": False, "terminal_evidence": proof,
                             "platform_evidence": {"eventType": "platform.pick_session_completed",
                                                   "orderId": OID, "pickSessionId": SID}}]})
    return client, hashes


def test_exact_boundary_and_settlement(tmp_path):
    client, hashes = make_case(tmp_path)
    baseline = snapshot("PREPARING", "CREATED", "UNASSIGNED", 8, 8)
    checkpoint = snapshot("PREPARING", "CREATED", "IN_PROGRESS", 8, 7)
    final = snapshot("READY", "COMPLETED", "COMPLETED", 7, 7)
    boundary = held.validate_boundary(tmp_path, checkpoint, OID, SID, TID)
    result = held.validate_settlement(tmp_path, baseline, checkpoint, final,
                                      (OID, SID, TID), boundary, client, hashes)
    assert result["physical_effects_unchanged"] is True
    assert result["recovery_hold_id"].startswith("sim-placement/")


def test_wrong_place_identity_is_rejected(tmp_path):
    make_case(tmp_path)
    marker = tmp_path / "held-crash-checkpoint-durable-state/crash-after-held-placement.used.json"
    changed = held.read(marker)
    changed["place_execution_id"] = "other-place"
    held.write(marker, changed)
    with pytest.raises(RuntimeError, match="exit-78 boundary"):
        held.validate_boundary(tmp_path, snapshot("PREPARING", "CREATED", "IN_PROGRESS", 8, 7),
                               OID, SID, TID)


def test_completion_before_crash_is_rejected(tmp_path):
    make_case(tmp_path)
    held.write(tmp_path / "held-crash-checkpoint-durable-state/pending-completions.json",
               {"records": []})
    with pytest.raises(RuntimeError, match="exit-78 boundary"):
        held.validate_boundary(tmp_path, snapshot("PREPARING", "CREATED", "IN_PROGRESS", 8, 7),
                               OID, SID, TID)


def test_restart_physical_change_is_rejected(tmp_path):
    client, hashes = make_case(tmp_path)
    checkpoint = snapshot("PREPARING", "CREATED", "IN_PROGRESS", 8, 7)
    boundary = held.validate_boundary(tmp_path, checkpoint, OID, SID, TID)
    device = tmp_path / "final-durable-state/units/unit-1/device.json"
    changed = held.read(device)
    changed["executions"]["place"] = 2
    held.write(device, changed)
    with pytest.raises(RuntimeError, match="physical device"):
        held.validate_settlement(tmp_path, snapshot("PREPARING", "CREATED", "UNASSIGNED", 8, 8),
                                 checkpoint, snapshot("READY", "COMPLETED", "COMPLETED", 7, 7),
                                 (OID, SID, TID), boundary, client, hashes)


@pytest.mark.parametrize("change", ["wrong-root", "wrong-hash", "missing-normalized"])
def test_client_source_attestation_rejects_mismatch(tmp_path, change):
    client, hashes = make_case(tmp_path)
    manifest = held.read(tmp_path / "final-durable-state/integration-manifest.json")
    if change == "wrong-root":
        manifest["client_source"] = str(tmp_path / "other")
    elif change == "wrong-hash":
        manifest["loaded_sources"]["hr_client.pending_completion"]["sha256"] = "0" * 64
    else:
        del manifest["pinned_sources"]["settings.py"]["normalized_sha256"]
    with pytest.raises(RuntimeError, match="client"):
        held.validate_client(manifest, client, hashes)


def test_phase2_paused_only_and_no_next_request():
    start = 100.0
    rows = [{"event": "upgrade_complete", "timestamp": 101.0},
            {"event": "humanoid_status_report_observed", "timestamp": 102.0,
             "valid": True, "state": "PAUSED"}]
    obs = [{"device": {"state": "PAUSED"}}]
    assert held.phase2_hold_sustained(rows, start, obs)[0] is True
    assert held.phase2_hold_sustained(rows + [{"timestamp": 103.0,
                                               "event_name": "hr.pick_next_pick_task"}], start, obs)[0] is False
    assert held.phase2_hold_sustained(rows, start, obs + [{"device": {"state": "FREE"}}])[0] is False


def test_run_case_refuses_wrong_baseline_before_order(tmp_path):
    called = []
    context = SimpleNamespace(root=tmp_path,
                              baseline_snapshot=snapshot("PREPARING", "CREATED", "UNASSIGNED", 7, 7),
                              api_request=lambda *args: called.append(args))
    with pytest.raises(RuntimeError, match="baseline"):
        held.run_case(context)
    assert called == []
