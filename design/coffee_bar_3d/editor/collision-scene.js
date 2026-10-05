import {makeCoffeeRequest} from './coffee-geometry.js';
import * as THREE from '../vendor/three.module.js';
import {setupSuctionJoints} from './suction-render.js';
import {gripAngles} from './bread-render.js';
import {makeBox,transformBox} from './collision-core.js';

export function collisionSettings(store) {
  const s=store.scene.collision_settings||{};
  return {worldRobots:Object.fromEntries(Object.entries(s.worldRobots||{}).filter(([,v])=>typeof v==='boolean')),enabled:s.enabled===true,robotPairs:s.robotPairs===true,show:s.show===true,search:s.search!==false,searchNodes:Math.max(100,Math.min(3000,Math.round(Number(s.searchNodes)||600))),margin:Math.max(-.02,Math.min(.05,Number(s.margin)||0))};
}
export function worldCollisionEnabled(settings,robotId) {
  return settings.enabled===true&&settings.worldRobots?.[robotId]!==false;
}
const boxBounds=geometry=>{
  if(!geometry.boundingBox)geometry.computeBoundingBox();
  return {center:geometry.boundingBox.getCenter(new THREE.Vector3()).toArray(),
    half:geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray()};
};
function solid(node,root) {
  for(let n=node;n;n=n.parent){if(!n.visible)return false;if(n===root)break;}
  const name=(node.userData.name||node.name).replaceAll('_',' ');
  if(node.userData.bread_ellipsoid||node.userData.equipment_top_label)return false;
  // Consumables participate in the illustrated process, not in the static world.
  if(/paper face|paper gusset|paper bottom|gusset fold|bag print|stored flat bag|stored bottom fold|nested (cup|lid)|label|sign$|imprint|grille perforation/i.test(name))return false;
  return node.isMesh&&node.geometry?.attributes.position;
}
function captureRig(view,object,width,payload) {
  const source=view.instances.get(object.id);
  if(!source)throw new Error('No loaded robot geometry for '+object.label);
  const node=new THREE.Group(),mesh=source.template.model.clone(true);
  node.matrix.copy(source.node.matrix);node.matrixAutoUpdate=false;node.add(mesh);
  const record={node,mesh};setupSuctionJoints(record);
  const key=view.store.key(object);
  let angles={open:0,closed:0};
  if(key==='nova5')angles=gripAngles(record,(width||.045)/(object.robot_scale||1));
  const jointRest=new Map(record.joints.map((j,i)=>[j.node,{rest:j.rest,joint:i}]));
  const gripRest=new Map((record.gripJoints||[]).map(j=>[j.node,j]));
  const nodes=[],boxes=[];let tcpNode;
  const visit=(part,parent,link='base_link')=>{
    const data=part.userData;
    link=data.urdf_link||link;
    const joint=jointRest.get(part),grip=gripRest.get(part);
    const matrix=part.matrixAutoUpdate?new THREE.Matrix4().compose(part.position,joint?.rest||grip?.rest||part.quaternion,part.scale):part.matrix;
    const index=nodes.length;
    if(part===record.tcp)tcpNode=index;
    nodes.push({parent,matrix:matrix.toArray(),...(joint?{joint:joint.joint}:{}),
      ...(grip?{grip:grip.multiplier,axis:grip.axis.toArray()}: {})});
    if(solid(part,node))boxes.push({node:index,bounds:boxBounds(part.geometry),link,part:data.name||part.name});
    for(const child of part.children)visit(child,index,link);
  };
  visit(node,-1);
  if(payload&&tcpNode!==undefined) {
    let rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2),bounds;
    if(payload.kind==='bread') {
      const basis=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
      rotation=basis.clone().multiply(new THREE.Quaternion(...payload.relative)).multiply(basis.clone().invert());
      bounds={center:[0,0,0],half:[payload.size[0]/2,payload.size[2]/2,payload.size[1]/2]};
    } else if(payload.kind==='bag')bounds={center:[0,payload.height/2-payload.contactHeight,-payload.depth/2],half:[payload.width/2,payload.height/2,payload.depth/2]};
    else bounds={center:[0,payload.height/2-payload.gripHeight,0],half:[payload.radius,payload.height/2,payload.radius]};
    // Payload dimensions are world metres; robot scale affects the TCP offset,
    // not the purchased cup/bag/bread size.
    const index=nodes.length,scale=1/(object.robot_scale||1);
    nodes.push({parent:tcpNode,matrix:new THREE.Matrix4().compose(new THREE.Vector3(),rotation,new THREE.Vector3(scale,scale,scale)).toArray()});
    boxes.push({node:index,bounds,payload:payload.kind,link:'Held '+payload.kind,part:'Held '+payload.kind});
  }
  return {nodes,boxes,gripAngles:angles,scale:object.robot_scale||1};
}
export function captureWorld(view) {
  if(!view.ready)throw new Error('Wait for the 3D models before checking collisions.');
  view.physical.updateMatrixWorld(true);
  const world=[];
  for(const object of view.store.scene.objects) {
    if(object.kind==='robot'||(object.kind==='zone'||(object.kind==='placement_zone'&&object.role!=='cup_rest'))||!view.store.visible(object.id))continue;
    const record=view.instances.get(object.id);
    if(!record)throw new Error('World geometry is missing for '+object.label);
    record.mesh.traverse(part=>{
      if(!solid(part,record.node))return;
      const bounds=boxBounds(part.geometry);
      // Text and zero-thickness display planes are non-structural.
      if(Math.min(...bounds.half)<1e-8)return;
      world.push(transformBox(bounds,part.matrixWorld,{objectId:object.id,label:object.label,part:part.userData.name||part.name,kind:object.kind}));
    });
  }
  const r=view.store.scene.room;
  world.push(makeBox([r.width/2,-50,-r.depth/2],[r.width/2+3,50,r.depth/2+3],undefined,{objectId:'floor',label:'Floor',part:'Floor surface'}));
  return world;
}
export function collisionRequest(view,robot,width,world,payload,settings=collisionSettings(view.store)) {
  if(!settings.enabled)return {enabled:false};
  return {...settings,robotId:robot.id,support:robot.support,mountingHeight:view.store.z(robot),
    rig:captureRig(view,robot,width,payload),payload,world:world||captureWorld(view)};
}
export function attachCollisions(view,request) {
  const settings=collisionSettings(view.store);
  request.pairCollision={enabled:!!request.bag&&settings.robotPairs};
  if(!settings.enabled&&!request.pairCollision.enabled){request.collision={enabled:false};return request;}
  const world=settings.enabled?captureWorld(view):[];
  const captureSettings={...settings,enabled:true};
  if(!request.bag&&worldCollisionEnabled(settings,request.robot.id)) {
    const definition={cup_offset:request.offsets.cup.map(v=>v/(request.robot.robot_scale||1)),stamp_offset:request.offsets.stamp.map(v=>v/(request.robot.robot_scale||1)),cup_inner_diameter:.085};
    request.collisionRoutes=[0,.02,.05,.10,.18].map(extra=>{
      const r=makeCoffeeRequest(view.store,definition,{...request.settings,clearance:request.settings.clearance+extra,collision_level_exit:true});
      return {knots:r.knots,events:r.events,duration:r.duration,settings:r.settings,label:'Level dispenser withdrawal; '+((request.settings.clearance+extra)*100).toFixed(0)+' cm approach clearance'};
    });
  }
  const payload=request.bag?{kind:'bag',...request.bag,fixtureId:request.fixture.id,magazineId:request.settings.magazine_id,tableId:request.zone.support}:
    {kind:'cup',radius:.045,height:request.settings.temperature==='cold'?.128:.123,gripHeight:request.cupSpec.gripHeight,
      restId:request.settings.stamp_rest_id,restFloor:request.park?.floor,tableId:view.store.object(request.settings.pickup_id)?.support};
  request.collision={...collisionRequest(view,request.robot,undefined,world,payload,captureSettings),enabled:worldCollisionEnabled(settings,request.robot.id)};
  if(request.breadTask) {
    const bread=request.breadTask,candidate=bread.candidates[0];
    const relative=new THREE.Quaternion(...candidate.toolQuaternion).invert().multiply(new THREE.Quaternion(...candidate.quaternion)).toArray();
    bread.collision={...collisionRequest(view,bread.robot,bread.graspWidth,world,
      {kind:'bread',size:bread.size,relative,shelfId:bread.shelfId},captureSettings),enabled:worldCollisionEnabled(settings,bread.robot.id)};
  }
  if(request.pairCollision.enabled) {
    const breadRobot=request.breadTask?.robot||view.store.object(request.settings.bread_robot_id);
    if(!breadRobot||view.store.key(breadRobot)!=='nova5'||!view.store.visible(breadRobot.id))throw new Error('Choose a visible bread Nova-5 for the Nova-to-Nova collision check.');
    const second=request.breadTask?.collision||collisionRequest(view,breadRobot,undefined,[],undefined,captureSettings);
    request.pairCollision={enabled:true,margin:settings.margin,first:{...request.collision,payload:{...payload,contentsSize:request.breadTask?[request.breadTask.size[0],request.breadTask.size[1],request.breadTask.size[2]]:[request.breadSize[0],request.breadSize[2],request.breadSize[1]]}},second,
      firstLabel:request.robot.label,secondLabel:breadRobot.label,
      stationaryBread:{q:Array.from({length:6},(_,i)=>(breadRobot.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180),grip:0}};
    // Match the stored gripper angle for a stationary bread robot.
    if(!request.breadTask) {
      const angles=second.rig.gripAngles,range=angles.closed-angles.open;
      request.pairCollision.stationaryBread.grip=range?((breadRobot.joints_deg?.gripper_r_joint1||0)*Math.PI/180-angles.open)/range:0;
    }
  }
  return request;
}
