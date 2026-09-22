"""Named simulation fixtures; pose/tag values are symbolic placeholders."""

import hashlib
import json


SCENARIOS = (
    "happy", "retries", "partial", "loss", "crash-after-place",
    "ack-loss", "cancellation-hold", "collision-hold",
)


def scenario_config(name: str) -> dict:
    if name not in SCENARIOS:
        raise ValueError(f"Unknown scenario {name!r}; choose from {', '.join(SCENARIOS)}")
    tasks = [
        {"task_id": "pastry-001", "order_id": "order-100", "session_id": "session-100", "rack": "B", "level": 1, "slot": 1, "counter": 1},
        {"task_id": "pastry-002", "order_id": "order-100", "session_id": "session-100", "rack": "B", "level": 1, "slot": 2, "counter": 2},
        {"task_id": "pastry-003", "order_id": "order-100", "session_id": "session-100", "rack": "B", "level": 2, "slot": 1, "counter": 3},
        {"task_id": "pastry-004", "order_id": "order-200", "session_id": "session-200", "rack": "B", "level": 2, "slot": 2, "counter": 4},
        {"task_id": "pastry-rack-a", "order_id": "order-300", "session_id": "session-300", "rack": "A", "level": 1, "slot": 1, "counter": 1},
    ]
    config = {
        "schema": 1, "scenario": name, "tasks": tasks,
        "tags": {"B:1:1": "SIM_TAG_B_1_1", "B:1:2": "SIM_TAG_B_1_2", "B:2:1": "SIM_TAG_B_2_1", "B:2:2": "SIM_TAG_B_2_2", "front": "SIM_TAG_FRONT_COUNTER", "placement": "SIM_TAG_PLACEMENT"},
        "poses": {"lift_pick": "SIM_LIFT_ROUTE_PICK", "lift_place": "SIM_LIFT_ROUTE_PLACE", "pre_pick": "SIM_POSE_PRE_PICK", "travel": "SIM_POSE_TRAVEL", "pre_place": "SIM_POSE_PRE_PLACE", "jolt": "SIM_POSE_JOLT", "pick_reset": "SIM_POSE_PICK_START"},
        "policies": {"pick": "SIM_POLICY_RACK_B"},
        "placement_targets": {str(n): f"SIM_COUNTER_{n}" for n in range(1, 5)},
        "navigation_retries": 1, "vla_retries": 2, "loss_retries": 1,
        "replacement_stock": {task["task_id"]: 1 for task in tasks if task["rack"] == "B"},
        "max_polls": 3, "cancel_polls": 3, "faults": [],
    }
    faults = {
        "retries": [
            {"task_id": "pastry-001", "kind": "navigate_pick", "occurrence": 1, "outcome": "fail"},
            {"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "stuck"},
            {"task_id": "pastry-001", "kind": "pick", "occurrence": 2, "outcome": "no_bun"},
        ],
        "partial": [{"task_id": "pastry-002", "kind": "pick", "occurrence": n, "outcome": "fail"} for n in range(1, 4)],
        "loss": [{"task_id": "pastry-003", "kind": "pre_place_check", "occurrence": 1, "outcome": "loss"}],
        "crash-after-place": [{"task_id": "pastry-001", "kind": "place", "occurrence": 1, "outcome": "crash_after_effect"}],
        "ack-loss": [
            {"task_id": "pastry-001", "kind": "place", "occurrence": 1, "outcome": "drop_ack"},
            {"task_id": "pastry-001", "kind": "report", "occurrence": 1, "outcome": "drop_ack"},
        ],
        "cancellation-hold": [{"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "cancel_unknown"}],
        "collision-hold": [{"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "collision"}],
    }
    config["faults"] = faults.get(name, [])
    return config


def fingerprint(config: dict) -> str:
    encoded = json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("ascii")).hexdigest()


def validate_config(config: dict) -> None:
    if config.get("schema") != 1 or not isinstance(config.get("tasks"), list):
        raise ValueError("Config requires schema 1 and tasks list")
    if not isinstance(config.get("tags"), dict) or not isinstance(config.get("poses"), dict) or not isinstance(config.get("policies"), dict) or not isinstance(config.get("placement_targets"), dict) or not isinstance(config.get("faults"), list):
        raise ValueError("Config requires tags, poses, policies, placement targets and fault list")
    if not {"front", "placement"} <= set(config["tags"]) or not {"lift_pick", "lift_place", "pre_pick", "travel", "pre_place", "jolt", "pick_reset"} <= set(config["poses"]) or "pick" not in config["policies"]:
        raise ValueError("Config is missing a required symbolic tag, pose, lift route or policy")
    if not {str(n) for n in range(1, 5)} <= set(config["placement_targets"]):
        raise ValueError("Config must map all four distinct counters")
    if len({config["placement_targets"][str(n)] for n in range(1, 5)}) != 4:
        raise ValueError("Counter placement targets must be distinct")
    if not isinstance(config.get("replacement_stock"), dict):
        raise ValueError("Config requires replacement_stock mapping")
    ids = set()
    for task in config["tasks"]:
        for key in ("task_id", "order_id", "session_id", "rack", "level", "slot", "counter"):
            if key not in task:
                raise ValueError(f"Task missing {key}")
        if task["task_id"] in ids:
            raise ValueError(f"Duplicate task ID {task['task_id']}")
        ids.add(task["task_id"])
        if task["counter"] not in (1, 2, 3, 4):
            raise ValueError("Counter must be one of 1, 2, 3, 4")
        if task["rack"] == "B" and f"B:{task['level']}:{task['slot']}" not in config.get("tags", {}):
            raise ValueError(f"Missing Rack B tag for {task['task_id']}")
    for key in ("navigation_retries", "vla_retries", "loss_retries", "max_polls", "cancel_polls"):
        if not isinstance(config.get(key), int) or config[key] < 0:
            raise ValueError(f"Invalid {key}")
    if config["max_polls"] == 0 or config["cancel_polls"] == 0:
        raise ValueError("Poll budgets must be positive")
    for task in config["tasks"]:
        if task["rack"] == "B" and (not isinstance(config.get("replacement_stock", {}).get(task["task_id"]), int) or config["replacement_stock"][task["task_id"]] < 0):
            raise ValueError(f"Invalid replacement stock for {task['task_id']}")
    for fault in config["faults"]:
        if not isinstance(fault, dict) or not {"task_id", "kind", "occurrence", "outcome"} <= set(fault) or fault["task_id"] not in ids or not isinstance(fault["occurrence"], int) or fault["occurrence"] < 1:
            raise ValueError("Invalid fault rule")
