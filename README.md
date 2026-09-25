# End-to-end robotics simulation

This repository joins the platform client, Nova bridge and humanoid pick-loop simulator for software tests. Hardware movements are simulated; the adapter interfaces retain the boundaries needed for later hardware work.

## Choose a starting point

| What you want to do | Guide |
|---|---|
| Watch the humanoid pick loop without starting services | [Standalone humanoid runbook](docs/humanoid-harness/README.md) |
| Run the combined mixed-device and recovery acceptance cases | [E2E acceptance runbook](docs/e2e-acceptance-runbook.md) |
| Connect the humanoid simulator to the real local platform client | [Platform integration guide](docs/humanoid-integration/README.md) |
| Try the earlier staged Nova snack scenario through the kiosk/admin frontend | [First-order runbook](docs/first-order-runbook.md) |
| Review coverage, failures and remaining work | [Master verification report](docs/master-verification-report.md) |
| Find where AMR, VLA, mover, lift and perception hardware adapters belong | [Adapter guide](docs/humanoid-harness/ADAPTERS.md) |

The frontend runbook uses the earlier staged Nova environment. Its results do not establish that the combined humanoid/Nova path has been exercised through the browser.

## Run a standalone demonstration

From this repository's root, using Python 3.10 or newer:

```text
python -m humanoid_harness --scenario happy --state-dir .humanoid-runs/my-demo
```

Choose a new state directory for an independent run. Open `.humanoid-runs/my-demo/world.html` to replay the simulated actions and read `summary.json` for the result. The [runbook](docs/humanoid-harness/README.md) covers failures, partial fulfillment and resuming an interrupted run.

## Use the prepared local environment

The existing WSL environment is documented in [wsl-environment.md](docs/wsl-environment.md). The combined integration uses the canonical sibling `platform-client` and `nova5_ros2` checkouts; the [merge record](docs/merge-execution-2026-09-24.md) identifies the merged versions. Launch commands must select the intended source directories explicitly.

The real-client launcher checks the imported module locations and reviewed source content. Keep those checks enabled. A deliberate change to client code requires a reviewed source-pin update and verification of the resulting pairing. Historical acceptance manifests continue to describe the source bytes used for those particular runs.

Use fresh isolated state and test databases for independent cases. Resume the same state only for an intentional recovery test. Captured journals, action ledgers and databases are evidence; editing them to force a result invalidates the test.

Direct use of the fake ROS provider requires `ROS_LOCALHOST_ONLY=1` and an explicit `ROS_DOMAIN_ID` from 1 through 232. It rejects missing/default or invalid isolation settings before initializing ROS. Use the domain selected by the simulation runner; do not share an active fixture's domain.

## Scope and records

The harness verifies software behavior around action identity, progress, physical-result simulation, durable reporting, restart recovery and holds. It does not establish calibrated poses, reachability, sensor reliability, physical stopping or hardware exactly-once execution. Counter 4 is a distinct symbolic simulation target.

The unchanged platform still has the partial-order, cancellation-accounting and replay limits described in the [master report](docs/master-verification-report.md). The [operator recovery recommendation](docs/operator-recovery-recommendation-2026-09-24.md) is proposed follow-up work, not an implemented physical recovery command.

The repository retains reviewed source, tests and documentation. Local run state and historical raw captures are preserved separately from the source commits; each acceptance record states which evidence and source version support its conclusions.
