# First local order test

This is the acceptance plan for the first runnable software loop. See the run guide for the actual launch commands and the verification record for observed results. This plan alone does not establish that a test has passed.

## Scope

Use the real coffee-platform customer frontend, API, inventory reservation logic, and Socket.IO protocol with a dedicated local simulation database. Begin with one Butter Croissant from Rack A. Customer checkout uses the platform's existing mock-payment flow.

The first startup check uses the existing live simulator's HR client. The middleware check then disconnects that client and connects the real Nova platform bridge to simulated ROS pick services. Only one client may claim work as `nova5_arm` at a time.

The ROS service provider models task acceptance, running, and successful completion. This does not validate native C++ motion, MoveIt planning, cameras, grasp reliability, or physical delivery.

## User-visible surfaces

- Customer kiosk: `http://127.0.0.1:3000/kiosk/menu`.
- Administration and order queue: `http://127.0.0.1:3000/admin`.
- API: `http://127.0.0.1:3001/api`.
- Existing live simulator event console: `http://127.0.0.1:8770`. Its HR events represent the direct protocol check, not traffic from a separate bridge client.
- Labeled API, frontend, bridge, and simulated ROS service logs, with a terminal view and explicit start, status, and stop commands.

The launcher must distinguish the direct simulator mode from the real bridge mode. A terminal UI must use a simulation-specific configuration; its controls must not start the default hardware or camera stack.

## Acceptance sequence

1. Confirm that all services use the dedicated simulation database and loopback network endpoints.
2. Capture Rack-A croissant inventory and existing order identifiers before the test.
3. In the real kiosk, select Snack, add one Butter Croissant, open the cart, select Go to checkout, and use the local mock Pay now action.
4. Record the returned order identifier and order number.
5. Observe assignment, one execution, completion acknowledgement, and the order becoming READY with an assigned counter.
6. Verify that the order has one completed pick task and no brew task for this pastry-only case.
7. Verify that total Rack-A croissant `databaseQuantity` and `availableQuantity` each decreased by exactly one. Do not assume which stock slot was chosen.
8. Preserve a trace that links the order, pick session, task, and, for the middleware check, ROS execution ID. Record any later READY-to-COMPLETED customer/admin action separately.

Read-only evidence endpoints are `GET /api/inventory`, `GET /api/orders/:id`, `GET /api/orders/find/:orderNumber`, and `GET /api/admin/order-queue`.

Reservation and completion have different effects: reservation reduces available quantity while leaving database quantity unchanged; successful pick completion reduces database quantity and releases the reservation. Cancellation releases a reservation without consuming stock.

## Simulated ROS contract

The provider implements `bread_interfaces/srv/StartBreadPick` on `/bread_pick/start` and `bread_interfaces/srv/GetBreadPickStatus` on `/bread_pick/status`.

- Empty execution ID in a status query reports readiness with protocol version 1.
- A valid new start records its full request and progresses from RUNNING to SUCCEEDED after a deterministic delay.
- Repeating the identical start with the same execution ID does not create a second execution.
- Reusing an execution ID with different parameters is rejected as a conflicting replay.
- A different execution ID is rejected as busy while a pick is active.
- Unknown status queries remain unknown; they must not fabricate success.
- The provider defaults to `success`. A controlled bridge launch can supply a comma-separated `success` and `failed` sequence for newly accepted execution IDs. Identical replays do not consume an outcome; after the sequence is exhausted, its final outcome repeats. A configured `failed` response is a known terminal `FAILED` state with the nonzero `NO_DETECTION` failure code and `robot_ready=true`.
- The provider does not inject a known execution with an `UNKNOWN` state. An unknown ID remains the protocol's `known=false`, `UNKNOWN`, no-failure response; bridge recovery of a lost correlated execution is a separate scenario.

The bridge uses actual seeded platform item identifiers, an isolated journal, and explicitly disabled telemetry and camera health polling. Counter 4 must not be silently mapped to an existing counter. This first test does not establish counter-4 support.

## Boundaries and follow-up

Keep credentials in restricted local runtime files, omit them from logs, and do not modify the original sibling repositories for this staged test. Database resets, if offered, must target only the dedicated simulation database and must be explicit.

Partial fulfillment, normative retry/deadline settings, Atom-W delivery choices, native motion, camera perception, and multi-order concurrency remain separate follow-up scenarios. A successful single-order test does not establish those behaviors.
