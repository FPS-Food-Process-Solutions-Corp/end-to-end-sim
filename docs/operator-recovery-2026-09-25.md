# Operator recovery implementation and verification - 2026-09-25

Status: draft. Software review is in progress; the new real-API operator acceptance controls have not run yet.

## Main merge and repository scope

The verified E2E integration was fast-forwarded locally into `end-to-end-sim/main` at `0c9e81d78a0c06ff7c40c92851599e1c0bb94e90`. The original main tip `62158af` remains preserved. Operator recovery is being developed on `codex/operator-recovery`.

This milestone changes only `end-to-end-sim`. The canonical client, Nova and platform codebases remain unchanged. It reuses the existing client recovery behavior; it does not implement platform accounting or hardware recovery.

## Implemented scope under validation

- A shared simulator recovery service and CLI with separate inspection, report reconciliation and physical-hold release.
- Offline inspection that separates physical evidence, report/callback state and readiness, with exact identity and an inspection fingerprint.
- Operator/reason attribution and a stable action ID, with intent recorded before mutation and guarded replay after interruption.
- Reconciliation of verified saved placement evidence through the pinned client, including the crash before a completion report was queued, while preserving the physical hold.
- A no-motion readiness probe limited to a genuinely completed retract. Unknown/running outcomes remain held.
- A startup gate for unfinished or malformed recovery actions, so normal dispatch cannot overtake recovery finalization.
- Two separate maintained acceptance controls: unknown retract must remain held; completed retract with an invalid first readiness observation can be rechecked and released.

See the [plan](operator-recovery-plan.md) for the acceptance criteria and the [runbook draft](operator-recovery-runbook.md) for the operator workflow.

## Findings and evidence limits recorded during development

Review found that a readback-only implementation could not settle the exit-78 pre-queue boundary. Reconciliation was changed to use the existing client completion queue/flush path with the physical hold installed before connecting. The real-API acceptance controls must verify the resulting report once, with no repeated physical work.

Independent review also found that publishing ready ownership before finalizing the recovery record could allow ordinary startup to dispatch too early. The simulator executor now gates startup on unfinished recovery actions; crash/repair/restart tests cover this boundary. Harmless terminal preflight refusals must not create a permanent startup block.

An early focused test run reported 12 passes and one failure because fixture progress output was mixed with the CLI JSON capture. The test clears its prior captured output before invoking the CLI. A later 13-test run passed. The failed run's raw files were overwritten before separate retention; its failure was observed in tool output, and no replacement raw result has been fabricated. Later runs use separate evidence filenames. Counts and final source attribution will be finalized after validation.

## Remaining scope

Local cancellation/completion-reporting recovery, reporting OPERATOR_HOLD overrides, the Nova recovery adapter and a GUI remain deferred. Their absence must not be described as passing the full original recommendation.

The simulator observer does not validate real robot pose, motion stopping, gripper contents or hardware safety. The earlier accepted unknown-retract hold is deliberately unresolved. The existing platform's partial-order, cancellation-accounting and terminal-replay limitations remain.
