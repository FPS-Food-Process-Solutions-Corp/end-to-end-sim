import {failureMarkup} from './flow-diagnostics.js';
import {searchMessage} from './motion-search.js';
import {COFFEE_ROBOT_KEYS} from './coffee-robots.js';
import {coffeeSettings} from './coffee-geometry.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function coffeeMarkup(store,request,result,message,diagnostic) {
  const s=coffeeSettings(store),canPlay=result?.pathOK&&!request?.errors.length;
  const select=(key,label,values)=>'<label class="flow-field">'+label+'<select data-coffee-setting="'+key+'">'+
    values.map(([value,text])=>'<option value="'+escape(value)+'" '+(s[key]===value?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';
  const component=(key,label,filter)=>{
    const values=store.scene.objects.filter(filter).map(o=>[o.id,o.label]);
    if(!values.some(([id])=>id===s[key]))values.unshift([s[key],'Choose an available component']);
    return select(key,label,values);
  };
  const number=(key,label,value,unit,factor=1)=>'<label class="flow-field">'+label+
    '<div class="flow-number"><input type="number" min=".1" step=".5" data-coffee-setting="'+key+
    '" data-factor="'+factor+'" value="'+Number((value*factor).toFixed(2))+'"><span>'+unit+'</span></div></label>';
  const f=result?.failure;
  const attempts=result?.routeSearch?.attempts||[];
  const alternatives=attempts.length>1?'<details class="flow-settings"><summary>'+attempts.length+' route alternatives checked</summary><p>Showing: '+escape(result.routeSearch.selected)+'. No layout objects were moved.</p><ol>'+attempts.map(a=>'<li><b>'+escape(a.label)+'</b><br>'+escape(a.ok?'Passed':a.phase+' · '+a.time.toFixed(2)+' s · '+(a.collision||(a.reason==='ik_not_converged'?'IK: '+(a.positionError*1000).toFixed(2)+' mm / '+(a.orientationError*180/Math.PI).toFixed(2)+'°':a.reason)))+(a.searchStatus?'<br>'+escape(searchMessage({status:a.searchStatus})):'' )+'</li>').join('')+'</ol></details>':'';
  return [
    '<div class="flow-heading"><span class="live-dot"></span>NOVA / BEVERAGES</div>',
    '<h2>Cup. Fill. Lid. Serve.</h2>',
    '<p class="flow-intro">A predefined demonstration. Machine signals below are simulated; no equipment is connected.</p>',
    select('drink','Drink',[['coffee','Coffee'],['milk_tea','Milk tea']]),
    select('temperature','Temperature',[['hot','Hot · paper cup + stamped lid'],['cold','Cold · plastic cup + applied lid']]),
    '<div class="field-grid">',
    select('sugar','Sugar',[['100%','100%'],['50%','50%'],['0%','No sugar']]),
    select('milk','Milk',[['regular','Regular'],['oat','Oat'],['none','No milk']]),'</div>',
    s.temperature==='cold'?select('ice','Ice',[['regular','Regular'],['light','Light'],['none','No ice']]):'',
    '<div class="flow-actions"><button class="primary" data-coffee-action="order">Place demo order</button><button data-coffee-action="frame">View coffee</button></div>',
    '<div id="coffee-status" class="flow-status '+(f?'failed':'')+'">'+escape(message)+'</div>',
    f?failureMarkup(f,'coffee'):'',
    f?.obstacleSearch?'<p class="flow-warning">'+escape(searchMessage(f.obstacleSearch))+'</p>':'',
    alternatives,
    diagnostic?'<p class="flow-hint">Diagnostic preview only · plays the accepted motion and stops before the failed step. The red marker is the rejected target. Full order playback remains blocked. Inspection duration: '+diagnostic.end.toFixed(2)+' s with the configured end-effector speed limit.</p><button id="coffee-partial-play" data-coffee-action="partial">▶ Preview to failure</button>':'',
    '<div class="flow-player"><div class="flow-actions"><button id="coffee-play" data-coffee-action="play" '+(canPlay?'':'disabled')+
      '>▶ Preview drink</button><button data-coffee-action="stop">Reset</button></div>',
    '<input id="coffee-scrub" aria-label="Coffee workflow timeline" type="range" min="0" max="'+(diagnostic?.end||result?.duration||request?.duration||1)+
      '" step=".02" value="0" '+(canPlay||diagnostic?'':'disabled')+'>',
    '<div class="flow-time"><span id="coffee-phase">Order preview</span><span id="coffee-time">0.0 s</span></div></div>',
    '<div class="coffee-signal" aria-live="polite"><b>Simulated machine signals</b><div id="coffee-signals">Waiting for the demo order.</div></div>',
    '<details class="flow-settings" open><summary>Sequence</summary><ol class="coffee-steps">',
    '<li>Paper or plastic cup dispenses into the prong.</li>',
    s.temperature==='cold'&&s.ice!=='none'?'<li>Dispense the selected amount of ice.</li>':'',
    '<li>Send drink preferences and fill the cup.</li><li>'+(s.temperature==='hot'?'Dispense the paper lid.':'Apply the plastic lid.')+'</li>',
    s.temperature==='hot'?'<li>Set the cup on the rest; turn and press with the opposite stamper.</li><li>Turn back and collect the sealed cup.</li>':'',
    '<li>Place the finished drink at the pickup marker.</li></ol></details>',
    '<details class="flow-settings"><summary>Service poses &amp; timing</summary>',
    '<label class="flow-field">Maximum end-effector speed<div class="flow-number"><input type="number" min=".01" step=".1" data-coffee-setting="max_tcp_speed" value="'+s.max_tcp_speed+'"><span>m/s</span></div></label>',
    '<p class="flow-hint">Caps linear speed at both the cup-prong centre and stamper contact. Fast stages take longer; dispensing and lid events follow the new timing.</p>',
    result?.searches?.some(s=>s.ok)?'<p class="flow-meta">Obstacle search found '+result.searches.filter(s=>s.ok).length+' transfer detour(s). Timing includes the longer route.</p>':'',
    result?.speed?'<p class="flow-meta">Checked speed bound: '+result.speed.boundAfter.toFixed(2)+' m/s · '+result.speed.nominalDuration.toFixed(1)+' → '+result.speed.duration.toFixed(1)+' s.</p>':'',
    number('service_fraction','Cup rim height on machine front',s.service_fraction,'%',100),
    number('clearance','Approach clearance',s.clearance,'cm',100),
    number('lift','Transfer lift',s.lift,'cm',100),
    number('beverage_seconds','Illustrative filling time',s.beverage_seconds,'s'),
    '<p class="flow-hint">Default: lower 25% of machines. The floor-standing HZ-D01 uses its modelled dispensing-bay target instead. Cups and paper lids dispense through the 30 cm underside gap. The legacy tea target uses the nearer front outlet.</p></details>',
    '<details class="flow-settings"><summary>Assign equipment</summary>',
    component('robot_id','Beverage robot',o=>COFFEE_ROBOT_KEYS.includes(store.key(o))),
    component('paper_cup_id','Paper cups',o=>o.kind==='dispenser'),
    component('plastic_cup_id','Plastic cups',o=>o.kind==='dispenser'),
    component('coffee_id','Coffee',o=>o.kind==='machine'),
    component('tea_id','Milk tea',o=>o.kind==='machine'),
    component('ice_id','Ice',o=>o.kind==='machine'),
    component('paper_lid_id','Paper lids',o=>o.kind==='dispenser'),
    component('plastic_lid_id','Plastic lid applicator',o=>o.kind==='machine'),
    component('stamp_rest_id','Stamping rest',o=>o.kind==='placement_zone'),
    component('pickup_id','Beverage pickup',o=>o.kind==='placement_zone'),'</details>',
    '<p class="flow-hint">Actual joint geometry for the selected beverage Nova, 85 mm prong and opposite cone stamper. Service-pose tolerance: 5 mm / 3°. Transfers use taught joint poses with upright wrist compensation; world collisions can be checked with the Collisions toggle. Robot-to-robot contacts, spills, forces and real cycle time are not validated.</p>',
    '<button class="flow-wide" data-coffee-action="report" '+(result?'':'disabled')+'>Export coffee sequence</button>',
  ].join('');
}
