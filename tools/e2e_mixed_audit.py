"""Strict saved-evidence gate for one mixed Nova and humanoid order."""
import json
import hashlib
import re
from datetime import datetime
from pathlib import Path

def read(path): return json.loads(Path(path).read_text(encoding="utf-8"))
def trace(path):
    if not Path(path).is_file(): return []
    rows=[]
    for line in Path(path).read_text(encoding="utf-8",errors="replace").splitlines():
        start=line.find("{")
        if start>=0:
            try: rows.append(json.loads(line[start:]))
            except json.JSONDecodeError: pass
    return rows
def stock(snapshot,item,slot=1):
    rack="rack_a" if item=="croissant" else "rack_b"
    rows=[r for r in snapshot["inventory"]["snacks"]["items"] if r.get("itemId")==item and (r.get("rackArea") or {}).get("rackId")==rack and (r.get("rackArea") or {}).get("level")==1 and (r.get("rackArea") or {}).get("slot")==slot]
    if len(rows)!=1: raise RuntimeError("public stock row ambiguous: "+item+" slot "+str(slot))
    return rows[0]["databaseQuantity"],rows[0]["availableQuantity"]
def seed(snapshot):
    queue=snapshot["queue"]
    counter=[x for x in queue["counters"] if x.get("counterArea")==1]
    ready=[x for x in queue["ready"] if (x.get("order") or {}).get("orderNumber")=="A007"]
    free=[x for x in queue["counters"] if x.get("counterArea")==2]
    if len(counter)!=1 or len(ready)!=1 or len(free)!=1 or counter[0].get("status")!="READY" or counter[0].get("order",{}).get("orderNumber")!="A007": return None
    if ready[0].get("counterArea")!=1 or (ready[0].get("order") or {}).get("status")!="READY": return None
    return {"order":ready[0]["order"],"pickSession":ready[0].get("pickSession"),"counter1":{"counterArea":1,"status":counter[0]["status"],"orderNumber":counter[0]["order"]["orderNumber"]},"counter2_status":free[0].get("status")}
def exact_record(path,oid,sid,tid):
    if not path.is_file(): return None
    rows=[r for r in read(path).get("records",[]) if r.get("identity",{}).get("order_id")==oid and r["identity"].get("session_id")==sid and r["identity"].get("task_id")==tid]
    if len(rows)>1: raise RuntimeError("duplicate durable completion identity")
    return rows[0] if rows else None
def platform_evidence(value,oid,sid,tid,item):
    if not isinstance(value,dict): return False
    if value.get("orderId")==oid and value.get("pickSessionId")==sid:
        return value.get("eventType") in ("platform.pick_session_updated","platform.pick_session_completed") and value.get("completedPickTasks") in (1,2) and value.get("pickedFrom",{}).get("itemId")==item
    if value.get("id")==oid:
        session=(value.get("fulfillmentProgress") or {}).get("pickSession") or {}
        return session.get("sessionId")==sid and any(t.get("taskId")==tid and t.get("status")=="COMPLETED" for t in session.get("tasks",[]))
    return False
