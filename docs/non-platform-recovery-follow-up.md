# Non-platform recovery follow-up

Date: 2026-09-22. Five client-only real-platform cases passed. This follow-up preserves the historical reports; it does not replace their observations. The separate final combined matrix passed all 13 cases.

## Scope and assessment

The isolated client and frozen Nova migration now pass **13 combined software-simulation cases** on final client `948fd23`. Durable controller outcomes, platform confirmation and audited operator disposition remain separate. The matrix covers disconnects, lost acknowledgments, full retry exhaustion, active recovery, deterministic crash boundaries, cancellation/operator reconciliation, and four readiness/identity refusals. The [combined results](combined-recovery-validation-results.md) and [evidence index](verification/2026-09-22-combined-nova-client-recovery/index.json) record the final sources, cases and limits.

An initial active-restart run exposed a client replay/session-finalization defect after the report and Nova callback were already confirmed. Sol corrected that path, added public startup/callback/crash regressions and preserved legitimate holds. Client tests passed 112/112, Nova compatibility 236/236, and fixture checks 15/15. Every final combined scenario was rerun or first executed on the corrected client; earlier passes and failed attempts retain their original source attribution and are not counted twice. The [new isolated client evidence](verification/2026-09-22-client-replay-finalization/index.json) is separate from the earlier startup and client-only bundles.

Nova's migration had been unapplied at the original client-only evidence cutoff because automatic approval review rejected the relayed authorization. A subsequent direct user request allowed the normal migration path; the implementation is now frozen and validated. That earlier block remains capture-time metadata in the immutable historical index, not the current project status.

Astra coordinated, assessed evidence and wrote the reports. Earlier client implementation/testing used Terra and read-only research used Luna. The later model rule assigned all new implementation, testing and code review to GPT-6 Sol, with GPT-6 Luna for read-only research. The completed humanoid stub harness is reported separately in the master report and is not part of this combined acceptance.

No hardware or platform business-logic/schema changes were performed. The platform's non-idempotent replay contract, cancellation accounting and mixed-success settlement remain open. Operator resolution records a local disposition; it neither fabricates acknowledgment nor repairs platform inventory. Owned recovery services are stopped and all historical/test databases remain retained.


## Subsequent client startup correction

Nova's adapter review exposed a distinct client startup gap: a recovered confirmed report seeded before `run()` could finish its callback and clear the reporting hold while leaving the client PAUSED. GPT-6 Sol corrected this in `16d04079727681f047282c5116298a828000c2a9`. The public seed/run/connect regression reproduced the ready-state failure with the correction disabled. Five focused cases now pass: successful callback permits FREE only when idle; callback failure, Nova physical readiness sentinel, manual message-only pause and an active session remain held. The full isolated suite passed **103 tests in 2.11 seconds**, with actual test-session module paths/hashes captured.

The new [startup evidence](verification/2026-09-22-client-startup-recovery/index.json) is separate from the completed client-only platform bundle. That startup run used client hash `551372d93eecd146bc8776bfa0bf6c236ff9681649d08a9630b7c74a84e09a09`; pending-store code is unchanged. No Nova modules, ROS or platform services were used in these isolated tests. Nova subsequently validated its adapter and the final combined runs use the later replay correction; the five older platform cases are not relabeled as tests of either correction.

## Sources and runtime

Client worktree: `C:/Users/andyl/.codex/worktrees/dfcb/platform-client`, branch `codex/durable-completion-recovery`, based on `64dd9628d1b5a5d8e6d48951a01af64810281da6`. The five platform cases and six paired interface tests use production changes through `3196f29` and test commit `0ce89cb9435975e13453f258d2fc8387fff29309`. At that evidence cutoff, code commit `93b5301` corrected log wording only and its 98-test run passed. The later startup behavior correction is recorded separately above.

