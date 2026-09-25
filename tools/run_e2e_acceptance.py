"""Own one fresh mixed Rack A Nova / Rack B humanoid order and its evidence."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from types import SimpleNamespace
import socketio

from urllib.error import URLError
from urllib.request import urlopen

import e2e_mixed_audit as audit
import e2e_held_placement_case as held
import nova5_socket_recovery_harness as nova
import recovery_api_runtime as api_runtime

SIM = Path(__file__).resolve().parents[1]
CLIENT = None
BRIDGE = None
DIST = None
PY = None
ROOT = None
DB = None
OPTIONS = None
CLIENT_HASHES = {}
CLIENT_COMMIT = "adf51339db90f75ee078d51bc8fba36148414d89"
NOVA_COMMIT = "4055912c72a90e841b79cbc93852fe9cc807927a"


def utc(): return datetime.now(timezone.utc).isoformat()
def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text(encoding="utf-8"))
def write(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,sort_keys=True)+"\n",encoding="utf-8")
def emit(name,**values):
    with (ROOT/"driver-events.jsonl").open("a",encoding="utf-8") as f:
        f.write(json.dumps({"utc":utc(),"event":name,**values},sort_keys=True)+"\n")
def command(argv,label):
    r=subprocess.run(argv,cwd=SIM,capture_output=True,text=True,check=False)
    emit("command",label=label,argv=argv,returncode=r.returncode,stdout=r.stdout,stderr=r.stderr)
    return r
def capture(source,relative,rows):
    source=Path(source); target=ROOT/"pre-run-source"/relative
    if not source.is_file(): raise RuntimeError("pre-run source absent: "+str(source))
    target.parent.mkdir(parents=True,exist_ok=True)
    before=digest(source); shutil.copy2(source,target)
    if before!=digest(source) or before!=digest(target): raise RuntimeError("source changed while captured: "+str(source))
    rows.append({"source":str(source),"copy":str(target),"sha256":before,"bytes":target.stat().st_size})
def source_head(path, expected, label):
    safe_root = path if label == "client" else path.parents[1]
    result = command(["git", "-c", "safe.directory=" + str(safe_root), "-C", str(safe_root), "rev-parse", "HEAD"], label + "-head")
    if result.returncode or result.stdout.strip() != expected:
        raise RuntimeError(label + " source is not the reviewed merged commit")
    for extra in ([], ["--cached"]):
        scope = ["src/platform_bridge"] if label == "nova" else ["hr_client", "platform_common"]
        clean = command(["git", "-c", "safe.directory=" + str(safe_root), "-c", "core.autocrlf=true", "-C", str(safe_root), "diff", "--quiet", *extra, "--", *scope], label + "-clean")
        if clean.returncode:
            raise RuntimeError(label + " selected source has tracked edits")
    return expected


def wait_for_api(manifest_path, port, timeout_seconds=25.0):
    manifest = read(manifest_path)
    if int(manifest.get("port", -1)) != port:
        raise RuntimeError("owned API manifest port differs from selected port")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        proc = Path("/proc") / str(manifest["pid"])
        if not proc.exists():
            raise RuntimeError("owned API exited before readiness")
        try:
            stat = (proc / "stat").read_text(encoding="ascii")
            ticks = int(stat.rsplit(") ", 1)[1].split()[19])
            if ticks != int(manifest["start_time_ticks"]):
                raise RuntimeError("owned API PID identity changed")
            with urlopen("http://127.0.0.1:%d/api/admin/order-queue" % port, timeout=2.0) as response:
                if response.status == 200:
                    emit("api_ready", pid=manifest["pid"], start_time_ticks=ticks, port=port)
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError("owned API did not become ready")


def capture_inputs(rows):
    global CLIENT_HASHES
    source_head(CLIENT, CLIENT_COMMIT, "client")
    source_head(BRIDGE, NOVA_COMMIT, "nova")
    for source, prefix in ((SIM / "humanoid_harness", Path("sim/humanoid_harness")),
                           (SIM / "tools", Path("sim/tools")),
                           (SIM / "sim_ros", Path("sim/sim_ros")),
                           (CLIENT / "hr_client", Path("client/hr_client")),
                           (CLIENT / "platform_common", Path("client/platform_common")),
                           (BRIDGE / "platform_bridge", Path("nova/platform_bridge"))):
        if not source.is_dir():
            raise RuntimeError("selected source package absent: " + str(source))
        for path in sorted(source.rglob("*.py")):
            capture(path, prefix / path.relative_to(source), rows)
    for path in sorted((CLIENT / "hr_client/config").rglob("*")):
        if path.is_file():
            capture(path, Path("client/hr_client/config") / path.relative_to(CLIENT / "hr_client/config"), rows)
    for source, relative in ((SIM / "config/platform_bridge.sim.json", Path("sim/config/platform_bridge.sim.json")),
                             (BRIDGE / "config/platform_bridge.json", Path("nova/config/platform_bridge.json"))):
        capture(source, relative, rows)
    if not DIST.is_dir() or not (DIST / "main.js").is_file():
        raise RuntimeError("selected compiled API stage is missing")
    for path in sorted(DIST.rglob("*")):
        if path.is_file():
            capture(path, Path("compiled-api") / path.relative_to(DIST), rows)
    CLIENT_HASHES = {name: digest(CLIENT / "hr_client" / name) for name in
                     ("client.py", "pending_completion.py", "pending_failure.py", "settings.py")}
    write(ROOT / "pre-run-source-manifest.json",
          {"schema": 1, "captured_at_utc": utc(), "client_commit": CLIENT_COMMIT,
           "nova_commit": NOVA_COMMIT, "sim_commit": command(["git", "-c", "safe.directory=" + str(SIM), "-C", str(SIM), "rev-parse", "HEAD"], "sim-head").stdout.strip(),
           "client_source": str(CLIENT), "nova_source": str(BRIDGE), "sim_source": str(SIM),
           "compiled_api_source": str(DIST), "client_module_sha256": CLIENT_HASHES, "files": rows})
    emit("source_capture", files=len(rows), manifest_sha256=digest(ROOT / "pre-run-source-manifest.json"))


def probe_child_dependencies():
    env = dict(os.environ)
    env["PYTHONPATH"] = str(CLIENT) + ":" + str(SIM)
    probe = subprocess.run([str(PY), "-c", "import socketio; import hr_client.client; import humanoid_harness.integration"], cwd=SIM, env=env, capture_output=True, text=True, check=False)
    emit("human_import_probe", interpreter=str(PY), returncode=probe.returncode, stdout=probe.stdout, stderr=probe.stderr)
    if probe.returncode:
        raise RuntimeError("selected child Python cannot import the humanoid client dependencies")


def settings(rows):
    state=ROOT/"humanoid-state"; payload=read(CLIENT/"hr_client/config/hr_settings.json")
    payload["paths"]["poses"]=str(CLIENT/"hr_client/config/poses.json")
    payload["paths"]["locations"]=str(CLIENT/"hr_client/config/locations.json")
    payload["paths"]["pending_completions"]=str(state/"pending-completions.json")
    payload["paths"]["pending_failures"]=str(state/"pending-failures.json")
    payload["server"].update({"url":"http://127.0.0.1:%d" % OPTIONS.humanoid_port,"completion_readback_url":"http://127.0.0.1:%d" % OPTIONS.api_port,"device_id":"humanoid_robot"})
    payload["logging"]["file"]=str(state/"platform-client.log")
    human=ROOT/"hr-settings.json"; write(human,payload)
    args=argparse.Namespace(bridge_config_template=SIM/"config/platform_bridge.sim.json",proxy_port=OPTIONS.nova_port,completion_readback_url="http://127.0.0.1:%d" % OPTIONS.api_port,ros_setup=OPTIONS.ros_setup,overlay_setup=OPTIONS.overlay_setup,ros_domain_id=OPTIONS.ros_domain_id,ros_python=PY,completion_delay_seconds=15,bridge_source=BRIDGE,platform_client_source=CLIENT,api_url="http://127.0.0.1:%d" % OPTIONS.api_port)
    nova.make_bridge_config(args,ROOT/"nova-settings.json",ROOT/"nova-state/bridge-journal.json",ROOT/"nova-state/pending-completions.json")
    for p in (human,ROOT/"nova-settings.json"): capture(p,Path("generated")/p.name,rows)
    data=read(ROOT/"pre-run-source-manifest.json"); data["files"]=rows; data["generated_before_database"]=[str(human),str(ROOT/"nova-settings.json")]; write(ROOT/"pre-run-source-manifest.json",data)
    return human,args
def api(method,path,payload=None): return nova.request_json(method,"http://127.0.0.1:%d" % OPTIONS.api_port+path,payload)
def post_stop_human_state(snapshot):
    matches=[row for row in (snapshot.get("devices") or {}).get("devices",[]) if row.get("deviceId")=="humanoid_robot"]
    if len(matches)!=1 or matches[0].get("state") not in ("FREE","OFFLINE") or matches[0].get("currentTaskId") is not None:
        raise RuntimeError("normal-stop public humanoid state is neither FREE nor OFFLINE without a task")
    return matches[0]["state"]

def snapshot(name,order_id=None):
    x={"utc":utc(),"queue":api("GET","/api/admin/order-queue"),"inventory":api("GET","/api/inventory"),"devices":api("GET","/api/admin/devices")}
    if order_id: x["order"]=api("GET","/api/orders/"+order_id)
    write(ROOT/(name+".json"),x); return x
def pair(order,oid):
    session=(order.get("fulfillmentProgress") or {}).get("pickSession") or {}
    tasks=session.get("tasks") or []
    if order.get("id")!=oid or len(tasks)!=2 or [x.get("index") for x in tasks]!=[1,2] or [x.get("itemName") for x in tasks]!=["Butter Croissant","Moon Cake"]: return None
    sid=session.get("sessionId"); ids=[x.get("taskId") for x in tasks]
    if not isinstance(sid,str) or not sid or any(not isinstance(x,str) or not x for x in ids) or len(set(ids))!=2: return None
    return sid,ids
async def bootstrap(oid):
    events=[]; client=socketio.AsyncClient(reconnection=False,logger=False,engineio_logger=False)
    @client.on("platform.pick_session_created",namespace="/socket-bridge")
    async def created(payload): events.append({"utc":utc(),"direction":"received","event":"platform.pick_session_created","payload":payload})
    await client.connect("http://127.0.0.1:%d" % OPTIONS.api_port,namespaces=["/socket-bridge"],transports=["websocket"],wait_timeout=8)
    try:
        events.append({"utc":utc(),"direction":"sent","event":"hr.subscribe_tasks","payload":{}})
        ack=await client.call("hr.subscribe_tasks",{},namespace="/socket-bridge",timeout=8)
        events.append({"utc":utc(),"direction":"ack","event":"hr.subscribe_tasks","payload":ack})
        status={"devices":[{"deviceId":"humanoid_robot","state":"FREE","online":True,"currentTaskId":None,"message":"Fresh simulated front/idle/empty-hands/no-motion state"}]}
        events.append({"utc":utc(),"direction":"sent","event":"hr.status_reported","payload":status})
        ack=await client.call("hr.status_reported",status,namespace="/socket-bridge",timeout=8)
        events.append({"utc":utc(),"direction":"ack","event":"hr.status_reported","payload":ack})
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            order=api("GET","/api/orders/"+oid); value=pair(order,oid)
            if value and all(x.get("status")=="UNASSIGNED" for x in order["fulfillmentProgress"]["pickSession"]["tasks"]):
                write(ROOT/"bootstrap-order.json",order); return value
            await asyncio.sleep(0.2)
        raise RuntimeError("one public bootstrap did not expose two exact UNASSIGNED tasks")
    finally:
        await client.disconnect()
        write(ROOT/"bootstrap-socket-events.json",{"assumption":"fresh simulated humanoid front/idle/empty hands; Nova reports its own ROS readiness","allowed_sent_events":["hr.subscribe_tasks","hr.status_reported"],"events":events})
def parse_arguments(argv=None):
    parser = argparse.ArgumentParser(description="Run an isolated real-platform mixed Nova/humanoid acceptance case with simulated hardware.")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--case", choices=("mixed-positive", "nova-callback-boundary", "held-placement-restart"), required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--client-root", type=Path, required=True)
    parser.add_argument("--nova-root", type=Path, required=True, help="Nova repository root")
    parser.add_argument("--platform-stage", type=Path, required=True, help="Prepared compiled API stage; never canonical platform source")
    parser.add_argument("--seed-db", required=True)
    parser.add_argument("--database-name", required=True)
    parser.add_argument("--api-port", type=int, required=True)
    parser.add_argument("--humanoid-port", type=int, required=True)
    parser.add_argument("--nova-port", type=int, required=True)
    parser.add_argument("--ros-domain-id", required=True)
    parser.add_argument("--python", type=Path, default=Path("/home/user/.venvs/end-to-end-sim-ros/bin/python"))
    parser.add_argument("--ros-setup", type=Path, default=Path("/opt/ros/humble/setup.bash"))
    parser.add_argument("--overlay-setup", type=Path, default=Path("/home/user/e2e-stage/ros_ws/install/setup.bash"))
    args = parser.parse_args(argv)
    if not args.execute:
        parser.error("--execute is required because the case creates an isolated database and order")
    if not args.run_root.is_absolute() or args.run_root.exists():
        parser.error("--run-root must be absolute and new; preserve prior attempts")
    if not all(path.is_absolute() for path in (args.client_root, args.nova_root, args.platform_stage)):
        parser.error("all source roots must be absolute")
    if args.platform_stage.resolve() != api_runtime.STAGE_ROOT.resolve():
        parser.error("--platform-stage must match the prepared isolated API stage used by the owned API helper")
    if not args.seed_db or not args.seed_db.replace("_", "").isalnum():
        parser.error("--seed-db must be a simple explicit database name")
    if not args.database_name.startswith("taska_20260925_") or not args.database_name.replace("_", "").isalnum():
        parser.error("--database-name must be a unique taska_20260925_ name")
    if len({args.api_port, args.humanoid_port, args.nova_port}) != 3 or any(not 1 <= port <= 65535 for port in (args.api_port, args.humanoid_port, args.nova_port)):
        parser.error("three distinct valid loopback ports are required")
    if not args.ros_domain_id.isascii() or not args.ros_domain_id.isdecimal() or not 1 <= int(args.ros_domain_id) <= 232:
        parser.error("--ros-domain-id must be an isolated domain from 1 through 232")
    for name in ("python", "ros_setup", "overlay_setup"):
        if not getattr(args, name).is_file():
            parser.error("selected runtime file is missing: " + name)
    return args


def run_callback_case(api_manifest):
    case_root = ROOT / "nova-callback-case"
    args = argparse.Namespace(execute=True, source_profile="current-canonical", case="confirmed-before-callback",
        label="e2e-" + DB, api_url="http://127.0.0.1:%d" % OPTIONS.api_port, proxy_port=OPTIONS.nova_port,
        completion_readback_url="http://127.0.0.1:%d" % OPTIONS.api_port, ros_domain_id=OPTIONS.ros_domain_id,
        database_name=DB, api_manifest=api_manifest, runtime_dir=case_root,
        bridge_config_template=SIM / "config/platform_bridge.sim.json", bridge_source=BRIDGE,
        nova_source_manifest=None, platform_client_source=CLIENT, operator="e2e-acceptance",
        reason="Verified simulated callback replay", ros_python=PY, ros_setup=OPTIONS.ros_setup,
        overlay_setup=OPTIONS.overlay_setup, deadline_seconds=35.0, completion_delay_seconds=5.0,
        check_next_order=True)
    result_path = nova.run_case(args)
    outcome = read(result_path)
    events = nova.event_log_entries(case_root / "harness-events.jsonl")
    before = [row for row in events if row.get("event") == "test_boundary_observed"]
    after = [row for row in events if row.get("event") == "test_boundary_replayed"]
    reports = [row for row in nova.event_log_entries(case_root / "proxy-events.jsonl") if row.get("event") == "terminal_report_forwarded"]
    if len(before) != 1 or len(after) != 1 or len(reports) != 2:
        raise RuntimeError("callback boundary or exact two completion reports missing")
    before_time = before[0].get("timestamp")
    after_time = after[0].get("timestamp")
    if not isinstance(before_time, (int, float)) or not isinstance(after_time, (int, float)) or not before_time < after_time:
        raise RuntimeError("callback boundary timestamps are invalid")
    if len([row for row in reports if row.get("timestamp", 0) < before_time]) != 1 or any(before_time <= row.get("timestamp", 0) <= after_time for row in reports) or len([row for row in reports if row.get("timestamp", 0) > after_time]) != 1:
        raise RuntimeError("completion report was resent during callback-only replay")
    write(ROOT / "callback-only-replay-audit.json", {"boundary_observed_epoch_s": before_time, "callback_replayed_epoch_s": after_time, "total_completion_reports": 2, "reports_before_boundary": 1, "reports_during_replay": 0, "reports_for_follow_up": 1})
    write(ROOT / "result.json", {"status": "automated_acceptance_passed", "database": DB, "harness_result": outcome, "callback_only_replay_audit": read(ROOT / "callback-only-replay-audit.json")})


def main(argv=None):
    global CLIENT, BRIDGE, DIST, PY, ROOT, DB, OPTIONS
    OPTIONS = parse_arguments(argv)
    CLIENT = OPTIONS.client_root.resolve()
    BRIDGE = (OPTIONS.nova_root.resolve() / "src/platform_bridge")
    DIST = OPTIONS.platform_stage.resolve() / "services/api/dist"
    PY = OPTIONS.python.absolute()
    ROOT = OPTIONS.run_root.resolve()
    DB = OPTIONS.database_name
    ROOT.mkdir(parents=True)
    write(ROOT / "request.json", {"case": OPTIONS.case, "run_root": str(ROOT), "client_root": str(CLIENT),
          "nova_root": str(OPTIONS.nova_root.resolve()), "platform_stage": str(OPTIONS.platform_stage.resolve()),
          "seed_db": OPTIONS.seed_db, "database_name": DB, "api_port": OPTIONS.api_port,
          "humanoid_port": OPTIONS.humanoid_port, "nova_port": OPTIONS.nova_port,
          "ros_domain_id": OPTIONS.ros_domain_id, "python": str(PY), "started_utc": utc()})
    children=[]; rows=[]; api_started=False; error=None
    try:
        capture_inputs(rows); human_settings,args=settings(rows); probe_child_dependencies()
        for port in (OPTIONS.api_port,OPTIONS.humanoid_port,OPTIONS.nova_port):
            with socket.socket() as probe: probe.bind(("127.0.0.1",port))
        clone=command(["runuser","-u","postgres","--","createdb","-T",OPTIONS.seed_db,DB],"clone-db")
        if clone.returncode: raise RuntimeError("fresh database clone failed")
        api_root=ROOT/"api-owner"
        started=command([str(PY),str(SIM/"tools/recovery_api_runtime.py"),"start","ack","--database-name",DB,"--port",str(OPTIONS.api_port),"--runtime-root",str(api_root),"--execute"],"api-start")
        manifest=api_root/"api-ack.json"
        if started.returncode or not manifest.is_file(): raise RuntimeError("owned API start failed")
        api_started=True; wait_for_api(manifest, OPTIONS.api_port, 25.0)
        write(ROOT/"api-owner-manifest-before-orders.json",read(manifest))
        if OPTIONS.case == "nova-callback-boundary":
            run_callback_case(manifest)
            return 0
        if OPTIONS.case == "held-placement-restart":
            baseline = snapshot("baseline-api-snapshot")
            if not nova.queue_is_clean(baseline["queue"]):
                raise RuntimeError("fresh API queue not clean for held placement")
            context = SimpleNamespace(root=ROOT, sim_root=SIM, client_root=CLIENT, python=PY, database_name=DB,
                api_port=OPTIONS.api_port, humanoid_port=OPTIONS.humanoid_port, client_hashes=CLIENT_HASHES,
                settings_path=human_settings, api_request=api, snapshot=snapshot, emit=emit,
                managed_process=nova.ManagedProcess, children=children, baseline_snapshot=baseline)
            result = held.run_case(context)
            write(ROOT / "result.json", {"status": "automated_acceptance_passed", **result})
            return 0
        for name in ("nova-proxy","humanoid-proxy"): write(ROOT/(name+"-control.json"),{"sequence":1,"mode":"pass"})
        write(ROOT/"nova-provider-status-control.json",{"mode":"pass"})
        os.environ["PYTHONPATH"]=str(SIM)+":"+os.environ.get("PYTHONPATH","")
        provider=nova.provider_process(args,ROOT/"nova-provider.log",ROOT/"nova-provider-status-control.json")
        proxy_nova=nova.proxy_process(args,ROOT/"nova-proxy-control.json",ROOT/"nova-proxy-events.jsonl",ROOT/"nova-proxy.log")
        proxy_human=nova.ManagedProcess("humanoid-proxy",[str(PY),str(SIM/"tools/socketio_status_capture_proxy.py"),"--listen-port",str(OPTIONS.humanoid_port),"--upstream-port",str(OPTIONS.api_port),"--control-path",str(ROOT/"humanoid-proxy-control.json"),"--events-path",str(ROOT/"humanoid-proxy-events.jsonl")],SIM,ROOT/"humanoid-proxy.log",dict(os.environ))
        for child in (provider,proxy_nova,proxy_human): children.append(child); child.start()
        nova.wait_for_with_processes(lambda:next((x for x in nova.json_log_events(ROOT/"nova-provider.log") if x.get("event")=="ready"),None),time.monotonic()+20,"fake ROS provider",children)
        for path in (ROOT/"nova-proxy-events.jsonl",ROOT/"humanoid-proxy-events.jsonl"):
            nova.wait_for_with_processes(lambda:next((x for x in nova.event_log_entries(path) if x.get("event")=="listening"),None),time.monotonic()+20,"transparent proxy",children)
        baseline=snapshot("baseline-api-snapshot")
        if not nova.queue_is_clean(baseline["queue"]): raise RuntimeError("fresh API queue not clean")
        if (audit.seed(baseline) or {}).get("counter2_status")!="FREE" or audit.stock(baseline,"croissant")!=(6,6) or audit.stock(baseline,"croissant",2)!=(0,0) or audit.stock(baseline,"moon-cake")!=(8,8):
            raise RuntimeError("fresh A007 counter or exact routed rack slots differ from reviewed seed")
        order=api("POST","/api/orders",{"customerName":"Mixed Nova and humanoid integration","source":"customer_ui","paymentMethod":"alipay","items":[{"itemId":"croissant","quantity":1,"selectedOptions":{}},{"itemId":"moon-cake","quantity":1,"selectedOptions":{}}]})
        if not isinstance(order,dict) or not isinstance(order.get("id"),str): raise RuntimeError("single mixed order not created")
        write(ROOT/"created-order.json",order)
        sid,ids=asyncio.run(bootstrap(order["id"]))
        write(ROOT/"exact-two-task-bootstrap.json",{"order_id":order["id"],"session_id":sid,"task_ids":ids})
        snapshot("before-launch-api-snapshot",order["id"])
        bridge=nova.bridge_process(args,ROOT/"nova-settings.json",ROOT/"nova-bridge.log")
        env=dict(os.environ); env.update({"PYTHONPATH":str(CLIENT)+":"+str(SIM),"CELL_TRACE_VERBOSE":"1","PYTHONUNBUFFERED":"1"})
        human=nova.ManagedProcess("humanoid",[str(PY),"-u",str(SIM/"tools/humanoid_integration_trace_entrypoint.py"),"--client-source",str(CLIENT),"--settings",str(human_settings),"--state-root",str(ROOT/"humanoid-state"),"--url","http://127.0.0.1:%d" % OPTIONS.humanoid_port,"--readback-url","http://127.0.0.1:%d" % OPTIONS.api_port,"--device-id","humanoid_robot","--stop-after-seconds","35"],SIM,ROOT/"humanoid-launcher.log",env)
        for child in (bridge,human): children.append(child); child.start()
        loaded=nova.wait_for_with_processes(lambda:next((x for x in nova.json_log_events(ROOT/"nova-bridge.log") if x.get("event")=="test_source_identity"),None),time.monotonic()+25,"Nova loaded source",children)
        nova.require_loaded_source_identity(loaded,args); write(ROOT/"nova-loaded-source-identity.json",loaded)
        deadline=time.monotonic()+90; settled=None
        while time.monotonic()<deadline:
            snap=snapshot("latest-api-snapshot",order["id"])
            settled=audit.strict(ROOT,snap,baseline,order["id"],sid,ids,client_source=CLIENT,client_hashes=CLIENT_HASHES)
            if settled: write(ROOT/"settled-audit.json",settled); break
            for child in children:
                if child is not human and child.process.poll() is not None: raise RuntimeError(child.name+" exited before settlement")
            time.sleep(0.25)
        if not settled: raise RuntimeError("mixed exact platform/physical settlement timed out")
        final=snapshot("final-api-snapshot",order["id"])
        verified=audit.strict(ROOT,final,baseline,order["id"],sid,ids,client_source=CLIENT,client_hashes=CLIENT_HASHES)
        if verified!=settled: raise RuntimeError("final mixed proof differs from settlement")
        human.process.wait(timeout=45)
        if human.process.returncode!=0: raise RuntimeError("humanoid launcher did not stop normally")
        after_stop=snapshot("post-launcher-stop-api-snapshot",order["id"])
        if after_stop["order"].get("status")!="READY" or after_stop["order"].get("fulfillmentProgress")!=final["order"].get("fulfillmentProgress"):
            raise RuntimeError("order/task status changed after normal humanoid launcher stop")
        if any(audit.stock(after_stop,item)!=audit.stock(final,item) for item in ("croissant","moon-cake")):
            raise RuntimeError("platform stock changed after normal humanoid launcher stop")
        post_state=post_stop_human_state(after_stop)
        disconnects=[item for item in audit.trace(ROOT/"humanoid-launcher.log") if item.get("event")=="socket_disconnected" and isinstance(item.get("ts"),str) and item["ts"]>verified["chronology"]["humanoid_free_emit_utc"]]
        if len(disconnects)!=1: raise RuntimeError("normal launcher stop lacked one post-FREE socket disconnect")
        write(ROOT/"post-launcher-stop-public-state.json",{"humanoid_state":post_state,"humanoid_socket_disconnect_utc":disconnects[0]["ts"],"launcher_returncode":human.process.returncode})
        post_stop_verified=audit.strict(ROOT,after_stop,baseline,order["id"],sid,ids,client_source=CLIENT,client_hashes=CLIENT_HASHES,expected_devices={"nova5_arm":"FREE","humanoid_robot":post_state})
        if post_stop_verified!=verified:
            raise RuntimeError("post-stop durable, physical, or public mixed proof differs from settlement")
        write(ROOT/"post-launcher-stop-audit.json",post_stop_verified)
        write(ROOT/"result.json",{"status":"automated_acceptance_passed","database":DB,**verified})
        return 0
    except Exception as exc:
        error={"type":type(exc).__name__,"message":str(exc),"utc":utc()}
        write(ROOT/"driver-error.json",error); emit("driver_error",**error); return 1
    finally:
        cleanup_issues=[]
        for child in reversed(children):
            try: child.stop()
            except Exception as stop_error: cleanup_issues.append({"child":child.name,"error":str(stop_error)})
            if child.process is not None and child.process.poll() is None: cleanup_issues.append({"child":child.name,"error":"owned process remains active"})
        manifest=ROOT/"api-owner/api-ack.json"
        if manifest.is_file(): shutil.copy2(manifest,ROOT/"api-manifest-before-stop.json")
        api_log=ROOT/"api-owner/api-ack.log"
        if api_log.is_file(): shutil.copy2(api_log,ROOT/"api-log-before-stop.log")
        stopped=None
        if api_started: stopped=command([str(PY),str(SIM/"tools/recovery_api_runtime.py"),"stop","ack","--database-name",DB,"--port",str(OPTIONS.api_port),"--runtime-root",str(ROOT/"api-owner"),"--execute"],"api-stop")
        write(ROOT/"api-cleanup.json",{"utc":utc(),"stop_returncode":None if stopped is None else stopped.returncode,"database_retained":True})
        if rows:
            changed=[{"source":r["source"],"expected":r["sha256"],"source_after":digest(r["source"]) if Path(r["source"]).is_file() else None,"copy_after":digest(r["copy"]) if Path(r["copy"]).is_file() else None} for r in rows if not Path(r["source"]).is_file() or not Path(r["copy"]).is_file() or digest(r["source"])!=r["sha256"] or digest(r["copy"])!=r["sha256"]]
            write(ROOT/"post-run-source-check.json",{"checked_at_utc":utc(),"file_count":len(rows),"changed":changed})
        if api_started and (stopped is None or stopped.returncode!=0): cleanup_issues.append({"api":"owned stop did not succeed"})
        if rows and changed: cleanup_issues.append({"sources":"captured source or copy changed"})
        listening=[]
        for line in Path("/proc/net/tcp").read_text(encoding="ascii").splitlines()[1:]:
            parts=line.split()
            if parts[3]=="0A" and int(parts[1].split(":")[1],16) in (OPTIONS.api_port,OPTIONS.humanoid_port,OPTIONS.nova_port): listening.append(parts[1])
        if listening: cleanup_issues.append({"listeners":listening})
        write(ROOT/"cleanup-proof.json",{"utc":utc(),"issues":cleanup_issues,"owned_children":[{"name":child.name,"pid":None if child.process is None else child.process.pid,"returncode":None if child.process is None else child.process.poll(),"start_time_ticks":child.start_time_ticks} for child in children],"api_stop_returncode":None if stopped is None else stopped.returncode,"reserved_listeners":listening})
        emit("cleanup_complete",api_stop_returncode=None if stopped is None else stopped.returncode,had_error=error is not None,issues=cleanup_issues)
        if cleanup_issues: raise RuntimeError("mixed owned cleanup/source verification failed: "+str(cleanup_issues))
if __name__=="__main__": raise SystemExit(main())
