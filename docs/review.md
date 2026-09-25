# Pastry-ordering simulation: initial review

Review date: 2026-09-18. Scope: documentation and source inspection, environment discovery, architecture review, and proposed tests. At review time, no implementation or application test execution was included. The subsequently authorized local run is described in the [first-order runbook](first-order-runbook.md), with [direct protocol test evidence](verification/2026-09-18-protocol-order.json).

The user's follow-up decisions are recorded in [decisions.md](decisions.md). Initial scope is integration plus motion visualization, partial fulfillment is required, counter/box is one destination concept, and changes to sibling repositories require advance notice.

## Answers to the brief

The plan is reasonable for finding integration bugs between the ordering UI, platform API, middlewares, and robot workflows. The strongest first version will run the real coordination code and replace physical devices at explicit boundaries. A successful simulated run can demonstrate protocol, sequencing, accounting, recovery, and selected motion-planning behavior; it cannot by itself validate real grasp reliability or physical collision safety.

The requested mocking is feasible in principle on this workstation, including ROS2 in WSL. At review time, an existing Ubuntu 22.04 WSL 2 distribution was available, but ROS2 and several required build/runtime tools were not installed there. Builds, graphics performance, project native dependencies, model/calibration availability, and the full startup sequence remain unverified. See the historical [environment snapshot](3rd-party/README.md) and the subsequent [base environment setup log](environment-setup-log.md).

## Corrections and confirmations from the code

1. **Counter assignment already comes from the platform API.** Platform MW maps counterArea into the C++ request's place_slot; vision MW does not choose the production destination. However, the platform has four counters and Nova has three taught placement codes. The default bridge maps are empty, and enabling the platform connection requires explicit configuration. The user wants counter 4 defined and treats counter/box as the same destination. Add an explicit fourth mapping/target rather than silently aliasing another counter. Physical pose data remains undefined. See [platform notes](3rd-party/platform.md) and [Nova notes](3rd-party/nova-vision.md).
2. **The Nova-5 control sequence differs from the brief's ownership description.** The actual path is platform API -> platform MW -> C++ node -> vision MW -> HTTP vision server. The C++ node orchestrates motion and vision calls. It already tries up to ten planable candidates and checks the grasp twice. Its legacy vision drop-position client is not used by the production worker.
3. **Placement is not the current terminal success boundary.** The C++ worker releases, retracts, returns home, verifies home, and evaluates terminal driver evidence before reporting success. Neither destination occupancy nor visual confirmation of placement is implemented in that path. Follow-up tracing confirms that post-release recovery already retries home only, or holds the robot not-ready; this path does not automatically repeat placement. Preserve that safeguard in regression tests. A separate ambiguity remains when a previously held bun is absent at the second grasp check before commanded release.
4. **A robot task is not the whole customer order.** Each physical pastry is a task; coffee and pastry sessions have separate completion rules, and READY differs from collected/COMPLETED. Rack-B-only session readiness uses the humanoid; mixed-rack readiness initially uses Nova-5. Test the mixed case with each robot independently unavailable.
5. **The Atom-W platform protocol client and simulated executor already exist.** Reuse platform-client/hr_client, its HardwareInterface, location table, retry executor, and simulated hardware. The missing work is connecting these abstractions to Atom-W/VLA/AMR behavior and coherent scene state. No need to rebuild the platform protocol from scratch. See [Atom notes](3rd-party/atom.md).
6. **Current VLA success does not prove the prescribed lift pose.** The inspected state machine proceeds to HOLD_TRANSIT after grasp detection, without a lift target/arrival check. Last Mile contains reusable depth/finger geometry and servo logic; it is more involved than a simple ROI pixel threshold and is not currently wired into the VLA order flow.
7. **Retry and health mechanisms already exist, but differ from the brief.** Camera, vision MW, C++ local recovery, and platform retries are distinct layers. Diagnostic heartbeat logs, Socket.IO disconnect handling, server /health polling, telemetry, and actual device readiness also have different meanings. No single existing heartbeat proves the full chain is healthy.
8. **Completion replay needs a protocol test.** Platform inventory updates are transactionally protected against duplicate consumption, but repeating a committed completion currently returns PICK_TASK_NOT_IN_PROGRESS. This conflicts with the documented idempotent acknowledgment behavior and matters to the client's lost-ack replay. Treat this as an acknowledgment/reconciliation concern, not a demonstrated duplicate inventory decrement.
9. **Counter allocation is not atomic across orders.** The API reads occupied counters and later writes the chosen value without an exclusive database claim. Concurrent distinct orders can select the same counter. No runtime race was reproduced, but the missing safeguard is visible in the source and needs a concrete concurrent acceptance test.
10. **An unavailable robot can block later work for the other robot.** Session admission checks the oldest snack order and one readiness device. Once a mixed session is admitted, both robots can claim their own rack's tasks concurrently. These are different scheduling boundaries and should be tested separately.
11. **Current exhausted-work behavior conflicts with the chosen partial-fulfillment requirement.** A pick session can become COMPLETED with a FAILED task, while the order remains PREPARING and cannot become READY without resolution. The user wants partial completion: preserve successful deliveries and failed-item results, and make the successful portion collectible once required recovery/reconciliation is complete. The API/UI representation needs design. Cancellation also deletes sessions, which can conflict with late robot completion reports.
12. **External Atom execution owns delivery.** Injecting a PickExecutor bypasses the client's built-in box-to-counter sequence. The executor must include the complete delivery boundary before reporting success. The initial proposed interpretation of the brief is direct per-item placement; collecting a box and then transporting it is a different contract.

