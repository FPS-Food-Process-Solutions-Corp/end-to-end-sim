# Partial-order reproduction with the platform API and Socket.IO

This reproduces the current partial-order behavior using only the dedicated local Coffee Platform API and one Socket.IO HR client. It does not start ROS, a bridge, a simulator, hardware, or a payment provider. The two-croissant order is intentional: the platform creates one pick task per physical snack item.

The expected current result is the observed A004 gap: one task completed, one task failed after its single retry, the pick session `COMPLETED`, and the order still `PREPARING` with its counter and failed reservation held. This guide is a characterization test before the partial-order business fix.

The proposed correction and its policy boundaries are in [partial-fulfillment-fix-plan.md](partial-fulfillment-fix-plan.md). This guide deliberately records current behavior; it does not implement or assume that proposal.

The clean API-only A006 run followed this sequence without an error acknowledgement; its complete pre-cleanup trace is in [2026-09-18-api-socketio-order.json](verification/2026-09-18-api-socketio-order.json). The earlier A005 trace records the separate startup race caused by two session-start triggers in [2026-09-18-api-socketio-startup-race.json](verification/2026-09-18-api-socketio-startup-race.json).

## Prerequisites and safety boundary

1. Use only the dedicated simulation API and database at `http://127.0.0.1:3001`. Confirm `GET /api/health` responds before proceeding.
2. Stop or disconnect every other HR consumer first, including the real bridge and the live simulator HR client. There must be only the Postman Socket.IO client for this run. Check `GET /api/admin/devices` before connecting; its `socketConnections.channels` must show HR count zero.
3. Capture `GET /api/inventory` and `GET /api/admin/order-queue` before creating the order. The queue's `queued` and `preparing` lists must both be empty, so this client cannot claim another order's task. A Ready order may remain for inspection. Choose a unique label such as `POSTMAN-PARTIAL-YYYYMMDD-HHMM`; it becomes part of the order's customer name.
4. This uses the existing local mock order flow with `paymentMethod: "alipay"`; it does not charge an account. Do not use a production API, a real order, or an existing order ID.

Keep one Socket.IO connection open for the entire run. It subscribes while the applicable queue is empty, reports Nova5 FREE while it remains empty, then creates the order. The order-queue event is then the single session-start trigger.

### Optional local-stage setup

External Platform users only need a running dedicated API and can skip this subsection. For this workspace, stop the normal bridge mode, then start direct mode. Leave the live simulator's HR and BW clients disconnected; this test's Postman client must be the only HR client.

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py stop
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py start --mode direct
```

After capturing and explicitly cleaning up the labeled order, disconnect Postman and restore the normal bridge mode:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py stop
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py start --mode bridge
```

## Configure Postman as Socket.IO

In Postman, create **New -> Socket.IO**, not a raw WebSocket request. Use this connection URL:

```text
ws://127.0.0.1:3001/socket-bridge
```

Set the Socket.IO handshake path to `/socket.io` and use Socket.IO client 4.x. The namespace is `/socket-bridge`; it is distinct from the handshake path. Select WebSocket transport because Postman's Socket.IO client does not use polling. Register event listeners before sending anything:

- `platform.connected`
- `hr.tasks_subscribed`
- `platform.pick_session_created`
- `platform.pick_task_assigned`
- `platform.pick_session_updated`
- `platform.pick_task_failed`
- `platform.pick_session_completed`
- `platform.pick_error`

Send one JSON argument beside each Socket.IO event name. The service has no authentication or request-ID field for this flow. Listen for the direct event as well as reading the acknowledgement: the API both acknowledges and emits relevant responses to the caller.

Postman's Socket.IO request, handshake, message, and listener instructions are in the official [Socket.IO request guide](https://learning.postman.com/latest-v-12/docs/use/send-requests/protocols/websocket/create-a-socketio-request), [connection settings guide](https://learning.postman.com/docs/use/send-requests/protocols/websocket/add-details-websocket), [message guide](https://learning.postman.com/docs/use/send-requests/protocols/websocket/work-with-websocket-messages), and [event-listener guide](https://learning.postman.com/docs/use/send-requests/protocols/websocket/listen-to-socketio-events/).

## Start one HR API-only run

1. Connect the Socket.IO request. Confirm `platform.connected` reports namespace `/socket-bridge`.
2. While the recorded `queued` and `preparing` lists are still empty, emit `hr.subscribe_tasks` with `{}`. The acknowledgement and direct event are `hr.tasks_subscribed`. The empty queue means this subscription must not create a pick session.
3. With that same empty queue, emit `hr.status_reported`:

```json
{
  "devices": [
    {
      "deviceId": "nova5_arm",
      "state": "FREE",
      "online": true,
      "currentTaskId": null,
      "message": "Postman partial test ready"
    }
  ]
}
```

