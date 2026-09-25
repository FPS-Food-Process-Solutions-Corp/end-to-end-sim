# Decisions from the user

Recorded during the review on 2026-09-18. These decisions refine the plan; implementation had not started at the time of that review. The subsequently authorized local test is described in the [first-order runbook](first-order-runbook.md).

| Topic | Agreed direction | Remaining detail |
| --- | --- | --- |
| Initial scope | Integration testing plus motion visualization; detailed contact/grasp physics deferred | Exact viewer integration after a runnable software loop |
| Sibling repositories | Notify the user beforehand about proposed changes | Before editing, name affected repositories/files, purpose, and expected behavior |
| Destination terminology | Counter and box refer to the same destination | Do not introduce a separate placement-cell entity |
| Counter 4 | It should be defined as a destination | Actual Nova placement configuration/pose is not yet defined; do not alias another counter silently |
| Permanent item failure | The order should partially complete | Specify the platform/UI representation while preserving failed-item results and successful-item delivery |
| Atom-W tags and poses | Not defined yet | Use explicit simulation-only placeholders where needed; never present these as real motion configuration |
| Retry terminology | Explain limits as retries after the initial attempt | Numerical values remain to be chosen; existing implementation limits are evidence, not new agreed defaults |

## Terminology correction

The review introduced “placement cell” as a possible subdivision within a counter/box. That was a design suggestion, not a verified separate entity in this installation. The plan now uses one destination identity, counter/box 1-4. Existing source fields such as Nova place_slot are protocol/motion mappings to that destination, not justification for introducing another business entity.

The current humanoid client's built-in box-transport workflow is still a source fact. It should not be assumed to define the requested workflow; the proposed Atom-W flow follows the brief's per-pastry delivery to the assigned counter/box.

## Retry explanation

- Zero retries means one attempt.
- One retry means up to two attempts.
- Two retries means up to three attempts.

For example, the current Nova constant allowing three physical grasp attempts corresponds to two retries, not three. A home restart and a local grasp retry are different operations with separate counters. Camera retries, platform retries, and an overall deadline are separate again.

Use unambiguous configuration/documentation names such as max_retries and explicitly record the initial attempt. This is a naming convention for the design, not an instruction to change existing limits. The brief's one AMR retry and two-or-three local VLA retries remain candidate values until the user selects the numbers.

## Partial-fulfillment interpretation to carry into implementation

Retain successful deliveries and failed-item outcomes. Once remaining work is terminal and the robot/counter is in the required safe state, the customer should be able to collect the successful portion, with a visible indication of items not fulfilled. Do not keep an order in PREPARING solely because a terminally failed item exists, and do not relabel that failed item as successful.

Whether the platform uses a dedicated partial status or an existing readiness/collection state with an explicit partial outcome is an implementation choice to present before changing the platform API/UI. Payment/refund treatment has not been specified. An unknown physical outcome still needs reconciliation; it is not equivalent to a known failed item that can simply be omitted.

## Anticipated change notice, not an implementation action

The initial simulator will likely need small changes in these repositories. Exact files and scope must be presented before edits:

- **nova5_ros2:** complete fake-device feedback/health integration, configure the fourth destination, and potentially improve vision execution correlation. Preserve the existing native recovery and durable platform-bridge journal.
- **bun-coordinate-server:** add an explicit replay/synthetic capture-provider boundary while keeping the real HTTP and perception/aim pipeline.
- **coffee-platform:** express partial fulfillment, make counter claims atomic, and define canonical terminal completion/reconciliation responses. Mixed-rack queue fairness is a separate behavior decision to make visible.
- **platform-client:** reconcile terminal/cancelled completion reports and ensure an external Atom executor owns the full chosen delivery boundary.
- **end-to-end-sim:** scenario runner, simulated world/devices, configuration, traces/assertions, and viewer integration.

No changes to aio_atom-w_gui, AtomW-VLA, or robo-cvstudio are assumed necessary for the first scope. Their existing assets/interfaces can be inspected or reused through adapters; any later edits will receive the same advance notice.
