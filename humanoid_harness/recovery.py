"""Operator-only inspection and no-motion recovery for saved humanoid simulator runs."""

import argparse
import json
from pathlib import Path
import sys

from .operator_recovery import inspect_state, reconcile_report, release_hold


def parser():
    top = argparse.ArgumentParser(description="Inspect or reconcile one saved simulated humanoid hold")
    commands = top.add_subparsers(dest="command", required=True)
    for name in ("inspect", "reconcile-report", "release-hold"):
        command = commands.add_parser(name)
        command.add_argument("--state-root", type=Path, required=True)
        command.add_argument("--client-source", type=Path, required=True)
        command.add_argument("--format", choices=("human", "json"), default="human")
        if name == "inspect":
            continue
        command.add_argument("--action-id", required=True)
        command.add_argument("--operator", required=True)
        command.add_argument("--reason", required=True)
        command.add_argument("--order-id", required=True)
        command.add_argument("--session-id", required=True)
        command.add_argument("--task-id", required=True)
        command.add_argument("--counter", type=int, required=True)
        command.add_argument("--place-execution-id", required=True)
        command.add_argument("--hold-id", required=True)
        command.add_argument("--expected-inspection-sha256", required=True)
        if name == "reconcile-report":
            command.add_argument("--api-url", required=True)
            command.add_argument("--socket-url")
    return top


def _human_inspection(result):
    physical = result["physical"]
    report = result["report"]
    readiness = result["readiness"]
    identity = physical["identity"] or {}
    lines = [
        "Saved offline inspection (not a live robot observation)",
        "State root: " + result["state_root"],
        "Inspection SHA-256: " + result["inspection_sha256"],
        "Physical: status=%s placement_verified=%s retract=%s effect_applied=%s hold_id=%s place_execution_id=%s" % (
            physical["status"], physical["placement_verified"], physical["retract_status"],
            physical["retract_effect_applied"], physical["hold_id"], physical["place_execution_id"]),
        "Identity: order_id=%s session_id=%s task_id=%s counter=%s" % (
            identity.get("order_id"), identity.get("session_id"), identity.get("task_id"), identity.get("counter")),
        "Report: state=%s callback_acknowledged=%s blockers=%s" % (
            report["state"], report["callback_acknowledged"], "; ".join(report["blockers"]) or "none"),
        "Readiness: status=%s version=%s proof_kind=%s" % (
            readiness["status"], readiness["version"], readiness["proof_kind"]),
    ]
    for action in ("reconcile_report", "release_hold"):
        gate = result["allowed_actions"][action]
        lines.append("%s: %s (%s)" % (
            action.replace("_", "-"), "allowed" if gate["allowed"] else "refused",
            "; ".join(gate["reasons"]) or "exact saved evidence meets offline preconditions"))
    lines.append("Audit actions: %d" % len(result["audit_history"]))
    if identity and physical["hold_id"] and physical["place_execution_id"]:
        lines.append("Next command identity: --order-id %s --session-id %s --task-id %s --counter %s --place-execution-id %s --hold-id %s --expected-inspection-sha256 %s" % (
            identity["order_id"], identity["session_id"], identity["task_id"], identity["counter"],
            physical["place_execution_id"], physical["hold_id"], result["inspection_sha256"]))
    return "\n".join(lines)


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "inspect":
            result = inspect_state(arguments.state_root, arguments.client_source)
        else:
            identity = {"order_id": arguments.order_id, "session_id": arguments.session_id,
                        "task_id": arguments.task_id, "counter": arguments.counter}
            common = {"action_id": arguments.action_id, "operator": arguments.operator,
                      "reason": arguments.reason, "identity": identity, "hold_id": arguments.hold_id,
                      "place_execution_id": arguments.place_execution_id,
                      "expected_inspection_sha256": arguments.expected_inspection_sha256}
            if arguments.command == "reconcile-report":
                result = reconcile_report(arguments.state_root, arguments.client_source,
                                          api_url=arguments.api_url,
                                          socket_url=arguments.socket_url, **common)
            else:
                result = release_hold(arguments.state_root, arguments.client_source, **common)
    except Exception as exc:
        if arguments.format == "json":
            print(json.dumps({"schema": 1, "status": "error", "message": str(exc)}, sort_keys=True))
        else:
            print("Recovery error: " + str(exc), file=sys.stderr)
        return 1
    if arguments.format == "json":
        print(json.dumps(result, sort_keys=True))
    elif arguments.command == "inspect":
        print(_human_inspection(result))
    else:
        print("Recovery action result: %s: %s" % (result["status"], result["message"]))
        print("Run inspect again for current saved state.")
        if result.get("historical_replay"):
            print("Saved historical result; current readiness was not rechecked. Run inspect for current state.")
    return 0 if arguments.command == "inspect" or result["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
