"""Child process for a durable retract effect with no failure-ready proof."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

from humanoid_harness.integration import HumanoidPickExecutor
from humanoid_harness.integration.executor import default_config
from humanoid_harness.stubs import StubDevice

from .fixtures import task_context


def config_factory(ctx):
    config = default_config(ctx)
    config["faults"] = [
        {"task_id": ctx.task_id, "kind": "pick", "occurrence": occurrence, "outcome": "fail"}
        for occurrence in (1, 2, 3)
    ]
    return config


async def main(state_root):
    executor = HumanoidPickExecutor(state_root, config_factory=config_factory)
    original_save = StubDevice._save

    def crash_after_durable_retract(device):
        original_save(device)
        if any(record["kind"] == "failure_retract" and record["effect_applied"] for record in device.state["executions"].values()):
            os._exit(77)

    async def progress(_subtask, _percent):
        return None

    with patch.object(StubDevice, "_save", crash_after_durable_retract):
        await executor.run(task_context(), progress)
    raise AssertionError("Failure retract effect did not trigger the hard crash")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
