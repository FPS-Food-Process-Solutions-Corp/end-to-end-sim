"""Read one bread-pick status through the real ROS service without mutation."""

import argparse
import json
from time import monotonic

import rclpy
from bread_interfaces.srv import GetBreadPickStatus


def parse_arguments() -> argparse.Namespace:
    """Require an exact execution identifier and a bounded observation timeout."""
    parser = argparse.ArgumentParser(description="Read one fake bread-pick status through its ROS service.")
    parser.add_argument("--execution-id", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=5.0)
    arguments = parser.parse_args()
    if not arguments.execution_id.strip():
        parser.error("--execution-id must not be empty")
    if arguments.timeout_seconds <= 0.0:
        parser.error("--timeout-seconds must be greater than zero")
    return arguments


def main() -> int:
    """Wait for the service and print its unmodified status response as JSON."""
    arguments = parse_arguments()
    rclpy.init(args=[])
    node = rclpy.create_node("bread_pick_status_observer")
    try:
        client = node.create_client(GetBreadPickStatus, "/bread_pick/status")
        deadline = monotonic() + arguments.timeout_seconds
        while not client.wait_for_service(timeout_sec=0.1):
            if monotonic() >= deadline:
                raise RuntimeError("bread-pick status service was unavailable")
        request = GetBreadPickStatus.Request()
        request.execution_id = arguments.execution_id
        future = client.call_async(request)
        remaining = deadline - monotonic()
        if remaining <= 0.0:
            raise RuntimeError("bread-pick status request timed out")
        rclpy.spin_until_future_complete(node, future, timeout_sec=remaining)
        if not future.done():
            raise RuntimeError("bread-pick status request timed out")
        response = future.result()
        if response is None:
            raise RuntimeError("bread-pick status response was empty")
        print(json.dumps({"execution_id": response.execution_id, "known": response.known, "state": int(response.state), "failure_code": int(response.failure_code), "message": response.message, "protocol_version": response.protocol_version, "robot_ready": response.robot_ready}, sort_keys=True, separators=(",", ":")))
        return 0
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
