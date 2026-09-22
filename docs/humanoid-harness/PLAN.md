# Architecture and acceptance plan

Coordinator: GPT-6 Astra, Ultra. Source reconstruction: GPT-6 Luna, read-only. Implementation, tests and independent code review: GPT-6 Sol. Documentation and final assessment: Astra.

## Scope and structure

Build a standard-library Python package under `humanoid_harness/`, with isolated tests under `tests/humanoid_harness/` and documentation here. Run software simulation only. Do not import the hardware repositories, contact policy servers, publish DDS, start ROS or use existing platform databases/journals. This harness requires no package installation or shared port allocation.

The orchestrator owns the complete per-pastry flow in [FLOW.md](FLOW.md). Injectable adapters own AMR navigation, humanoid posture/hand/lift movement, VLA execution, perception checks and platform assignment/completion. Their names should identify the physical action to replace. The real source's pure `PickPlaceRun`/UI handler separation informs this structure; the harness does not import that Qt application or equate its local taught-pose picking recipe with the requested VLA workflow.

Use typed requests/results and the robotics `Result` pattern. An accepted submission is not a completed action. Each action has an execution identity, state progression, terminal result, timeout and cancellation path. Match status to the intended identity; ignore or reject stale and mismatched results. The durable identity is a harness adapter contract, not a capability attributed to current DDS or inference RPCs.

## Three durable truths

1. **Controller checkpoint:** active task, intended action, stable execution ID, stage, attempts, retry budgets and hold/cancellation state.
2. **Simulated device ledger and world:** accepted executions, progress and actual effects, including location, posture, rack inventory, held pastry, loss and counter inventory. Persist effects independently of the controller. Distinguish a pastry task from a physical bun instance: retrying after loss must consume explicit spare stock, not resurrect the lost bun.
3. **Platform stub ledger:** assigned task identities and idempotently accepted per-task completion reports. A report acknowledgment is not evidence of placement.

Write intent before submission. After restart, reconcile an existing execution before considering new work. A completed physical action advances the checkpoint without being executed again. A definitely unstarted action can follow its bounded retry policy. An unknown or conflicting outcome enters a visible hold. Completed placement followed by missing platform acknowledgment resumes reporting only.

Bind a state directory to its original configuration. Resume explicitly; reject mismatched or corrupt state instead of silently starting again. Tests and demonstrations use fresh, isolated directories. Keep all simulated state and evidence beneath those directories.

## Failure behavior

Use deterministic stage fault rules and a virtual clock so delay, rejection, failure, stuck policy, dropped acknowledgment, timeout, cancellation and crash windows are repeatable without a device. The default budgets are one navigation retry, two VLA retries and one full-cycle retry after confirmed loss. Retry only when the outcome is positively known safe for that action; `FAILED` or `CANCELED` by itself is insufficient evidence. A retry does not erase inventory or fulfillment. Safety decisions use adapter/perception contracts, never a private simulation ledger belonging to a different adapter.

Verify lift posture and possession from the simulated world after VLA success. Recheck possession before placement. A policy may return success without holding anything; this must never fulfill the task. Safe terminal exhaustion can fail the individual unit and preserve other completed units. A potentially held pastry, collision, unknown outcome or unconfirmed cancellation requires a rescue/reconciliation hold.

## Demonstration and visibility

Provide a module CLI, configurable scenarios, readable lifecycle events, machine-readable events/summary and a standalone HTML timeline. Show the robot's AMR tag, posture, held pastry, assigned counter and four distinct counter inventories. Display simulation placeholders clearly. The HTML uses recorded world facts and has no service or network dependency.

Document how to run a normal loop, inject failures, inspect the active stage, restart after a crash, observe retained partial results and replace each stub. Supply a process-boundary crash example after placement, before controller completion persistence, then resume from the same fixture.

## Acceptance

- Full stage ordering, Rack B-only ownership, one physical cycle per pastry task, immediate next-task pickup and front-counter return when idle.
- Counter 4 remains distinct, quantities are not hardcoded and partial/cross-rack orders remain partial or pending as appropriate.
- Independent navigation, VLA and full-cycle budgets; safe stuck recovery; empty-hand/lift-check failures; loss before placement.
- Submission acknowledgment versus terminal outcome; delayed/stale/mismatched status; timeout and cancellation races; uncertain outcomes hold.
- Controller crash with device effect already durable: no duplicate pick or placement on restart.
- Platform accepted completion with lost acknowledgment: no duplicate physical action or fulfilled count on replay.
- Visual frames agree with world/ledger facts.
- Python syntax, ASCII source, module-level imports and expected exception handling follow the robotics coding guidance.

Final reporting separates simulation-tested behavior, source-reviewed interfaces and hardware-only gaps. Existing client recovery acceptance and pending Nova/client combined acceptance are not harness validation.
