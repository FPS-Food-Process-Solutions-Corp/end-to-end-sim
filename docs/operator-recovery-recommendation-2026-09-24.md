# Recommended operator recovery workflow

Prepared 2026-09-24. This is a proposal for review, not an implemented feature or permission to operate hardware. Existing tested behavior and its limits are in [the master verification report](master-verification-report.md).

## Recommendation

Build one small recovery service with a command-line interface first. Provide a read-only inspection view and narrowly defined recovery actions. Add a graphical recovery panel after the commands and their audit trail work in the simulator.

Use the same recovery logic from both interfaces. Keep three facts separate: what physically happened, whether the platform acknowledged it, and whether the device is ready for another task. A completed placement can be reported while the device remains physically held. A platform cancellation cannot establish that a robot is safe to move.

Start with the existing `platform-client` recovery APIs and the humanoid simulator. Extend the common operator experience to Nova by reusing its existing manual recovery commands. Real-hardware use follows validation of the actual adapters and observations.

## What the operator should see

| Item | Information to display |
|---|---|
| Work identity | Device, order, session, task, retry generation, physical execution ID, and destination |
| Physical outcome | Known success, known failure, or unknown; supporting receipt or observation |
| Reporting | Pending, confirmed, or conflicting; last attempt and authoritative readback when available |
| Readiness | Current hold, whether an action is still active, and latest verified readiness observation |
| Suggested action | An eligible action with prerequisites, or the reason no action is currently permitted |
| History | Who acted, why, when, evidence used, and result |

Inspection should work from saved evidence offline. A separately identified live refresh can obtain current platform/device status. Distinguish recorded observations from current ones.

Treat the execution identity and readiness version as part of the recovery item. If either changes after inspection, refresh the item and reassess the action before applying it.

## Actions to support

| Situation | Recommended action | Required boundary |
|---|---|---|
| A known outcome has not been acknowledged | Retry or reconcile the saved report through the existing client path. | Preserve original identity and outcome; no repeated physical action. |
| Placement is verified, but retract/readiness is unresolved | Report the known placement if eligible, then retain the physical hold. | Placement accounting is separate from permission to accept more work. |
| Physical outcome is unknown | Show required inspection/controller evidence and retain the hold. | Unknown is not proof of failure, success, empty hands, or readiness. |
| A controller later provides a matching terminal outcome | For Nova, reuse the reviewed recovery branch's existing manual late-success command. Add an equivalent supported adapter before offering this action for another device. | Exact execution correlation, durable recording, separate readiness verification, and no repeated pick. |
| Fresh device evidence establishes readiness | First persist and verify the device's current release evidence and matching hold token; then release that token through the public client API. | Other reporting, callback, execution, or recovery gates stay effective. |
| A completion cannot settle because the order was cancelled or platform state conflicts | Offer the existing eligible audited local completion-recovery path, with unresolved platform accounting identified separately. | Local resolution does not claim platform confirmation, repair stock silently, or imply physical readiness. |
| A failure report has ambiguous, deleted, or stale retry identity | Retain its reporting hold and show the exact conflict for investigation. | There is no public operator-resolution API for this failure state today; the completion-recovery command does not apply to it. |

The first implementation should not add robot movement commands. When physical recovery requires movement, the operator uses the appropriate existing device procedure; this interface consumes and verifies the resulting evidence. A later device-specific workflow can add explicit, reviewed recovery movements.

## Reuse the existing foundations

`platform-client` already provides durable outcome reporting and the public methods `hold_execution_for_recovery(...)` and `release_execution_hold_for_recovery(...)`. Releasing a client gate does not create evidence that a robot is physically ready. That evidence belongs to the device adapter or bridge.

The humanoid integration already records physical executions, placement/retract observations, global readiness, failure-report generations, and held restart state. It is a suitable first adapter for exercising this workflow without hardware. It currently has no operator-facing physical-hold resolver.

The reviewed Nova branch already supplies manual exact late-success recovery, durable completion replay, and an audited local operator command. Older issue-ledger rows describe the original canonical checkout; they do not mean these candidate-branch changes are absent. These are supported manual recovery tools, not automatic/background recovery or a general resolver for arbitrary physical holds.

The existing cancellation operator command resolves a local completion-reporting hold in its supported case. It sends no platform message. A failure report in `OPERATOR_HOLD` has different semantics and no equivalent public operator-resolution method today.

## Proposed ownership and implementation order

| Stage | Codebases | Deliverable |
|---|---|---|
| 1. Shared inspection and audit | `platform-client`, `end-to-end-sim` | Read-only recovery snapshot and common audit format, demonstrated with existing simulator evidence. |
| 2. Narrow recovery commands | `platform-client`, `end-to-end-sim` | Report reconciliation and evidence-checked physical-hold release, using public APIs and durable state. |
| 3. Nova adapter | `nova5_ros2`, `platform-client`, `end-to-end-sim` | Expose existing Nova manual recovery commands through the common case view, preserving their checks instead of duplicating their logic. |
| 4. Operator panel | `end-to-end-sim` initially; `aio_atom-w_gui` for later hardware integration | Small interface calling the same commands, with prerequisites and recovery history. |
| 5. Platform settlement | `coffee-platform`, only if separately permitted | Canonical cancellation, late-result, partial-order, and accounting reconciliation. This remains outside the current read-only platform scope. |

The first usable milestone is a simulator operator inspecting a held item, reconciling an eligible report, and releasing a verified hold with an audit entry while all unrelated gates remain intact.

## Proposed acceptance checks

These are proposed checks, not new test results:

- A pending report can settle without starting another physical action.
- Verified placement can be confirmed while the device remains held and does not request more work.
- An unknown outcome remains held until supported evidence resolves it.
- Wrong, stale, or mismatched identity/readiness evidence cannot release a hold.
- Releasing one hold does not remove another hold or bypass an unresolved report/callback.
- Interruption during recovery leaves durable state that can be inspected and safely resumed.
- Each state-changing action retains actor, reason, time, identity, evidence references, and before/after state. Record intent durably before changing recovery state, then record the observed result.
- A local cancellation workaround is visibly distinguished from platform acknowledgment and inventory reconciliation.
- A failure-report operator hold cannot be cleared with the completion-report or physical-hold recovery action.

## Remaining limits

This interface cannot make platform terminal reports idempotent, prevent its cross-actor retry-generation race, or repair its partial/cancelled-order accounting. Those need platform changes. It also cannot manufacture trustworthy hardware observations: motion, grasp/possession, navigation, calibration, and readiness must come from validated adapters and procedures.

Keep current simulated holds and exact-identity checks as the starting behavior. The purpose of the operator workflow is to make supported recovery understandable and auditable.
