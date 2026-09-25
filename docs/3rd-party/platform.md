# Platform API and client

Read-only survey of the 2026-09-18 working copies. See [snapshot metadata](README.md); `platform-client` includes existing uncommitted changes. Source inspection does not establish that the stack runs successfully.

## coffee-platform

The repository contains the ordering UI, platform API, PostgreSQL/Prisma persistence, Socket.IO bridge, HR pastry-pick sessions, BW coffee sessions, and an existing live simulator.

The user-facing ordering path uses REST to create an order and Socket.IO updates to track it. [api.ts](../../../coffee-platform/apps/web/src/features/coffee-shop/api.ts), lines 224-291, defines order/device/task API calls. [CustomerOrdering.tsx](../../../coffee-platform/apps/web/src/features/coffee-shop/CustomerOrdering.tsx), lines 889-960, submits the current mock checkout directly as an order; it does not establish a real payment charge. [CoffeeShopProvider.tsx](../../../coffee-platform/apps/web/src/features/coffee-shop/CoffeeShopProvider.tsx), lines 413-485 and 870-885, subscribes to order updates on connection.

Key business/protocol facts:

- [docs/backend.md](../../../coffee-platform/docs/backend.md), lines 1082-1095, 1165-1177, and 1210-1240: the platform API reserves counterArea before creating preparation sessions and carries it in assignments. The statement that only middleware tracks the counter is incorrect at the API boundary.
- [hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 435-479: pastry quantity becomes individual tasks. Rack B routes to humanoid_robot and Rack A to nova5_arm. Initial readiness for a mixed-rack session currently depends on the Nova-5 route; this deserves a scenario with only one robot available.
- [docs/backend.md](../../../coffee-platform/docs/backend.md), lines 1397-1406 and 1905-1935: task, preparation session, and order state are separate; coffee and pastry preparation must both finish before a mixed order becomes READY. Collection/COMPLETED is a further business step.
- [orders.service.ts](../../../coffee-platform/services/api/src/modules/orders/orders.service.ts), lines 119-221: creation validates the request and records a QUEUED order, line items, and inventory reservations in a transaction, then emits order and queue events.
- [orders.service.ts](../../../coffee-platform/services/api/src/modules/orders/orders.service.ts), lines 302-375: cancellation and status changes have inventory/session/counter effects; the counter pickup path requires READY before COMPLETED. Include these paths in the simulator's final-state assertions.
- [counter-area.service.ts](../../../coffee-platform/services/api/src/modules/orders/counter-area.service.ts), lines 5-49: counters are 1-4. It reads free counters then updates the requesting order without atomically claiming that counter across orders. [schema.prisma](../../../coffee-platform/prisma/schema.prisma), lines 238-276, has no counterArea uniqueness constraint. Distinct concurrent orders can both select/persist the same counter; a same-order losing update can return a stale selected value because the update count is not checked. This is a source-confirmed concurrency hazard, not a reproduced runtime collision.
- [docs/backend.md](../../../coffee-platform/docs/backend.md), lines 627-649: disconnection of the final channel marks owned devices offline. Transport liveness, process responsiveness, and robot readiness should be tested separately.
- [hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 301-340: task completion rejects a task no longer IN_PROGRESS. [inventory-reservation.service.ts](../../../coffee-platform/services/api/src/modules/inventory/inventory-reservation.service.ts), lines 540-645, locks the task and transactionally guards the inventory update; duplicate reports do not consume inventory twice. The error response still needs reconciliation with the documented idempotency statement at [backend.md](../../../coffee-platform/docs/backend.md), lines 457-464, particularly when the server commits but the completion acknowledgment is lost.
- [hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 166-194, 369-432, and 618-635: platform failures/retries have retryCount/maxRetries distinct from robot-local recovery. A terminal robot failure can therefore be retried at another layer unless policy is coordinated.

There is also a separate skeletal robot-orchestrator/RobotTask adapter path. Do not confuse its TODOs with absence of the functional HR/BW Socket.IO dispatch services; identify the path used by each entry point before choosing a test target.

The existing [live-simulator README](../../../coffee-platform/simulators/live-simulator/README.md), lines 1-12 and 73-101, describes protocol clients that interact with the real platform and kiosk. Its [socket_clients.py](../../../coffee-platform/simulators/live-simulator/src/live_simulator/socket_clients.py), lines 241-323, includes automated BW/HR completion; the inspected HR request uses nova5_arm at lines 257-261. This can seed a coffee stub but does not replace the required Nova middleware/vision integration or establish full humanoid route coverage. Failure injection, telemetry, vision inventory, and detailed robot retries are not part of its stated scope.

Local prerequisites described by the repository include Node >=20.11, npm >=10, PostgreSQL, generated Prisma artifacts, migrations, and seeded test data. The documented API port is 3001 and the sample PostgreSQL host port is 5431. Review [package.json](../../../coffee-platform/package.json), lines 11-38, and [backend.md](../../../coffee-platform/docs/backend.md), lines 45-125, before creating a repeatable startup profile. API, UI, and simulator test suites exist; none was executed in this review.

## platform-client

This is the actual folder corresponding to the brief's `vision-platform-client`. It includes `hr_client` for the humanoid/pastry protocol and `vision_client` for inventory reporting, plus operator tools. The platform protocol implementation is reusable; a new controller should not duplicate it.

- [README.md](../../../platform-client/README.md), lines 3-29, describes the clients; lines 173-197 document the platform URL, namespace, humanoid device identity, timeouts/retries, simulated hardware, and failure scripts.
- [hr_client/client.py](../../../platform-client/hr_client/client.py), lines 587-606 and 1274-1293, handles reconnect readiness, subscription snapshots, pending completion replay, and new task requests.
- The same file, lines 402-416 and 717-840, handles assignment deduplication/retry generation; lines 1080-1210 implement bounded call retries; lines 1763-1827 retain and replay completion reports whose acknowledgments were not received.
- Lines 1260-1272 implement a local heartbeat log. That loop is not an application-level platform ping/reply health contract.
- [task_executor.py](../../../platform-client/hr_client/task_executor.py), lines 1-13 and 123-191, implements internal retry/rollback/deadline behavior before a platform failure report. Distinguish these budgets from platform retryCount/maxRetries.
- [README.md](../../../platform-client/README.md), lines 235-275, describes location/motion configuration, including rack slots, AMR and arm movement, counters, and a box station. These are useful integration interfaces; placeholder trajectories are not confirmed physical configuration.

The reported baseline is Python 3.10+, Socket.IO/aiohttp and related dependencies; [README.md](../../../platform-client/README.md), lines 58-69 and 97-127, gives entry points and validation commands. Preserve and review the current working-copy changes when integrating this client.

## Recommended integration checks

1. Exercise the actual ordering-UI-to-HR/BW path, including mixed quantities, rack routing, and coffee completion.
2. Verify counterArea reaches both robot executors without reassignment, and that all items belong to the correct order and counter/box destination. The user does not require separate placement-cell identifiers.
3. Drop the acknowledgment after the platform commits completion; determine whether replay reconciles successfully without new motion or duplicate inventory effects.
4. Start mixed-rack orders with Nova-5 unavailable and Atom-W available, and vice versa; document intended queue behavior.
5. Test concurrent counter acquisition and every cancellation/restart/release path with an isolated database.

## Follow-up findings from Terra review and Luna source tracing

### Mixed-rack admission versus task claims

The oldest eligible snack order determines session admission. [order-queue.service.ts](../../../coffee-platform/services/api/src/modules/orders/order-queue.service.ts), lines 108-134, selects oldest-first, and [hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 73-116 and 466-479, checks the one selected device. If that device is unavailable, a later snack order suitable for the other robot can be blocked behind it. Coffee scheduling is independent.

After admission, task claims are rack-specific and can run concurrently across the two robots ([hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 150-213; [inventory-reservation.service.ts](../../../coffee-platform/services/api/src/modules/inventory/inventory-reservation.service.ts), lines 319-478). The existing service test at lines 441-463 confirms both devices can receive tasks from one session. Admission is therefore not the same policy as ongoing per-rack dispatch, and availability is not rechecked at the claim point.

There is no application-wide counter-allocation serializer in the reviewed gateway paths. [socket-bridge.gateway.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/socket-bridge.gateway.ts), lines 104-107, 257-279, 344-388, and 664-673, allows multiple event/status/subscription paths to reach schedulers. The admin queue-emission promise only serializes that emission, not allocation. A future acceptance test must require one counter owner across competing orders; documenting the defect does not make that acceptance case pass.

### Cancellation, exhausted attempts, and pending completion reports

[orders.service.ts](../../../coffee-platform/services/api/src/modules/orders/orders.service.ts), lines 310-340, cancels and releases reservations/counter state, then [order-fulfillment-cleanup.service.ts](../../../coffee-platform/services/api/src/modules/orders/order-fulfillment-cleanup.service.ts), lines 8-12, deletes fulfillment sessions. A completion arriving concurrently can receive a task/session-not-found or task-not-in-progress error. The client does not have a cancellation-specific reconciliation response.

Failed completion reports are retained by [hr_client/client.py](../../../platform-client/hr_client/client.py), lines 1763-1783. The flush at lines 1808-1827 removes them only after success, while lines 1140-1149 classify platform errors without interpreting already-completed status. They can remain queued across reconnects. Normal session completion clears pending reports at lines 879-895, so not every lost acknowledgment leaves a permanent pending entry; cancellation/session deletion is a particularly important stranded-report case. No process-restart durability is claimed for this pending-report mechanism.

After attempts are exhausted, [hr-pick-session.service.ts](../../../coffee-platform/services/api/src/modules/socket-bridge/hr/hr-pick-session.service.ts), lines 646-669, can mark the pick session COMPLETED while a task remains FAILED. [order-preparation.service.ts](../../../coffee-platform/services/api/src/modules/orders/order-preparation.service.ts), lines 62-71, blocks order READY while any failed brew/pick task remains. Such an order stays PREPARING until administrative resolution. Session completion must not be used as proof of complete customer fulfillment.

### Existing unresolved outcome and delivery ownership

The client already supports UNRESOLVED. [hr_client/client.py](../../../platform-client/hr_client/client.py), lines 1504-1527, holds the task, reports PAUSED, and sends neither terminal success nor failure when an external execution is unresolved, raises, or is cancelled. Preserve this distinction instead of treating every interrupted execution as a retriable platform failure.

The external PickExecutor path at lines 1484-1536 reports completion when the executor succeeds and bypasses the built-in box-delivery path at lines 1608-1621. [models.py](../../../platform-client/hr_client/models.py), lines 106-125, provides task/session/retry/counter context, but not all session counts. An external Atom-W executor must own delivery through the selected boundary. Direct per-item placement follows the brief; a collect-then-deliver-box workflow needs an explicit session/container contract.

Mixed-rack fixtures must reserve inventory from both actual rack_a and rack_b locations; a menu label alone does not choose the route. The location table expects all 18 rack slots, matching counters, box-station configuration, and referenced motion files. Shipped trajectory placeholders are useful simulation inputs, not verified physical motion.
