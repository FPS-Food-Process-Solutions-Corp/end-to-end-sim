# Public recovery API adoption

Status: bridge implementation, the later client lifecycle pin update and independent source reviews are complete. The latest pin passes 43 integration checks; the prior 21 standalone passes are inherited with unchanged standalone production code. The checked-in-settings launcher smoke uses actual client construction and fresh stores, stubbing only network loops. Eight fresh isolated cases on the first corrected client and the three selected lifecycle-client controls are accepted; [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) records exact evidence, retained unsuccessful fixtures and mixed-runtime status. The accepted baseline uses client production commit `948fd23c1204f94983cc2e35865e3796f81b8a9c`; its evidence remains immutable.

The first reviewed recovery correction was released at `b4b055765e801b7edd93d0abf4e87d226d6b9bee` on branch `codex/durable-failure-recovery`, in `C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client`. This supersedes `2514a52757a0e37f1fd676bb3dac04099e21af0f` with a narrow settings-parser fix: the bridge's unchanged launcher test found that an omitted optional `paths.pending_failures` was incorrectly rejected. Missing/empty paths now select the documented derived-path behavior; invalid nonstrings and whitespace remain rejected. Client recovery APIs are unchanged. This task independently verified that checkout and the following raw source hashes for the eight isolated cases:

| Source | SHA256 |
| --- | --- |
| `hr_client/client.py` | `70ad4509c788d2736c2a38b029e17a498e7ce48a39c60e47bedee558120f9cd4` |
| `hr_client/pending_failure.py` | `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a` |
| `hr_client/settings.py` | `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584` |

The client owner's independent review and retained in-process provenance record 139 focused/protocol and 379 available broader tests passing on the replacement pin. These scopes overlap. Four GUI/vision collection errors and nine preexisting Python 3.10 logging failures remain qualified exclusions; this is not a full green repository suite. Evidence is under the client checkout's `docs/verification/durable-failure-settings/`; the earlier 129/369 candidate evidence remains under `docs/verification/durable-failure-postfix/`. Frozen Nova compatibility also passed 236 tests with a reviewed two-file test-only overlay for isolated journals and complete acknowledgments; the original 230-pass/six-failure attempt is retained. Client/Nova software verification does not establish bridge or actual runtime acceptance.

Astra owns this design and documentation. Sol owns implementation, tests and independent code review. Only the client task's existing sole operator owns shared-runtime cases.

## Client lifecycle pin update

The excluded first mixed run exposed a later lifecycle issue: the humanoid's physical release and completion were valid, but its public status stayed PAUSED after its peer finished. The strict FREE requirement was retained. Client production `9be6207a6c286d5f2f441f37b97b663a6256291a` adds continuing authoritative same-order/session reconciliation with bounded requests/backoff, one worker, and guards for physical, reporting and session changes. No backend schema or business logic changed.

The Task C adoption changes only the launcher's expected client hash. The other 18 simulator production files are unchanged. The new simulator commit is `1fb043c4f056223e1e7d27b6fa5fabb7fdf5c75d`; its launch manifest SHA256 is `5a9c6a584d295913ffb6b3d8b58dc143c20a96e8b4ea598da56ba9a193b0551b`. Raw client hashes are:

| Source | SHA256 |
| --- | --- |
| `hr_client/client.py` | `481163dc187fff8e62fdd9d2af6c919f3ed9f1ccae43d4f463acd900111a3f9d` |
| `hr_client/pending_completion.py` | `3f2d33d94dd838af21b5e49c64cab1cf5c0a5bd34bb759fa63062e50af5bf228` |
| `hr_client/pending_failure.py` | `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a` |
| `hr_client/settings.py` | `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584` |

The existing 43 integration checks passed in 23.462 seconds with exit 0 on this client pin, including `test_launcher_stops_idle_client_without_network_and_records_pinned_sources`. The test constructs the real client from checked-in settings with fresh stores and stubs the network loops. Retained logs and imported-source provenance are under `.humanoid-runs/local-verification/client-lifecycle-pin-01/`. The first wrapper recorded a blank exit despite 43 OK; the definitive repeat retained both 43 OK and exit 0. The prior 21-test standalone pass is inherited because this adoption does not change standalone production code.

The client owner passed 154 focused checks (protocol, pending completion, pending failure and settings diff) and 385 available broad checks. Independent Sol passed 153 focused checks, substituting failure-settings coverage for settings diff, and 385 broad checks; the focused selections differ and overlap the broad suite. Owner provenance captures actual imports during pytest. Independent imports were captured by a separate post-run process, so they do not establish which modules pytest imported. Both broad selections exclude `test_gui_console.py`, `test_gui_main_window.py`, `test_gui_settings_form.py`, `test_pipeline_rois.py` and the whole `test_log_handler.py`; neither is a fully green repository suite. The [verification packet](C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/verification/mixed-peer-session/run-provenance.json), manifest SHA256 `5464a808a6d02f06a3667164c2465294c13cdf565e4b3c57233aab912eef007a`, indexes 13 evidence files (14 files including the manifest). All indexed copies and originals were independently checked. The earlier nine logging failures are prior evidence, not a result established by this packet. Three expected behavioral failures against the old b4 client are retained separately.

