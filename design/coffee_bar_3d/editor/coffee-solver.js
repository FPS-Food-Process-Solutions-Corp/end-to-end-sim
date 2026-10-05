import {createSearchBudget,tryDetour,retimeDetours} from './motion-search.js';
import {WorldCollisionChecker,collisionText} from './collision-core.js';
import {SuctionArm,interpolateTarget,pathFailure,MAX_JOINT_STEP} from './ik-core.js';
import {limitCoffeeSpeed} from './coffee-timing.js';

import {Matrix3, Quaternion, Vector3} from '../vendor/three.module.js';

function orientWrist(arm,q,desired) {
  let angles=[...q];
  for(let iteration=0;iteration<70;iteration++) {
    const fk=arm.forward(angles);
    const delta=desired.clone().multiply(fk.quaternion.clone().invert()).normalize();
    if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
    const n=Math.hypot(delta.x,delta.y,delta.z),angle=2*Math.atan2(n,delta.w);
    if(angle<.002)return {q:angles,ok:true};
    const error=new Vector3(delta.x,delta.y,delta.z).multiplyScalar(n<1e-10?2:angle/n);
    const axes=fk.axes.slice(3);
    const normal=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>
      axes.reduce((sum,a)=>sum+a.getComponent(r)*a.getComponent(c),0)+(r===c?.0001:0)));
    const step=error.applyMatrix3(new Matrix3().set(...normal.flat()).invert());
    const changes=axes.map(a=>a.dot(step)),factor=Math.min(1,.25/Math.max(...changes.map(Math.abs),1e-9));
    for(let j=0;j<3;j++)angles[j+3]=Math.max(arm.lower[j+3],Math.min(arm.upper[j+3],angles[j+3]+changes[j]*factor));
  }
  return {q:angles,ok:arm.forward(angles).quaternion.angleTo(desired)<.05236};
}

