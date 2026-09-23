# Public recovery API adoption

Status: bridge implementation and independent source review are complete; 43 integration tests and 21 standalone tests pass. The checked-in-settings launcher smoke uses actual client construction and fresh stores, stubbing only network loops. Actual acceptance is pending. The accepted baseline uses client production commit `948fd23c1204f94983cc2e35865e3796f81b8a9c`; its evidence remains immutable.

The reviewed correction is released at `b4b055765e801b7edd93d0abf4e87d226d6b9bee` on branch `codex/durable-failure-recovery`, in `C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client`. This supersedes `2514a52757a0e37f1fd676bb3dac04099e21af0f` with a narrow settings-parser fix: the bridge's unchanged launcher test found that an omitted optional `paths.pending_failures` was incorrectly rejected. Missing/empty paths now select the documented derived-path behavior; invalid nonstrings and whitespace remain rejected. Client recovery APIs are unchanged. This task independently verified HEAD and the following raw source hashes:

| Source | SHA256 |
| --- | --- |
| `hr_client/client.py` | `70ad4509c788d2736c2a38b029e17a498e7ce48a39c60e47bedee558120f9cd4` |
| `hr_client/pending_failure.py` | `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a` |
| `hr_client/settings.py` | `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584` |

The client owner's independent review and retained in-process provenance record 139 focused/protocol and 379 available broader tests passing on the replacement pin. These scopes overlap. Four GUI/vision collection errors and nine preexisting Python 3.10 logging failures remain qualified exclusions; this is not a full green repository suite. Evidence is under the client checkout's `docs/verification/durable-failure-settings/`; the earlier 129/369 candidate evidence remains under `docs/verification/durable-failure-postfix/`. Frozen Nova compatibility also passed 236 tests with a reviewed two-file test-only overlay for isolated journals and complete acknowledgments; the original 230-pass/six-failure attempt is retained. Client/Nova software verification does not establish bridge or actual runtime acceptance.

Astra owns this design and documentation. Sol owns implementation, tests and independent code review. Only the client task's existing sole operator may launch the later shared-runtime cases.

## Durable failure reporting

Physical failure and platform report acceptance are separate facts. An exact saved `failure_readiness_proof` establishes the physical result; a report attempt additionally binds the observed platform retry generation. A newer task retry count alone cannot confirm an older report.

The released client seam adds trailing `execution_id` and `terminal_evidence` fields to `PickExecutionOutcome.failed(...)`, a separate `PendingFailureStore`, public `queue_recovered_failure(...)`, and a confirmation callback. `FailureIdentity` contains session, task, order, retry count and execution ID. Retry count must be an explicit nonnegative integer; neither missing metadata nor `True` may become retry zero. These signatures and exports were checked against the released source before bridge implementation.

The bridge preserves the original physical proof and its digest, using `failure_readiness_proof.recovery_execution_id` as the stable physical execution ID. A separate durable attempt ledger contains the current exact assignment, source, retry count, reason, unchanged wire message and terminal evidence. Save its intent before returning FAILED or seeding the public client queue. Save enough assignment metadata before physical dispatch to recover a crash after safe failure but before this intent exists. Do not infer the report generation from a controller phase or the largest observed retry count.

On callback, validate the exact attempt and persist confirmed state plus the client's platform evidence before returning. Callback failure leaves the reporting gate closed. A confirmed record whose bridge callback audit is missing may retry that callback; it must not resend the report or repeat physical work. After an exactly confirmed retry-zero attempt, retry one creates a new report attempt over the same physical proof. An ambiguous pending retry-zero record remains held even if retry one is observed. Immutable context conflicts fail closed.

The launcher injects a fresh explicit failure store beneath the case state root, separate from `pending-completions.json`. It will never read or reuse a live/captured client journal. The real client alone performs network reports, acknowledgment retries, readback, reconnection and scheduling. Confirmation of failure does not publish physical readiness or release a bridge hold.

The backend failure payload still contains only session, task and message. These local audit identities do not introduce a backend generation guard or make readback plus replay atomic against another actor. Acceptance is limited to the controlled, serialized client owner; contradictory or ambiguous generation evidence must hold.

## Reporting a verified placement while physically held

The agreed synchronous public method is `client.hold_execution_for_recovery(hold_id, message, *, task_id=None)`. Install the hold before any recovery queue await or client connection. The paired async `release_execution_hold_for_recovery(hold_id)` removes only that exact bridge hold; other client reporting or manual holds remain effective.

The bridge persists a stable opaque hold ID and monotonically increasing hold version in the same owner HOLD record, bound to assignment, source, configuration, current readiness version and placement-proof digest. Restart reinstalls that exact token and context. Token or context conflicts fail closed. A task ID alone is insufficient as the hold token.

Startup order is:

1. Reconcile only an eligible ACTIVE crash checkpoint and validate its exact physical proof.
2. Inspect the durable owner and current readiness. Explicit HOLD cannot auto-clear.
3. Construct the real client and synchronously install the verified placed unit's saved recovery hold.
4. Seed exact completion and failure attempts through the public client APIs, then connect.

Only a verified placement with a valid bound HOLD may use this reporting path. Other unknown physical holds continue to refuse startup. Completion reporting, readback and callbacks may run while the device remains PAUSED; no FREE status, next-task request, default delivery or new physical action is permitted. A completion acknowledgment cannot release the physical hold. No operator resolver is in scope, so these explicit holds remain held.

## Required verification

Local tests cover intent-before-outcome persistence, exact retry metadata, immutable failure proof across report generations, callback audit before release, callback-only recovery, stale or contradictory pending attempts, and B-failure/C-success/B-retry without overwriting C's current physical release.

Hold tests cover installation before queue/connect, repeat installation after restart, wrong token/context, crashes before and after queueing or acknowledgment, and the absence of FREE, next-task, default delivery and additional physical effects while reporting settles.

The opt-in `--crash-after-held-placement-once` fixture exits 78 after exact placement proof, persisted owner HOLD and unknown readiness, before the completed executor outcome reaches the client. Before restart, the fresh case must show one place, no client completion record, no outbound completion and platform IN_PROGRESS. After adoption, restart must settle the exact report while preserving the same physical hold and action ledger. The older exit-76 hook stops before readiness verification and does not establish this held-placement boundary.

Actual acceptance then requires fresh fixed-client outbound-failure-loss and committed-failure-response-loss cases, this held-placement restart, remaining physical fault/restart cases and mixed Nova/Rack A plus humanoid/Rack B routing. Capture separate reviewed client and bridge pins, exact identities and retry generations, database versus available-stock changes, current counter/readiness, pending records, source captures and owned-process cleanup. Local tests alone cannot satisfy these runtime requirements.
