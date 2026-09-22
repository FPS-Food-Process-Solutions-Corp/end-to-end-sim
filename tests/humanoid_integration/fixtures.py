"""Exact public client task objects and one-unit simulator configurations."""

from hr_client.locations import AmrTarget, CounterLocation, SlotLocation
from hr_client.models import RackArea, TaskContext

from humanoid_harness.integration.executor import default_config


def task_context(task_id="pastry-004", retry_count=0):
    rack = RackArea("rack_b_level_2_slot_2", "rack_b", 2, 2, "Rack B 2/2")
    slot = SlotLocation("rack_b", 2, 2, AmrTarget(0.0, tag="SIM_TAG_B_2_2"), ())
    counter = CounterLocation(4, AmrTarget(0.0, tag="SIM_TAG_PLACEMENT"), ())
    return TaskContext(
        session_id="session-200",
        task_id=task_id,
        item_id="item-bun",
        item_name="Bun",
        retry_count=retry_count,
        rack_area=rack,
        counter_area=4,
        slot_location=slot,
        counter_location=counter,
        order_id="order-200",
    )


def faulty_config(ctx, kind, outcome, occurrences=(1,)):
    config = default_config(ctx)
    config["faults"] = [
        {"task_id": ctx.task_id, "kind": kind, "occurrence": occurrence, "outcome": outcome}
        for occurrence in occurrences
    ]
    return config
