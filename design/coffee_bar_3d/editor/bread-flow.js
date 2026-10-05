import {coordinatePacking} from './packing-timeline.js';
import {createSearchBudget,tryDetour,retimeDetours} from './motion-search.js';
import {WorldCollisionChecker} from './collision-core.js';
import {Vector3, Quaternion} from '../vendor/three.module.js';
import {SuctionArm, interpolateTarget, pathFailure, MAX_JOINT_STEP} from './ik-core.js';

const Z = new Vector3(0,0,1);
const pose = (position,quaternion) => ({position:[...position],quaternion:[...quaternion]});
const at = (target, offset) => ({...target,position:target.position.map((v,i)=>v+offset[i])});

function breadKnots(bread, candidate, extraLift) {
  const pickup = pose(candidate.position,candidate.toolQuaternion);
  const direction = Z.clone().applyQuaternion(new Quaternion(...pickup.quaternion));
  const pre = pose(candidate.prePosition||at(pickup,direction.clone().multiplyScalar(-bread.approach).toArray()).position,pickup.quaternion);
  const unaimed = new Quaternion(...pre.quaternion)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.25));
  // Same shortest-arc, left-multiplied rotation as core/aim_math.py.
  const towardBun = new Vector3(...pickup.position).sub(new Vector3(...pre.position)).normalize();
  const aimed = new Quaternion().setFromUnitVectors(Z.clone().applyQuaternion(unaimed),towardBun)
    .multiply(unaimed);
  const release = pose(bread.releasePosition,candidate.releaseQuaternion||bread.releaseQuaternion);
  const above = at(release,[0,0,bread.lift+extraLift+.10]);
  const lifted = at(pickup,[0,0,bread.lift+extraLift]);
  const withdrawn = at(lifted,direction.clone().multiplyScalar(-bread.approach).toArray());
  const knots = [];
  let time = 0;
  const add = (seconds,target,phase,state='rack',grip=0) => {
    time+=seconds; knots.push({...target,time,phase,breadState:state,grip});
  };
  add(3, bread.method==='aim'?{...pre,quaternion:unaimed.toArray()}:pre,'Bread: move to pre-pick');
  if (bread.method==='aim') add(1.5,{...pre,quaternion:aimed.toArray()},'Bread: aim tool +Z in place');
  add(2,pickup,bread.method==='aim'?'Bread: advance along tool +Z':'Bread: direct IK contact');
  add(.6,pickup,'Bread: close tongs / grab','held',1);
  add(1.5,lifted,'Bread: lift clear of rack','held',1);
  add(1.5,withdrawn,'Bread: withdraw from rack','held',1);
  add(4,above,'Bread: carry above open bag','held',1);
  add(2,release,'Bread: lower vertically into bag','held',1);
  add(.5,release,'Bread: release bun','released',0);
  add(.7,release,'Bread: settle in bag','loaded',0);
  add(2,above,'Bread: withdraw jaws vertically','loaded',0);
  return knots;
}

function solveCandidate(arm,bread,candidate,extraLift,branch) {
  const knots=breadKnots(bread,candidate,extraLift);
  const preferred=branch===0?arm.initial:[0,-.7,-1.4,0,1.5,0];
  const first=arm.solveMultiple(knots[0],preferred,12);
  const common={candidate,knots,duration:knots.at(-1).time,extraLift,branch,collision:arm.collision.summary()};
  if(!first.ok) return {...common,pathOK:false,frames:[],failure:pathFailure(arm,knots[0],first,null,{
    phase:knots[0].phase,time:knots[0].time,robotId:bread.robot.id})};
  const frames=[],searches=[];
  // The move from the stored posture to pre-pick is a joint-space move.
  // Collision checking follows the same interpolated joint path as playback.
  const initial=arm.forward(arm.initial);
  const start={time:0,q:arm.initial,target:pose(initial.position.toArray(),initial.quaternion.toArray()),
    phase:'Bread: move to pre-pick',breadState:'rack',grip:0};
  const startFailure=arm.collision.failure(arm,null,start);
  if(startFailure)return {...common,frames,pathOK:false,failure:startFailure};
  frames.push(start);
  const steps=Math.ceil(knots[0].time*12);
  for(let i=1;i<=steps;i++){
    const q=arm.initial.map((v,j)=>v+(first.q[j]-v)*i/steps),fk=arm.forward(q);
    const frame={...knots[0],time:knots[0].time*i/steps,q,
      target:pose(fk.position.toArray(),fk.quaternion.toArray())};
    const blocked=arm.collision.failure(arm,frames.at(-1),frame);
    if(blocked) {
      const detour=tryDetour(arm,start,knots[0],{budget:arm.searchBudget});
      const report={...detour,frames:undefined,path:undefined};searches.push(report);
      if(!detour.ok)return {...common,frames,searches,pathOK:false,failure:{...blocked,search:report}};
      frames.splice(1);frames.push(...detour.frames);break;
    }
    frames.push(frame);
  }
  for(let segment=1;segment<knots.length;segment++){
    const segmentStart=frames.length-1;
    const a=knots[segment-1],b=knots[segment],count=Math.ceil((b.time-a.time)*12);
    for(let i=1;i<=count;i++){
      const fraction=i/count,time=a.time+(b.time-a.time)*fraction;
      const target=interpolateTarget(a,b,fraction),previous=frames.at(-1);
      const result=arm.solve(target,previous.q);
      const step=Math.max(...result.q.map((q,j)=>Math.abs(q-previous.q[j])));
      if(!result.ok||step>MAX_JOINT_STEP) return {...common,frames,pathOK:false,
        failure:pathFailure(arm,target,result,previous,{phase:b.phase,time,robotId:bread.robot.id,
          segment:{index:segment,sample:i,samples:count,fraction,startTime:a.time,endTime:b.time}})};
      const frame={...b,time,q:result.q,target,grip:a.grip+(b.grip-a.grip)*fraction,
        breadState:i===count?b.breadState:a.breadState};
      const blocked=arm.collision.failure(arm,previous,frame);
      if(blocked) {
        const free=/carry above/.test(b.phase);
        const detour=free?tryDetour(arm,frames[segmentStart],b,{budget:arm.searchBudget}):
          {ok:false,status:'protected_motion',method:'RRT-Connect',phase:b.phase,nodes:0};
        const report={...detour,frames:undefined,path:undefined};searches.push(report);
        if(!detour.ok)return {...common,frames,searches,pathOK:false,failure:{...blocked,search:report}};
        frames.splice(segmentStart+1);frames.push(...detour.frames);break;
      }
      frames.push(frame);
    }
  }
  const timed=retimeDetours({...common,pathOK:true,frames,searches,failure:null},knots);
  return {...timed.result,knots:timed.knots,duration:timed.duration};
}

