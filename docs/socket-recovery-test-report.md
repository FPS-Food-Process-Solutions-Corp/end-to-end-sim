# Platform and Nova Socket.IO recovery tests

Date: 2026-09-22. This report covers the real staged coffee platform, its actual platform-client/Nova bridge, and a fake ROS controller. It tests software coordination, not physical robot stopping or motion safety.

## Results

| Scenario | Observed result | Did the distinct follow-up order proceed? |
| --- | --- | --- |
| Connection lost immediately after the controller accepted a pick | Client reconnected, completed the same execution, and received the platform completion acknowledgment. No repeat start for that execution | **Yes.** Both orders reached READY; two distinct executions and two inventory deductions |
| Platform committed completion, then connection closed before the completion response reached middleware | First order reached READY and stock was deducted once. The in-flight completion call was cancelled; reconnect requested another task from the old session and received `platform.pick_task_unavailable` | **No during observation.** Follow-up remained QUEUED; only one controller start |
| Completion responses withheld through the normal retry budget, then reconnect | Five actual completion requests over about 65 seconds ended in `completion_queued`. After reconnect, the sixth request replayed that completion and received `PICK_TASK_NOT_IN_PROGRESS`; the pending report remained | **No during observation.** First order READY; follow-up QUEUED; one controller start and one stock deduction |
| Middleware stopped and restarted while a pick was active | Journal retained the original execution ID. The separate controller later reported that exact execution SUCCEEDED/ready. Restarted middleware reported PAUSED and required operator reconciliation | **No during observation.** First order remained PREPARING/IN_PROGRESS; follow-up remained QUEUED; no duplicate start |
| Order cancelled after dispatch, followed by controller success | Cancelled order stayed CANCELLED. Platform rejected the late result with `PICK_SESSION_NOT_FOUND`; middleware queued its completion report | **No during observation.** Follow-up remained QUEUED; only one controller start |

The disconnect-after-start case passed the continuation check. The two lost-response variants, restart case, and cancellation case prevented duplicate dispatch but did not restore the workflow during the bounded follow-up observation. A deliberate PAUSED hold is not a false claim of completion; it still needs a supported way to reconcile the known outcome and resume work.

## What the acknowledgment test proves

The proxy forwarded the actual `hr.pick_task_completed` request to the actual API. The harness verified the committed order/task through a separate API request before closing the connection. The proxy withheld both the direct `platform.pick_session_completed` event and the Socket.IO callback acknowledgment.

In this immediate-disconnect variant, the bridge logged no `completion_queued` or `completion_replay` event and its unacknowledged queue count was zero. The completion call was cancelled by the transport close while still in flight. Consequently, this run does **not** reproduce queued-completion replay returning `PICK_TASK_NOT_IN_PROGRESS`. Its confirmed finding is the lost-completion-response/session stall after a real server commit.

The separate timeout-before-disconnect variant exercised the pending-report replay boundary. It retained the production client's 10-second timeout, five attempts, and 1/2/4/8-second retry delays. The proxy passed Engine.IO heartbeat and WebSocket control frames while withholding Socket.IO application responses. Five real completion requests exhausted the approximately 65-second retry budget, producing `completion_queued` with one pending report. Only then did the proxy close the connection. On reconnect, the client sent the sixth completion request for the exact same task; the live platform returned `PICK_TASK_NOT_IN_PROGRESS`. The report remained pending and the follow-up order stayed queued. This confirms the previously source-reviewed replay incompatibility.

## Inventory and execution evidence

All cases used independent database copies. Each started with six available croissants in the tested rack location. The imported historical READY order A007 was left untouched. Each new case created A008 and a distinct follow-up A009; those display numbers repeat across the separate databases, so use the case and unique order ID when comparing evidence.

| Case | Final database quantity / available quantity | Interpretation | Provider start requests / distinct accepted execution IDs |
| --- | --- | --- | --- |
| Disconnect after start | 4 / 4 | Two successful orders consumed one item each | 2 / 2 |
| Immediate lost completion response | 5 / 4 | One consumed item; one reservation for the queued follow-up | 1 / 1 |
| Timeout, queued completion, then replay | 5 / 4 | Five attempts and one replay did not consume extra stock; one follow-up reservation remains | 1 / 1 |
| Middleware restart | 6 / 4 | No consumption recorded; original and follow-up reservations remain | 1 / 1 |
| Cancellation followed by success | 6 / 5 | Original reservation released by cancellation; late success did not consume platform stock; follow-up reserved one item | 1 / 1 |

These counts describe fake-provider service requests and accepted execution identities. They are not measurements of physical motions. Cancellation preserved the platform's cancelled state, but left a discrepancy between the reported successful controller action and platform fulfillment/inventory accounting.