## Mocking boundaries

| Component | Keep real | Simulation work needed |
| --- | --- | --- |
| Ordering UI and platform API | UI, REST/Socket.IO, sessions/tasks, inventory, counter allocation | Isolated PostgreSQL/test data and scripted orders |
| Platform MW and vision MW | Their actual Python nodes and protocols | Explicit local endpoints, calibration/TF, observable faults |
| nova5 ROS node | Native C++ workflow, MoveIt planning, gripper action | Existing fake ros2_control plus custom Dobot joint feedback and RobotMode/GetErrorID services |
| Bun coordinate server | HTTP service and detection/aim/grasp processing | Capture provider for replay or synthetic RGB-D; preserve depth scale and geometry |
| Atom-W | Existing HR client/executor and eventual shared orchestration | Simulated robot/AMR/policy/hand observations, tag/pose map, shared scene and animation |
| Coffee | Real platform BW protocol | Reuse/adapt the existing live simulator's coffee client |
| Visualization | Reusable robot/scene assets where compatible | Connect to actual simulated state; verify FK/TF conventions |

Fake ros2_control alone is insufficient because the C++ node expects vendor health interfaces. The bun server has offline replay helpers but no complete production /aim camera-injection endpoint. Robo-CVStudio provides a useful synthetic RGB-D source, but runs independently and has unverified FK relative to the controller. Its Python 3.12 environment should remain separate from the Humble/Python 3.10 environment. AtomW-VLA's Isaac Lab scenes are optional higher-fidelity work, not a prerequisite for protocol tests.

## Proposed first implementation sequence

These are planning recommendations, not work already performed.

The [detailed implementation plan](implementation-plan.md) defines milestone evidence, ownership boundaries, and acceptance criteria, incorporating the follow-up Terra review.

1. **Define observable contracts.** Record the actual assignment/completion messages, identifiers, task-versus-order lifecycle, rack mapping, placement fields, coordinate frames, units, retry scopes, and failure classes. Decide how an indeterminate physical result is represented after a process dies.
2. **Establish an isolated local stack.** Run the real platform UI/API and required backing services with test data. Keep the ROS participants together inside WSL, with a distinct ROS domain and explicit simulation endpoints. Use a coffee client that speaks the real platform protocol. Reuse the existing humanoid platform client/executor with simulated device operations.
3. **Preserve Nova-5 workflow behavior.** Use the real platform MW, vision MW, and nova5 ROS node where supported. Replace the hardware boundary and camera inputs. Demonstrate one actual order progressing through the complete software chain before adding extensive animation.
4. **Add reproducible failures.** Model scene state, sensor observations, robot execution, and transport errors separately. Define named scenarios with bounded delays and scripted faults. Assert final business state and the sequence of actions, not only a green status in a viewer.
5. **Connect visualization.** Show the same state and trajectories used by the simulator, plus an event timeline keyed to order/task/attempt identifiers. Reuse available robot models and viewers after checking their interfaces and frame conventions.
6. **Increase fidelity where it finds bugs.** Add RGB-D replay or rendering, collision-aware planning, and eventually physics only where required. Keep a smaller repeatable integration suite available for rapid debugging.

## Missing contract decisions

- **Completion has several meanings.** A robot action, a single pastry task, the pastry portion of an order, the coffee portion, an order ready for collection, and customer collection are distinct events. The simulator must assert the correct transitions and resource release at each boundary.
- **Retry budgets need explicit scope.** Specify whether each limit counts retries or total attempts. Keep camera retries, candidate evaluation, local regrasp, return-home retry, AMR round trip, and platform task retry distinguishable. Bound the total work across nested retries and retain enough state across reconnects to avoid resetting the budget accidentally.
- **A dropped connection after placement is ambiguous.** Replaying a completion message must be safe. Repeating the physical placement after a lost acknowledgment must not be the default. A crash between the physical effect and durable completion may require an unknown-result state and operator reconciliation.
- **Counter reservation and occupancy differ.** Counter and box are the same destination in this installation. Reserving that destination does not prove it is empty, nor should a second pastry for the same order be rejected merely because the first is already there. Track destination ownership and the items actually placed there, without introducing separate placement-cell identifiers.
- **Cancellation needs a physical policy.** Business cancellation, a recoverable pick failure, a software crash, and a hardware alarm need distinct handling. Define whether already placed items are retained and how the robot reaches a safe stopping state before another assignment.
- **Recovery motion needs a defined path.** Returning directly to pre-pick from an arbitrary posture is not automatically collision-free. AMR travel should require a verified travel posture; a proposed VLA jolt should be a bounded, validated recovery action with clear eligibility, never an automatic reaction to an alarm. Simulate these gates explicitly.
- **A sensor's unknown result is not an empty hand.** Camera disconnection, stale frames, invalid depth, uncertain classification, and a confidently missing bun should be distinguishable in the scenarios and workflow.
- **Redo needs a business definition.** A customer-requested replacement should be a new, traceable fulfillment operation linked to the original item, with inventory and counter handling defined. It should not be an uncontrolled replay of an already completed task.