export function checkBreadWorkflow(definition,bread,progress=()=>{}) {
  const arm=new SuctionArm(definition,bread.robot,bread.mountingHeight);
  arm.collision=new WorldCollisionChecker(bread.collision);
  arm.searchBudget=createSearchBudget(bread.collision);
  if(arm.collision.enabled)arm.poseAllowed=q=>!arm.collision.pose(q);
  const maxGap=definition.maximum_aperture*(bread.robot.robot_scale||1);
  const errors=[];
  if ((bread.graspWidth??bread.size[2]) > maxGap-.002) errors.push(
    'The '+(bread.grasp==='sides'?'bun width for side gripping':'bun thickness')+' is '+((bread.graspWidth??bread.size[2])*100).toFixed(1)+' cm; the tongs open to '+
    (maxGap*100).toFixed(1)+' cm and need 2 mm clearance. Reduce '+(bread.grasp==='sides'?'bread Length 1':'bread thickness')+' or change the gripper.');
  const initial=arm.forward(arm.initial);
  const blockedStart=arm.collision.failure(arm,null,{q:arm.initial,time:0,grip:0,
    target:pose(initial.position.toArray(),initial.quaternion.toArray()),phase:'Bread: starting posture',breadState:'rack'});
  // Even an invalid grasp must report an overlapping starting posture. This
  // pose check is not a claim that the remaining route has been validated.
  if(blockedStart||errors.length)return {pathOK:false,frames:[],knots:[],duration:0,candidate:bread.candidates[0],
    attempts:[],robotId:bread.robot.id,shelfId:bread.shelfId,failure:blockedStart,errors,collision:arm.collision.summary()};
  const attempts=[];
  let best;
  // Nearest front-row buns first; additional tiers remain available if a lower one fails.
  for(const candidate of bread.candidates) {
    arm.collision.setPayloadRotation?.(candidate.relative);
    for(const extraLift of [0,.10,.20]) for(let branch=0;branch<2;branch++){
      progress({phase:'bread',completed:attempts.length,total:bread.candidates.length*6});
      const result=solveCandidate(arm,bread,candidate,extraLift,branch);
      attempts.push({tier:candidate.tier,column:candidate.column,extraLift,branch,
        ok:result.pathOK,phase:result.failure?.phase});
      if(!best||result.frames.length>best.frames.length)best=result;
      if(result.pathOK) return {...result,attempts,robotId:bread.robot.id,shelfId:bread.shelfId};
    }
  }
  return {...best,attempts,robotId:bread.robot.id,shelfId:bread.shelfId};
}

// Stretch only the opened-bag hold. The suction TCP stays fixed during bread loading;
// release and carry cannot start until the bread arm has withdrawn.
export function combineBreadWorkflow(result,breadResult,settings={}) {
  result.bread=breadResult;
  if(!breadResult.pathOK){
    result.bagPathOK=result.pathOK; result.pathOK=false;
    return result;
  }
  if(!result.pathOK)return result;
  Object.assign(result,coordinatePacking(result,breadResult,settings.bread_parallel===true));
  return result;
}
