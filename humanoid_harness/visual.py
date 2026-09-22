"""Portable HTML replay of persisted world frames and controller events."""

import html
import json
from pathlib import Path


def write_visual(path: Path, config: dict, device: dict, controller: dict, events_path: Path) -> None:
    events = []
    with events_path.open("r", encoding="ascii") as stream:
        for line in stream:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and isinstance(item.get("world"), dict):
                events.append(item)
    if not events or events[-1]["world"] != device["world"]:
        events.append({"sequence": "snapshot", "event": "durable world readback", "phase": controller["phase"], "task_id": controller["active_task_id"], "world": device["world"]})

    def safe(value: object) -> str:
        return html.escape(str(value), quote=True)

    task_rows = []
    for task in config["tasks"]:
        status = controller["units"][task["task_id"]]["status"]
        task_rows.append(f"<tr><td>{safe(task['task_id'])}</td><td>{safe(task['rack'])} / {safe(task['level'])} / {safe(task['slot'])}</td><td>{task['counter']}</td><td>{safe(status)}</td></tr>")
    frames_json = json.dumps(events, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c")
    source = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Humanoid pastry loop</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#f5f7fb;color:#1e293b;margin:0;padding:2rem;line-height:1.4}main{max-width:1100px;margin:auto}section{background:#fff;border:1px solid #dbe2ee;border-radius:12px;padding:1.25rem;margin:1.25rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}.metric,.counter,.zone{border:1px solid #cbd5e1;border-radius:9px;padding:1rem;background:#f8fafc}.metric strong,.metric span,.counter strong,.counter span{display:block}.metric span{overflow-wrap:anywhere}.counter span{margin-top:.4rem}.map{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.zone{min-height:6rem}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e2e8f0;text-align:left;padding:.5rem;vertical-align:top}td:last-child{overflow-wrap:anywhere}button{padding:.5rem .8rem;margin-right:.35rem;border:1px solid #94a3b8;border-radius:6px;background:#fff;cursor:pointer}input[type=range]{width:min(100%,600px)}.muted{color:#475569}.event{font-weight:700}@media(max-width:650px){body{padding:1rem}.map{grid-template-columns:1fr}}</style>
<main><h1>Humanoid pastry loop</h1><p class="muted">Deterministic software simulation. Tags, poses and lift routes are named placeholders.</p>
<section><h2>Replay</h2><button id="prev" type="button">Previous</button><button id="next" type="button">Next</button><button id="play" type="button">Play</button><label for="frame">Frame <span id="frame-number"></span></label><br><input id="frame" type="range" min="0" value="0"><p class="event" id="event"></p><p class="muted" id="task"></p></section>
<section><h2>Robot and pastry</h2><div class="grid"><div class="metric"><strong>AMR location</strong><span id="location"></span></div><div class="metric"><strong>Posture phase</strong><span id="posture"></span></div><div class="metric"><strong>Held pastry</strong><span id="held"></span></div><div class="metric"><strong>Controller</strong><span id="phase"></span></div></div></section>
<section><h2>World</h2><div class="map"><div class="zone"><h3>Rack B</h3><p id="rack"></p></div><div class="zone"><h3>Placement area</h3><div class="grid"><div class="counter"><strong>Counter 1</strong><span id="counter-1"></span></div><div class="counter"><strong>Counter 2</strong><span id="counter-2"></span></div><div class="counter"><strong>Counter 3</strong><span id="counter-3"></span></div><div class="counter"><strong>Counter 4</strong><span id="counter-4"></span></div></div></div></div><p class="muted">Lost bun IDs: <span id="lost"></span></p></section>
<section><h2>Platform units at end of run</h2><table><thead><tr><th>Pastry task</th><th>Rack / level / slot</th><th>Counter</th><th>Status</th></tr></thead><tbody>%%TASKS%%</tbody></table></section>
<section><h2>Timeline</h2><table><thead><tr><th>#</th><th>Event</th><th>Task</th><th>AMR</th><th>Posture</th><th>Held bun</th></tr></thead><tbody id="timeline"></tbody></table></section></main>
<script id="frames-data" type="application/json">%%FRAMES%%</script><script>
const frames=JSON.parse(document.getElementById('frames-data').textContent);
const slider=document.getElementById('frame');slider.max=String(frames.length-1);slider.value=slider.max;
let timer=null;
function value(id,text){document.getElementById(id).textContent=String(text);}
function list(items){return items.length?items.join(', '):'empty';}
function render(index){const item=frames[index],w=item.world;slider.value=String(index);value('frame-number',`${index+1} / ${frames.length}`);value('event',`${item.sequence}: ${item.event}`);value('task',item.task_id||'No active task');value('phase',item.phase);value('location',w.location);value('posture',w.posture);value('held',w.held_bun_id||'none');value('rack',list(Object.entries(w.rack_bun_ids).filter(([,bun])=>bun).map(([task,bun])=>`${task}: ${bun}`)));for(let n=1;n<=4;n++)value(`counter-${n}`,list(w.counter_bun_ids[String(n)]));value('lost',list(w.lost));}
slider.addEventListener('input',()=>render(Number(slider.value)));
document.getElementById('prev').addEventListener('click',()=>render(Math.max(0,Number(slider.value)-1)));
document.getElementById('next').addEventListener('click',()=>render(Math.min(frames.length-1,Number(slider.value)+1)));
document.getElementById('play').addEventListener('click',()=>{if(timer){clearInterval(timer);timer=null;value('play','Play');return;}if(Number(slider.value)>=frames.length-1)render(0);timer=setInterval(()=>{const n=Number(slider.value)+1;if(n>=frames.length){clearInterval(timer);timer=null;value('play','Play');return;}render(n);},450);value('play','Pause');});
const body=document.getElementById('timeline');for(let i=0;i<frames.length;i++){const item=frames[i],row=document.createElement('tr');for(const part of [item.sequence,item.event,item.task_id||'',item.world.location,item.world.posture,item.world.held_bun_id||'']){const cell=document.createElement('td');cell.textContent=String(part);row.appendChild(cell);}row.addEventListener('click',()=>render(i));body.appendChild(row);}render(Number(slider.value));
</script></html>"""
    source = source.replace("%%TASKS%%", "".join(task_rows)).replace("%%FRAMES%%", frames_json)
    path.write_text(source, encoding="ascii")
