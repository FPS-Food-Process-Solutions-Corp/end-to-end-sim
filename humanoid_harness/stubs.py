"""Durable simulated adapters. Replace these at the Protocol boundaries."""

from dataclasses import asdict
from pathlib import Path

from .models import CompletionReport, Execution, Observation, Result
from .storage import read_json, write_json


class InjectedCrash(RuntimeError):
    """Test-only process boundary after a physical effect is durable."""


def selected_fault(config: dict, task_id: str, kind: str, occurrence: int) -> dict:
    for fault in config["faults"]:
        if fault["task_id"] == task_id and fault["kind"] == kind and fault["occurrence"] == occurrence:
            return fault
    return {"outcome": "success"}


class StubDevice:
    """One persisted device execution ledger and world for AMR, mover and VLA."""

    def __init__(self, path: Path, config: dict):
        self.path = path
        self.config = config
        self.state = read_json(path)
        if self.state.get("schema") != 1 or not isinstance(self.state.get("executions"), dict) or not isinstance(self.state.get("world"), dict):
            raise ValueError("Invalid device ledger schema")
        if not isinstance(self.state.get("observations"), dict) or not isinstance(self.state.get("confirmed_losses"), dict):
            raise ValueError("Invalid device observation ledger")
        world = self.state["world"]
        required_world = {"location", "posture", "held_task_id", "held_bun_id", "rack_buns", "rack_bun_ids", "replacement_stock", "counters", "counter_bun_ids", "lost", "lift_pose_ok"}
        if not required_world <= set(world) or any(not isinstance(world[key], dict) for key in ("rack_buns", "rack_bun_ids", "replacement_stock", "counters", "counter_bun_ids")) or not isinstance(world["lost"], list):
            raise ValueError("Invalid physical world ledger")
        required_execution = {"execution_id", "task_id", "kind", "target", "generation", "status", "reason", "safe_to_retry", "effect_applied", "outcome", "polls", "delay_polls", "occurrence"}
        for execution_id, record in self.state["executions"].items():
            if not isinstance(record, dict) or not required_execution <= set(record) or record["execution_id"] != execution_id or record["status"] not in {"RUNNING", "COMPLETED", "FAILED", "CANCELED", "UNKNOWN"}:
                raise ValueError(f"Invalid device execution record {execution_id}")

    @staticmethod
    def initial(config: dict) -> dict:
        return {"schema": 1, "executions": {}, "observations": {}, "confirmed_losses": {}, "world": {
            "location": "SIM_TAG_FRONT_COUNTER", "posture": "SIM_POSE_IDLE", "held_task_id": None,
            "rack_buns": {task["task_id"]: True for task in config["tasks"] if task["rack"] == "B"},
            "rack_bun_ids": {task["task_id"]: f"{task['task_id']}/bun-c0" for task in config["tasks"] if task["rack"] == "B"},
            "replacement_stock": dict(config["replacement_stock"]),
            "held_bun_id": None, "counters": {str(n): [] for n in range(1, 5)},
            "counter_bun_ids": {str(n): [] for n in range(1, 5)}, "lost": [], "lift_pose_ok": False,
        }}

    def _save(self) -> None:
        write_json(self.path, self.state)

    def _count(self, task_id: str, kind: str) -> int:
        return sum(1 for item in self.state["executions"].values() if item["task_id"] == task_id and item["kind"] == kind)

    def _response(self, record: dict) -> Execution:
        return Execution(**{key: record[key] for key in ("execution_id", "task_id", "kind", "target", "generation", "status", "reason", "safe_to_retry")})

    def _effect(self, record: dict) -> None:
        if record["effect_applied"]:
            return
        world = self.state["world"]
        task_id = record["task_id"]
        kind = record["kind"]
        if kind.startswith("navigate"):
            world["location"] = record["target"]
        elif kind in ("lift_pick", "lift_place"):
            world["posture"] = record["target"]
            world["lift_pose_ok"] = True
        elif kind in ("pre_pick", "retract", "pre_place", "jolt", "pick_reset"):
            world["posture"] = record["target"]
        elif kind == "pick" and record["outcome"] != "no_bun":
            if world["held_task_id"] is not None or world["rack_buns"].get(task_id) is not True:
                record["status"] = "UNKNOWN"
                record["reason"] = "pick precondition conflicted with world"
                return
            world["held_task_id"] = task_id
            world["held_bun_id"] = world["rack_bun_ids"][task_id]
            world["rack_buns"][task_id] = False
            world["rack_bun_ids"][task_id] = None
            world["posture"] = "SIM_POSE_PICK_LIFT"
        elif kind == "place":
            if world["held_task_id"] != task_id:
                record["status"] = "UNKNOWN"
                record["reason"] = "placement possession conflicted with world"
                return
            matches = [counter for counter, target in self.config["placement_targets"].items() if target == record["target"]]
            counter = matches[0] if len(matches) == 1 else ""
            if counter not in world["counters"]:
                record["status"] = "UNKNOWN"
                record["reason"] = "unknown placement target"
                return
            world["counters"][counter].append(task_id)
            world["counter_bun_ids"][counter].append(world["held_bun_id"])
            world["held_task_id"] = None
            world["held_bun_id"] = None
            world["posture"] = "SIM_POSE_PLACE_DONE"
            world["lift_pose_ok"] = False
        record["effect_applied"] = True

    def _submit(self, execution: Execution) -> Result[Execution]:
        existing = self.state["executions"].get(execution.execution_id)
        if existing is not None:
            expected = (execution.task_id, execution.kind, execution.target, execution.generation)
            actual = (existing["task_id"], existing["kind"], existing["target"], existing["generation"])
            if expected != actual:
                return Result.err_msg("execution identity conflict")
            return Result.ok(self._response(existing))
        occurrence = self._count(execution.task_id, execution.kind) + 1
        fault = selected_fault(self.config, execution.task_id, execution.kind, occurrence)
        outcome = fault["outcome"]
        known = {"success", "fail", "reject", "delay", "stuck", "no_bun", "unknown", "collision", "drop_ack", "crash_after_effect", "cancel_unknown", "cancel_race"}
        if outcome not in known:
            return Result.err_msg(f"unknown configured outcome {outcome}")
        status = "RUNNING" if outcome in ("delay", "cancel_unknown", "cancel_race") else "COMPLETED"
        if outcome in ("fail", "reject", "stuck"):
            status = "FAILED"
        if outcome in ("unknown", "collision"):
            status = "UNKNOWN"
        record = {**asdict(execution), "status": status, "reason": outcome if outcome != "success" else "", "outcome": outcome,
                  "safe_to_retry": outcome in ("fail", "reject", "stuck"),
                  "occurrence": occurrence, "polls": 0, "delay_polls": int(fault.get("delay_polls", 2)), "effect_applied": False}
        self.state["executions"][execution.execution_id] = record
        if status == "COMPLETED":
            self._effect(record)
        self._save()
        if outcome == "crash_after_effect":
            raise InjectedCrash(f"injected process stop after {execution.execution_id} effect")
        if outcome == "drop_ack":
            return Result.err_msg("submit acknowledgement lost; query execution ID")
        return Result.ok(self._response(record))

    def submit_navigation(self, execution: Execution) -> Result[Execution]:
        return self._submit(execution)

    def submit_pose(self, execution: Execution) -> Result[Execution]:
        return self._submit(execution)

    def submit_lift_route(self, execution: Execution) -> Result[Execution]:
        return self._submit(execution)

    def submit_pick(self, execution: Execution) -> Result[Execution]:
        return self._submit(execution)

    def get_execution(self, execution_id: str) -> Result[Execution]:
        record = self.state["executions"].get(execution_id)
        if record is None:
            return Result.err_msg("execution ID not found")
        if record["status"] == "RUNNING":
            record["polls"] += 1
            if record["outcome"] == "delay" and record["polls"] >= record["delay_polls"]:
                record["status"] = "COMPLETED"
                self._effect(record)
            self._save()
        return Result.ok(self._response(record))

    def cancel_execution(self, execution_id: str) -> Result[Execution]:
        record = self.state["executions"].get(execution_id)
        if record is None:
            return Result.err_msg("execution ID not found")
        if record["status"] == "RUNNING":
            if record["outcome"] == "cancel_unknown":
                record["status"] = "UNKNOWN"
                record["reason"] = "cancellation outcome and bun possession uncertain"
            elif record["outcome"] == "cancel_race":
                record["status"] = "COMPLETED"
                self._effect(record)
            else:
                record["status"] = "CANCELED"
                record["reason"] = "terminal cancellation confirmed"
                record["safe_to_retry"] = not record["effect_applied"]
            self._save()
        return Result.ok(self._response(record))

    def observe(self, task_id: str, phase: str, cycle: int) -> Result[Observation]:
        world = self.state["world"]
        key = f"{task_id}:{phase}"
        loss_key = f"{task_id}:c{cycle}"
        occurrence = self.state["observations"].get(key, 0) + 1
        self.state["observations"][key] = occurrence
        fault = selected_fault(self.config, task_id, phase, occurrence)
        loss_confirmed = self.state["confirmed_losses"].get(loss_key, False)
        if fault["outcome"] == "loss":
            if world["held_task_id"] == task_id:
                loss_confirmed = True
                self.state["confirmed_losses"][loss_key] = True
                world["held_task_id"] = None
                world["lost"].append(world["held_bun_id"])
                world["held_bun_id"] = None
                if world["replacement_stock"][task_id] > 0:
                    world["replacement_stock"][task_id] -= 1
                    world["rack_buns"][task_id] = True
                    world["rack_bun_ids"][task_id] = f"{task_id}/bun-c{cycle + 1}"
                world["lift_pose_ok"] = False
        elif fault["outcome"] == "unknown":
            self._save()
            return Result.err_msg("perception uncertain")
        elif fault["outcome"] != "success":
            return Result.err_msg(f"unsupported perception outcome {fault['outcome']}")
        self._save()
        return Result.ok(Observation(task_id, world["held_task_id"], world["rack_buns"].get(task_id, False),
                                     world["lift_pose_ok"], world["location"], world["posture"], loss_confirmed))

    def verify_placement(self, task_id: str, counter: int) -> Result[bool]:
        world = self.state["world"]
        return Result.ok(world["counters"][str(counter)].count(task_id) == 1 and world["held_task_id"] != task_id)


