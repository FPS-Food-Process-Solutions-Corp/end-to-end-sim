# Validation and limits

Validation date: 2026-09-22. Worktree: `C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim`; branch: `codex/humanoid-pick-loop`. Implementation and tests were performed by GPT-6 Sol, with a separate Sol code reviewer. Astra owns this assessment and the documentation. Luna performed read-only source research.

## Software acceptance

The acceptance suite uses Python 3.12.14 and only the standard library. It runs subprocess CLI scenarios and isolated adapter/ledger tests in fresh fixture directories. No dependency was installed; no shared service, port, ROS domain, physical device, captured journal or live database was used.

**Result: 21 acceptance tests passed in 10.443 seconds.** The independent review rerun completed in 10.66 seconds and found no remaining blocking defects in the requested simulation invariants. Python syntax, ASCII source and module-level imports passed for all 16 Python files under the package/tests; imports are standard-library or local. Git whitespace checks also passed.

```powershell
& 'C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m unittest discover -s tests/humanoid_harness -v
```

The completed scenarios exercise:

| Area | Evidence checked |
| --- | --- |
| Complete flow | Rack B-only work, explicit lift/posture/VLA/perception stages, assigned counters 1-4, immediate next task and front-counter return. |
| Quantity and partial fulfillment | Per-task fulfillment, retained successful units, failed units not counted, Rack A work left pending. |
| Retry boundaries | Separate navigation/VLA budgets, safe stuck recovery, whole-cycle retry after confirmed loss. |
| Physical inventory | Distinct physical bun IDs, explicit replacement stock, lost bun never resurrected, conserved world inventory. |
| Durable effect recovery | Process exit after place effect but before controller checkpoint; resume reconciles the same execution without another placement. |
| Missing acknowledgment | Device submission and accepted platform completion can lose acknowledgments without duplicating effects or fulfillment. |
| Cancellation and collision | Unknown results hold. A cancellation race retains completed effects and stops before dependent motion. Collision does not enter a blind retry. |
| Adapter separation | Submission/status/cancel use the injected adapter; reporting uses the public readback contract. |
| Identity and freshness | Mismatched generation/identity on submission, polling or cancellation cannot satisfy the current execution. |
| Startup consistency | Unrelated state directory, changed configuration, corrupt/missing state and concurrent writer are rejected. A report checkpoint without placement proof cannot fulfill a task. |
| Replay data | Event frames preserve recorded location, posture, held bun and distinct counter contents; frame JSON agrees with world facts. |

## Retained demonstrations

Generated outputs live under `.humanoid-runs/`, which is ignored by Git. They are simulation fixtures, not captured hardware state. Each retained run includes controller/device/platform JSON, event JSONL, summary JSON and its HTML replay.

| Retained replay | Observed result |
| --- | --- |
| `.humanoid-runs/happy/world.html` | Done; four accepted reports; 148 world snapshots; four Rack B units fulfilled. |
| `.humanoid-runs/partial/world.html` | Done; three reports overall; `order-100` fulfilled 2 of 3, one failed; 136 snapshots. |
| `.humanoid-runs/crash-after-place/world.html` | First process exited 75; resume exited 0; four reports; `pastry-001` has exactly one place execution; 149 snapshots. |
| `.humanoid-runs/cancellation-hold/world.html` | Initial run and resume remain held; zero reports; unchanged execution ledger; 15 snapshots. |

All four leave the Rack A `order-300` requested quantity of one pending outside scope. Development smoke runs are retained separately under `.humanoid-runs/development/`.

Use the runbook's two separate `crash-after-place` invocations to reproduce the process-boundary recovery. Inspect the device execution/effect record alongside the completion report; the final controller state alone is not the recovery oracle.

## What this establishes

The tests establish the software controller's behavior against explicit simulated adapter contracts. They also exercise persistent world effects independently of the controller checkpoint and accepted platform reports independently of their acknowledgments.

The real interfaces in [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md) were source-reviewed only. The harness's durable execution IDs, terminal evidence and replay guarantees are not capabilities attributed to current firmware or raw inference RPCs. The reviewed source revisions and the separate client-recovery provenance are recorded in that document and [FLOW.md](FLOW.md).

## Remaining limits

- No real AMR, humanoid, lift, camera, VLA model or platform service was executed. This is not integrated Atom/Nova/client acceptance.
- Tags, poses, policies and counter targets remain symbolic simulation placeholders. Actual payload translation, calibration and safe jolt recipes require real adapters and hardware work.
- Real transports need command correlation, fresh measured terminal evidence, stopped/cancelled confirmation and durable reconciliation before making a physical replay claim.
- Unknown/collision/cancellation holds are persistent. This version has no operator-resolution command because the physical rescue/reset procedure is undefined.
- The HTML replay was generated and its embedded world data/source were checked, but visual browser QA was not performed: browser security policy blocked the local `file:///` preview. No alternate server or browser workaround was attempted. Open the retained HTML locally to inspect its appearance and controls.
- Virtual poll budgets model deterministic lifecycle behavior; they are not real-time performance, stopping-distance or policy-quality measurements.