def owner_and_physical(root,oid,sid,tid,counter,record):
    state=root/"humanoid-state"; units=state/"units"
    if not units.is_dir(): return None
    all_units=[p for p in units.iterdir() if p.is_dir()]
    selected=[p for p in all_units if (p/"controller.json").is_file() and read(p/"controller.json").get("assignment",{}).get("task_id")==tid]
    if len(all_units)!=1 or len(selected)!=1: return None
    required=[selected[0]/"controller.json",selected[0]/"device.json",state/"device-owner.json",state/"device-readiness.json"]
    if any(not path.is_file() for path in required): return None
    controller=read(selected[0]/"controller.json"); device=read(selected[0]/"device.json")
    owner=read(state/"device-owner.json"); ready=read(state/"device-readiness.json")
    expected={"order_id":oid,"session_id":sid,"task_id":tid,"counter":counter}
    proof=controller.get("physical_proof") or {}
    if controller.get("phase")!="done" or controller.get("assignment")!=expected or proof.get("assignment")!=expected or record.get("terminal_evidence")!=proof: return None
    if proof.get("placement_verified") is not True or proof.get("empty_hand_verified") is not True or proof.get("target_counter")!=counter or proof.get("target")!="SIM_COUNTER_2" or proof.get("place_status")!="COMPLETED" or proof.get("source")!={"item_id":"moon-cake","rack_id":"rack_b","level":1,"slot":1}: return None
    if not proof.get("config_fingerprint") or proof.get("config_fingerprint")!=controller.get("config_fingerprint") or proof.get("provenance")!="humanoid_harness.StubDevice/1": return None
    unit_state=controller.get("units") or {}
    if set(unit_state)!={tid} or unit_state[tid].get("status")!="complete" or unit_state[tid].get("pick_attempt")!=1 or unit_state[tid].get("post_place_retract_attempts")!=1 or unit_state[tid].get("failure_retract_attempts")!=0 or unit_state[tid].get("navigation_attempts")!={"navigate_pick":1,"navigate_place":1}: return None
    kinds=("navigate_pick","lift_pick","pre_pick","pick","retract","navigate_place","lift_place","pre_place","place","post_place_retract")
    executions=device.get("executions") or {}
    if len(executions)!=len(kinds): return None
    by_kind={}
    for key,value in executions.items():
        kind=value.get("kind")
        if kind not in kinds or kind in by_kind or value.get("execution_id")!=key or value.get("task_id")!=tid or value.get("status")!="COMPLETED" or value.get("effect_applied") is not True or value.get("generation")!=1 or value.get("occurrence")!=1 or value.get("outcome")!="success": return None
        by_kind[kind]=value
    if set(by_kind)!=set(kinds): return None
    targets={"navigate_pick":"SIM_TAG_B_1_1","lift_pick":"SIM_LIFT_ROUTE_PICK","pre_pick":"SIM_POSE_PRE_PICK","pick":"SIM_POLICY_RACK_B","retract":"SIM_POSE_TRAVEL","navigate_place":"SIM_TAG_PLACEMENT","lift_place":"SIM_LIFT_ROUTE_PLACE","pre_place":"SIM_POSE_PRE_PLACE","place":"SIM_COUNTER_2","post_place_retract":"SIM_POSE_TRAVEL"}
    if any(by_kind[kind].get("target")!=target or not by_kind[kind]["execution_id"].endswith("/c0/"+kind+"/a1") for kind,target in targets.items()): return None
    action_ids={kind:by_kind[kind]["execution_id"] for kind in kinds}
    events=[json.loads(line) for line in (selected[0]/"events.jsonl").read_text(encoding="utf-8").splitlines()]
    action_events=[e for e in events if e.get("event") in ("intent_persisted","execution_terminal")]
    if len(action_events)!=2*len(kinds): return None
    for index,kind in enumerate(kinds):
        intent,terminal=action_events[2*index:2*index+2]
        if intent.get("event")!="intent_persisted" or terminal.get("event")!="execution_terminal": return None
        if any(e.get("execution_id")!=action_ids[kind] or e.get("phase")!=kind or e.get("task_id")!=tid for e in (intent,terminal)): return None
        if terminal.get("status")!="COMPLETED" or terminal.get("reason")!="": return None
        if intent.get("sequence",0)>=terminal.get("sequence",0): return None
    if action_ids["place"]!=proof.get("place_execution_id") or proof.get("bun_id")!=tid+"/bun-c0" or proof.get("cycle")!=0: return None
    release=controller.get("post_place_readiness_proof") or {}
    observation=release.get("readiness_observation") or {}
    if release.get("assignment")!=expected or release.get("physical_place_execution_id")!=action_ids["place"] or release.get("recovery_execution_id")!=action_ids["post_place_retract"] or release.get("recovery_status")!="COMPLETED" or release.get("recovery_target")!="SIM_POSE_TRAVEL" or release.get("recovery_generation")!=1: return None
    if release.get("config_fingerprint")!=controller.get("config_fingerprint") or release.get("provenance")!="humanoid_harness.StubDevice/1": return None
    if observation.get("task_id")!=tid or observation.get("counter")!=counter or observation.get("recovery_execution_id")!=action_ids["post_place_retract"] or observation.get("motion_quiescent") is not True or observation.get("navigation_safe") is not True or observation.get("placement_verified") is not True or observation.get("held_task_id") is not None or observation.get("posture")!="SIM_POSE_TRAVEL" or observation.get("location")!="SIM_TAG_PLACEMENT" or not isinstance(observation.get("observation_version"),int) or observation["observation_version"]<=0: return None
    placement_readback=(device.get("placement_observations") or {}).get(tid+":1") or {}
    release_readback=(device.get("release_readiness_observations") or {}).get(tid+":1")
    if set(device.get("placement_observations") or {})!={tid+":1"} or set(device.get("release_readiness_observations") or {})!={tid+":1"} or device.get("confirmed_losses")!={}: return None
    placement_observation=proof.get("observation") or {}
    if placement_observation!={"task_id":tid,"held_task_id":None,"location":"SIM_TAG_PLACEMENT","posture":"SIM_POSE_PLACE_DONE","version":1}: return None
    if any(placement_readback.get(key)!=value for key,value in placement_observation.items()) or release_readback!=observation: return None
    if release.get("readiness_scope")!="at_unit_release" or release.get("recovery_generation")!=1 or observation.get("cycle")!=0: return None
    release_hash=hashlib.sha256(json.dumps(release,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")).hexdigest()
    world=device.get("world") or {}; key=str(counter)
    if world.get("counter_bun_ids",{}).get(key)!=[proof.get("bun_id")] or world.get("counters",{}).get(key)!=[tid] or world.get("held_bun_id") is not None or world.get("held_task_id") is not None or world.get("posture")!="SIM_POSE_TRAVEL" or world.get("location")!=observation.get("location") or world.get("lost")!=[]: return None
    if owner.get("status")!="idle" or owner.get("identity") is not None or owner.get("readiness_version")!=ready.get("version") or owner.get("recovery_hold") is not None: return None
    if not isinstance(ready.get("version"),int) or ready["version"]<=1: return None
    if ready.get("status")!="ready" or ready.get("proof_kind")!="post_place_retract" or ready.get("identity")!=expected or ready.get("source")!=proof["source"] or ready.get("proof_action_id")!=action_ids["post_place_retract"] or ready.get("proof_sha256")!=release_hash: return None
    if ready.get("config_fingerprint")!=proof.get("config_fingerprint") or ready.get("action_generation")!=release.get("recovery_generation") or ready.get("observation_version")!=observation.get("observation_version") or ready.get("location")!=observation.get("location") or ready.get("posture")!=observation.get("posture") or ready.get("held_task_id") is not None or ready.get("held_bun_id") is not None or ready.get("provenance")!=release.get("provenance"): return None
    return {"place_execution_id":action_ids["place"],"pick_execution_id":action_ids["pick"],"post_place_retract_execution_id":action_ids["post_place_retract"],"bun_id":proof["bun_id"],"readiness_version":ready["version"],"readiness_proof_sha256":release_hash,"action_ids":action_ids,"physical_proof":proof,"post_place_readiness_proof":release}
def provider_start_metrics(events):
    attempts=[x for x in events if x.get("event") in ("start","replay","start_refused")]
    accepted=[x for x in attempts if x.get("event")=="start" and isinstance(x.get("execution_id"),str)]
    return attempts,accepted

def mixed_chronology(root,oid,sid,ids,execution):
    def seconds(value):
        if not isinstance(value,str): return None
        try: return datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()
        except ValueError: return None
    human=trace(root/"humanoid-launcher.log")
    confirmed=[x for x in human if x.get("event")=="completion_acknowledged" and x.get("session_id")==sid and x.get("task_id")==ids[1] and isinstance(x.get("ack"),dict) and x["ack"].get("orderId")==oid]
    unavailable=[x for x in human if x.get("event")=="socket_call_ack" and x.get("event_name")=="hr.pick_next_pick_task" and isinstance(x.get("ack"),dict) and x["ack"].get("eventType")=="platform.pick_task_unavailable" and x["ack"].get("reason")=="NO_TASK_FOR_DEVICE" and x["ack"].get("pickSessionId")==sid and x["ack"].get("deviceId")=="humanoid_robot" and (x.get("payload") or {}).get("pickSessionId")==sid]
    readback=[x for x in human if x.get("event")=="peer_session_completed_readback" and x.get("order_id")==oid and x.get("session_id")==sid and x.get("task_id")==ids[1]]
    free=[x for x in human if x.get("event")=="status_emit_send" and any(d.get("deviceId")=="humanoid_robot" and d.get("state")=="FREE" and d.get("currentTaskId") is None for d in (x.get("payload") or {}).get("devices",[]))]
    terminals=[]
    for line in (root/"nova-provider.log").read_text(encoding="utf-8",errors="replace").splitlines():
        if '"event":"terminal"' not in line or execution not in line: continue
        match=re.search(r"\[(\d+\.\d+)\]",line)
        if match: terminals.append(float(match.group(1)))
    if len(confirmed)!=len(unavailable)!=len(readback): return None
    if len(confirmed)!=1 or len(unavailable)!=1 or len(readback)!=1 or len(terminals)!=1: return None
    readback_time=seconds(readback[0].get("ts"))
    free_after=[x for x in free if readback_time is not None and (seconds(x.get("ts")) or 0)>readback_time]
    if not free_after: return None
    first_free=min(free_after,key=lambda x: seconds(x.get("ts")))
    times=[seconds(confirmed[0].get("ts")),seconds(unavailable[0].get("ts")),terminals[0],readback_time,seconds(first_free.get("ts"))]
    if any(t is None for t in times) or not all(a<b for a,b in zip(times,times[1:])): return None
    connects=[x for x in human if x.get("event")=="socket_connected" and seconds(x.get("ts")) is not None and seconds(x["ts"])<=times[4]]
    if len(connects)!=1 or seconds(connects[0]["ts"])>=times[0]: return None
    if any(x.get("event")=="socket_disconnected" and seconds(x.get("ts")) is not None and seconds(connects[0]["ts"])<seconds(x["ts"])<times[4] for x in human): return None
    if any(x.get("event")=="status_emit_send" and (seconds(x.get("ts")) or 0)>times[1] and (seconds(x.get("ts")) or 0)<times[3] and any(d.get("deviceId")=="humanoid_robot" and d.get("state")=="FREE" for d in (x.get("payload") or {}).get("devices",[])) for x in human): return None
    return {"human_socket_connected_utc":connects[0]["ts"],"human_reconnects_before_free":0,"human_completion_ack_utc":confirmed[0]["ts"],"no_task_for_device_ack_utc":unavailable[0]["ts"],"nova_terminal_epoch_s":terminals[0],"exact_session_readback_utc":readback[0]["ts"],"humanoid_free_emit_utc":first_free["ts"],"nova_execution_id":execution}
CLIENT_MODULE_FILES=("client.py","pending_completion.py","pending_failure.py","settings.py")
def selected_client_identity(imported,client_source,client_hashes):
    source=Path(client_source).resolve()
    if not source.is_dir() or not isinstance(client_hashes,dict) or set(client_hashes)!=set(CLIENT_MODULE_FILES): return False
    if imported.get("client_source")!=str(source) or imported.get("device_id")!="humanoid_robot" or imported.get("client_pin_scheme")!="sha256-crlf-to-lf-v1": return False
    loaded=imported.get("loaded_sources")
    pinned=imported.get("pinned_sources")
    if not isinstance(loaded,dict) or not isinstance(pinned,dict): return False
    root=source/"hr_client"
    for filename in CLIENT_MODULE_FILES:
        candidate=root/filename
        path=candidate.resolve()
        if path.parent!=root or not candidate.is_file(): return False
        content=candidate.read_bytes()
        raw=hashlib.sha256(content).hexdigest()
        normalized=hashlib.sha256(content.replace(b"\r\n",b"\n")).hexdigest()
        if client_hashes[filename]!=raw: return False
        module="hr_client."+filename[:-3]
        for item in (loaded.get(module),pinned.get(filename)):
            if not isinstance(item,dict) or item.get("path")!=str(path) or item.get("sha256")!=raw or item.get("normalized_sha256")!=normalized: return False
        if filename=="client.py" and (imported.get("loaded_client_file")!=str(path) or imported.get("loaded_client_sha256")!=raw or imported.get("loaded_client_normalized_sha256")!=normalized): return False
    return True

def strict(root,snapshot,baseline,oid,sid,ids,*,client_source,client_hashes,expected_devices=None):
    root=Path(root); order=snapshot.get("order") or {}
    session=(order.get("fulfillmentProgress") or {}).get("pickSession") or {}
    tasks=session.get("tasks") or []
    if order.get("id")!=oid or order.get("status")!="READY" or session.get("sessionId")!=sid or session.get("status")!="COMPLETED": return None
    if len(tasks)!=2 or [x.get("taskId") for x in tasks]!=ids or [x.get("status") for x in tasks]!=["COMPLETED","COMPLETED"]: return None
    counter=order.get("counterArea")
    if counter!=2: return None
    base_seed=seed(baseline); final_seed=seed(snapshot)
    if base_seed is None or base_seed["counter2_status"]!="FREE" or final_seed is None or final_seed["order"]!=base_seed["order"] or final_seed["pickSession"]!=base_seed["pickSession"]: return None
    if stock(baseline,"croissant",2)!=(0,0) or stock(snapshot,"croissant",2)!=(0,0): return None
    for item,before,after in (("croissant",(6,6),(5,5)),("moon-cake",(8,8),(7,7))):
        if stock(baseline,item)!=before or stock(snapshot,item)!=after: return None
    for filename,device,rack,task in (("nova-bridge.log","nova5_arm","rack_a",ids[0]),("humanoid-launcher.log","humanoid_robot","rack_b",ids[1])):
        received=[x["payload"] for x in trace(root/filename) if x.get("event")=="assignment_received" and isinstance(x.get("payload"),dict)]
        if not received: return None
        if any(x.get("deviceId")!=device or x.get("pickSessionId")!=sid or x.get("orderId")!=oid or x.get("pickTaskId")!=task or (x.get("item") or {}).get("rackArea",{}).get("rackId")!=rack or (x.get("item") or {}).get("rackArea",{}).get("level")!=1 or (x.get("item") or {}).get("rackArea",{}).get("slot")!=1 for x in received):
            raise RuntimeError("cross-rack or wrong-identity task assignment in "+filename)
    provider_log=root/"nova-provider.log"
    attempts,starts=provider_start_metrics(trace(provider_log))
    if len(attempts)!=1 or len(starts)!=1 or len({x["execution_id"] for x in starts})!=1: return None
    journal=root/"nova-state/bridge-journal.json"
    if not journal.is_file(): return None
    entries=[x for x in read(journal).values() if isinstance(x,dict) and x.get("order_id")==oid]
    if len(entries)!=1: return None
    entry=entries[0]; execution=entry.get("execution_id")
    identity={"order_id":oid,"session_id":sid,"task_id":ids[0],"execution_id":execution}
    if starts[0]["execution_id"]!=execution or entry.get("terminal_state")!="COMPLETED" or entry.get("completion_outbox",{}).get("identity")!=identity or entry.get("completion_outbox",{}).get("state")!="confirmed" or (entry.get("platform_confirmation") or {}).get("identity")!=identity: return None
    nova_record=exact_record(root/"nova-state/pending-completions.json",oid,sid,ids[0])
    human_record=exact_record(root/"humanoid-state/pending-completions.json",oid,sid,ids[1])
    if not nova_record or not human_record: return None
    if nova_record.get("identity")!=identity or nova_record.get("state")!="confirmed" or nova_record.get("callback_acknowledged") is not True: return None
    if human_record.get("identity",{}).get("execution_id")!=human_record.get("terminal_evidence",{}).get("place_execution_id") or human_record.get("state")!="confirmed" or human_record.get("callback_acknowledged") is not False: return None
    if not platform_evidence(nova_record.get("platform_evidence"),oid,sid,ids[0],"croissant") or not platform_evidence(human_record.get("platform_evidence"),oid,sid,ids[1],"moon-cake"): return None
    if entry["platform_confirmation"].get("platform_evidence")!=nova_record.get("platform_evidence"): return None
    manifest_path=root/"humanoid-state/integration-manifest.json"
    if not manifest_path.is_file(): return None
    imported=read(manifest_path)
    if not selected_client_identity(imported,client_source,client_hashes): return None
    physical=owner_and_physical(root,oid,sid,ids[1],counter,human_record)
    if not physical: return None
    devices=snapshot["devices"]["devices"]
    for device,state in (expected_devices or {"nova5_arm":"FREE","humanoid_robot":"FREE"}).items():
        hits=[x for x in devices if x.get("deviceId")==device]
        if len(hits)!=1 or hits[0].get("state")!=state: return None
    chronology=mixed_chronology(root,oid,sid,ids,execution)
    if chronology is None: return None
    return {"chronology":chronology,"order_id":oid,"session_id":sid,"task_ids":ids,"counter":counter,"nova_execution_id":execution,"nova_start_count":len(starts),"nova_callback_acknowledged":True,"humanoid_completion_callback":"not configured; callback_acknowledged false is N/A","croissant_stock":{"before":stock(baseline,"croissant"),"after":stock(snapshot,"croissant")},"moon_cake_stock":{"before":stock(baseline,"moon-cake"),"after":stock(snapshot,"moon-cake")},"humanoid":physical}
