# Non-platform recovery fixes: task handoff

Created 2026-09-22 from the completed simulation/recovery review. The user authorized new tasks to implement the non-`coffee-platform` fixes.

## Model and ownership rules

- **Astra:** coordinate, plan, make decisions, perform final assessment, write and maintain documentation, and report to the user.
- **GPT-6 Sol (`gpt-6-sol`):** implement, test, and review code. This replaces Terra for future work.
- **GPT-6 Luna (`gpt-6-luna`):** read source files and documentation and report findings. Luna must not write or edit documentation or code.
- Generally follow `D:/Work/FPS/Robotics/skills/python-robotics-coding.md`: ASCII Python, top-level fail-fast imports, specific exception handling, and explicit simulation/hardware composition.
- Every shell command must occupy one physical line, including commands in documentation. No backslash, caret or backtick continuations.

## Hard scope boundary

Treat the canonical `coffee-platform` checkout, its staged copy, compiled artifacts and schema as read-only. Do not modify platform business logic, inject server behavior, or use direct database edits as a substitute for platform fixes. Existing API and Socket.IO contracts may be used. Creating isolated simulation database copies for tests is allowed; preserve the original `coffee_platform_sim` database and captured evidence.

The existing staged platform includes an earlier device socket-snapshot patch. Disclose that baseline when reporting tests; it is not an upstream fix or authorization to make further platform changes. If a result depends on that patch, identify the dependency. Do not claim tests used a pristine canonical platform without checking the actual loaded version.

Use existing installed dependencies and software simulation. No physical robot/camera/vendor motion commands. Present proposed additional installation commands before adding dependencies. The requested fixes are authorized; do not repeatedly ask permission to implement within the assigned scope.

## Task A: platform-client reporting and reconciliation

Primary codebase: `D:/Work/FPS/Robotics/platform-client`. Use an isolated checkout/worktree. This task owns generic transport, pending-report persistence, read-back reconciliation and client scheduling/state transitions. Its Astra coordinator also owns coordinated integration changes and consolidated result updates in `end-to-end-sim`; avoid overwriting the historical evidence.

Implement durable pending completion handling, including disconnect cancellation of an in-flight completion call, retry exhaustion, reconnect and process restart. Use existing read APIs to reconcile the exact original task/session/order when the platform has already committed completion. Never treat order READY alone as proof that an arbitrary task completed; verify exact identity and authoritative terminal evidence. Do not fabricate an acknowledgment or merely drop a pending report to clear the queue.

For cancellation/deleted sessions, preserve an auditable local outcome and expose explicit operator reconciliation where the backend no longer supplies enough evidence. Do not silently restore a cancelled order or adjust inventory based on guessed physical outcomes. Document residual platform defects and uncertainty. Coordinate terminal/pending-report callbacks and persistence responsibilities with Task B before implementing overlapping behavior.

Acceptance: preserve task/execution correlation and pending results across interruption/restart; no duplicate execution or inventory effect; exact confirmed completions reconcile locally despite the server's non-idempotent replay response; subsequent work can proceed when both controller and platform/local reconciliation permit it; ambiguous/deleted evidence produces a diagnosable hold rather than silent loss.

## Task B: Nova journal and late-success recovery

Primary codebase: `D:/Work/FPS/Robotics/nova5_ros2`, chiefly its Python `platform_bridge`. Use an isolated checkout/worktree. This task owns executor/journal/recovery commands and the Nova-specific adapter to Task A's client contract. It must not independently edit the generic client implementation or concurrently rewrite the shared simulation harness/master report.

Implement an audited path for an unresolved journal entry whose exact execution later becomes terminal, including SUCCEEDED with fresh controller readiness after a transient status failure or active bridge restart. Match original execution/task evidence, preserve identity, and coordinate platform reporting/read-back/operator reconciliation before releasing relevant holds. Never delete a journal, relabel a known success as failure, or redispatch motion merely to obtain a result.

Keep controller outcome, platform confirmation and explicit local operator resolution distinguishable. Handle readiness false and unavailable/mismatched evidence honestly. Make persistence/restart and repeated recovery operations safe. Do not expand this task into native motion control, MoveIt or hardware behavior unless evidence establishes a necessary dependency and scope is discussed first.

Acceptance: exact-ID late success can be reconciled through a supported path; known controller faults/readiness holds remain truthful; restarted work is never blindly repeated; confirmed/operator-resolved cases allow a distinct next task; ambiguous states remain actionable holds. Coordinate cancellation and already-committed completion cases with Task A.

## Reproduced behavior to preserve as regression cases