## Minimum scenario coverage

| Scenario | Principal assertion |
| --- | --- |
| Nova-only and Atom-only single-item orders | Correct robot route, counter, task completion, order readiness |
| Quantity greater than one; mixed rack order | Correct number of physical item actions; no early order completion |
| Pastries plus coffee | Independent paths converge at the correct platform order state |
| Two queued orders and both robots active | Per-device serialization and consistent shared-counter ownership |
| No buns, then success; permanent empty shelf | Correct bounded retry scope and terminal outcome |
| Early aim candidates fail; all candidates fail | Ordered candidate evaluation, correct retry accounting, no invalid execution |
| Bun missing after lift or at pre-place | Correct recovery route and separate local/travel retry budget |
| Camera timeout, stale frame, bad calibration/units | Explicit failure classification and useful diagnostic evidence |
| VLA stall, timeout, software failure, collision/alarm | Bounded local recovery; serious faults block autonomous continuation |
| Platform MW, vision MW, or device process dies | Availability changes and unresolved work becomes visible |
| Disconnect before assignment acknowledgment or after physical placement | No duplicate physical fulfillment; completion can be reconciled |
| Bun delivered but return-home or terminal reporting fails | Placement is not repeated blindly; physical and protocol outcomes can be reconciled |
| Duplicate, delayed, stale, or malformed messages | Idempotent status/accounting and rejection of invalid transitions |
| Counter full/occupied and cancellation during work | No counter leak, cross-order placement, or premature reuse |
| Process restart with active work | Explicit recovery or operator decision; no silent reset of task history |
| One item permanently fails while others succeed | Successful items become collectible with an explicit partial outcome; failed items remain failed |

The simulated world should own facts such as bun locations, hand contents, and placement occupancy. Camera observations can be faulty views of that world. Tests should compare platform/controller outcomes against independently tracked world state, so the mock does not merely return whatever result the controller expects.

Use normal wall-clock time for initial HTTP/WebSocket and process timeout testing. Introducing ROS simulated time across only part of the stack can otherwise hide timeout and heartbeat defects. Each later acceleration mode needs an explicit clock contract.

Keep characterization tests of the current applications distinct from acceptance tests for desired changes. A known gap should be observable as a failing or explicitly pending acceptance case; the mock should not silently supply behavior missing from production. Save the source revision/working-copy identity, scenario seed, configuration, input frames, and correlated event trace with each run so a failure is reproducible.

## Coding guidance for later work

Apply the supplied Python robotics guidance to new code: module-level fail-fast imports, explicit SDK wrappers, shared typed models, Result-style recoverable I/O, correct unit boundaries, ASCII Python source, and Qt thread/enum rules where a GUI is involved. Select simulation or hardware implementations explicitly at composition time; missing hardware dependencies should not silently activate simulation. A headless workflow should not acquire a Qt dependency merely to reuse robot logic.

## Decisions and remaining details

The user accepted integration plus visualization as the first scope, requires advance notice before sibling-repository edits, wants counter 4 defined, identifies counter/box as the same destination, and wants orders to partially complete. Atom-W tags/poses are not defined yet.

Retry terminology is now explained as additional tries after the initial attempt: two retries permit three attempts. The numerical limits, timeouts, selected hand/policy, actual pose/tag data, and the platform/UI representation of partial fulfillment remain to be set. Explicit simulation-only placeholders can support the first scenario design without inventing physical calibration.

“Placement cell” was introduced by the review as a possible subdivision, not found as a separate required business entity. It has been removed from the proposed domain model. See [the decision record](decisions.md) for the anticipated repository changes that must be described before editing.

The phrase in section 4 that direct SDK use means the robot “will it be using ROS2” appears to be a typo. This review interprets the intended Atom-W architecture as a standalone Python controller using the Dobot SDK without ROS2.

Other editorial clarifications: section 3.3.2 appears to mean “more direct than 3.3.1,” rather than middleware-offline section 3.2.2. Section 4-A.2.2's “cancel the recordings” appears to mean fail/cancel the fulfillment attempt. Neither wording is treated as an implementation instruction.

Luna performed the repository surveys and focused source tracing; Terra independently reviewed the architecture and selected source paths. The coordinating agent synthesized their findings and the proposed plan. Source links were checked, but no application tests, builds, services, or hardware runs were performed. Concurrency and recovery findings are source-level assessments until exercised by the planned scenarios.