The eight earlier isolated cases and three earlier Nova controls remain attributed to client `b4b0557`. The accepted selected reruns on the lifecycle client are the strict mixed order, Nova callback boundary and humanoid held-placement restart; [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) records their distinct results.

## Durable failure reporting

Physical failure and platform report acceptance are separate facts. An exact saved `failure_readiness_proof` establishes the physical result; a report attempt additionally binds the observed platform retry generation. A newer task retry count alone cannot confirm an older report.

The released client seam adds trailing `execution_id` and `terminal_evidence` fields to `PickExecutionOutcome.failed(...)`, a separate `PendingFailureStore`, public `queue_recovered_failure(...)`, and a confirmation callback. `FailureIdentity` contains session, task, order, retry count and execution ID. Retry count must be an explicit nonnegative integer; neither missing metadata nor `True` may become retry zero. These signatures and exports were checked against the released source before bridge implementation.

The bridge preserves the original physical proof and its digest, using `failure_readiness_proof.recovery_execution_id` as the stable physical execution ID. A separate durable attempt ledger contains the current exact assignment, source, retry count, reason, unchanged wire message and terminal evidence. Save its intent before returning FAILED or seeding the public client queue. Save enough assignment metadata before physical dispatch to recover a crash after safe failure but before this intent exists. Do not infer the report generation from a controller phase or the largest observed retry count.

On callback, validate the exact attempt and persist confirmed state plus the client's platform evidence before returning. Callback failure leaves the reporting gate closed. A confirmed record whose bridge callback audit is missing may retry that callback; it must not resend the report or repeat physical work. After an exactly confirmed retry-zero attempt, retry one creates a new report attempt over the same physical proof. An ambiguous pending retry-zero record remains held even if retry one is observed. Immutable context conflicts fail closed.

The launcher injects a fresh explicit failure store beneath the case state root, separate from `pending-completions.json`. It will never read or reuse a live/captured client journal. The real client alone performs network reports, acknowledgment retries, readback, reconnection and scheduling. Confirmation of failure does not publish physical readiness or release a bridge hold.

The backend failure payload still contains only session, task and message. These local audit identities do not introduce a backend generation guard or make readback plus replay atomic against another actor. Acceptance is limited to the controlled, serialized client owner; contradictory or ambiguous generation evidence must hold.

## Reporting a verified placement while physically held

The agreed synchronous public method is `client.hold_execution_for_recovery(hold_id, message, *, task_id=None)`. Install the hold before any recovery queue await or client connection. The paired async `release_execution_hold_for_recovery(hold_id)` removes only that exact bridge hold; other client reporting or manual holds remain effective.

The bridge persists a stable opaque hold ID and monotonically increasing hold version in the same owner HOLD record, bound to assignment, source, configuration, current readiness version and placement-proof digest. Restart reinstalls that exact token and context. Token or context conflicts fail closed. A task ID alone is insufficient as the hold token. This bound placement-hold rule does not imply that every unresolved owner HOLD has the latest readiness version: an ordinary unknown pick may retain an earlier owner version while current readiness is UNKNOWN, and it still refuses startup.

Startup order is:

1. Reconcile only an eligible ACTIVE crash checkpoint and validate its exact physical proof.
2. Inspect the durable owner and current readiness. Explicit HOLD cannot auto-clear.
3. Construct the real client and synchronously install the verified placed unit's saved recovery hold.
4. Seed exact completion and failure attempts through the public client APIs, then connect.

Only a verified placement with a valid bound HOLD may use this reporting path. Other unknown physical holds continue to refuse startup. The public client supports completion reporting, readback and configured callbacks while the device remains PAUSED. This launcher configures only the failure callback; a confirmed completion's false callback flag is not applicable. During held-placement reporting, no FREE status, next-task request, default delivery or new physical action is permitted. A completion acknowledgment cannot release the physical hold. No operator resolver is in scope, so these explicit holds remain held.

## Required verification

Local tests cover intent-before-outcome persistence, exact retry metadata, immutable failure proof across report generations, callback audit before release, callback-only recovery, stale or contradictory pending attempts, and B-failure/C-success/B-retry without overwriting C's current physical release.

Hold tests cover installation before queue/connect, repeat installation after restart, wrong token/context, crashes before and after queueing or acknowledgment, and the absence of FREE, next-task, default delivery and additional physical effects while reporting settles.

The opt-in `--crash-after-held-placement-once` fixture exits 78 after exact placement proof, persisted owner HOLD and unknown readiness, before the completed executor outcome reaches the client. Before restart, the fresh case must show one place, no client completion record, no outbound completion and platform IN_PROGRESS. After adoption, restart must settle the exact report while preserving the same physical hold and action ledger. The older exit-76 hook stops before readiness verification and does not establish this held-placement boundary.

The fresh fixed-client outbound-failure-loss and committed-failure-response-loss cases, held-placement restart, safe retries/loss, unknown/cancellation holds, exit-76 completion recovery and partial A/B/C case are accepted. Their runtime report retains separate reviewed client and bridge pins, exact identities and retry generations, database versus available-stock changes, current counter/readiness, pending records, source captures and owned-process cleanup. It also records mixed Nova/Rack A plus humanoid/Rack B evidence. Local tests alone do not satisfy runtime requirements.
