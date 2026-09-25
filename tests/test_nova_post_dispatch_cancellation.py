"""Regression coverage for a late ROS reply after bridge cancellation.

Run with the canonical bridge source on PYTHONPATH; this test uses no ROS
processes and makes one real adapter instance dispatch a deferred RPC.
"""

import asyncio
import importlib
import sys
import types

import pytest

from platform_bridge.contracts import StartPickRequest


@pytest.fixture
def ros_link(monkeypatch):
    rclpy = types.ModuleType("rclpy")
    rclpy.node = types.ModuleType("rclpy.node")
    rclpy.node.Node = object
    bread = types.ModuleType("bread_interfaces")
    bread.srv = types.ModuleType("bread_interfaces.srv")
    bread.srv.StartBreadPick = type("StartBreadPick", (), {"Request": type("Request", (), {})})
    bread.srv.GetBreadPickStatus = type("GetBreadPickStatus", (), {"Request": type("Request", (), {})})
    ament = types.ModuleType("ament_index_python")
    ament.packages = types.ModuleType("ament_index_python.packages")
    ament.packages.get_package_share_directory = lambda _name: "/tmp"
    modules = {"rclpy": rclpy, "rclpy.node": rclpy.node, "bread_interfaces": bread, "bread_interfaces.srv": bread.srv, "ament_index_python": ament, "ament_index_python.packages": ament.packages}
    for name, member in (("dobot_msgs_v4", "RobotStatus"), ("sensor_msgs", "JointState"), ("std_msgs", "String")):
        top = types.ModuleType(name)
        child = types.ModuleType(name + ".msg")
        setattr(child, member, type(member, (), {}))
        top.msg = child
        modules[name] = top
        modules[name + ".msg"] = child
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.delitem(sys.modules, "platform_bridge.ros_node", raising=False)
    module = importlib.import_module("platform_bridge.ros_node")
    yield module._RosVisionLink
    sys.modules.pop("platform_bridge.ros_node", None)


class DeferredFuture:
    def __init__(self):
        self._callbacks = []
        self._value = None

    def add_done_callback(self, callback):
        self._callbacks.append(callback)

    def result(self):
        return self._value

    def resolve(self, value):
        self._value = value
        for callback in self._callbacks:
            callback(self)


class StartClient:
    def __init__(self):
        self.requests = []
        self.future = DeferredFuture()

    def service_is_ready(self):
        return True

    def call_async(self, request):
        self.requests.append(vars(request).copy())
        return self.future


class Node:
    def __init__(self):
        self.start = StartClient()

    def create_client(self, _service, name):
        return self.start if name.endswith("/start") else self.start

    def create_timer(self, *_args):
        return None


def test_late_start_reply_cannot_resurrect_cancelled_bridge_call(ros_link):
    async def run():
        node = Node()
        link = ros_link(node, asyncio.get_running_loop(), 1.0)
        pending = asyncio.create_task(link.start_pick(StartPickRequest("exec_late", 1, 2, 3, "bun", 2)))
        await asyncio.sleep(0)
        link._drain()
        assert node.start.requests == [{"execution_id": "exec_late", "rack_id": 1, "level_id": 2, "slot_id": 3, "label": "bun", "place_slot": 2}]
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        node.start.future.resolve(types.SimpleNamespace(accepted=True, message="late", execution_id="exec_late", code=0, robot_ready=True))
        await asyncio.sleep(0)
        assert pending.cancelled()

    asyncio.run(run())
