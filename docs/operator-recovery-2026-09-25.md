# Operator recovery verification - 2026-09-25

Status: simulator CLI milestone implemented and verified on `codex/operator-recovery`. The earlier E2E integration is merged locally into `main` at `0c9e81d`. Operator recovery is a separate change for review; nothing was pushed.

## What an operator can do

The new command inspects a stopped humanoid simulator run, reconciles an eligible saved placement report, and releases an eligible exact physical hold. It records who acted, why, the task and hold identity, and the evidence before and after the action. The [runbook](operator-recovery-runbook.md) has the commands and refusal guidance.

A placement can be confirmed by the platform while the device remains held. Release requires a genuinely completed retract plus a fresh safe-readiness observation. An UNKNOWN retract remains held. Recovery does not move the robot, repeat a pick, or provide a general force-ready button.

## Changed items to review

All source changes are in `end-to-end-sim`.

| Item | Change and purpose |
|---|---|
| `humanoid_harness/operator_recovery.py` | Shared inspection, saved-report reconciliation, exact hold release and durable action audit. Exclusive locks and an inspection fingerprint reject competing writers and changed context. |
| `humanoid_harness/recovery.py` | Operator CLI with human and JSON output, exact identity inputs, action ID, actor and reason. JSON output stays separate from progress logs. |
| `humanoid_harness/controller.py` | Narrow no-motion readiness verification and action-tagged proof for a completed retract; physical world and execution history remain unchanged. |
| `humanoid_harness/integration/executor.py` | Normal startup refuses an incomplete or malformed recovery journal, including interruption between readiness, ownership and final audit writes. |
| `tools/e2e_operator_recovery_case.py` | Real-API acceptance fixture for held placement, report reconciliation, refusal/release, replay and restart, with preserved CLI, wire, API and state evidence. |
| `tools/run_e2e_acceptance.py` | Two operator case modes using fresh run directories and database clones, source capture and owned cleanup. |
| Three operator test modules | Service/CLI, independent crash and stale-state review, and acceptance-fixture checks. |
| Runbook, plan, reports and evidence index | Operator instructions, tested scope, failures and fixes, exact provenance and remaining work. |

The canonical `platform-client` remains on `dev` at `adf51339db90f75ee078d51bc8fba36148414d89`. Canonical `nova5_ros2` remains on `nova5_vision_lebai_andy` at `4055912c72a90e841b79cbc93852fe9cc807927a`. Neither required another source change. Canonical `coffee-platform` remained read-only. Runtime checks used the existing prepared WSL platform stage and isolated database clones; that stage has previously documented test-only patch history and is not a pristine canonical-platform claim.

## Runtime results

Both selected cases ran against the real prepared platform API, Socket.IO capture proxy and canonical pinned client, with executable source captured at `be2ec370ba865f899a855b305f5d36df276d0caf`.

| Selected case | What happened | Result |
|---|---|---|
| `operator-unknown-03` | The simulator stopped after verified placement with an UNKNOWN retract. Offline recovery sent exactly one original completion report; the platform confirmed it. Release refused. Restart added no assignment, physical effect or next-task request. Owner HOLD and unknown readiness persisted; the live device checkpoint was PAUSED/online. | Passed |
| `operator-motion-busy-02` | The retract was completed but its first readiness observation was motion_busy. Recovery confirmed the report, took a fresh safe observation (version 2), and released only the exact hold. Replaying the same action made no new write; changing its intent refused. Ordinary restart added no assignment or physical effect, and the live device checkpoint was FREE/online. | Passed |

Each final case verified all 341 captured source files unchanged. Both normal launcher shutdowns ended with an OFFLINE checkpoint; each owned API stopped successfully and cleanup found no issues or remaining test listeners. The negative case's unchanged hold and the positive case's exact release were checked against durable state as well as sampled API/proxy observations.

The [machine-readable summary](verification/operator-recovery-2026-09-25/summary.json) records exact source versions, artifact hashes, case results and cleanup. Full raw state, proxy traffic, logs and source captures remain local under `docs/verification/operator-recovery-2026-09-25/raw/`; only selected reports and the summary are committed. Historical integration pins and earlier evidence were not rewritten.

## Software checks