Expect `hr.status_recorded`. A `platform.pick_error` here is a blocking setup failure; do not create the order. This status report is deliberately before order creation.

4. In a normal HTTP Postman request, create the new two-item order with `POST http://127.0.0.1:3001/api/orders`:

```json
{
  "customerName": "API Socket.IO partial test POSTMAN-PARTIAL-YYYYMMDD-HHMM",
  "source": "customer_ui",
  "paymentMethod": "alipay",
  "items": [
    {
      "itemId": "croissant",
      "quantity": 2,
      "selectedOptions": {}
    }
  ]
}
```

The returned order is already queued and reserved. Do not call an order-confirmation endpoint or add a payment event. Save the returned `id` and `orderNumber`.

The order-queue event creates the matching pick session; wait for `platform.pick_session_created` and save its `pickSessionId`. Do not send another FREE report here.

The platform's current subscription and FREE-status paths can both start a pick session without serializing creation. A005 sent FREE after creating the order and subscribing; it created the valid matching session but also returned `platform.pick_error` with a unique `order_id` error. This is a startup race separate from the partial-order behavior. Do not ignore that error or retry another FREE report; preserve it as evidence and stop. Do not invent IDs; copy each ID from the immediately preceding acknowledgement or event.

5. Claim task one by emitting `hr.pick_next_pick_task`:

```json
{
  "pickSessionId": "<from platform.pick_session_created>",
  "deviceId": "nova5_arm"
}
```

Expect `platform.pick_task_assigned`. Save `pickTaskId` as task one. Complete it with `hr.pick_task_completed`:

```json
{
  "pickSessionId": "<session id>",
  "pickTaskId": "<task one id>"
}
```

Expect `platform.pick_session_updated`, including one completed task. This consumes exactly one reserved croissant.

6. Claim task two with the same `hr.pick_next_pick_task` payload, then save its different `pickTaskId`. Fail it with `hr.pick_task_failed`:

```json
{
  "pickSessionId": "<session id>",
  "pickTaskId": "<task two id>",
  "message": "NO_DETECTION"
}
```

Expect `platform.pick_task_failed` with `retryCount: 0`, `maxRetries: 1`, and `willRetry: true`.

7. Emit `hr.pick_next_pick_task` again. It must return `platform.pick_task_assigned` for the same task-two ID with `retryCount: 1`. Emit `hr.pick_task_failed` again with the same session and task IDs. Expect `willRetry: false`.
8. Emit `hr.pick_next_pick_task` one final time. With no unassigned or retryable task left, expect `platform.pick_session_completed` with `totalPickTasks: 2`, `completedPickTasks: 1`, and `failedPickTasks: 1`.
9. Return the device to free state using the same `hr.status_reported` structure from step 3, with a completion message. Then capture the HTTP evidence before disconnecting the Socket.IO client.

## Verify the current behavior

Use these read-only requests, substituting the newly created ID:

```text
GET http://127.0.0.1:3001/api/orders/<order id>
GET http://127.0.0.1:3001/api/admin/order-queue
GET http://127.0.0.1:3001/api/inventory
```

Before cleanup, expect the order to be `PREPARING`, the pick session to be `COMPLETED`, task one `COMPLETED`, task two `FAILED` with retry count one, and the assigned counter still occupied. Relative to the pre-run inventory snapshot, database quantity decreases by one and available quantity decreases by two: one item was consumed and one failed task still reserves an item.

## Capture before cleanup

Save the complete order response, queue response, inventory response, every acknowledgement, and the listener events. Current cancellation removes persisted fulfillment session and task detail, so cancellation is test cleanup rather than evidence preservation.

Only after capture, cancel the newly labeled order with `PATCH http://127.0.0.1:3001/api/orders/<order id>/status`:

```json
{
  "status": "CANCELLED"
}
```

For the observed A004 behavior, this released the counter and only the remaining reservation. It did not restore the item already consumed by the completed task. Re-run the three read-only requests to confirm the cleanup, then disconnect the Postman Socket.IO client and restore the normal bridge mode separately.

## Optional guarded Python proof client

[partial_order_socketio_proof.py](../tools/partial_order_socketio_proof.py) implements this same API-only sequence with the existing `python-socketio` dependency. It forces Socket.IO WebSocket transport, requires `--execute` and a unique `--label`, validates each acknowledgement before the next mutation, and deliberately does not cancel or refund anything.

When the dedicated API is prepared and a coordinator authorizes one new labeled order, run:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /home/user/.venvs/coffee-platform-live-sim/bin/python /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/partial_order_socketio_proof.py --execute --label POSTMAN-PARTIAL-YYYYMMDD-HHMM
```

Without `--execute`, the script only prints its prerequisites and makes no connection.