The platform runs load client hash `1bf0b6c4ffd27e958b09cb5f67f42d6dfc6d9dc3bc9a36701ae6672fc3cf8a4c`. The logging-only correction changes it to `13aa4cac6cc843a76b451e123da3784c2e7674b3dfa27e7c4a0fe00f5c924a85`. Pending-store hash remains `006e47f6c1510bfcda9c019aef5f7741e73187ce14b64a3f6b11fc358520b402`. Earlier run artifacts retain their actual source identity. The saved generic harness remains pinned to the logging-only hash until a deliberate future validation update; it should reject an unselected newer client. The archived abrupt-run fixture retains its original expectation. The final combined fixture binds client `948fd23` and the frozen Nova manifest explicitly.

The canonical client checkout at that base also contained uncommitted deferred-retry behavior. It was preserved in the isolated implementation after the paired retry test exposed the difference. The original checkout and unrelated dirty files remain untouched. A base commit alone does not describe those original working files.

The independent real-platform cases use the staged API at `/home/user/e2e-stage/coffee-platform/services/api/dist/main.js`, localhost ports 3111/3112, a transparent fault proxy, and an explicitly simulated generic `PickExecutor`. The fixture uses device identity `nova5_arm` to route the selected Rack A item; it imports no Nova or ROS modules. These cases establish client/platform behavior only. They do not establish Nova journal recovery, ROS recovery, physical readiness, or actual picking.

Each accepted case requires a new `taska_20260922_*` database copied from `coffee_platform_sim`, a separate runtime, matching API ownership/DB manifest, loaded client paths/hashes, exact order/session/task identities, total and distinct simulated start counts, and inventory snapshots. A source template may retain historical completed orders; it is never reset. New test orders and their changes occur only in the fresh copies.

The staged platform includes the earlier admin device socket-snapshot patch. It is not pristine upstream and this task did not implement that patch. Platform source, compiled business logic, schema, the original simulation DB, and historical evidence DBs remain read-only. The runtime wrapper binds the API listener to localhost; it does not alter order/task/inventory logic.

## Isolated test evidence

| Scope | Observed result | Evidence and limit |
| --- | --- | --- |
| HR protocol and durable completion store | 98 passed in 1.12 seconds at `93b5301` | Retained stdout, JUnit and source identity from a fresh temporary cwd. Includes forced cancellation/concurrency boundaries, exact read-back, store validation, physical holds, and retry/positional compatibility. |
| Client with canonical Nova executor/journal | 6 passed in 1.51 seconds; JUnit suite time 1.469 seconds | `paired-interface-tests.xml`, `paired-interface-modules.json`, and `paired-interface-tests.provenance.json`. Module paths/hashes are captured inside the actual pytest session. No network/ROS or isolated Nova migration worktree is used. |
| Shared harness/export helpers | 9 focused tests passed | Fixture checks only, not a real recovery result. |
| Nova partial late-success core | 24 focused tests passed in 0.77 seconds, reported by the Nova task | Predates migration. A broader intermediate run had 46 passes and one deferred-retry failure; do not count that run as a pass or add overlapping counts. |

The earlier six-test paired result in 1.87 seconds is excluded from isolated-client evidence because its command omitted `PLATFORM_CLIENT_ROOT`. A corrected explicit-environment run passed, followed by the retained actual-session provenance run. Counts are not added across repeats.

The final 98-test HR run uses explicit worktree environment bindings and post-run on-disk hashes. Its provenance is not an import-hook capture; the six-test paired run does capture modules inside pytest. Both execution ledgers state their methods.

## Real-platform client cases

All five cases below reached their bounded acceptance conditions. Success cases require settled durable records and measured FREE state, not only a READY server snapshot. The cancellation case passes by preserving an actionable hold. The [portable evidence index](verification/2026-09-22-non-platform-recovery/index.json) identifies retained results, event logs, queue snapshots, and their hashes.