| Report | Result | Scope and source qualification |
|---|---|---|
| [CLI and independent recovery checks](verification/operator-recovery-2026-09-25/pytest-operator-cli-json-fix.txt) | 26 passed | Final CLI fix: 20 focused checks plus 6 independent review checks. The tested code was subsequently committed as `be2ec370`. |
| [Earlier focused recovery checks](verification/operator-recovery-2026-09-25/pytest-operator-recovery-probing-stage.txt) | 18 passed | Probing-stage implementation before the later CLI output fix; these checks are also represented in the final focused suite. |
| [Humanoid regression](verification/operator-recovery-2026-09-25/pytest-humanoid-regression-probing-stage.txt) | 68 passed | Existing standalone/integration behavior after the probing-stage fix. Later edits were confined to fixture lifecycle checks and CLI output separation; controller/executor code did not change afterward. |
| [Acceptance fixture checks](verification/operator-recovery-2026-09-25/pytest-operator-fixture-live-liveness.txt) | 7 passed | Correct live-state and normal-shutdown checkpoints, including launcher liveness on both sides of the API read; committed in `46ab51d`. |
| [Independent crash/proof review](verification/operator-recovery-2026-09-25/pytest-operator-review-probe-crash.txt) | 6 passed | Crash before a fresh probe cannot reuse an earlier safe proof; changed context and unfinished actions refuse. These checks also appear in the 26-test run above. |

These suites overlap and ran at documented implementation stages; the counts are not an aggregate total or a claim that every suite reran after each later edit. Corresponding JUnit records are included beside the console reports.

## Findings and fixes

- **Placement saved before report queueing:** the forced exit occurs before the normal completion queue exists. Recovery reconstructs the eligible completion from verified saved placement evidence and sends through the existing guarded client API. It does not invent a platform confirmation.
- **Interrupted multi-file recovery:** readiness, ownership and audit state can be written separately. Durable intent and progress stages allow a retry of the same action to finish safely; normal startup refuses unresolved recovery.
- **Old readiness proof:** a new action must obtain a fresh observation. A durable probing stage and action-tagged proof prevent a crash immediately before probing from reusing a prior safe observation.
- **Wrong fixture checkpoint:** `operator-unknown-01` failed because the fixture expected PAUSED after intentionally stopping the launcher. The normal final state is OFFLINE. The fixture now checks PAUSED/FREE while the launcher is alive and separately checks OFFLINE after shutdown.
- **Mixed CLI output:** `operator-motion-busy-01` safely released the hold but then failed strict JSON parsing because two progress messages preceded the result. The CLI now sends progress to stderr and one JSON document to stdout. The fixture continues to parse the complete stdout; it does not hide the defect by stripping lines.

## Preserved attempts and evidence limits

| Attempt | Source | Disposition |
|---|---|---|
| `operator-unknown-01` | `16d3944` | Failed fixture timing expectation; preserved, excluded from acceptance. |
| `operator-unknown-02` | `46ab51d` | Passed and independently audited at its own historical source. The final selected negative case is unknown-03. |
| `operator-motion-busy-01` | `46ab51d` | Failed CLI structured-output boundary after physical release; remaining acceptance steps were not reached. Preserved, excluded from acceptance. |
| First focused test attempt | Early implementation | 12 passed / 1 failed because setup progress remained in the test capture. The test was corrected to clear setup capture. Its original raw files were overwritten before the retention instruction; only the recorded observation remains. No replacement failed report was manufactured. |

## Remaining work

This completes the first simulator CLI milestone, not the entire [broader recommendation](operator-recovery-recommendation-2026-09-24.md).

- Cancellation accounting and failure-report `OPERATOR_HOLD` resolution remain deferred and unexercised as recovery workflows. Platform defects are unchanged.
- A Nova operator adapter, browser recovery UI and broader device recovery policy remain unimplemented.
- Real hardware readiness, calibrated movement, sensors, physical stopping and recovery from genuinely unknown hardware outcomes require separate adapters and hardware validation.
- The normal humanoid launcher has no completion callback, so `callback_acknowledged=false` is not applicable to this path; the tests do not fabricate a callback.
- Status observations are sampled checkpoints, not proof of uninterrupted device state between samples. The tested crash boundaries and one-report evidence do not establish exactly-once behavior under every possible network or process failure.

Recommended next step: review this separate branch and, if useful, conduct a user-operated CLI trial on a fresh disposable simulator run. After that, add a read-only recovery panel backed by this service, then scope the Nova adapter independently.
