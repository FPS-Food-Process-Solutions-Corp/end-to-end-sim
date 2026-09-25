# Nova failure and recovery test report

Date: 2026-09-18. Canonical source: `D:/Work/FPS/Robotics/nova5_ros2`, commit `fe1e9d07ad2e16d1c46838cce63b65943b5261c8`.

Follow-up evidence: the [September 22 Socket.IO recovery report](socket-recovery-test-report.md) adds real WebSocket interruption, completion-response loss/replay, controlled active middleware restart, and cancellation/late-success tests. The scope statements below describe the original September 18 run.

## Verdict

The tested ordinary failure paths do not permanently block the executor: a known failed pick with controller readiness restored can be followed by a distinct successful task. However, the tests reproduced a recovery gap that can leave the Nova worker blocked indefinitely after a transient status failure followed by a controller-confirmed success. This is not an all-clear for pipeline recovery. The reproduced blockage affects subsequent Nova pick tasks sharing that journal; the API and other robot workers were outside this isolated probe.

## Confirmed blocker: late success after an unresolved result

The isolated ROS Domain 68 probe used the canonical `NovaPickExecutor`, the production `_RosVisionLink`, and disposable local fake controller services:

1. Dispatch a pick with a journal-issued execution ID.
2. Return a correlated `UNKNOWN` status once. The executor returns `UNRESOLVED`, preserving a nonterminal journal entry.
3. Let the fake controller complete the same execution. Its real ROS status response now reports known `SUCCEEDED` and `robot_ready=true`.
4. Attempt the supported `recover_unresolved` path. It rejects the successful result as a non-failed outcome. `recover_terminal` cannot close the still-nonterminal journal entry.
5. Offer a distinct task. The executor holds it instead of dispatching another pick.

The probe measured one outbound executor-to-ROS-link start call, unchanged after the distinct task was held. This measures software dispatch requests, not physical motions.

The hold prevents blind duplicate execution, but there is no supported late-success reconciliation path to release it. Platform admin cancellation addresses the platform order; it does not resolve this local execution journal or cancel an already-dispatched native motion request.

Source references: [recovery.py](D:/Work/FPS/Robotics/nova5_ros2/src/platform_bridge/platform_bridge/recovery.py), especially `recover_unresolved` around lines 65-92, and [test_recovery.py](D:/Work/FPS/Robotics/nova5_ros2/src/platform_bridge/test/test_recovery.py), around lines 149-158. The existing test explicitly checks rejection of controller-reported success. Normal polling has already returned at this point, and the production ROS link does not supply a background reconciliation stream through the compatibility `offer_status` hook.

## Results and evidence

| Check | Observed result | Scope |
| --- | --- | --- |
| Known failed pick, then distinct successful task | Later task completes; no unresolved blockers remain | Canonical executor and actual ROS service transport on Domain 68 |
| Unknown status, then late successful result | Recovery refuses success; subsequent task remains held | Reproduced recovery gap through canonical executor and actual ROS service transport |
| Terminal failed/not-ready fixture, clear, then distinct start | Start refused during latch; accepted after explicit fixture clear | ROS wire fixture; timer clear is not a vendor reset or native held-grasp recovery |
| One transient unknown status | Later known failed status is retained | ROS wire fixture |
| Existing failure/recovery suites | 213 tests passed: 111 plus 102 | Isolated bridge, journal, adapter, recovery, native-flow/diagnostic and HR protocol tests |
| Cancel after ROS dispatch, then receive late acceptance | Cancelled awaiter stays cancelled | One new test using production adapter with mocked ROS service/future objects |
| Native recovery core and runtime guard | Both standalone C++17 harnesses passed | Real native headers; no ROS, MoveIt, vendor services, or hardware |
| Fixture/core and adapter parser checks | 22 tests passed | End-to-end-sim test-fixture validation |

Detailed records:

- [Isolated tests and native harnesses](verification/2026-09-18-nova-isolated-tests.json), including reproducible commands and source paths.
- [Canonical executor / ROS probe](verification/2026-09-18-nova-failure-executor-probe.json).
- [Provider wire probe](verification/2026-09-18-nova-failure-provider-probe.json).
- [Demo and source baseline](verification/2026-09-18-nova-failure-baseline.json).

## What the native checks establish

The native lifecycle tests cover fault/readiness holds, release of the active-start latch, guarded operator reset, retry limits, deadline/feedback guards, and prevention of false readiness for held or unknown physical dispositions. They provide evidence against the previously targeted false-BUSY latch failure.

A hold for unknown physical state is intentional. Clearing it requires truthful controller/readiness evidence. A platform cancellation alone cannot supply that evidence. The new post-dispatch cancellation test only establishes that the Python adapter does not revive its cancelled awaiter; it does not establish that a physical controller action stops.

## Remaining boundaries

Actual Socket.IO network disconnect/reconnect was not exercised here; acknowledgement, replay, persistence and protocol behaviors were tested in isolation. Actual native MoveIt/action hangs, vendor reset, hardware communication loss, and physical motion were not exercised. A blocked native operation can outlive a bridge timeout, so a middleware timeout must not be interpreted as physical cancellation.

Tests ran separately from the managed demo: ROS Domain 68 with localhost-only discovery, while the demo remained on Domain 67. No live platform orders or managed demo services were changed in this test task. Original Nova source files were not edited.

Final read-only verification at 21:25 UTC found the demo Nova device online, FREE, and pick-ready; the user's already-cancelled A003 remained CANCELLED without a counter. Only the normal demo fake-provider process remained; the disposable probe processes had exited. The canonical Nova checkout had no reported changes (Git warned that its existing `.pytest_cache` directory was inaccessible).

## Recommended fix before further pipeline expansion

Add an audited reconciliation path for a controller-confirmed terminal success after an unresolved journal entry. Require the exact original execution identity, matching task evidence, fresh controller readiness, and an idempotent platform completion or explicit operator reconciliation before releasing the local hold. Keep the original execution ID and never dispatch the pick again merely to recover its result. If the platform order was cancelled, retain the known physical outcome and handle that discrepancy explicitly. Do not relabel a known success as a failure or delete the journal to clear the worker.