| Case | Required evidence | Status |
| --- | --- | --- |
| Disconnect after accepted simulated start | Original and distinct next order READY; exact task confirmation; two starts and two stock deductions | **Passed:** `generic-disconnect-retry-011`, DB `taska_20260922_ack_retry_009`. Both exact reports confirmed, both orders READY, two starts/two unique IDs, inventory 6 to 4, measured device FREE. |
| Immediate response loss after commit | Proven server commit and dropped response/connection; durable exact reconciliation; distinct next order | **Passed:** `generic-immediate-retry-010`, DB `taska_20260922_ack_retry_008`. Retained exact original COMPLETED/READY API snapshot before socket close; both reports confirmed, distinct follow-up READY, two starts/two unique IDs, inventory 6 to 4, measured device FREE. |
| Normal retry exhaustion and reconnect | Five real calls over the configured normal budget; queued record; rejected replay then exact read-back | **Passed:** `generic-ack-retry-006`, DB `taska_20260922_ack_retry_004`. Sixth replay rejected with `PICK_TASK_NOT_IN_PROGRESS`; both exact reports confirmed, both orders READY, two starts/two unique IDs, inventory 6 to 4, measured device FREE. |
| Abrupt restart with queued report | Kill only after durable queue; restart same queue; original identity preserved, no repeated start | **Passed:** `generic-abrupt-retry-007`, DB `taska_20260922_ack_retry_005`. Five withheld reports then queued snapshot; client PID 1830 killed and restarted as 1851; exact pending evidence retained and replay reconciled. Two distinct starts, both orders READY/reports confirmed, inventory 6 to 4, measured device FREE. |
| Cancellation followed by late simulated success | Original stays CANCELLED; controller success retained; operator hold; no stock deduction or next start | **Passed for truthful hold:** `generic-cancel-retry-008`, DB `taska_20260922_ack_retry_006`. Exact SUCCEEDED evidence retained with `operator_hold` and `order is cancelled`; no platform confirmation/operator resolution. Inventory 6 to 6; one start; device PAUSED and follow-up QUEUED over a three-second observation. |

Preliminary fixture failures and incomplete observations are excluded. The first generic fixture used `humanoid_robot`, which routes another rack; it could not consume the Rack A item. Other excluded attempts include API-start readiness/configuration failures, snapshots taken before local confirmation or order READY, a JSON-spacing predicate timeout, and a pending-file predicate that fired before retry exhaustion. All original runtime directories remain preserved. Only the five rows above count as accepted cases.

The generic fixture configures no completion callback, so `callback_acknowledged:false` in its confirmed records is expected. Durable adapter-callback behavior is covered by client isolated tests; these platform runs do not validate a Nova callback. Explicit local operator resolution was exercised in isolated tests, not performed against the cancelled real-platform fixture.

The coordinator independently verified that ports 3111/3112 had no listeners after cleanup. Original, historical and fresh evidence databases remain present. The [cleanup record](verification/2026-09-22-non-platform-recovery/cleanup.json) lists the observed database names and distinguishes presence checks from content verification. Raw API ownership manifests are removed by the existing stop helper; where retained, runtime references accompany the evidence. Remaining DB mappings come from the case owner's observed start/stop receipts and were checked against the final database inventory.

## Remaining limits

- The server completion replay remains non-idempotent. Exact read-back mitigates already-committed success for the generic client; it does not fix the platform contract.
- Cancellation deletes fulfillment evidence. A local operator disposition cannot restore the cancelled order, account for physical inventory, or invent platform acknowledgment. That business-state conflict remains open.
- Mixed-success order settlement, concurrent session creation, and the historical pricing/UI observations are outside this change and remain open.
- The generic pending store assumes one writer per file. Process-restart checks do not establish power-loss durability, split-brain safety, or concurrent-worker correctness.
- The server read API does not expose controller execution ID. The client retains it locally while read-back checks the original order/session/task and terminal task state.
- The validated Nova migration retains terminal evidence and its outbox before handing the outcome to the client, restores it before scheduling, and durably acknowledges callbacks. This guarantee depends on the selected adapter; the generic queue alone cannot provide it for other executors.

See the client interface document at `C:/Users/andyl/.codex/worktrees/dfcb/platform-client/docs/durable-completion-recovery.md`. Nova's final migration and retained baseline/design history are documented in `D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/RECOVERY.md`, `RECOVERY_MIGRATION_BASELINE.md`, and `RECOVERY_MIGRATION_PROPOSAL.md`.
