# Run the humanoid pick-loop simulation

This standard-library Python harness runs the complete Rack B pastry path with replaceable AMR, VLA, humanoid mover, lift, perception and platform stubs. It uses fresh local simulation state. It does not connect to a robot, policy server, platform API, ROS or DDS. No dependency installation is needed.

Read [FLOW.md](FLOW.md) for the reconciled workflow, [PLAN.md](PLAN.md) for architecture and acceptance decisions, [ADAPTERS.md](ADAPTERS.md) for the hardware replacement points, and [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md) for real interfaces and their limits.

## Start a demonstration

Run commands from the repository root (`D:/Work/FPS/Robotics/end-to-end-sim` in this workspace). Use Python 3.10 or newer. The original standalone acceptance used the following bundled interpreter; the portable `python` command below works with an appropriate interpreter on PATH:

```powershell
& 'C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m humanoid_harness --scenario happy --state-dir .humanoid-runs/my-demo
```

With Python already on PATH, the portable form is:

```text
python -m humanoid_harness --scenario happy --state-dir .humanoid-runs/my-demo
```

Choose a new directory for each independent run. Resume an existing fixture explicitly. Do not point the harness at captured or live journals/databases.

The run writes:

| File | Use |
| --- | --- |
| `world.html` | Open locally to replay location, posture, possession and all four counters. |
| `events.jsonl` | Ordered stage/lifecycle events and recorded world facts. |
| `summary.json` | Terminal outcome, task/fulfillment counts and evidence summary. |
| `controller.json` | Controller checkpoint, action identity, progress and holds. |
| `device.json` | Independent simulated executions, physical effects and world inventory. |
| `platform.json` | Independent accepted per-task completion records. |

An acknowledgment means the adapter accepted work. Fulfillment requires physical placement and accepted completion reporting. An exit into a hold requires reconciliation; restarting is not permission to repeat an uncertain movement. This version deliberately has no operator-resolution command: `--resume` preserves the hold and its task/action evidence. A real rescue/reset procedure is still undefined. Use a fresh fixture to explore a different simulation outcome.

## Failure and recovery demonstrations

Each command below uses a distinct fixture. All commands are one physical line.

```text
python -m humanoid_harness --scenario retries --state-dir .humanoid-runs/my-retries
python -m humanoid_harness --scenario partial --state-dir .humanoid-runs/my-partial
python -m humanoid_harness --scenario loss --state-dir .humanoid-runs/my-loss
python -m humanoid_harness --scenario ack-loss --state-dir .humanoid-runs/my-ack-loss
python -m humanoid_harness --scenario cancellation-hold --state-dir .humanoid-runs/my-cancellation-hold
python -m humanoid_harness --scenario collision-hold --state-dir .humanoid-runs/my-collision-hold
```

`retries` exercises independent local retry behavior. `partial` retains successful quantities when another unit fails. `loss` restarts the rack path after confirmed loss before placement, consuming a distinct spare bun instead of recreating the lost one. `ack-loss` separates an accepted effect/report from its missing acknowledgment. `cancellation-hold` exposes cancellation with an uncertain outcome; `collision-hold` prevents retry after a collision. If an action completes during cancellation, retain that effect and hold before the next movement.

To demonstrate a process restart after a durable placement but before the controller records completion:

```text
python -m humanoid_harness --scenario crash-after-place --state-dir .humanoid-runs/my-crash-after-place
python -m humanoid_harness --scenario crash-after-place --state-dir .humanoid-runs/my-crash-after-place --resume
```

The first invocation exits with code 75 at the injected crash boundary. The second reconciles the same execution and continues. Inspect `device.json`, `events.jsonl` and the final summary to verify that placement was not repeated. Exit code 0 means the run completed, which may still include an explicitly partial order. Code 2 means a hold or a configuration/state error; read the console reason and, when a run was created, `summary.json`.

## Configure placeholders and faults

Export an editable starting configuration:

```text
python -m humanoid_harness --write-default-config .humanoid-runs/custom-config.json
```

Run it in another fresh fixture:

```text
python -m humanoid_harness --config .humanoid-runs/custom-config.json --state-dir .humanoid-runs/custom
```

Task records contain separate task, order and session identities, rack, level, slot and assigned counter. Tags and poses are named simulation placeholders. Counter targets 1-4 are distinct entries. Changing a tag or pose here does not calibrate hardware or enable a real connection.

Retry settings count retries after the first attempt: `navigation_retries=1`, `vla_retries=2`, `loss_retries=1`. Poll budgets bound action and cancellation observation. Fault rules select a task, action kind and occurrence, then choose a deterministic outcome/delay. Keep the configuration unchanged when resuming; create a new fixture for a changed experiment.

For example, place this verified entry inside the exported configuration's `faults` array to make a pick finish while cancellation is pending. The held bun is retained and the controller holds before placement:

```json
{"task_id":"pastry-001","kind":"pick","occurrence":1,"outcome":"cancel_race"}
```

Use `{"task_id":"pastry-001","kind":"navigate_pick","occurrence":1,"outcome":"delay","delay_polls":2}` to model a delayed navigation lifecycle. Delay is measured in virtual polls, not wall-clock seconds. The fault rule changes the stub's behavior, not the real adapter contract.

| Selector group | `kind` values | Outcomes |
| --- | --- | --- |
| Physical actions | `navigate_pick`, `lift_pick`, `pre_pick`, `pick`, `jolt`, `pick_reset`, `retract`, `navigate_place`, `lift_place`, `pre_place`, `place`, `navigate_idle` | `success`, `fail`, `reject`, `delay`, `stuck`, `no_bun`, `unknown`, `collision`, `drop_ack`, `crash_after_effect`, `cancel_unknown`, `cancel_race` |
| Perception | `pick_check`, `pre_place_check`, `safety_check` | `success`, `loss`, `unknown` |
| Completion reporting | `report` | `success`, `drop_ack`, `reject`, `unknown` |

Choose an outcome meaningful for the selected action: `no_bun` belongs on `pick`, and loss-before-placement belongs on `pre_place_check`. Action `occurrence` counts persisted executions for that task and kind; a new safe attempt increments it, while readback of the same execution does not. Observation occurrence counts calls per task/phase across cycles. Report occurrence stays at 1 until acceptance because rejected or unknown submissions do not create an accepted report.

`summary.json` includes `phase`, `hold_reason`, `units`, `orders`, `world`, `report_count`, `execution_count` and `config_fingerprint`. Each order exposes `requested`, `fulfilled`, `failed` and `pending_outside_scope`. In the retained partial demo, `order-100` remains fulfilled 2 of 3 with one failed unit; the Rack A order remains pending outside scope.

## Run acceptance tests

```powershell
& 'C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m unittest discover -s tests/humanoid_harness -v
```

Tests create fresh isolated fixtures. They do not use the existing client/Nova recovery state or shared ports. Simulation validation and outstanding real-system work are recorded in [VALIDATION.md](VALIDATION.md).