class StubPlatform:
    """Completion acceptance is persisted separately from the physical world."""

    def __init__(self, path: Path, config: dict):
        self.path = path
        self.config = config
        self.state = read_json(path)
        if self.state.get("schema") != 1 or not isinstance(self.state.get("reports"), dict):
            raise ValueError("Invalid platform ledger schema")
        required_report = {"task_id", "order_id", "session_id", "execution_id", "status"}
        for task_id, report in self.state["reports"].items():
            if not isinstance(report, dict) or set(report) != required_report or report["task_id"] != task_id or report["status"] != "ACCEPTED":
                raise ValueError(f"Invalid platform report record {task_id}")

    @staticmethod
    def initial() -> dict:
        return {"schema": 1, "reports": {}}

    def report_completion(self, task_id: str, order_id: str, session_id: str, execution_id: str) -> Result[str]:
        prior = self.state["reports"].get(task_id)
        if prior is not None:
            if (prior["order_id"], prior["session_id"], prior["execution_id"]) != (order_id, session_id, execution_id):
                return Result.err_msg("report identity conflict")
            return Result.ok("ACCEPTED")
        occurrence = sum(1 for report in self.state["reports"].values() if report["task_id"] == task_id) + 1
        outcome = selected_fault(self.config, task_id, "report", occurrence)["outcome"]
        if outcome not in ("success", "drop_ack", "reject", "unknown"):
            return Result.err_msg(f"unsupported report outcome {outcome}")
        if outcome == "reject":
            return Result.err_msg("platform rejected completion")
        if outcome == "unknown":
            return Result.err_msg("platform completion outcome unknown")
        self.state["reports"][task_id] = {"task_id": task_id, "order_id": order_id, "session_id": session_id, "execution_id": execution_id, "status": "ACCEPTED"}
        write_json(self.path, self.state)
        if outcome == "drop_ack":
            return Result.err_msg("report acknowledgement lost; read back by task ID")
        return Result.ok("ACCEPTED")

    def get_report(self, task_id: str) -> Result[CompletionReport]:
        report = self.state["reports"].get(task_id)
        if report is None:
            return Result.err_msg("report not found")
        if report.get("status") != "ACCEPTED":
            return Result.err_msg("report status unknown")
        return Result.ok(CompletionReport(**report))
