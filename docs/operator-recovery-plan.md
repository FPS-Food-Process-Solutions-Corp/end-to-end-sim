# Operator recovery implementation plan - 2026-09-25

Status: implementation and validation in progress on `codex/operator-recovery`. This is a plan, not a test-result record.

## Starting point and scope

The user authorized merging the verified E2E integration into main and proceeding with operator recovery. The local main branch was fast-forwarded from `62158af` to `0c9e81d78a0c06ff7c40c92851599e1c0bb94e90`; the original tip remains available as `codex/pre-humanoid-integration-20260925`. Recovery work starts on a separate branch. No remote push is included.

The first milestone follows the [operator recommendation](operator-recovery-recommendation-2026-09-24.md): inspect a held item, reconcile an eligible saved report, and release an eligible exact hold with durable audit evidence while preserving all other gates. Code inspection identified existing public client APIs sufficient for this offline simulator milestone, so implementation is confined to `end-to-end-sim`. The canonical client and Nova branches remain the previously merged versions. The platform remains read-only.

Astra owns design and prose; GPT-6 Luna reads documents and source; GPT-6 Sol implements, reviews and tests. The first interface is a CLI and shared recovery service. A GUI, Nova command adapter, broader reporting-hold resolution and hardware recovery are later work.

## Operator workflow

1. Inspect the saved run. Show physical outcome, platform report/callback state and device readiness separately. Identify the exact order, session, task, retry generation, hold and source context. Show available actions and concrete refusal reasons. Label saved evidence as offline.
2. Choose an eligible action using the inspection fingerprint and exact hold identity. Require operator identity and a meaningful reason. A changed task, source, readiness version, hold or relevant saved state invalidates the inspection.
3. Acquire exclusive ownership and persist the action intent before mutation. Record the action identity, actor, reason, time, expected state, evidence paths/hashes and before state.
4. Reconcile a saved report through the existing pinned client path, or collect a fresh no-motion simulator readiness observation and release an eligible physical hold. Record the outcome and after state. Interruption must leave an inspectable action that can be resumed without changing its original attribution.

The service must reject a live launcher or competing writer using the existing state-root and per-unit locks. It must not dispatch a pick, send movement commands, request a new task as part of reconciliation, clear an unrelated hold, or invent a platform acknowledgment. It must not offer a generic force-ready override.

## Physical release policy

The concrete positive simulator case is a genuinely completed post-place retract followed by an invalid first readiness observation, such as a one-shot stale observation. The hold remains meaningful until a new observation proves the same completed action and the present safe state.

Release preflight requires the exact persisted retract action to be COMPLETED with its effect applied, bound to the same task, target and generation. It must reject unknown or running actions before calling any simulator method that could advance their execution. A new readiness observation must establish empty hands, travel posture, quiescence and navigation readiness. Physical world and action records must not change during this observation; observation records may advance.

The accepted earlier held-placement case has an unknown retract outcome. It remains held under this policy. The workflow does not convert an operator assertion into device evidence or rewrite the old action as successful. Independently validated hardware observations would require a separate device adapter and validation.

Platform acknowledgment and physical readiness are independent. A placement may be reported successfully while the device remains held. Releasing the physical hold must preserve pending reporting/callback gates and failure OPERATOR_HOLD. This milestone offers no local workaround for cancellation accounting and no reporting-hold override.

## Durable action record

Use a small versioned record with a stable action ID. Preserve the first actor, reason and before-state evidence when resuming the same action. Persist intent before a report or readiness mutation, then retain phase progress and a terminal result or refusal. The action record must explain partial state after interruption.

Readiness and ownership are separate atomic files. Recovery must therefore handle interruption after intent, observation, readiness write and ownership write. It must remain fail-closed while repair is pending, and a retry must neither repeat a physical action nor falsely claim another platform success. Keep original journals, failed attempts and source captures intact.

## Required validation

| Control | Required result |
|---|---|
| Pending report reconciliation | The existing report settles without any new physical action or next-task request. |
| Verified placement while held | Completion can be confirmed while the exact physical hold remains. |
| Unknown outcome | Inspection explains the uncertainty; release refuses and state remains held. |
| Fresh readiness after completed retract | A new valid observation permits the exact hold release, without motion or rewritten physical history. |
| Wrong or stale context | Wrong hold, task, retry, source, proof, configuration, readiness or inspection fingerprint refuses mutation. |
| Independent gates | Releasing one physical hold cannot remove another hold, bypass a callback/report gate or clear failure OPERATOR_HOLD. |
| Concurrent writer | An active launcher or another recovery writer prevents mutation. |
| Interrupted recovery | Named intent/probe/readiness/owner boundaries remain inspectable and resume safely and idempotently. |
| Audit attribution | Every state-changing action records actor, reason, time, exact identity, evidence and before/after; intent precedes mutation. |
| Scope distinction | Local state changes remain distinct from platform confirmation and inventory correction. |
| Local cancellation/reporting workaround | Deferred and not exercised in this milestone. Refusing a reporting OPERATOR_HOLD does not count as validating the proposed cancellation-resolution workflow. |

Focused tests cover the service, CLI and interruption cases. A separate Sol review checks implementation and extends the maintained real-API simulator acceptance workflow with fresh databases and run directories. Results will be saved directly under `docs/verification/operator-recovery-2026-09-25/`; raw captures remain local and only selected summaries/test reports will be committed. The completed report will state exact versions, failures, fixes, passing checks and remaining limits.

Keep historical humanoid source pins and acceptance manifests unchanged. New operator runs capture all current simulator production files, including new recovery modules and any changed controller code, alongside the exact unchanged canonical client revision and guarded module hashes. Historical simulator hashes do not validate new code.
