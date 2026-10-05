import {Matrix4, Vector3, Quaternion} from '../vendor/three.module.js';

// All collision geometry uses Three's X/right, Y/up, Z/front convention, in metres.
const axes = [[1,0,0],[0,1,0],[0,0,1]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function makeBox(center, half, basis=axes, metadata={}) {
  const radius=axes.map((_,i)=>basis.reduce((sum,a,j)=>sum+Math.abs(a[i])*half[j],0));
  return {...metadata,center,half,axes:basis,min:center.map((v,i)=>v-radius[i]),max:center.map((v,i)=>v+radius[i])};
}
export function transformBox(bounds,matrix,metadata={}) {
  const columns=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(matrix,i));
  const x=columns[0].clone().normalize();
  const y=columns[1].clone().addScaledVector(x,-columns[1].dot(x)).normalize();
  const z=new Vector3().crossVectors(x,y).normalize();
  const basis=[x,y,z];
  const centre=new Vector3(...bounds.center).applyMatrix4(matrix).toArray();
  // Project the transformed parallelepiped, also enclosing any non-uniform-scale shear.
  const half=basis.map(a=>columns.reduce((s,c,i)=>s+Math.abs(a.dot(c))*bounds.half[i],0));
  return makeBox(centre,half,basis.map(a=>a.toArray()),metadata);
}
export function boxesOverlap(a,b,padding=0) {
  if(a.min.some((v,i)=>v>b.max[i]+padding||a.max[i]+padding<b.min[i]))return false;
  const delta=sub(b.center,a.center);
  for(const axis of [...a.axes,...b.axes,...a.axes.flatMap(x=>b.axes.map(y=>cross(x,y)))]) {
    const length=Math.hypot(...axis);
    if(length<1e-9)continue;
    const extent=a.axes.reduce((s,x,i)=>s+Math.abs(dot(x,axis))*a.half[i],0)+
      b.axes.reduce((s,x,i)=>s+Math.abs(dot(x,axis))*b.half[i],0);
    // Mere contact is permitted; the margin requests additional separation.
    if(Math.abs(dot(delta,axis))>=extent+padding*length-1e-7)return false;
  }
  return true;
}
export class WorldCollisionChecker {
  constructor(data) {
    this.data=data;this.enabled=!!data?.enabled;
    if(!this.enabled)return;
    if(!data.rig?.nodes?.length||!data.rig.boxes?.length)throw new Error('Collision geometry for this Nova is not ready. Reload the models and check again.');
    this.world=data.world;
    this.rig=data.rig;
    this.rest=this.rig.nodes.map(n=>new Matrix4().fromArray(n.matrix));
    this.margin=Math.max(-.02,Math.min(.05,Number(data.margin)||0));
    // Conservative distance from each joint axis to every corner of each proxy.
    this.levers=this.rig.boxes.map(box=>{
      let radius=Math.hypot(...box.bounds.center)+Math.hypot(...box.bounds.half);
      const lever=Array(7).fill(0);
      for(let i=box.node;i>=0;i=this.rig.nodes[i].parent) {
        const n=this.rig.nodes[i],m=this.rest[i],scale=new Vector3().setFromMatrixScale(m);
        radius*=Math.max(scale.x,scale.y,scale.z);
        if(n.joint!==undefined)lever[n.joint]+=radius;
        if(n.grip!==undefined)lever[6]+=radius*Math.abs(n.grip);
        if(n.parent>=0)radius+=new Vector3().setFromMatrixPosition(m).length();
      }
      return lever.map(v=>v*this.rig.scale);
    });
  }
  setPayloadRotation(relative) {
    if(!this.enabled||!relative)return;
    const box=this.rig.boxes.find(b=>b.payload==='bread');if(!box)return;
    const basis=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
    const rotation=basis.clone().multiply(new Quaternion(...relative)).multiply(basis.clone().invert());
    this.rest[box.node].compose(new Vector3(),rotation,new Vector3().setScalar(1/this.rig.scale));
  }
  shapes(q,grip=0,state={}) {
    const angle=this.rig.gripAngles.open+(this.rig.gripAngles.closed-this.rig.gripAngles.open)*grip;
    const matrices=this.rig.nodes.map((node,i)=>{
      const m=this.rest[i].clone();
      if(node.joint!==undefined)m.multiply(new Matrix4().makeRotationY(q[node.joint]));
      if(node.grip!==undefined)m.multiply(new Matrix4().makeRotationAxis(new Vector3(...node.axis),angle*node.grip));
      return m;
    });
    for(let i=0;i<matrices.length;i++)if(this.rig.nodes[i].parent>=0)
      matrices[i].premultiply(matrices[this.rig.nodes[i].parent]);
    return this.rig.boxes.flatMap((b,sourceIndex)=>{
      if(b.payload&&!(b.payload==='cup'?state.collisionCup==='held':b.payload==='bag'?state.bagState==='carried':state.breadState==='held'))return [];
      let bounds=b.bounds;
      if(b.payload==='bag'){const depth=state.bagDepth??this.data.payload.depth;bounds={center:[bounds.center[0],bounds.center[1],-depth/2],half:[bounds.half[0],bounds.half[1],depth/2]};}
      return [transformBox(bounds,matrices[b.node],{part:b.part,link:b.link,payload:b.payload,robotId:this.data.robotId,sourceIndex})];
    });
  }
  contactAllowed(robot,world) {
    // Only the fixed base may rest on its mounting surface. Arm/tool links still
    // collide with the supporting table, its legs, shelf, sides and underside.
    return robot.link==='base_link' &&
      (world.objectId===this.data.support||(!this.data.support&&world.objectId==='floor')) &&
      robot.min[1]>=this.data.mountingHeight-.001 &&
      world.max[1]<=this.data.mountingHeight+.001;
  }
  hit(shapes,padding=[],state={}) {
    for(let i=0;i<shapes.length;i++)for(const world of this.world) {
      if(this.contactAllowed(shapes[i],world))continue;
      let margin=this.margin;
      const payload=shapes[i].payload,p=this.data.payload;
      if(payload) {
        // Contact tolerance is scoped to the payload and named receiving surface,
        // never to an entire shelf/table or the robot's arm.
        const tray=payload==='bread'&&world.objectId===p.shelfId&&/Continuous solid stainless tier base/.test(world.part);
        const bagContact=payload==='bag'&&world.objectId===p.fixtureId&&
          (/Bag bottom support/.test(world.part)||(/Fixed rear suction cup/.test(world.part)&&(state.fixedVacuum||/Present to opposing|Confirm opposing|Pull the bag|Wait for bun|Release fixed/.test(state.phase||''))));
        const tabletop=world.objectId===p.tableId&&/Solid stainless worktop/.test(world.part);
        const cupRest=payload==='cup'&&world.objectId===p.restId&&shapes[i].min[1]>=p.restFloor-.001;
        if(cupRest&&/Cup rest rim/.test(world.part))continue;
        if(tray||bagContact||tabletop||cupRest)margin=Math.min(margin,-.0015);
      }
      if(boxesOverlap(shapes[i],world,margin+(padding[i]||0)))
        return {robot:shapes[i],world,margin:this.margin,sweepPadding:padding[i]||0};
    }
    return null;
  }
  pose(q,grip=0,state={}) {return this.enabled?this.hit(this.shapes(q,grip,state),[],state):null;}
  travelBounds(a,b) {
    const gripRange=Math.abs(this.rig.gripAngles.closed-this.rig.gripAngles.open);
    const delta=[...b.q.map((v,i)=>Math.abs(v-a.q[i])),Math.abs((b.grip||0)-(a.grip||0))*gripRange];
    return this.levers.map((l,i)=>l.reduce((s,v,j)=>s+v*delta[j],0)+(this.rig.boxes[i].payload==='bag'?Math.abs((b.bagDepth||0)-(a.bagDepth||0)):0));
  }
  interval(a,b) {
    if(!this.enabled)return null;
    if(!a){const collision=this.pose(b.q,b.grip||0,b);return collision?{collision,fraction:1,q:b.q,grip:b.grip||0}:null;}
    const travel=this.travelBounds(a,b);
    const sample=f=>({q:a.q.map((v,i)=>v+(b.q[i]-v)*f),grip:(a.grip||0)+((b.grip||0)-(a.grip||0))*f});
    const walk=(lo,hi,depth)=>{
      const mid=(lo+hi)/2,s=sample(mid),state={...a,bagDepth:(a.bagDepth||0)+((b.bagDepth||0)-(a.bagDepth||0))*mid};
      const shapes=this.shapes(s.q,s.grip,state);
      const padding=travel.map(d=>d*(hi-lo)/2);
      const collision=this.hit(shapes,padding,state);
      if(!collision)return null;
      if(depth>=16||Math.max(...padding)<.00025) {
        const exact=this.hit(shapes,[],state);
        return {...s,fraction:mid,collision:{...(exact||collision),conservative:!exact,uncertainty:Math.max(...padding)}};
      }
      return walk(lo,mid,depth+1)||walk(mid,hi,depth+1);
    };
    const crossing=walk(0,1,0);if(crossing)return crossing;
    const end=this.pose(b.q,b.grip||0,b);
    return end?{q:b.q,grip:b.grip||0,fraction:1,collision:end}:null;
  }
  failure(arm,previous,frame) {
    const hit=this.interval(previous,frame);if(!hit)return null;
    const fk=arm.forward(hit.q),time=previous?previous.time+(frame.time-previous.time)*hit.fraction:frame.time;
    return {reason:'world_collision',phase:frame.phase,time,robotId:this.data.robotId,q:hit.q,grip:hit.grip,
      collision:hit.collision,gripAngles:this.rig?.gripAngles,positionError:0,orientationError:0,
      segment:previous?{startTime:previous.time,endTime:frame.time,fraction:hit.fraction}:null,
      search:previous?null:{ok:false,status:'start_in_collision',method:'RRT-Connect',nodes:0},
      target:{position:fk.position.toArray(),quaternion:fk.quaternion.toArray()},
      toolDirection:new Vector3(0,0,1).applyQuaternion(fk.quaternion).toArray(),
      previous:previous?{time:previous.time,q:previous.q,target:previous.target}:null,
      interpretation:'A robot proxy intersects a world proxy or its clearance margin. Held items are included. Robot-to-robot contacts are not checked.'};
  }
  summary() {
    return {enabled:this.enabled,method:'per-part oriented boxes; bounded joint-interpolation sweep',heldPayload:this.data?.payload?.kind||null,
      margin:this.margin||0,worldParts:this.world?.length||0,robotParts:this.rig?.boxes.length||0,
      exclusions:['robot-to-robot','self collision','decorative labels'],
      resolution:.0005};
  }
}
export const collisionText = f => f?.reason==='robot_collision'
  ? 'Nova-5 collision: '+f.collision.first.robotLabel+' / '+f.collision.first.part+' ↔ '+f.collision.second.robotLabel+' / '+f.collision.second.part
  : f?.reason==='world_collision'
  ? (f.collision.conservative?'Clearance unresolved':'World collision')+': '+f.collision.robot.link+' / '+f.collision.robot.part+
    ' ↔ '+f.collision.world.label+' / '+f.collision.world.part : '';
