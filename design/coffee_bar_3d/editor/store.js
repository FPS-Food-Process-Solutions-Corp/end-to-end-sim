import {migrateVentilationShaft} from './vent-layout.js';
import {migrateBagFixtures} from './bag-fixture-parameters.js';
import {migrateCoffeeWorkflow} from './coffee-migration.js';
import {migrateCustomerFrontage} from './customer-frontage.js';
import {migrateCustomerBarrier,barrierSettings} from './barrier-parameters.js';
import {migrateSuctionWorkflow} from './suction-migration.js';
import {captureComponents, insertComponents} from './component-copy.js';
import {migrateBagStation} from './bag-station.js';
import {shelfSettings,shelfLayout} from './shelf-parameters.js';
export const clone = value => JSON.parse(JSON.stringify(value));
export const rad = degrees => degrees*Math.PI/180;
export const rotate = (x,y,degrees) => [x*Math.cos(rad(degrees))-y*Math.sin(rad(degrees)),x*Math.sin(rad(degrees))+y*Math.cos(rad(degrees))];
export const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
export const cleanAngle = a => ((a+180)%360+360)%360-180;

export function corners(o) {
  return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>{const p=rotate(x*o.width,y*o.depth,o.yaw_deg||0);return [o.x+p[0],o.y+p[1]];});
}
export function bounds(objects) {
  const points=objects.flatMap(corners);
  if(!points.length)return {x:0,y:0,width:0,depth:0};
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return {x:(minX+maxX)/2,y:(minY+maxY)/2,width:maxX-minX,depth:maxY-minY};
}
export function closestPoint(point,o) {
  const [x,y]=rotate(point[0]-o.x,point[1]-o.y,-(o.yaw_deg||0));
  let qx=Math.max(-o.width/2,Math.min(o.width/2,x)),qy=Math.max(-o.depth/2,Math.min(o.depth/2,y));
  if(Math.abs(x)<o.width/2&&Math.abs(y)<o.depth/2){
    if(o.width/2-Math.abs(x)<o.depth/2-Math.abs(y))qx=(x<0?-1:1)*o.width/2;
    else qy=(y<0?-1:1)*o.depth/2;
  }
  const q=rotate(qx,qy,o.yaw_deg||0);return [o.x+q[0],o.y+q[1]];
}
// Machines face local -Y; the same convention drives their 2D and 3D models.
export function frontCenter(o){const p=rotate(0,-o.depth/2,o.yaw_deg||0);return [o.x+p[0],o.y+p[1]];}
function nearestOnSegment(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
  const t=Math.max(0,Math.min(1,den?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den:0));return [a[0]+t*dx,a[1]+t*dy];
}
function inside(p,o){const q=rotate(p[0]-o.x,p[1]-o.y,-(o.yaw_deg||0));return Math.abs(q[0])<=o.width/2+1e-9&&Math.abs(q[1])<=o.depth/2+1e-9;}
export function edgeGap(a,b){
  const ca=corners(a),cb=corners(b);let best={distance:Infinity,a:ca[0],b:cb[0]};
  for(const p of ca){if(inside(p,b))return {distance:0,a:p,b:p};for(let j=0;j<4;j++){const q=nearestOnSegment(p,cb[j],cb[(j+1)%4]);const d=distance(p,q);if(d<best.distance)best={distance:d,a:p,b:q};}}
  for(const p of cb){if(inside(p,a))return {distance:0,a:p,b:p};for(let j=0;j<4;j++){const q=nearestOnSegment(p,ca[j],ca[(j+1)%4]);const d=distance(p,q);if(d<best.distance)best={distance:d,a:q,b:p};}}
  // Crossed edges can overlap even when all four corners lie outside.
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){
    const p=ca[i],q=ca[(i+1)%4],r=cb[j],s=cb[(j+1)%4],ux=q[0]-p[0],uy=q[1]-p[1],vx=s[0]-r[0],vy=s[1]-r[1],den=ux*vy-uy*vx;
    if(Math.abs(den)<1e-12)continue;
    const t=((r[0]-p[0])*vy-(r[1]-p[1])*vx)/den,v=((r[0]-p[0])*uy-(r[1]-p[1])*ux)/den;
    if(t>=0&&t<=1&&v>=0&&v<=1){const at=[p[0]+t*ux,p[1]+t*uy];return {distance:0,a:at,b:at};}
  }
  return best;
}

