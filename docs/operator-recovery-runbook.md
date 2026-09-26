# Operator recovery runbook

Status: validated for the first simulator CLI milestone at executable source `be2ec370ba865f899a855b305f5d36df276d0caf`. See the [verification report](operator-recovery-2026-09-25.md) for the two final runtime cases, software checks, preserved failed attempts and limits.

This workflow is for the humanoid simulator's saved integration state. It does not command motion. It keeps placement/reporting, physical hold and readiness separate. The earlier Nova operator command remains a separate workflow.

## Before making a change

Use your own stopped simulation run. Stop its launcher through its normal process owner; the recovery service refuses a competing writer. Do not mutate a preserved accepted run or copy its evidence into a new directory and present that copy as a new test.

The commands below run in the prepared Ubuntu-22.04 WSL shell. Replace the state directory with the integration state root that contains `device-owner.json`, `device-readiness.json` and `task-identities.json`. The parent acceptance-run directory is not necessarily the state root.

```bash
cd /mnt/d/Work/FPS/Robotics/end-to-end-sim
E2E_RECOVERY_PY=/home/user/.venvs/end-to-end-sim-ros/bin/python
E2E_RECOVERY_CLIENT=/mnt/d/Work/FPS/Robotics/platform-client
E2E_RECOVERY_STATE=/absolute/path/to/your/stopped/integration-state
```

These variables belong to the current shell session. Set them again if you open another terminal.

## Inspect the saved state

```bash
"$E2E_RECOVERY_PY" -m humanoid_harness.recovery inspect --state-root "$E2E_RECOVERY_STATE" --client-source "$E2E_RECOVERY_CLIENT" --format human
```

Use `--format json` for structured output: stdout contains one JSON result and service progress goes to stderr. Preserve both streams when recording evidence. Exit code 0 means inspection or a completed action; 1 reports a service/validation error; 2 reports refusal or another non-complete action result (argument-usage errors also use 2). Read the result before deciding whether to resume or start a new action. Inspection shows saved offline evidence, the exact identity and hold, reporting/callback state, readiness, action eligibility and audit history. A confirmed report does not mean the robot is ready.

Copy the inspection fingerprint and exact order, session, task, counter, place-execution and hold identifiers before choosing an action. Every placeholder in the examples below must be replaced. Use a new UUID for a new action, and keep the complete original command if it must be resumed after an interruption.

## Reconcile the saved report

Keep the physical hold while reconciling an eligible report through the existing platform client. Supply the correct loopback address of the owned local test API; this is not an arbitrary remote-platform recovery tool.

```bash
"$E2E_RECOVERY_PY" -m humanoid_harness.recovery reconcile-report --state-root "$E2E_RECOVERY_STATE" --client-source "$E2E_RECOVERY_CLIENT" --format human --action-id "<new-UUID>" --operator "<operator-id>" --reason "Reconcile the saved placement report without motion" --order-id "<order-id>" --session-id "<session-id>" --task-id "<task-id>" --counter "<counter>" --place-execution-id "<place-execution-id>" --hold-id "<hold-id>" --expected-inspection-sha256 "<inspection-sha256>" --api-url "http://127.0.0.1:<owned-api-port>"
```

`--api-url` supplies the original local platform base URL for HTTP readback. Reports are sent over Socket.IO. By default the Socket.IO connection uses that same base URL; the optional `--socket-url` instead selects the exact saved loopback capture-proxy URL. Both routes must lead to the original run's API/database. HTTP readback and Socket.IO report sends are separate evidence.

This action must not request another task or repeat the placement. Read the result and inspect again. Use the new inspection fingerprint for a different action. Pending, confirmed and operator-held reporting states remain distinct; a reporting refusal is not permission to clear a physical hold.

## Release an eligible physical hold

The first implementation accepts only the simulator's verified completed-retract path. It takes a fresh readiness observation and checks the exact action, empty hand, travel posture and safe stationary state. An unknown or running retract is refused. A reason or confirmation flag cannot substitute for device evidence.

