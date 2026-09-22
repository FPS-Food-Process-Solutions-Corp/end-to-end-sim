"""Durable per-unit orchestration with reconciliation before every action."""

from pathlib import Path
from copy import deepcopy

from .adapters import StubAmr, StubHumanoidMover, StubLift, StubPerception, StubVla
from .config import fingerprint, validate_config
from .models import Execution
from .storage import StateError, StateLock, append_event, read_json, write_json
from .stubs import StubDevice, StubPlatform
from .visual import write_visual


class Harness:
    ACTIONS = {"navigate_pick", "lift_pick", "pre_pick", "pick", "jolt", "pick_reset", "retract", "navigate_place", "lift_place", "pre_place", "place", "navigate_idle"}
    NEXT = {
        "navigate_pick": "lift_pick", "lift_pick": "pre_pick", "pre_pick": "pick",
        "retract": "navigate_place", "navigate_place": "lift_place", "lift_place": "pre_place",
        "jolt": "pick_reset", "pick_reset": "pick", "navigate_idle": "done",
    }

    def __init__(self, state_dir: Path, config: dict, resume: bool = False, *, amr=None, mover=None, lift=None, vla=None, perception=None, platform=None):
        validate_config(config)
        if resume and not state_dir.is_dir():
            raise StateError("--resume requires an existing harness state directory")
        if not resume:
            state_dir.mkdir(parents=True, exist_ok=True)
        self.lock = StateLock(state_dir / ".harness.lock")
        self.lock.acquire()
        try:
            self._initialize(state_dir, config, resume, amr, mover, lift, vla, perception, platform)
        except (StateError, ValueError, OSError, KeyError, TypeError):
            self.lock.release()
            raise

    def _initialize(self, state_dir: Path, config: dict, resume: bool, amr, mover, lift, vla, perception, platform) -> None:
        self.directory = state_dir
        self.controller_path = state_dir / "controller.json"
        self.device_path = state_dir / "device.json"
        self.platform_path = state_dir / "platform.json"
        self.events_path = state_dir / "events.jsonl"
        self.summary_path = state_dir / "summary.json"
        self.visual_path = state_dir / "world.html"
        if resume:
            self.state = read_json(self.controller_path)
            if self.state.get("schema") != 1 or self.state.get("config_fingerprint") != fingerprint(config):
                raise StateError("Resume config differs from immutable saved config or controller schema is invalid")
            if self.state.get("config") != config or not isinstance(self.state.get("units"), dict):
                raise StateError("Controller config or task state is corrupt")
        else:
            if any(path.name != ".harness.lock" for path in state_dir.iterdir()):
                raise StateError("State directory is not empty; use --resume for a prior run")
            self.state = {"schema": 1, "config": config, "config_fingerprint": fingerprint(config), "phase": "select",
                          "index": 0, "active_task_id": None, "intent": None, "hold_reason": None, "event_sequence": 0,
                          "units": {task["task_id"]: {"status": "pending", "cycle": 0, "navigation_attempts": {}, "pick_attempt": 0} for task in config["tasks"]}}
            write_json(self.controller_path, self.state)
            write_json(self.device_path, StubDevice.initial(config))
            write_json(self.platform_path, StubPlatform.initial())
            self.events_path.touch()
        self.config = config
        self.device = StubDevice(self.device_path, config)
        self.platform = platform if platform is not None else StubPlatform(self.platform_path, config)
        self.amr = amr if amr is not None else StubAmr(self.device)
        self.mover = mover if mover is not None else StubHumanoidMover(self.device)
        self.lift = lift if lift is not None else StubLift(self.device)
        self.vla = vla if vla is not None else StubVla(self.device)
        self.perception = perception if perception is not None else StubPerception(self.device)
        if resume:
            self._validate_resume()

    def _validate_resume(self) -> None:
        state = self.state
        task_map = {task["task_id"]: task for task in self.config["tasks"]}
        if set(state["units"]) != set(task_map):
            raise StateError("Controller task set differs from config")
        if state.get("phase") not in self.ACTIONS | {"select", "pick_check", "pre_place_check", "report", "done", "hold"}:
            raise StateError("Controller phase is invalid")
        if not isinstance(state.get("index"), int) or not 0 <= state["index"] <= len(self.config["tasks"]):
            raise StateError("Controller index is invalid")
        if state.get("active_task_id") is not None and state["active_task_id"] not in task_map:
            raise StateError("Controller active task is invalid")
        if state["phase"] not in ("select", "navigate_idle", "done", "hold") and state.get("active_task_id") is None:
            raise StateError("Controller active task missing")
        if state["phase"] == "select" and state.get("active_task_id") is not None:
            raise StateError("Select checkpoint has an unexpected active task")
        if not isinstance(state.get("event_sequence"), int) or state["event_sequence"] < 0:
            raise StateError("Controller event sequence is invalid")
        for task in self.config["tasks"][:state["index"]]:
            if task["rack"] == "B" and state["units"][task["task_id"]].get("status") not in ("complete", "failed"):
                raise StateError(f"Controller index skips unfinished unit {task['task_id']}")
        if state.get("active_task_id") is not None and state["phase"] not in ("hold",):
            active_index = next(i for i, task in enumerate(self.config["tasks"]) if task["task_id"] == state["active_task_id"])
            if active_index != state["index"]:
                raise StateError("Controller active task and index mismatch")
        intent = state.get("intent")
        if intent is not None:
            required = {"execution_id", "task_id", "kind", "target", "generation", "status", "reason", "dispatch_started"}
            if not isinstance(intent, dict) or not required <= set(intent) or intent["kind"] != state["phase"] and state["phase"] != "hold" or not isinstance(intent["dispatch_started"], bool):
                raise StateError("Controller intent is invalid for phase")
            if intent["task_id"] != (state["active_task_id"] or "idle"):
                raise StateError("Controller intent task identity mismatch")
        for task_id, unit in state["units"].items():
            if not isinstance(unit, dict) or unit.get("status") not in {"pending", "active", "complete", "failed", "held"}:
                raise StateError(f"Invalid unit status for {task_id}")
            if not isinstance(unit.get("cycle"), int) or unit["cycle"] < 0 or not isinstance(unit.get("pick_attempt"), int) or unit["pick_attempt"] < 0 or not isinstance(unit.get("navigation_attempts"), dict):
                raise StateError(f"Invalid unit retry counters for {task_id}")
            if unit["status"] == "complete":
                task = task_map[task_id]
                reports = self.platform.get_report(task_id)
                if reports.is_err or reports.data is None:
                    raise StateError(f"Completed {task_id} lacks accepted platform report")
                report = reports.data
                if (report.task_id, report.order_id, report.session_id, report.execution_id, report.status) != (task_id, task["order_id"], task["session_id"], f"{task_id}/report", "ACCEPTED"):
                    raise StateError(f"Completed {task_id} report identity mismatch")
                if not self._placement_verified(task):
                    raise StateError(f"Completed {task_id} lacks verified physical placement")
        if state["phase"] == "done" and any(state["units"][task["task_id"]]["status"] not in ("complete", "failed") for task in self.config["tasks"] if task["rack"] == "B"):
            raise StateError("Done checkpoint still has unfinished Rack B unit")

    def _save(self) -> None:
        write_json(self.controller_path, self.state)

    def _emit(self, event: str, **fields: object) -> None:
        self.state["event_sequence"] += 1
        self._save()
        item = {"sequence": self.state["event_sequence"], "event": event, "phase": self.state["phase"],
                "task_id": self.state["active_task_id"], "world": deepcopy(self.device.state["world"]), **fields}
        append_event(self.events_path, item)
        print(f"[{item['sequence']:03d}] {event}: {fields}")

    def _task(self) -> dict:
        task_id = self.state["active_task_id"]
        for task in self.config["tasks"]:
            if task["task_id"] == task_id:
                return task
        raise StateError(f"Active task {task_id!r} absent from config")

    def _unit(self) -> dict:
        return self.state["units"][self.state["active_task_id"]]

    def _set_phase(self, phase: str) -> None:
        self.state["phase"] = phase
        self.state["intent"] = None
        self._save()
        self._emit("phase", next_phase=phase)

    def _hold(self, reason: str) -> None:
        self.state["phase"] = "hold"
        self.state["hold_reason"] = reason
        if self.state["active_task_id"] is not None:
            self._unit()["status"] = "held"
        self._save()
        self._emit("operator_hold", reason=reason, execution_id=self.state["intent"]["execution_id"] if self.state["intent"] else None)

    def _fail_unit(self, reason: str) -> None:
        task_id = self.state["active_task_id"]
        self._unit()["status"] = "failed"
        self._emit("unit_failed", reason=reason)
        self.state["index"] = next(i for i, task in enumerate(self.config["tasks"]) if task["task_id"] == task_id) + 1
        self.state["active_task_id"] = None
        self._set_phase("select")

    def _target(self, kind: str) -> str:
        task = self._task() if self.state["active_task_id"] else None
        if kind == "navigate_pick":
            return self.config["tags"][f"B:{task['level']}:{task['slot']}"]
        if kind == "navigate_place":
            return self.config["tags"]["placement"]
        if kind == "navigate_idle":
            return self.config["tags"]["front"]
        if kind == "place":
            return self.config["placement_targets"][str(task["counter"])]
        if kind == "pick":
            return self.config["policies"]["pick"]
        if kind == "retract":
            return self.config["poses"]["travel"]
        return self.config["poses"][kind]

    def _intent_for(self, kind: str) -> Execution:
        if self.state["intent"] is not None:
            intent = self.state["intent"]
            if intent["kind"] != kind:
                raise StateError(f"Saved intent kind {intent['kind']} conflicts with phase {kind}")
            return Execution(**{key: intent[key] for key in ("execution_id", "task_id", "kind", "target", "generation", "status", "reason")})
        if kind == "navigate_idle":
            task_id, cycle, attempt = "idle", 0, 1
        else:
            task_id = self.state["active_task_id"]
            unit = self._unit()
            cycle = unit["cycle"]
            if kind in ("navigate_pick", "navigate_place"):
                attempt = unit["navigation_attempts"].get(kind, 0) + 1
                unit["navigation_attempts"][kind] = attempt
            elif kind == "pick":
                unit["pick_attempt"] += 1
                attempt = unit["pick_attempt"]
            else:
                attempt = 1
        generation = cycle * 100 + attempt
        execution = Execution(f"{task_id}/c{cycle}/{kind}/a{attempt}", task_id, kind, self._target(kind), generation, "INTENDED")
        self.state["intent"] = {"execution_id": execution.execution_id, "task_id": execution.task_id,
                                "kind": execution.kind, "target": execution.target, "generation": execution.generation,
                                "status": execution.status, "reason": execution.reason, "dispatch_started": False}
        self._save()
        self._emit("intent_persisted", execution_id=execution.execution_id, target=execution.target)
        return execution

    def _check_identity(self, expected: Execution, actual: Execution) -> bool:
        return (actual.execution_id, actual.task_id, actual.kind, actual.target, actual.generation) == (expected.execution_id, expected.task_id, expected.kind, expected.target, expected.generation)

    def _action_status(self, kind: str) -> tuple[str, str, bool]:
        expected = self._intent_for(kind)
        adapter = self.amr if kind.startswith("navigate") else self.lift if kind.startswith("lift") else self.vla if kind == "pick" else self.mover
        existing = adapter.get_execution(expected.execution_id)
        if existing.is_ok:
            result = existing
            self._emit("execution_reconciled", execution_id=expected.execution_id, status=existing.data.status)
        elif existing.message == "execution ID not found":
            if self.state["intent"].get("dispatch_started"):
                return "UNKNOWN", "dispatched execution absent on readback", False
            self.state["intent"]["dispatch_started"] = True
            self._save()
            if kind.startswith("navigate"):
                result = adapter.submit_navigation(expected)
            elif kind.startswith("lift"):
                result = adapter.submit_lift_route(expected)
            elif kind == "pick":
                result = adapter.submit_pick(expected)
            else:
                result = adapter.submit_pose(expected)
            if result.is_err:
                self._emit("ack_unavailable", execution_id=expected.execution_id, reason=result.message)
                result = adapter.get_execution(expected.execution_id)
        else:
            return "UNKNOWN", existing.message, False
        if result.is_err or result.data is None:
            return "UNKNOWN", result.message, False
        if not self._check_identity(expected, result.data):
            return "UNKNOWN", "execution identity or generation mismatch", False
        actual = result.data
        for _ in range(self.config["max_polls"]):
            if actual.status != "RUNNING":
                break
            polled = adapter.get_execution(expected.execution_id)
            if polled.is_err or polled.data is None or not self._check_identity(expected, polled.data):
                return "UNKNOWN", "poll response missing or mismatched identity", False
            actual = polled.data
        if actual.status == "RUNNING":
            self._emit("execution_timeout_cancel", execution_id=expected.execution_id)
            canceled = adapter.cancel_execution(expected.execution_id)
            if canceled.is_err or canceled.data is None or not self._check_identity(expected, canceled.data):
                return "UNKNOWN", "cancel response missing or mismatched identity", False
            actual = canceled.data
            if actual.status == "COMPLETED":
                self._emit("cancel_race_completed", execution_id=expected.execution_id)
                return "UNKNOWN", "execution completed during cancellation; operator reconciliation required", False
            for _ in range(self.config["cancel_polls"]):
                if actual.status != "RUNNING":
                    break
                polled = adapter.get_execution(expected.execution_id)
                if polled.is_err or polled.data is None or not self._check_identity(expected, polled.data):
                    return "UNKNOWN", "post-cancel response missing or mismatched identity", False
                actual = polled.data
        if actual.status not in ("COMPLETED", "FAILED", "CANCELED", "UNKNOWN"):
            return "UNKNOWN", f"nonterminal or invalid status {actual.status}", False
        self._emit("execution_terminal", execution_id=expected.execution_id, status=actual.status, reason=actual.reason, safe_to_retry=actual.safe_to_retry)
        return actual.status, actual.reason, actual.safe_to_retry

    def _select(self) -> None:
        for index in range(self.state["index"], len(self.config["tasks"])):
            task = self.config["tasks"][index]
            if task["rack"] != "B":
                continue
            self.state["index"] = index
            self.state["active_task_id"] = task["task_id"]
            self._unit()["status"] = "active"
            self._save()
            self._emit("unit_accepted", order_id=task["order_id"], session_id=task["session_id"], rack=task["rack"],
                       level=task["level"], slot=task["slot"], counter=task["counter"])
            self._set_phase("navigate_pick")
            return
        self.state["active_task_id"] = None
        self._set_phase("navigate_idle")

    def _pick_check(self) -> None:
        task_id = self.state["active_task_id"]
        result = self.perception.observe(task_id, "pick_check", self._unit()["cycle"])
        if result.is_err or result.data is None:
            self._hold(f"pick perception uncertain: {result.message}")
        elif result.data.held_task_id == task_id and result.data.lift_pose_ok and not result.data.rack_has_bun:
            self._emit("pick_verified", held_task_id=task_id, lift_pose_ok=True)
            self._set_phase("retract")
        elif result.data.held_task_id is None and result.data.rack_has_bun:
            self._pick_failed("policy completed without bun")
        else:
            self._hold("pick verification conflicts with physical world")

    def _pick_failed(self, reason: str) -> None:
        self._emit("pick_attempt_failed", reason=reason, attempt=self._unit()["pick_attempt"])
        if self._unit()["pick_attempt"] <= self.config["vla_retries"]:
            self._set_phase("jolt" if reason == "stuck" else "pick")
        else:
            self._fail_unit("VLA attempts exhausted: " + reason)

    def _place_check(self) -> None:
        task_id = self.state["active_task_id"]
        result = self.perception.observe(task_id, "pre_place_check", self._unit()["cycle"])
        if result.is_err or result.data is None:
            self._hold(f"pre-place perception uncertain: {result.message}")
        elif result.data.held_task_id == task_id:
            self._emit("pre_place_possession_verified", held_task_id=task_id)
            self._set_phase("place")
        elif result.data.held_task_id is None and result.data.loss_confirmed:
            self._emit("confirmed_loss", cycle=self._unit()["cycle"])
            if self._unit()["cycle"] < self.config["loss_retries"] and result.data.rack_has_bun:
                unit = self._unit()
                unit["cycle"] += 1
                unit["navigation_attempts"] = {}
                unit["pick_attempt"] = 0
                self._set_phase("navigate_pick")
            else:
                self._fail_unit("confirmed bun loss exhausted full-cycle retry or replacement stock")
        else:
            self._hold("possession unknown or world inconsistent at pre-place check")

    def _report(self) -> None:
        task = self._task()
        task_id = task["task_id"]
        if not self._placement_verified(task):
            self._hold("cannot report without matching completed placement and counter evidence")
            return
        if self.state["intent"] is None:
            execution_id = f"{task_id}/report"
            self.state["intent"] = {"execution_id": execution_id, "task_id": task_id, "kind": "report", "target": task["order_id"], "generation": 1, "status": "INTENDED", "reason": "", "dispatch_started": False}
            self._save()
            self._emit("report_intent_persisted", execution_id=execution_id)
        execution_id = self.state["intent"]["execution_id"]
        existing = self.platform.get_report(task_id)
        if existing.is_err and existing.message == "report not found":
            if self.state["intent"].get("dispatch_started"):
                self._hold("dispatched report absent on readback")
                return
            self.state["intent"]["dispatch_started"] = True
            self._save()
            sent = self.platform.report_completion(task_id, task["order_id"], task["session_id"], execution_id)
            if sent.is_err:
                self._emit("report_ack_unavailable", reason=sent.message)
            existing = self.platform.get_report(task_id)
        if existing.is_err or existing.data is None or existing.data.status != "ACCEPTED":
            self._hold(f"platform completion uncertain: {existing.message}")
            return
        report = existing.data
        if (report.task_id, report.order_id, report.session_id, report.execution_id) != (task_id, task["order_id"], task["session_id"], execution_id):
            self._hold("platform accepted report identity mismatch")
            return
        self._unit()["status"] = "complete"
        self._emit("unit_reported", order_id=task["order_id"], session_id=task["session_id"], counter=task["counter"], execution_id=execution_id)
        self.state["index"] += 1
        self.state["active_task_id"] = None
        self._set_phase("select")

    def _placement_verified(self, task: dict) -> bool:
        task_id = task["task_id"]
        cycle = self.state["units"][task_id]["cycle"]
        execution_id = f"{task_id}/c{cycle}/place/a1"
        result = self.mover.get_execution(execution_id)
        if result.is_err or result.data is None:
            return False
        expected = Execution(execution_id, task_id, "place", self.config["placement_targets"][str(task["counter"])], cycle * 100 + 1, "INTENDED")
        if not self._check_identity(expected, result.data) or result.data.status != "COMPLETED":
            return False
        observed = self.perception.verify_placement(task_id, task["counter"])
        return observed.is_ok and observed.data is True

    def step(self) -> None:
        phase = self.state["phase"]
        if phase == "select":
            self._select()
        elif phase == "pick_check":
            self._pick_check()
        elif phase == "pre_place_check":
            self._place_check()
        elif phase == "report":
            self._report()
        elif phase in self.ACTIONS:
            status, reason, safe_to_retry = self._action_status(phase)
            if status == "COMPLETED":
                if phase == "pick":
                    self._set_phase("pick_check")
                elif phase == "pre_place":
                    self._set_phase("pre_place_check")
                elif phase == "place":
                    self._set_phase("report")
                else:
                    self._set_phase(self.NEXT.get(phase, "hold"))
            elif status == "UNKNOWN":
                self._hold(f"{phase} outcome uncertain: {reason}")
            elif not safe_to_retry:
                self._hold(f"{phase} terminal outcome lacks safe no-effect evidence: {reason}")
            elif phase.startswith("navigate") and phase != "navigate_idle":
                attempts = self._unit()["navigation_attempts"][phase]
                if attempts <= self.config["navigation_retries"]:
                    self.state["intent"] = None
                    self._save()
                    self._emit("navigation_retry", attempt=attempts + 1, reason=reason)
                elif phase == "navigate_pick" and self._safe_empty():
                    self._fail_unit("navigation attempts exhausted: " + reason)
                else:
                    self._hold("navigation failed while bun may be held: " + reason)
            elif phase == "pick":
                self._pick_failed(reason)
            elif phase == "navigate_idle":
                self._hold("cannot verify front-counter idle: " + reason)
            elif not self._safe_empty():
                self._hold(f"{phase} failed while holding bun: {reason}")
            else:
                self._fail_unit(f"{phase} failed: {reason}")
        elif phase not in ("done", "hold"):
            raise StateError(f"Unknown controller phase {phase}")

    def _safe_empty(self) -> bool:
        result = self.perception.observe(self.state["active_task_id"], "safety_check", self._unit()["cycle"])
        return result.is_ok and result.data is not None and result.data.held_task_id is None

    def run(self) -> dict:
        try:
            return self._run()
        finally:
            self.close()

    def close(self) -> None:
        self.lock.release()

    def _run(self) -> dict:
        for _ in range(1000):
            if self.state["phase"] in ("done", "hold"):
                break
            self.step()
        else:
            self._hold("controller step bound exceeded")
        summary = self.summary()
        write_json(self.summary_path, summary)
        write_visual(self.visual_path, self.config, self.device.state, self.state, self.events_path)
        return summary

    def summary(self) -> dict:
        units = self.state["units"]
        orders: dict[str, dict] = {}
        for task in self.config["tasks"]:
            order = orders.setdefault(task["order_id"], {"requested": 0, "fulfilled": 0, "failed": 0, "pending_outside_scope": 0})
            order["requested"] += 1
            status = units[task["task_id"]]["status"]
            if status == "complete":
                order["fulfilled"] += 1
            elif status == "failed":
                order["failed"] += 1
            elif task["rack"] != "B":
                order["pending_outside_scope"] += 1
        return {"scenario": self.config["scenario"], "phase": self.state["phase"], "hold_reason": self.state["hold_reason"],
                "units": {key: value["status"] for key, value in units.items()}, "orders": orders,
                "world": self.device.state["world"], "report_count": sum(1 for value in units.values() if value["status"] == "complete"),
                "execution_count": len(self.device.state["executions"]), "config_fingerprint": self.state["config_fingerprint"]}
