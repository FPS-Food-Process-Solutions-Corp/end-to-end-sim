# Proposed implementation plan

Status: planning document from the 2026-09-18 review. The user subsequently authorized the base environment and first local order test; see the [first-order runbook](first-order-runbook.md). This document records the proposed milestones and acceptance criteria and does not itself authorize additional work.

This plan builds on [the initial review](review.md) and [repository summaries](3rd-party/README.md). It separates a runnable integration harness from higher-fidelity physical simulation. Repository behavior and readiness still require runtime verification.

Apply the [user's follow-up decisions](decisions.md): integration plus visualization initially; notify before sibling-repository changes; counter/box is one destination with counter 4 to be defined; partial fulfillment is required; real tags/poses are not yet available.

## Initial scope recommendation

Run the actual ordering UI/platform API, PostgreSQL, platform MW, vision MW, native nova5 ROS node, bun-coordinate-server, and humanoid platform client. Simulate robot/camera devices and policy outcomes while preserving the production protocols and workflow decisions. Include a protocol-compatible coffee client and animation tied to simulator state.

The first complete deliverable should support one Nova order, one Atom-W order, a mixed order, and selected failure/recovery cases. It should include an automatically checked outcome and a saved event trace for each run. An animation alone is insufficient evidence of an end-to-end pass.

Real VLA inference, Isaac Lab, deformable buns, contact/friction tuning, and physically predictive grasp success are later fidelity increments. Their omission from the first deliverable must be explicit in its results.

## Ownership boundaries

| Owner | Authoritative information | Must not infer from |
| --- | --- | --- |
| Platform API | Order/task/session state, inventory reservations, counter assignment | Viewer animation or an unacknowledged local success message |
| Robot workflow and platform adapter | Accepted execution, progress, retry disposition, completion evidence | Merely having received a task message |
| Simulated world | Bun identities/locations, actual hand contents, items placed at each counter/box | What result the controller wants the sensor to return |
| Camera source and perception service | Observations derived from the world, including controlled error | Platform business state as a substitute for image evidence |
| Viewer | Rendering of observed simulator/robot state | An independent motion script that can diverge from execution |
| Test runner | Scenario inputs, fault schedule, assertions, run artifacts | A successful HTTP response alone |

Existing protocol identifiers remain authoritative. The harness should correlate order, session, task, platform attempt, and robot execution identifiers without replacing their production semantics. A test-run identifier and scenario seed are additional diagnostic fields.

## Physical outcome contract to review

These are proposed distinctions, not replacements already made to the production enums:

| Evidence | Proposed treatment |
| --- | --- |
| No physical attempt began | A later execution may be scheduled if the task is still valid |
| An attempt failed with evidence that no delivery occurred | Retry within the appropriate budget and motion constraints |
| Bun was confirmed held, then is absent at a later check | Determine whether it was dropped elsewhere or could already be at the destination; absence alone does not establish either |
| Release was commanded/completed, but recovery or reporting failed | Reconcile the existing delivery attempt; do not equate recovery failure with an untouched task |
| Platform committed completion, acknowledgment was lost | Replay/reconcile the same completion; never restart robot execution for this transport failure |
| Physical effect is unknown | Hold the affected execution for evidence or operator reconciliation; do not reset its history by assigning a new execution ID |

The business outcome and robot availability are separate. A delivered item can coexist with a robot that needs recovery. Likewise, a robot reporting idle does not by itself resolve an outstanding item. Tests should assert both facts.

The user brief permits a retry after missing-hand checks. The narrower recommendation here is to require evidence that retry will not duplicate a delivery when the item was previously known to be held. This is a proposed policy refinement requiring agreement, not an assumption that all missing-hand outcomes require manual intervention.

## Milestones and evidence

### 1. Freeze the contracts and baseline scenarios

Produce small, reviewable examples of real assignment/completion/failure messages, location mapping, ROS request/result types, and vision geometry. Record the current retry scopes, initial readiness gates, and treatment of completion replay. Resolve or explicitly isolate unsupported counter mappings.

Acceptance evidence:

- Every expected result is labeled either current behavior or desired behavior.
- Each terminal outcome distinguishes physical delivery, robot recovery, and platform acknowledgment.
- Each retry counter states its owner, reset condition, maximum retries versus total attempts, and interaction with parent budgets.
- Unsupported rack/slot/counter/frame/unit values fail before a motion command.
- Concurrent distinct orders cannot acquire the same counter. A read/check followed by an unprotected write is not a reservation contract.
- An already completed or cancelled task has an explicit reconciliation response that lets a client retire a pending report without replaying motion. The current pending-report lifetime across process restart must be documented separately from reconnect behavior.
- Counter/box is one destination identifier. Multiple items for one order may occupy the same destination; no extra placement-cell model is required.
- Partial fulfillment retains failed item outcomes while permitting collection of successful items after required recovery/reconciliation.

### 2. Establish a local platform loop

Use an isolated database and the real UI/platform API. Reuse the existing humanoid client and coffee/BW simulator pieces. Start with simulated execution that makes the protocol and queue behavior observable; this milestone alone does not meet the final camera/Nova integration requirement.

Acceptance evidence:

- An order entered through the real UI creates the expected tasks/reservations.
- Quantity and rack routing are preserved through completion.
- A pastry-plus-coffee order reaches READY only after its required components finish.
- Customer collection is represented separately from preparation readiness.
- A permanently failed item does not leave an otherwise resolved partial order indefinitely PREPARING; the successful portion has an explicit collectible partial outcome.
- Duplicate/delayed messages and a lost completion acknowledgment have recorded outcomes without duplicate physical action or inventory consumption.

### 3. Run the native Nova workflow against simulated devices

Keep the existing C++ node and MoveIt planning. Extend the existing fake-hardware startup with the vendor-format feedback and health services the node uses. Feed camera frames through the real vision-server capture boundary while retaining the real detection/aim/grasp calculations.

Acceptance evidence:

- One item traverses platform API -> platform MW -> C++ node -> vision MW -> real vision server and back to the platform.
- Characterization scenarios use existing configured taught placement slots 1-3 and verify an unsupported counter is held/rejected before motion. The intended deliverable adds an explicit counter-4 simulation target/mapping, after advance notice of the required Nova changes. Any simulation pose is marked as such and is not a taught physical pose.
- Multiple aim candidates exercise the native selection logic.
- Both grasp checks consume observations associated with the actual simulated pose/world state.
- A delivery followed by a home or reporting failure cannot be mistaken for an untouched item eligible for blind re-execution.
- Health faults and stale feedback are distinguishable from valid idle feedback.

Use recorded RGB-D fixtures with known calibration to establish a reliable perception baseline before relying on synthetic images. Synthetic frames may require detector-specific evaluation; geometric correctness alone does not prove the deployed segmentation/model will recognize them. A final-response stub is appropriate for isolated protocol tests, not for claiming completion of this milestone.

### 4. Connect the Atom-W sequence to simulated devices

Compose the existing humanoid client/executor with explicit AMR, joint-motion, policy, and hand-observation implementations. Use configured tags and poses. Represent pre-pick, grasp, lift/settle, hand verification, travel posture, placement navigation, pre-place verification, release, and idle/next-task transitions explicitly.

The proposed initial interpretation of the brief is direct placement of each pastry at its assigned counter. The external PickExecutor must own the entire sequence through that delivery boundary. The existing client reports task completion when the external executor succeeds; this path bypasses the built-in humanoid box-delivery sequence. Do not assume the client will perform a missing delivery tail afterward.

If the desired workflow instead collects multiple pastries in a box and then transports the box to the counter, use an explicit session/container delivery contract. The current TaskContext does not expose all session counts needed to infer that tail reliably. This alternate behavior must be chosen and represented explicitly before implementation.

Acceptance evidence:

- Platform assignment selects the correct configured rack/slot/tag and counter destination.
- AMR travel requires the configured travel posture.
- Local VLA retries and retries requiring AMR travel consume distinct budgets.
- A successful policy outcome alone does not bypass lift arrival or hand verification.
- A hardware alarm, failed recovery, or indeterminate outcome prevents another automatic fulfillment until the defined reconciliation/reset occurs.
- The viewer displays the same motion state the executor observes.
- For multiple items, every physical placement belongs to the correct order and counter/box. Platform completion cannot precede the chosen per-item or final-container delivery boundary.

The first simulated hand check can use scripted observations derived from independent world state. Reusing Last Mile's more detailed depth gate is a separate, testable integration choice. Document which check a given scenario actually exercises.

### 5. Add the cross-system regression scenarios

Prioritize scenarios that cross process or ownership boundaries:

| Scenario | Evidence required |
| --- | --- |
| Both robots, multiple pastry quantities, and coffee | Correct route/count/destination; no premature readiness |
| One robot unavailable during a mixed order | The selected policy permits eligible work or visibly holds it with a reason; availability recovery resumes progress without another order; no incorrect routing or false readiness |
| Empty detection or first candidates unreachable | Bounded retries and native candidate selection visible in the trace |
| No confirmed acquisition, with evidence of no delivery | Bounded ordinary recovery and no phantom delivery |
| Bun absent after a confirmed hold, with uncertain destination | Evidence-based disposition; no automatic assumption that the item never reached its destination |
| Release succeeds but robot recovery fails | Delivery remains distinguishable from recovery failure |
| Server commits completion but acknowledgment is lost | Reconciliation without another physical placement or inventory decrement |
| Middleware/client process restarts with active work | Existing execution identity is reconciled; a new execution is not silently invented |
| Customer/operator cancels during motion | Defined physical stopping/reconciliation and reservation handling |
| Two different orders need the last counter | Exactly one acquires it; the other stays queued/held, cannot overwrite the winning reservation, and causes no same-counter motion |
| Unknown sensor result or stale feedback | No conversion into false success or a confidently empty hand |
| Some items succeed and another permanently fails | Successful items can be collected with a visible partial outcome; failed items and their reasons remain recorded |

Keep known production gaps visible as pending/failing acceptance cases. Characterization tests can pass by confirming current behavior even when that behavior needs a later production change.

## Proposed environment layout

Keep ROS nodes, MoveIt, controllers, and vendor-diagnostic mocks together in one Ubuntu 22.04/Humble environment. Give the run explicit local endpoints and a dedicated ROS domain. Avoid loading real-device configuration by default.

Use separate dependency environments for the Python 3.10 ROS packages, Python 3.12 Robo-CVStudio pieces, and any heavier AtomW-VLA evaluation stack. Communicate across existing service boundaries or small explicit adapters instead of forcing all repositories into one Python environment. The platform API needs a usable Node/PostgreSQL environment; its browser UI can be viewed from Windows.

The startup profile should verify required configuration, models, calibration, executables, and service readiness before submitting a test order. Missing dependencies should fail visibly, not select a different backend. This is a proposed design, not a verified startup command or an installation request.

## Run artifacts

Each run should save its scenario/configuration, source revisions and working-copy identity, seed, protocol/event trace, physical world ledger, relevant frames/calibration, final platform state, and assertion results. Record real-time timestamps for transport timeouts and monotonic elapsed time for ordering events. Keep simulated time optional until its cross-process contract is defined.

Logs should connect every retry and terminal result to the same task/execution lineage. Credentials and unrelated environment data do not belong in artifacts.

## Remaining design details and change notice

Initial scope, partial fulfillment, and destination terminology have been answered in [decisions.md](decisions.md). Before editing a sibling repository, describe its affected files, why the change is needed, and the expected behavior. This notice is a user requirement; it does not authorize implementation during the current review phase.

Numerical retry/deadline values, actual Atom-W tags/poses, hand/policy selection, and the API/UI representation of partial fulfillment remain open. The first simulator can use explicitly labeled nonphysical pose/tag fixtures; it must not present them as calibrated robot data. Counter 4 needs an explicit target rather than an alias.

The implementation should not silently change business policy or fabricate physical configuration to make tests pass.
