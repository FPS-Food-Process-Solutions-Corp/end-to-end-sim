"""Drive one labeled partial pick scenario through HTTP and Socket.IO only."""

import argparse
import json
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import socketio


API_DEFAULT = "http://127.0.0.1:3001"
NAMESPACE = "/socket-bridge"
DEVICE_ID = "nova5_arm"


def parse_arguments() -> argparse.Namespace:
    """Require an explicit mutation switch and a traceable order label."""
    parser = argparse.ArgumentParser(description="Create one API and Socket.IO partial-order proof run.")
    parser.add_argument("--execute", action="store_true", help="Allow the client to create and mutate one labeled simulation order.")
    parser.add_argument("--label", help="Required unique label included in the customer name when --execute is set.")
    parser.add_argument("--api-url", default=API_DEFAULT, help="Dedicated simulation API base URL.")
    parser.add_argument("--timeout-seconds", type=float, default=15.0, help="Socket.IO acknowledgement and session-event timeout.")
    parser.add_argument("--failure-message", default="NO_DETECTION", help="Stored failure reason for both failed attempts.")
    arguments = parser.parse_args()
    if arguments.execute and not arguments.label:
        parser.error("--label is required with --execute")
    if arguments.timeout_seconds <= 0.0:
        parser.error("--timeout-seconds must be greater than zero")
    return arguments


def request_json(method: str, url: str, payload: dict[str, Any] | None = None) -> Any:
    """Make one JSON HTTP request without adding a client dependency."""
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(url, data=body, method=method)
    request.add_header("Accept", "application/json")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urlopen(request, timeout=15.0) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError("HTTP %s %s failed: %s" % (method, url, detail)) from exc
    except URLError as exc:
        raise RuntimeError("HTTP %s %s could not connect: %s" % (method, url, exc.reason)) from exc


def require_event(payload: Any, expected_event: str) -> dict[str, Any]:
    """Fail before a later mutation if an acknowledgement is not the expected shape."""
    if not isinstance(payload, dict) or payload.get("eventType") != expected_event:
        raise RuntimeError("expected %s acknowledgement, received %s" % (expected_event, json.dumps(payload, sort_keys=True)))
    return payload


def require_clean_queue(queue: Any) -> None:
    """Refuse to claim work when another queued or preparing order could be selected."""
    if not isinstance(queue, dict):
        raise RuntimeError("order queue response was not an object: %s" % json.dumps(queue, sort_keys=True))
    queued = queue.get("queued")
    preparing = queue.get("preparing")
    if not isinstance(queued, list) or not isinstance(preparing, list):
        raise RuntimeError("order queue response omitted queued or preparing lists: %s" % json.dumps(queue, sort_keys=True))
    if queued or preparing:
        raise RuntimeError("refusing proof run: applicable queue is not clean: %s" % json.dumps({"queued": queued, "preparing": preparing}, sort_keys=True))


def require_partial_result(order: Any, queue: Any, order_id: str, session_id: str) -> None:
    """Prove the current partial-order gap without creating further mutations."""
    if not isinstance(order, dict) or order.get("id") != order_id or order.get("status") != "PREPARING":
        raise RuntimeError("expected created order %s to remain PREPARING: %s" % (order_id, json.dumps(order, sort_keys=True)))
    progress = order.get("fulfillmentProgress")
    pick_session = progress.get("pickSession") if isinstance(progress, dict) else None
    tasks = pick_session.get("tasks") if isinstance(pick_session, dict) else None
    if not isinstance(pick_session, dict) or pick_session.get("sessionId") != session_id or not isinstance(tasks, list):
        raise RuntimeError("order response did not retain the expected pick session: %s" % json.dumps(order, sort_keys=True))
    if len(tasks) != 2 or sum(task.get("status") == "COMPLETED" for task in tasks if isinstance(task, dict)) != 1 or sum(task.get("status") == "FAILED" for task in tasks if isinstance(task, dict)) != 1:
        raise RuntimeError("order response did not retain one completed and one failed task: %s" % json.dumps(tasks, sort_keys=True))
    if not isinstance(queue, dict) or not isinstance(queue.get("preparing"), list):
        raise RuntimeError("order queue response did not include preparing entries: %s" % json.dumps(queue, sort_keys=True))
    matching_entries = [entry for entry in queue["preparing"] if isinstance(entry, dict) and isinstance(entry.get("order"), dict) and entry["order"].get("id") == order_id]
    if len(matching_entries) != 1:
        raise RuntimeError("order queue did not contain exactly one created order entry: %s" % json.dumps(queue, sort_keys=True))
    queue_session = matching_entries[0].get("pickSession")
    queue_tasks = queue_session.get("tasks") if isinstance(queue_session, dict) else None
    expected_counts = {"totalPickTasks": 2, "completedCount": 1, "failedCount": 1}
    if not isinstance(queue_session, dict) or queue_session.get("pickSessionId") != session_id or any(queue_session.get(key) != value for key, value in expected_counts.items()) or not isinstance(queue_tasks, list):
        raise RuntimeError("queue response did not retain the expected terminal session counts: %s" % json.dumps(queue_session, sort_keys=True))
    failed_tasks = [task for task in queue_tasks if isinstance(task, dict) and task.get("status") == "FAILED"]
    if len(failed_tasks) != 1 or failed_tasks[0].get("retryCount") != 1 or failed_tasks[0].get("maxRetries") != 1:
        raise RuntimeError("queue response did not retain exhausted retry 1/1: %s" % json.dumps(queue_tasks, sort_keys=True))


