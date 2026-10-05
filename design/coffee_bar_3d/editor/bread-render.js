import * as THREE from '../vendor/three.module.js';
import {poseSuctionRobot,setupSuctionJoints} from './suction-render.js';

const BASIS=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
const worldPoint=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const worldRotation=q=>BASIS.clone().multiply(new THREE.Quaternion(...q)).multiply(BASIS.clone().invert());

export function poseTongGrip(record,angle) {
  if(!record.gripJoints) {
    record.gripJoints=[];
    record.mesh.traverse(node=>{
      if(node.userData.grip_axis) {
        const a=node.userData.grip_axis;
        record.gripJoints.push({node,rest:node.quaternion.clone(),axis:new THREE.Vector3(a[0],a[2],-a[1]),
          multiplier:node.userData.grip_multiplier});
      }
    });
  }
  for(const j of record.gripJoints) j.node.quaternion.copy(j.rest)
    .multiply(new THREE.Quaternion().setFromAxisAngle(j.axis,angle*j.multiplier));
  record.node.updateMatrixWorld(true);
}

// Measure the inside faces of the actual imported tong meshes around the grasp
// plane. Choose the closest available aperture; this is not a force/contact model.
export function tongAperture(record,angle) {
  poseTongGrip(record,angle);
  const inverse=record.tcp.matrixWorld.clone().invert();
  const extents=[];
  record.mesh.traverse(node=>{
    if(!node.isMesh||!/gripper_[rl]_tong.*visual/.test(node.name))return;
    const transform=inverse.clone().multiply(node.matrixWorld),points=node.geometry.attributes.position;
    const xs=[];
    for(let i=0;i<points.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(points,i).applyMatrix4(transform);
      if(Math.abs(p.y)<.035)xs.push(p.x);
    }
    if(xs.length)extents.push({min:Math.min(...xs),max:Math.max(...xs)});
  });
  if(extents.length!==2)return null;
  extents.sort((a,b)=>a.min-b.min);
  return Math.max(0,extents[1].min-extents[0].max);
}

export function gripAngles(record,width) {
  setupSuctionJoints(record);
  const samples=[];
  for(let i=0;i<=100;i++){
    const {grip_lower:lower,grip_upper:upper}=record.tcp.userData;
    const angle=lower+(upper-lower)*i/100,gap=tongAperture(record,angle);
    if(gap!==null)samples.push({angle,gap});
  }
  if(!samples.length)return {open:.85,closed:.55,approximate:true};
  const closest=target=>samples.reduce((best,s)=>Math.abs(s.gap-target)<Math.abs(best.gap-target)?s:best);
  return {open:closest(width+.006).angle,closed:closest(width).angle,
    contactGap:closest(width).gap,maxGap:Math.max(...samples.map(s=>s.gap))};
}

export class BreadPlayback {
  constructor(player) {
    this.player=player;
    const {request,result,view}=player;
    this.task=request.breadTask;this.result=result.bread;
    this.record=view.instances.get(this.task.robot.id);
    if(!this.record)throw new Error('The selected bread robot is not loaded.');
    setupSuctionJoints(this.record);
    this.angles=gripAngles(this.record,(this.task.graspWidth??this.task.size[2])/(this.task.robot.robot_scale||1));
    const c=this.result.candidate;
    view.instances.get(this.task.shelfId)?.mesh.traverse(n=>{
      if(n.userData.bread_ellipsoid&&n.userData.column===c.column&&
        n.userData.row===c.row&&n.parent.userData.shelf_tier===c.tier)this.source=n;
    });
    if(!this.source)throw new Error('The selected bread mesh is missing; recheck the shelf.');
    this.originalVisible=this.source.visible;
    this.relative=new THREE.Quaternion(...c.toolQuaternion).invert().multiply(new THREE.Quaternion(...c.quaternion));
    this.released=this.result.knots.find(k=>k.breadState==='released').time;
    this.loaded=this.result.knots.find(k=>k.breadState==='loaded').time;
  }

  seek(time,bag,bagCentre) {
    const {bread}=this.player,r=this.result,t=time-r.startTime;
    const frames=r.frames,clamped=Math.max(0,Math.min(r.duration,t));
    let i=frames.findIndex(f=>f.time>=clamped);if(i<0)i=frames.length-1;
    const b=frames[i],a=frames[Math.max(0,i-1)];
    const f=b.time===a.time?0:(clamped-a.time)/(b.time-a.time);
    const state=f<1?a:b;
    const q=a.q.map((v,j)=>v+(b.q[j]-v)*f);
    poseSuctionRobot(this.record,q);
    const grip=a.grip+(b.grip-a.grip)*f;
    poseTongGrip(this.record,this.angles.open+(this.angles.closed-this.angles.open)*grip);
    const picked=state.breadState!=='rack';
    this.source.visible=this.originalVisible&&!picked;
    bread.visible=picked;
    if(!picked)return t>=0&&t<=r.duration?b.phase:null;
    if(t<this.released) {
      bread.position.copy(this.record.tcp.getWorldPosition(new THREE.Vector3()));
      // TCP world quaternion includes the glTF basis; relative rotation is in URDF axes.
      bread.quaternion.copy(this.record.tcp.getWorldQuaternion(new THREE.Quaternion()))
        .multiply(worldRotation(this.relative.toArray()));
    } else if(t<this.loaded) {
      const drop=Math.max(0,Math.min(1,(t-this.released)/(this.loaded-this.released)));
      bread.position.copy(worldPoint(this.task.releasePosition)).lerp(worldPoint(this.task.restingPosition),drop);
      bread.quaternion.copy(worldRotation(this.task.heldQuaternion));
    } else {
      // Use actual animated bag depth / centre, including the opening stroke.
      bread.position.copy(bag.position).add(bagCentre).add(
        new THREE.Vector3(0,this.task.size[1]/2+.002,0).applyQuaternion(bag.quaternion));
      bread.quaternion.copy(bag.quaternion).multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    }
    return t>=0&&t<=r.duration?b.phase:null;
  }

  stop() {
    this.source.visible=this.originalVisible;
    const object=this.player.store.object(this.task.robot.id);
    if(object){
      poseSuctionRobot(this.record,Array.from({length:6},(_,i)=>(object.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180));
      poseTongGrip(this.record,(object.joints_deg?.gripper_r_joint1||0)*Math.PI/180);
    }
  }
}