```bash
"$E2E_RECOVERY_PY" -m humanoid_harness.recovery release-hold --state-root "$E2E_RECOVERY_STATE" --client-source "$E2E_RECOVERY_CLIENT" --format human --action-id "<different-new-UUID>" --operator "<operator-id>" --reason "Recheck simulator readiness after the invalid initial observation" --order-id "<order-id>" --session-id "<session-id>" --task-id "<task-id>" --counter "<counter>" --place-execution-id "<place-execution-id>" --hold-id "<hold-id>" --expected-inspection-sha256 "<fresh-inspection-sha256>"
```

A physical release must not clear another hold or override reporting/callback gates. Resume the ordinary launcher only after reading the result. The normal client still applies its own reporting and readiness gates.

## Refusal or interruption

If the exact identity, source, configuration, readiness version or relevant saved state has changed, inspect again and reassess. Do not guess replacement identifiers, edit a journal to remove a hold, or reuse another item's action ID to force success.

An unfinished recovery action deliberately blocks ordinary launcher startup until its transaction is repaired. A harmless terminal preflight refusal does not create that startup block.

If a command is interrupted, retain its UUID and original attribution. Inspect the audit history and resume the same action with its original command. A completed-action replay returns its saved result without a new mutation; that historical result is not a fresh readiness observation.

An unknown retract outcome remains held. This milestone does not implement hardware recovery, a cancellation/inventory repair, or a generic completion/failure reporting OPERATOR_HOLD override. See the [implementation plan](operator-recovery-plan.md) and [original recommendation](operator-recovery-recommendation-2026-09-24.md) for the boundary.

## Run the automated acceptance controls

These controls create their own test database, API, client and simulator processes, then stop the processes and retain the results. They are automatic verification runs, not a way to leave an API running for later manual recovery. The prepared environment and source-root requirements are described in the [E2E acceptance runbook](e2e-acceptance-runbook.md).

The following commands are fresh user examples, not the paths of the archived verification runs. The accepted archives are `operator-unknown-03` and `operator-motion-busy-02`, recorded in the [evidence summary](verification/operator-recovery-2026-09-25/summary.json). From the repository root in the prepared WSL shell, create the output parent and choose one fresh case:

```bash
mkdir -p .local/operator-acceptance
/home/user/.venvs/end-to-end-sim-ros/bin/python tools/run_e2e_acceptance.py --execute --case operator-unknown-retract --run-root /mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/operator-acceptance/unknown-user-01 --client-root /mnt/d/Work/FPS/Robotics/platform-client --nova-root /mnt/d/Work/FPS/Robotics/nova5_ros2 --platform-stage /home/user/e2e-stage/coffee-platform --seed-db coffee_platform_sim --database-name taska_20260925_operator_unknown_user_01 --api-port 3211 --humanoid-port 3212 --nova-port 3213 --ros-domain-id 82 > .local/operator-acceptance/unknown-user-01.console.log 2>&1
```

The unknown-retract case must reconcile the saved report while preserving the physical hold, refuse release and remain held after normal restart.

```bash
/home/user/.venvs/end-to-end-sim-ros/bin/python tools/run_e2e_acceptance.py --execute --case operator-motion-busy-release --run-root /mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/operator-acceptance/ready-user-01 --client-root /mnt/d/Work/FPS/Robotics/platform-client --nova-root /mnt/d/Work/FPS/Robotics/nova5_ros2 --platform-stage /home/user/e2e-stage/coffee-platform --seed-db coffee_platform_sim --database-name taska_20260925_operator_ready_user_01 --api-port 3221 --humanoid-port 3222 --nova-port 3223 --ros-domain-id 83 > .local/operator-acceptance/ready-user-01.console.log 2>&1
```

The positive case uses an actually completed retract with a deliberately invalid first readiness observation. A separate fresh observation must permit the exact physical release without new motion, and normal restart must honor the durable result.

Each case's state root is `<run-root>/humanoid-state`. For a repeat, change the run directory, database name and console filename together. Run cases sequentially with free loopback ports and isolated ROS domains. The runner uses the prepared WSL root/PostgreSQL account-switch setup described in the main runbook.

For manual `reconcile-report`, the original run's owned API must still be running against that run's database. Its URL must match that environment; starting another seed database does not recreate the original task. Do not use an automated acceptance archive as a mutable operator demo.