export class SceneStore {
  constructor(seed){
    this.seed=clone(seed);migrateCoffeeWorkflow(this.seed);migrateVentilationShaft(this.seed);migrateBagFixtures(this.seed,true);this.scene=clone(this.seed);this.selected=['nova5'];this.undoStack=[];this.redoStack=[];this.listeners=new Set();this.gesture=null;
    this.options={units:'cm',showAllDistances:false,showAllReach:false,distanceMode:'center',snap:true,view:'split',showLabels:true,planNames:'always',resizeMode:'opposite',resizeAnchorX:'left',resizeAnchorY:'top',resizeKeepChildren:true};
    this.lastAction='Ready';
  }
  on(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(type='change'){for(const fn of this.listeners)fn(type);}
  object(id){return this.scene.objects.find(o=>o.id===id);}
  group(id){return (this.scene.groups||[]).find(g=>g.id===id);}
  item(id){return this.object(id)||this.group(id);}
  isGroup(id){return !!this.group(id);}
  children(id){return [...(this.scene.groups||[]),...this.scene.objects].filter(o=>(o.parentId||null)===(id||null));}
  descendants(id){const out=[];const visit=k=>{for(const child of this.children(k)){out.push(child.id);if(this.isGroup(child.id))visit(child.id);}};visit(id);return out;}
  resolve(ids=this.selected,followers=false){
    const keys=new Set();for(const id of ids){if(this.isGroup(id))this.descendants(id).forEach(k=>{if(this.object(k))keys.add(k);});else if(this.object(id))keys.add(id);}
    if(followers){let added=true;while(added){added=false;for(const o of this.scene.objects)if(o.support&&keys.has(o.support)&&!keys.has(o.id)){keys.add(o.id);added=true;}}}
    return this.scene.objects.filter(o=>keys.has(o.id));
  }
  selectionBounds(){return bounds(this.resolve());}
  visible(id){
    const item=this.item(id);if(!item)return false;
    const seen=new Set();let o=item;
    while(o){if(o.visible===false||o.enabled===false)return false;if(seen.has(o.id))return false;seen.add(o.id);o=this.item(o.parentId);}
    if(item.support)return this.visible(item.support);
    return true;
  }
  locked(id){let o=this.item(id),seen=new Set();while(o){if(o.locked)return true;if(seen.has(o.id))return true;seen.add(o.id);o=this.item(o.parentId);}return false;}
  z(o){if(!o)return 0;if(o.kind==='window')return o.bottom||0;const support=this.object(o.support);return (support?(this.z(support)+(support.height||0)):0)+(o.z||0);}
  select(id,add=false){if(!id)this.selected=[];else if(add)this.selected=this.selected.includes(id)?this.selected.filter(k=>k!==id):[...this.selected,id];else this.selected=[id];this.emit('selection');}
  selectAll(){this.selected=this.scene.objects.filter(o=>this.visible(o.id)&&!this.locked(o.id)).map(o=>o.id);this.emit('selection');}
  snapshot(){return {scene:clone(this.scene),selected:[...this.selected]};}
  restore(s){this.scene=clone(s.scene);this.selected=s.selected.filter(id=>this.item(id));}
  transact(label,fn){const old=this.snapshot();fn();if(JSON.stringify(old.scene)!==JSON.stringify(this.scene)){this.undoStack.push(old);if(this.undoStack.length>70)this.undoStack.shift();this.redoStack=[];this.lastAction=label;}this.emit();}
  begin(){this.gesture=this.snapshot();}
  preview(fn){if(!this.gesture)this.begin();this.restore(this.gesture);fn();this.emit('preview');}
  commit(label='Layout updated'){if(!this.gesture)return;const old=this.gesture;this.gesture=null;if(JSON.stringify(old.scene)!==JSON.stringify(this.scene)){this.undoStack.push(old);this.redoStack=[];this.lastAction=label;}this.emit();}
  cancel(){if(this.gesture){this.restore(this.gesture);this.gesture=null;this.emit();}}
  undo(){if(!this.undoStack.length)return;this.redoStack.push(this.snapshot());this.restore(this.undoStack.pop());this.lastAction='Undo';this.emit();}
  redo(){if(!this.redoStack.length)return;this.undoStack.push(this.snapshot());this.restore(this.redoStack.pop());this.lastAction='Redo';this.emit();}
  setOption(key,value){this.options[key]=value;this.emit('option');}
  move(ids,dx,dy){for(const o of this.resolve(ids,true)){if(this.locked(o.id))continue;o.x+=dx;o.y+=dy;}}
  rotateSelection(ids,degrees,pivot=null){const items=this.resolve(ids,true);const centre=pivot||bounds(this.resolve(ids));for(const o of items){if(this.locked(o.id))continue;const p=rotate(o.x-centre.x,o.y-centre.y,degrees);o.x=centre.x+p[0];o.y=centre.y+p[1];o.yaw_deg=cleanAngle((o.yaw_deg||0)+degrees);}}
  resize(id,width,depth){
    const o=this.object(id);if(!o||this.locked(id))return;
    width=Math.max(.02,width);depth=Math.max(.02,depth);
    if(o.kind==='robot'){const factor=width/o.width;o.width=width;o.depth*=factor;o.robot_scale=(o.robot_scale||1)*factor;return;}
    if(o.kind==='dispenser'){depth=width;o.diameter=width;}
    const sx=width/o.width,sy=depth/o.depth;
    for(const child of this.resolve([id],true))if(child.id!==id){const p=rotate(child.x-o.x,child.y-o.y,-(o.yaw_deg||0));const q=rotate(p[0]*sx,p[1]*sy,o.yaw_deg||0);child.x=o.x+q[0];child.y=o.y+q[1];}
    o.width=width;o.depth=depth;
  }
  resizeGroup(ids,sx,sy){
    const bb=bounds(this.resolve(ids));
    for(const o of this.resolve(ids,true)){if(this.locked(o.id))continue;o.x=bb.x+(o.x-bb.x)*sx;o.y=bb.y+(o.y-bb.y)*sy;
      if(o.kind==='robot'){const f=Math.min(sx,sy);o.width*=f;o.depth*=f;o.robot_scale=(o.robot_scale||1)*f;}
      else if(o.kind==='dispenser'){const f=Math.min(sx,sy);o.width*=f;o.depth*=f;o.diameter=o.width;}
      else {o.width*=sx;o.depth*=sy;}
    }
  }
  patch(id,values){
    const o=this.item(id);if(!o||this.locked(id))return;
    if('x' in values||'y' in values){this.move([id],('x' in values?values.x:o.x)-o.x,('y' in values?values.y:o.y)-o.y);}
    if('yaw_deg' in values)this.rotateSelection([id],values.yaw_deg-(o.yaw_deg||0),{x:o.x,y:o.y});
    if('width' in values||'depth' in values)this.resize(id,values.width??o.width,values.depth??o.depth);
    for(const [key,value] of Object.entries(values))if(!['x','y','width','depth','yaw_deg'].includes(key))o[key]=value;
  }
  toggleVisibility(id){this.transact('Visibility updated',()=>{const o=this.item(id);if(o)o.visible=o.visible===false;});}
  toggleLock(id){this.transact('Lock updated',()=>{const o=this.item(id);if(o)o.locked=!o.locked;});}
  removeSelected(){this.transact('Deleted selection',()=>{const ids=new Set(this.resolve(this.selected,true).filter(o=>!this.locked(o.id)).map(o=>o.id));const gids=new Set(this.selected.filter(id=>this.isGroup(id)&&!this.locked(id)));for(const id of [...gids])this.descendants(id).filter(k=>this.isGroup(k)).forEach(k=>gids.add(k));this.scene.objects=this.scene.objects.filter(o=>!ids.has(o.id));this.scene.groups=this.scene.groups.filter(g=>!gids.has(g.id));for(const o of this.scene.objects)if(o.distanceTargets)o.distanceTargets=o.distanceTargets.filter(k=>!ids.has(k));this.selected=[];});}
  unique(prefix){let i=1;while(this.item(prefix+'_'+i))i++;return prefix+'_'+i;}
  duplicate() {
    const packet = captureComponents(this);
    if (packet) insertComponents(this, packet, {label: 'Duplicated selection'});
  }
  supportAt(x,y){return this.scene.objects.filter(o=>['table','counter','cart','support'].includes(o.kind)&&this.visible(o.id)&&inside([x,y],o)).sort((a,b)=>a.width*a.depth-b.width*b.depth)[0];}
  addRobot(key,x,y){
    this.transact('Added '+this.scene.robot_inventory[key].name,()=>{
      const inv=this.scene.robot_inventory[key];const id=this.unique(key);let support=this.supportAt(x,y);let parentId=support?.parentId;
      const source=this.seed.objects.find(o=>o.model_key===key||o.id===key);
      const packages={nova2:['nova2','nova2_robot.urdf'],nova5:['nova5','nova5_lebai_tongs.urdf'],nova5_suction:['nova5','nova5_lebai_tongs.urdf'],nova5_coffee:['nova5','nova5_lebai_tongs.urdf'],atom_w:['atom_w','atom_w_p3.urdf'],me6:['magician_e6','me6_robot.urdf'],mg400:['mg400','mg400_description.urdf']};
      const o={...(source?clone(source):{}),id,label:inv.name,kind:'robot',model_key:key,asset_key:key,x,y,width:inv.base_width_cm/100,depth:inv.base_depth_cm/100,robot_scale:1,yaw_deg:key==='nova5'?180:0,package:packages[key][0],urdf:packages[key][1],support:key==='atom_w'?null:support?.id||null,z:0,visible:true,locked:false,parentId:parentId||'area_added',distanceTargets:[]};
      delete o.layout_component;
      delete o.station_offset;
      if(key==='me6')o.joints_deg={joint1:0,joint2:40,joint3:-69,joint4:0,joint5:29,joint6:0};
      if(!o.joints_deg)o.joints_deg=key==='me6'?{joint1:0,joint2:40,joint3:-69,joint4:0,joint5:29,joint6:0}:{};
      if(!this.group('area_added'))this.scene.groups.push({id:'area_added',label:'Added equipment'});
      if(key==='nova5'){
        const gid=this.unique('nova5_cell');this.scene.groups.push({id:gid,label:'Nova-5 + cart',parentId:'area_added'});
        const cid=this.unique('nova5_cart');this.scene.objects.push({id:cid,kind:'cart',label:'Nova-5 cart',asset_key:'nova5_cart',x:x-.135,y:y-.295,width:.6,depth:.8,height:.8,top_thickness:.035,yaw_deg:0,parentId:gid,visible:true});
        o.parentId=gid;o.support=cid;
      }
      this.scene.objects.push(o);o.distanceTargets=this.nearestTargets(o,3).map(t=>t.id);this.selected=[id];
    });return this.selected[0];
  }
  shelfSettings(o){return shelfSettings(this.scene,o);}
  shelfLayout(o){return shelfLayout(this.scene,o);}
  key(o){return o.model_key||o.id;}
  reach(o){const def=this.scene.robot_inventory[this.key(o)];if(!def)return null;const s=o.robot_scale||1,off=def.torso_axis_offset_cm||[0,0],p=rotate(off[0]/100*s,off[1]/100*s,o.yaw_deg||0);return {center:[o.x+p[0],o.y+p[1]],effective:(def.working_radius_cm+def.tool_length_cm)/100*s,placement:def.working_radius_cm/100*this.scene.reach_ratio*s};}
  relevantRobots(all=false){const selected=new Set(this.resolve().map(o=>o.id));return this.scene.objects.filter(o=>o.kind==='robot'&&this.visible(o.id)&&(all||selected.has(o.id)));}
  nearestTargets(robot,n=3){const centre=this.reach(robot)?.center||[robot.x,robot.y];return this.scene.objects.filter(o=>['shelf','machine','charger','table','counter','dispenser'].includes(o.kind)&&o.id!==robot.support&&this.visible(o.id)).sort((a,b)=>distance(centre,closestPoint(centre,a))-distance(centre,closestPoint(centre,b))).slice(0,n);}
  distances(){
    const result=[];
    for(const robot of this.relevantRobots(this.options.showAllDistances)){
      const centre=this.reach(robot).center;
      const targets=(robot.distanceTargets?.length?robot.distanceTargets.map(id=>this.object(id)):this.nearestTargets(robot)).filter(o=>o&&this.visible(o.id));
      for(const target of targets){
        const front=['machine','dispenser'].includes(target.kind),end=front?frontCenter(target):closestPoint(centre,target);
        const midHeight=target.kind==='dispenser'?((target.bottom_clearance??.3)+(target.height||0))/2:(target.height||0)/2;
        const z=front?this.z(target)+midHeight:Math.max(this.z(robot),this.z(target))+.025;
        const common={robot:robot.id,target:target.id,label:target.label,z,targetMode:front?'front-center':'nearest-edge'};
        if(this.options.distanceMode!=='edge')result.push({...common,a:centre,b:end,distance:distance(centre,end),type:'center'});
        if(this.options.distanceMode!=='center'){
          const support=this.object(robot.support),body=support?.kind==='cart'?support:robot;
          const start=front?(inside(end,body)?end:closestPoint(end,body)):null;
          const gap=front?{a:start,b:end,distance:distance(start,end)}:edgeGap(body,target);
          result.push({...common,...gap,type:'edge'});
        }
      }
    }return result;
  }
  format(m,suffix=true){const value=m*(this.options.units==='px'?200:100);return value.toFixed(1).replace(/\.0$/,'')+(suffix?' '+this.options.units:'');}
  exportScene(){const c=clone(this.scene);c.editor_options=clone(this.options);for(const o of c.objects){o.enabled=this.visible(o.id);if(o.kind==='shelf')o.shelf_overrides=this.shelfSettings(o);if(o.kind==='customer_barrier')o.barrier=barrierSettings(o);}return c;}
  importScene(value){
    if(!value||!Array.isArray(value.objects)||!value.room)throw new Error('Expected an exported scene with objects and room dimensions.');
    if(value.objects.length>1000)throw new Error('This editor supports up to 1,000 scene objects.');
    const allowed=new Set(['table','counter','cart','shelf','robot','machine','dispenser','human','charger','zone','support','box_station','window','placement_zone','customer_barrier','vent']);
    const ids=new Set();for(const o of [...(value.groups||[]),...value.objects]){if(typeof o.id!=='string'||ids.has(o.id))throw new Error('Layer IDs must be unique.');ids.add(o.id);}
    for(const o of value.objects){if(!allowed.has(o.kind))throw new Error('Unsupported object kind: '+o.kind);for(const k of ['x','y','width','depth'])if(!Number.isFinite(o[k]))throw new Error('Invalid '+k+' for '+o.id);if(o.width<=0||o.depth<=0)throw new Error('Dimensions must be positive.');if(o.yaw_deg!==undefined&&!Number.isFinite(o.yaw_deg))throw new Error('Invalid rotation.');}
    const entries=new Map([...(value.groups||[]),...value.objects].map(o=>[o.id,o]));
    for(const o of entries.values())for(const field of ['parentId','support']){let p=o,visited=new Set();while(p){if(visited.has(p.id))throw new Error('Layer/support cycle detected.');visited.add(p.id);p=entries.get(p[field]);}}
    this.transact('Imported scene',()=>{this.scene={...clone(this.seed),...clone(value),vent_layout_revision:value.vent_layout_revision||0,editor_revision:value.editor_revision||0,coffee_flow_revision:value.coffee_flow_revision||0,coffee_workflow:clone(value.coffee_workflow||{}),groups:clone(value.groups||this.seed.groups)};for(const o of this.scene.objects){delete o.enabled;}
      if((value.editor_revision||0)<3){
        const nova=this.object('nova2');
        if(nova)nova.distanceTargets=[...new Set([...(nova.distanceTargets||[]),...['lid_machine','lid_dispenser','cup_dispenser'].filter(id=>this.object(id))])];
      }
      if((value.editor_revision||0)<4){
        const source=this.seed.objects.find(o=>o.id==='bag_opener'),support=this.object('middle_counter');
        if(source&&support&&!this.object(source.id)){
          const added=clone(source);added.x=support.x;added.y=support.y;added.yaw_deg=(support.yaw_deg||0)-90;this.scene.objects.push(added);
          for(const id of ['nova5','atom_w']){const robot=this.object(id);if(robot)robot.distanceTargets=[...new Set([...(robot.distanceTargets||[]),'bag_opener'])];}
        }
      }
      if((value.editor_revision||0)<5)migrateBagStation(this.scene,this.seed);
      migrateSuctionWorkflow(this.scene,this.seed);
      migrateCustomerBarrier(this.scene);
      migrateCustomerFrontage(this.scene);
      migrateCoffeeWorkflow(this.scene);
      migrateVentilationShaft(this.scene);
      migrateBagFixtures(this.scene);
      this.scene.editor_revision=8;
      if(value.editor_options)this.options={...this.options,...value.editor_options};this.selected=[];});
  }
  reset(){this.transact('Reset to source layout',()=>{this.scene=clone(this.seed);this.selected=['nova5'];});}
}
