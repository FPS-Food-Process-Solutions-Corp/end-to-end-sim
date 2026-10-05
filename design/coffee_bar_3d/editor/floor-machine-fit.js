import {corners} from './store.js';
import {FLOOR_TEA_KEY, FLOOR_TEA_SPEC} from './floor-tea-machine.js';
const escape = value => String(value).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function overlaps(a, b) {
  for (const polygon of [a, b]) for (let i=0;i<4;i++) {
    const p=polygon[i],q=polygon[(i+1)%4],axis=[q[1]-p[1],p[0]-q[0]];
    const project=points=>points.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    const pa=project(a),pb=project(b);
    if(Math.max(...pa)<=Math.min(...pb)+1e-8||Math.max(...pb)<=Math.min(...pa)+1e-8)return false;
  }
  return true;
}

export function floorMachineAssessment(store, machine) {
  const footprint=corners(machine), bottom=store.z(machine);
  const outside=footprint.some(([x,y])=>x<0||y<0||x>store.scene.room.width||y>store.scene.room.depth);
  const conflicts=store.scene.objects.filter(other=>{
    if(other.id===machine.id||!store.visible(other.id)||['zone','placement_zone','customer_barrier','window'].includes(other.kind))return false;
    if(other.support)return false; // Report the supporting furniture once.
    const low=store.z(other),height=other.height||(other.kind==='robot'?1.8:.01);
    return low<bottom+machine.height&&low+height>bottom&&overlaps(footprint,corners(other));
  });
  return {outside,conflicts,area:machine.width*machine.depth};
}

export function floorTeaProperties(object, store) {
  if(object.asset_key!==FLOOR_TEA_KEY)return '';
  const fit=floorMachineAssessment(store,object);
  const issues=[...(fit.outside?['Extends outside the room']:[]),
    ...fit.conflicts.map(o=>'Overlaps '+o.label)];
  const mounted=!!object.support;
  return '<section class="property-section"><h3>Floor-standing tea machine</h3>'+
    '<div class="distance-row"><span>Floor footprint</span><b>'+fit.area.toFixed(2)+' m²</b></div>'+
    '<div class="distance-row"><span>Cup rim target</span><b>'+store.format(store.z(object)+object.height*(object.service_point?.z??FLOOR_TEA_SPEC.service_point.z))+' above floor</b></div>'+
    '<p data-floor-machine-fit class="'+(issues.length||mounted?'flow-warning':'hint')+'">'+
    (mounted?'This model is intended for the floor. Set Mount / support to Floor.<br>':'')+
    (issues.length?issues.map(escape).join('<br>'):'No overlap with visible floor-object footprints.')+'</p>'+
    '<p class="hint">Reference: 60 × 70 × 152 cm; lower cabinet 90 cm, upper unit 62 cm. Leave space at the front for opening the cabinet. This footprint check excludes panels and robot-arm reach; validate the assigned milk-tea route in Coffee &amp; drinks.</p>'+
    '<p class="hint">The outlet and internal details are estimated from the reference photo. Width, depth and height scale the model and its cup-rim target together.</p></section>';
}