1. Real WebSocket disconnect after an accepted pick: recovered, original and distinct follow-up orders READY, two distinct starts and two inventory deductions.
2. Immediate response loss after server commit: first order READY, completion coroutine cancelled, reconnect's next-task request returned unavailable, follow-up QUEUED, one ROS start.
3. Completion responses withheld through the normal retry budget: five real completion attempts over about 65 seconds, `completion_queued`, reconnect's sixth completion request rejected with `PICK_TASK_NOT_IN_PROGRESS`, report pending and follow-up QUEUED, one ROS start and one stock deduction.
4. Controlled active bridge restart: provider survived and later returned exact-ID SUCCEEDED/ready; restarted bridge PAUSED with persisted unresolved execution, original PREPARING/IN_PROGRESS and follow-up QUEUED, no redispatch.
5. Cancellation during an accepted pick followed by success: order stayed CANCELLED, deleted session caused `PICK_SESSION_NOT_FOUND`, client queued completion and follow-up stayed QUEUED. Platform stock did not account for the reported controller success.

The captured journal schema has no durable platform-acknowledgment field. A `platform_acknowledged:false` trace field before reporting is not a persisted journal flag. The prior restart test was controlled/graceful; abrupt crash and restart with an already-queued report remain additional software tests to cover.

## Evidence and runtime

Read these from the original `end-to-end-sim` directory because many artifacts are currently uncommitted and will not automatically exist in a new worktree:

- [Master verification report](master-verification-report.md).
- [Socket.IO recovery report](socket-recovery-test-report.md) and [portable evidence/commands](verification/2026-09-22-socket-recovery/validation.json).
- [Nova failure report](nova5-failure-recovery-report.md).
- [Partial-fulfillment proposal](partial-fulfillment-fix-plan.md): platform work remains outside these tasks.
- [Final cleanup/database map](verification/2026-09-22-socket-recovery-cleanup.json).
- Test tools under `D:/Work/FPS/Robotics/end-to-end-sim/tools` and tests under its `tests` / `tests_ros` directories.

Tested repository heads were Nova `fe1e9d07ad2e16d1c46838cce63b65943b5261c8`, client `64dd9628d1b5a5d8e6d48951a01af64810281da6`, and platform `0c36efab069103c81f1d24fafa826d58bcde6e06`. Check actual current worktree and staged versions; do not assume every staged module matches its canonical checkout. Recorded hash equality covered the executor file only.

WSL distribution: Ubuntu-22.04. Existing Node: `/home/user/.local/opt/node-v22.23.2-linux-x64/bin/node`. ROS Python: `/home/user/.venvs/end-to-end-sim-ros/bin/python`. Staged platform: `/home/user/e2e-stage/coffee-platform/services/api/dist/main.js`; staged client: `/home/user/e2e-stage/platform-client`; ROS overlay: `/home/user/e2e-stage/ros_ws`. Keep environment credentials out of logs and shared artifacts.

The original demo and all disposable test services were stopped when handed off. PostgreSQL and evidence databases remain. Do not reset/reuse the captured recovery databases as fresh fixtures. Use newly named copies and task-specific runtime directories. Task A should use an independent domain/ports such as ROS 69 and 3111/3112; Task B can use ROS 70 for independent ROS checks. Check availability before binding. Coordinate any shared integrated run explicitly; never start two workers competing for the same HR queue or journal.

## Cross-task coordination

Created tasks (local host):

- Task A, `Fix client completion reporting and reconciliation`: `01a0ca6c-5fb7-7110-9e70-5905d50bd0f4`, saved `platform-client` project in an isolated worktree.
- Task B, `Fix Nova recovery in isolated checkout`: `01a0ca75-5f1e-76a2-b99e-b49b232bc654`, fresh execution context with product worktree `D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree`, branch `codex/nova-late-success-recovery`, based on tested Nova `fe1e9d07ad2e16d1c46838cce63b65943b5261c8`.
- Superseded Task B, `Fix Nova late-success journal recovery`: `01a0ca6c-b0e3-7132-ac80-c24354397ce5`. Its local execution context stalled before shell startup. It made no source edits or worktree changes; its probes/subagents were stopped and the task was archived after the replacement's read probe succeeded.
- Original review/coordinator: `01a0b54c-1896-7103-9fe5-a8286026d984`.

Both active coordinators run Astra and received the corrected role split plus each other's task IDs. Task A aligned its initially older default-branch worktree to tested client `64dd962` and works on `codex/durable-completion-recovery`. Task B's worktree was prepared by the original coordinator and verified clean before implementation. LFS smudge was disabled for that checkout to avoid fetching hardware assets; this is initially a Python bridge fix. Each task must continue to establish the exact loaded implementation for its tests.

Before finalizing interfaces, exchange a short contract covering: stable execution/task/order identity; controller terminal evidence and freshness; durable pending platform outcome; verified server terminal state; explicit operator-only resolution for deleted/ambiguous outcomes; acknowledgment/reconciliation callbacks; and when readiness permits new dispatch.

Task A owns `platform-client` and integrated harness changes. Task B owns `nova5_ros2/platform_bridge` changes. Each Astra writes its own task documentation and communicates exact file/branch/commit/interface details to the peer. Task A's Astra consolidates the master verification report after a coordinated run of both changes. Neither task may assume the other's uncommitted implementation is already present in its test environment.

Tasks must actually implement and test the authorized fixes, not stop at a design proposal. Where an unchanged platform makes full recovery impossible, implement the truthful local behavior, preserve evidence, and clearly state the remaining platform limitation instead of inventing business outcomes.