## Recovery changes needed

1. **Lost completion response and replay:** retain and reconcile the original completion across disconnect, including cancellation of an in-flight reporting coroutine. Repeating a committed completion currently returns `PICK_TASK_NOT_IN_PROGRESS`; it needs an identity-checked canonical terminal response that lets the client finish its local bookkeeping and advance without consuming inventory again.
2. **Active middleware restart:** reconcile the journal's original execution with controller evidence and platform state. Preserve the current protection against redispatch; provide the missing late-success/operator reconciliation path.
3. **Cancellation with a late outcome:** preserve durable fulfillment identity and define how a late controller result settles a cancelled order. Deleting the session currently prevents reconciliation and leaves the client with a pending completion.
4. **Durable acknowledgment state:** the captured journal preserves terminal controller results, but its schema does not persist a platform-acknowledgment field. `platform_acknowledged:false` in a pre-report trace event must not be described as a persisted journal flag. Completion acknowledgments were separately observed in the successful reconnect run; durable pending-report recovery across a process restart remains a further test boundary.

No product recovery fix was applied in this task. Changes were limited to the test harness, isolation/observation tools, and documentation.

## Setup and limits

- Actual staged API and PostgreSQL, actual platform-client/bridge, and actual localhost Socket.IO and ROS service transport.
- Explicit **WebSocket-only** transport selected by a disposable bridge entrypoint. The client's default polling-to-WebSocket upgrade path was not exercised.
- ROS Domain 68 with localhost-only discovery; fake controller services only. No native controller, MoveIt, gripper, camera, or robot hardware was started.
- API bound to `127.0.0.1:3101`; transparent fault proxy on `127.0.0.1:3102`. The test API used copied databases; the original `coffee_platform_sim` database and stopped demo were preserved.
- Restart used a controlled bridge shutdown/restart with the provider kept alive and journal retained. It was not a power-loss or abrupt-crash test.
- Follow-up results are observations within bounded test windows, not measurements of indefinite deadlock or long-term reliability. Four cases used a 30-second per-wait deadline; the retry-exhaustion variant used 100 seconds to accommodate the unmodified client retry budget.
- Recorded canonical/staged hash equality establishes identity of the executor file only, not every staged module. Repository heads and runtime paths are in the baseline record.

Two preliminary harness attempts were excluded from product results: a bridge import-path failure before order creation, and a predicate evaluation error after order creation. Both were corrected; their logs were preserved, and the second attempt's database was archived before a fresh copy was used. The valid immediate-disconnect acknowledgment run is `ack-v3`.

## Evidence and tools

- [Isolation/source baseline](verification/2026-09-22-socket-recovery-baseline.json).
- [API inventory/queue baseline](verification/2026-09-22-socket-recovery-api-baseline.json).
- [Final cleanup and preserved database mapping](verification/2026-09-22-socket-recovery-cleanup.json).
- [Validation and recorded one-line commands](verification/2026-09-22-socket-recovery/validation.json): eight focused harness tests passed, plus syntax/ASCII checks. These tests validate the fixture; they are separate from the five actual recovery runs and the September 18 suites.
- Portable case evidence: [accepted-start disconnect](verification/2026-09-22-socket-recovery/disconnect/index.json), [immediate response loss](verification/2026-09-22-socket-recovery/ack-immediate/index.json), [timeout and completion replay](verification/2026-09-22-socket-recovery/ack-queued/index.json), [active middleware restart](verification/2026-09-22-socket-recovery/restart/index.json), [cancellation then late success](verification/2026-09-22-socket-recovery/cancel/index.json). Each index maps original runtime files to included portable copies; result JSON paths describe their original capture locations.
- [Integration harness](../tools/nova5_socket_recovery_harness.py), [transport proxy](../tools/socketio_fault_proxy.py), [WebSocket entrypoint](../tools/bridge_websocket_transport_entrypoint.py), [isolated API launcher](../tools/recovery_api_runtime.py).
- [Master verification report](master-verification-report.md).

Raw runtime evidence is also retained under `.local/recovery-20260922-*`. The original demo was stopped before testing and remains stopped. Final inspection found no listeners on ports 3001, 3101 or 3102 and no disposable bridge, provider, proxy or harness process. PostgreSQL and the isolated databases were retained for inspection; no test-order cancellation was used to clear an observed stall.

The immediate-response-loss database was preserved as `coffee_platform_recovery_20260922_ack_immediate`; the interrupted second harness attempt was preserved as `coffee_platform_recovery_20260922_ack_attempt2`. The final `coffee_platform_recovery_20260922_ack` database contains the timeout/replay variant. The `disconnect`, `restart` and `cancel` database copies retain their respective outcomes. These existing databases are evidence, not fresh inputs for another run.