def matching_session_id_from_order(order: Any, order_id: str) -> str | None:
    """Read an already-created pick session for this proof order, if one exists."""
    if not isinstance(order, dict) or order.get("id") != order_id:
        raise RuntimeError("order read did not match created order %s: %s" % (order_id, json.dumps(order, sort_keys=True)))
    progress = order.get("fulfillmentProgress")
    pick_session = progress.get("pickSession") if isinstance(progress, dict) else None
    session_id = pick_session.get("sessionId") if isinstance(pick_session, dict) else None
    return session_id if isinstance(session_id, str) and session_id else None


def run(arguments: argparse.Namespace) -> None:
    """Execute one success, failure, retry, failure, and terminal-session sequence."""
    if not arguments.execute:
        print("Dry run only. Re-run with --execute --label UNIQUE_LABEL after preparing the dedicated API and stopping other HR consumers.")
        return
    api_url = arguments.api_url.rstrip("/")
    baseline_queue = request_json("GET", api_url + "/api/admin/order-queue")
    baseline_inventory = request_json("GET", api_url + "/api/inventory")
    require_clean_queue(baseline_queue)
    print("baseline_queue=" + json.dumps(baseline_queue, sort_keys=True))
    print("baseline_inventory=" + json.dumps(baseline_inventory, sort_keys=True))
    session_created = threading.Event()
    session_payload: dict[str, Any] = {}
    session_events: list[dict[str, Any]] = []
    expected_order_id: str | None = None
    client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)

    @client.on("platform.pick_session_created", namespace=NAMESPACE)
    def on_pick_session_created(payload: Any) -> None:
        if isinstance(payload, dict):
            session_events.append(payload)
            if payload.get("orderId") == expected_order_id:
                session_payload.update(payload)
                session_created.set()

    client.connect(api_url, namespaces=[NAMESPACE], socketio_path="socket.io", transports=["websocket"])
    try:
        subscribe = require_event(client.call("hr.subscribe_tasks", {}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "hr.tasks_subscribed")
        print("subscribed=" + json.dumps(subscribe, sort_keys=True))
        warmup = require_event(client.call("hr.status_reported", {"devices": [{"deviceId": DEVICE_ID, "state": "FREE", "online": True, "currentTaskId": None, "message": "API-only partial test ready"}]}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "hr.status_recorded")
        print("warmup_ready=" + json.dumps(warmup, sort_keys=True))
        order = request_json("POST", api_url + "/api/orders", {"customerName": "API Socket.IO partial test " + arguments.label, "source": "customer_ui", "paymentMethod": "alipay", "items": [{"itemId": "croissant", "quantity": 2, "selectedOptions": {}}]})
        expected_order_id = order.get("id") if isinstance(order, dict) else None
        if not isinstance(expected_order_id, str) or not expected_order_id:
            raise RuntimeError("order creation omitted id: %s" % json.dumps(order, sort_keys=True))
        print("order=" + json.dumps(order, sort_keys=True))
        for event in session_events:
            if event.get("orderId") == expected_order_id:
                session_payload.update(event)
                session_created.set()
                break
        if not session_created.wait(arguments.timeout_seconds):
            current_order = request_json("GET", api_url + "/api/orders/" + expected_order_id)
            existing_session_id = matching_session_id_from_order(current_order, expected_order_id)
            if existing_session_id:
                session_payload.update({"eventType": "platform.pick_session_created", "orderId": expected_order_id, "pickSessionId": existing_session_id})
                session_created.set()
                print("session_recovered_from_order=" + json.dumps(current_order, sort_keys=True))
            else:
                raise RuntimeError("subscription did not create a matching pick session; do not send another FREE report because it could race the subscription path: %s" % json.dumps(current_order, sort_keys=True))
        session_id = session_payload.get("pickSessionId")
        if session_payload.get("orderId") != expected_order_id or not isinstance(session_id, str) or not session_id:
            raise RuntimeError("pick session event omitted pickSessionId: %s" % json.dumps(session_payload, sort_keys=True))
        print("session=" + json.dumps(session_payload, sort_keys=True))
        first = require_event(client.call("hr.pick_next_pick_task", {"pickSessionId": session_id, "deviceId": DEVICE_ID}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_task_assigned")
        first_task_id = first.get("pickTaskId")
        if not isinstance(first_task_id, str) or not first_task_id:
            raise RuntimeError("first task assignment omitted pickTaskId")
        print("first_assignment=" + json.dumps(first, sort_keys=True))
        first_complete = require_event(client.call("hr.pick_task_completed", {"pickSessionId": session_id, "pickTaskId": first_task_id}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_session_updated")
        print("first_completion=" + json.dumps(first_complete, sort_keys=True))
        second = require_event(client.call("hr.pick_next_pick_task", {"pickSessionId": session_id, "deviceId": DEVICE_ID}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_task_assigned")
        second_task_id = second.get("pickTaskId")
        if not isinstance(second_task_id, str) or not second_task_id:
            raise RuntimeError("second task assignment omitted pickTaskId")
        print("second_assignment=" + json.dumps(second, sort_keys=True))
        first_failure = require_event(client.call("hr.pick_task_failed", {"pickSessionId": session_id, "pickTaskId": second_task_id, "message": arguments.failure_message}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_task_failed")
        if first_failure.get("willRetry") is not True:
            raise RuntimeError("first failure was not retryable: %s" % json.dumps(first_failure, sort_keys=True))
        print("first_failure=" + json.dumps(first_failure, sort_keys=True))
        retry = require_event(client.call("hr.pick_next_pick_task", {"pickSessionId": session_id, "deviceId": DEVICE_ID}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_task_assigned")
        if retry.get("pickTaskId") != second_task_id or retry.get("retryCount") != 1:
            raise RuntimeError("retry assignment did not reuse the failed task exactly once: %s" % json.dumps(retry, sort_keys=True))
        print("retry_assignment=" + json.dumps(retry, sort_keys=True))
        final_failure = require_event(client.call("hr.pick_task_failed", {"pickSessionId": session_id, "pickTaskId": second_task_id, "message": arguments.failure_message}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_task_failed")
        if final_failure.get("willRetry") is not False:
            raise RuntimeError("second failure unexpectedly remained retryable: %s" % json.dumps(final_failure, sort_keys=True))
        print("final_failure=" + json.dumps(final_failure, sort_keys=True))
        session_complete = require_event(client.call("hr.pick_next_pick_task", {"pickSessionId": session_id, "deviceId": DEVICE_ID}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "platform.pick_session_completed")
        print("session_complete=" + json.dumps(session_complete, sort_keys=True))
        free = require_event(client.call("hr.status_reported", {"devices": [{"deviceId": DEVICE_ID, "state": "FREE", "online": True, "currentTaskId": None, "message": "API-only partial test complete"}]}, namespace=NAMESPACE, timeout=arguments.timeout_seconds), "hr.status_recorded")
        print("free=" + json.dumps(free, sort_keys=True))
        final_order = request_json("GET", api_url + "/api/orders/" + expected_order_id)
        final_queue = request_json("GET", api_url + "/api/admin/order-queue")
        final_inventory = request_json("GET", api_url + "/api/inventory")
        require_partial_result(final_order, final_queue, expected_order_id, session_id)
        print("final_order=" + json.dumps(final_order, sort_keys=True))
        print("queue=" + json.dumps(final_queue, sort_keys=True))
        print("inventory=" + json.dumps(final_inventory, sort_keys=True))
        print("Evidence captured. This client intentionally does not cancel the order or issue a refund.")
    finally:
        client.disconnect()


if __name__ == "__main__":
    run(parse_arguments())