const jointMove = phase => /^(Move clear|Carry|Above|Turn|Clear cup|Withdraw cup|Withdraw filled|Withdraw lidded|Withdraw from ice|Approach \/|At |Approach sealed cup)/.test(phase);
export function solveCoffeeFlow(definition,request,progress=()=>{}) {
  const candidates=[{label:'Configured route'},...(request.collision?.enabled?request.collisionRoutes||[]:[])];
  const attempts=[];let best,selected;
  const budget=createSearchBudget(request.collision);
  for(const candidate of candidates) {
    const input={...request,...candidate};
    const result=solveCoffeeCandidate(definition,input,progress,budget);
    const failure=result.failure;
    attempts.push({label:candidate.label,ok:result.pathOK,reason:failure?.reason,phase:failure?.phase,time:failure?.time,
      acceptedUntil:result.frames.at(-1)?.time||0,positionError:failure?.positionError,orientationError:failure?.orientationError,
      collision:collisionText(failure),searchStatus:failure?.obstacleSearch?.status});
    if(!best||(result.frames.at(-1)?.time||0)>(best.frames.at(-1)?.time||0)) {
      best=result;selected=candidate.label;
    }
    if(result.pathOK)return {...result,routeSearch:{attempts,selected:candidate.label}};
  }
  return {...best,routeSearch:{attempts,selected}};
}
function solveCoffeeCandidate(definition,request,progress,budget) {
  const arm=new SuctionArm({...definition,tolerance:{position:.005,orientationDegrees:3}},request.robot,request.mountingHeight);
  arm.collision=new WorldCollisionChecker(request.collision);
  if(arm.collision.enabled)arm.poseAllowed=q=>!arm.collision.pose(q);
  let best;
  for(let branch=0;branch<4;branch++) {
    const seed=branch===0?arm.initial:[branch*Math.PI/2,-.7,-1.4,0,1.5,0];
    const first=arm.solveMultiple(request.knots[0],seed,18),frames=[],searches=[];
    let failure=null;
    if(!first.ok) failure=pathFailure(arm,request.knots[0],first,null,{phase:'Cup-dispenser approach',time:0});
    else {
      const frame={...request.knots[0],q:first.q,target:request.knots[0]};
      failure=arm.collision.failure(arm,null,frame);
      if(!failure)frames.push(frame);
    }
    for(let segment=1;segment<request.knots.length&&!failure;segment++) {
      progress({phase:'coffee',completed:segment,total:request.knots.length,branch});
      const a=request.knots[segment-1],b=request.knots[segment],steps=Math.max(1,Math.ceil((b.time-a.time)*12));
      const segmentStart=frames.length-1;
      const from=frames.at(-1),joint=b.motion!=='cartesian'&&jointMove(b.phase);
      const end=joint?arm.solveMultiple(b,from.q,24):null;
      const upright=joint&&a.cup==='held'&&b.cup==='held';
      const context=(sample,fraction)=>({phase:b.phase,time:a.time+(b.time-a.time)*fraction,
        segment:{index:segment,from:a.phase,to:b.phase,sample,samples:steps,fraction,startTime:a.time,endTime:b.time}});
      const recover=()=>{
        const free=joint&&a.cup===b.cup;
        const detour=free?tryDetour(arm,{...from,collisionCup:a.cup},
          {...b,collisionCup:b.cup},{budget,tiltLimit:upright?3:null}):
          {ok:false,status:'protected_motion',phase:b.phase,method:'RRT-Connect',nodes:0};
        const report={...detour,trigger:failure.reason,frames:undefined,path:undefined};searches.push(report);
        if(detour.ok){frames.splice(segmentStart+1);frames.push(...detour.frames);failure=null;}
        else failure.obstacleSearch=report;
        return detour.ok;
      };
      if(end&&!end.ok) {
        failure=pathFailure(arm,b,end,from,context(steps,1));
        if(recover())continue;
        break;
      }
      if(end)end.q=end.q.map((q,j)=>{
        const equivalent=[q-2*Math.PI,q,q+2*Math.PI].filter(v=>v>=arm.lower[j]&&v<=arm.upper[j]);
        return equivalent.sort((u,v)=>Math.abs(u-from.q[j])-Math.abs(v-from.q[j]))[0];
      });
      for(let i=1;i<=steps;i++) {
        const fraction=i/steps,previous=frames.at(-1);
        let target=interpolateTarget(a,b,fraction),result;
        if(joint) {
          const blend=fraction*fraction*(3-2*fraction);
          let wristOK=true;
          let q=from.q.map((v,j)=>v+(end.q[j]-v)*blend);
          if(upright){
            q=q.map((v,j)=>j>=3?previous.q[j]:v);
            const adjusted=orientWrist(arm,q,new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion),blend));
            q=adjusted.q;wristOK=adjusted.ok;
          }
          const fk=arm.forward(q);
          const desired=new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion),blend);
          const endpointError=i===steps?fk.position.distanceTo(new Vector3(...b.position)):0;
          const orientationError=upright?fk.quaternion.angleTo(desired):0;
          result={ok:wristOK&&endpointError<=arm.tolerance.position,q,positionError:endpointError,
            orientationError,tcp:fk.position.toArray(),tcpQuaternion:fk.quaternion.toArray(),links:fk.links};
          target={position:i===steps?b.position:fk.position.toArray(),
            quaternion:upright?desired.toArray():fk.quaternion.toArray()};
        } else result=arm.solve(target,previous.q);
        if(!result.ok||(!joint&&Math.max(...result.q.map((v,j)=>Math.abs(v-previous.q[j])))>MAX_JOINT_STEP)) {
          failure=pathFailure(arm,target,result,previous,context(i,fraction));
          recover();
          break;
        }
        const frame={...b,time:a.time+(b.time-a.time)*fraction,q:result.q,target,collisionCup:fraction<1?a.cup:b.cup,moveType:joint?'joint':'cartesian'};
        failure=arm.collision.failure(arm,previous,frame);
        if(failure) {
          failure.segment=context(i,fraction).segment;
          recover();
          break;
        }
        frames.push(frame);
      }
    }
    let result={frames,failure,pathOK:!failure,branch,duration:request.duration,searches,collision:arm.collision.summary(),
      checks:'IK at service poses, Cartesian local approaches, predefined joint transfers with upright wrist compensation. Optional world-proxy collision checks include interpolated arm/tool motion. No robot-to-robot, self collision, spill or dynamics simulation.'};
    const timed=retimeDetours(result,request.knots,request.events);
    result={...timed.result,duration:timed.duration,route:{knots:timed.knots,events:timed.events,duration:timed.duration}};
    if(!best||(result.frames.at(-1)?.time||0)>(best.frames.at(-1)?.time||0))best=result;
    if(result.pathOK)return limitCoffeeSpeed(arm,{...request,knots:timed.knots,events:timed.events,duration:timed.duration},result);
  }
  return best;
}
