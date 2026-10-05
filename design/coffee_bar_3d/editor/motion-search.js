import {Matrix3, Quaternion, Vector3} from '../vendor/three.module.js';
import {inspectHeldInterval,jointTravel} from './bag-motion.js';

const Z=new Vector3(0,0,1);
const norm=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const mix=(a,b,f)=>a.map((v,i)=>v+(b[i]-v)*f);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function orientWrist(arm,input,desired) {
  const q=[...input];
  for(let iteration=0;iteration<45;iteration++) {
    const pose=arm.forward(q),delta=desired.clone().multiply(pose.quaternion.clone().invert()).normalize();
    if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
    const n=Math.hypot(delta.x,delta.y,delta.z),angle=2*Math.atan2(n,delta.w);
    if(angle<.004)return q;
    const error=new Vector3(delta.x,delta.y,delta.z).multiplyScalar(n<1e-10?2:angle/n);
    const axes=pose.axes.slice(3);
    const normal=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>
      axes.reduce((sum,a)=>sum+a.getComponent(r)*a.getComponent(c),0)+(r===c?.0001:0)));
    const step=error.applyMatrix3(new Matrix3().set(...normal.flat()).invert());
    const change=axes.map(a=>a.dot(step)),factor=Math.min(1,.2/Math.max(...change.map(Math.abs),1e-9));
    for(let j=0;j<3;j++)q[j+3]=clamp(q[j+3]+change[j]*factor,arm.lower[j+3],arm.upper[j+3]);
  }
  return null;
}

export function createSearchBudget(data) {
  return {remaining:data?.searchNodes||600,used:0,searches:0};
}

// Bidirectional RRT-Connect in joint space. Every accepted edge uses the same
// collision sweep and joint interpolation as playback, including held objects.
export function searchJointPath(arm,start,end,options={}) {
  const checker=arm.collision,budget=options.budget||createSearchBudget(checker.data);
  const report={method:'RRT-Connect',phase:end.phase,startTime:start.time,endTime:end.time,
    status:'not_started',nodes:0,heldItem:checker.data?.payload?.kind||null};
  const finish=(status,path=null)=>({...report,status,path,ok:!!path});
  if(!checker.enabled||checker.data.search===false)return finish('search_disabled');
  const state={...start,phase:end.phase};
  if(checker.pose(start.q,start.grip||0,state))return finish('start_in_collision');
  if(checker.pose(end.q,end.grip||0,end))return finish('goal_in_collision');
  if(!budget.remaining)return finish('budget_exhausted');
  budget.searches++;
  const tilt=options.tiltLimit,heading=arm.forward(start.q).quaternion;
  const frame=q=>({...state,q});
  const edge=(a,b)=>{
    if(checker.interval(frame(a),frame(b)))return false;
    return !tilt||inspectHeldInterval(arm,frame(a),frame(b),tilt).ok;
  };
  const project=q=>{
    if(!tilt)return q;
    const desired=new Quaternion().setFromAxisAngle(Z,q[0]-start.q[0]).multiply(heading);
    return orientWrist(arm,q,desired);
  };
  if(edge(start.q,end.q)&&(!options.minimumJ1Share||jointTravel([start,end]).j1Share>=options.minimumJ1Share))return finish('found',[start.q,end.q]);
  let seed=9173+Math.round((start.time||0)*100),iterations=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const trees=[[{q:start.q,parent:-1}],[{q:end.q,parent:-1}]];
  const nearest=(tree,q)=>tree.reduce((best,node,i)=>norm(node.q,q)<norm(tree[best].q,q)?i:best,0);
  const trace=(tree,index)=>{const p=[];for(let i=index;i>=0;i=tree[i].parent)p.push(tree[i].q);return p.reverse();};
  const extend=(tree,target)=>{
    if(!budget.remaining)return null;
    budget.remaining--;budget.used++;report.nodes++;
    const parent=nearest(tree,target),from=tree[parent].q,distance=norm(from,target);
    let q=distance<=.24?[...target]:project(mix(from,target,.24/distance));
    if(!q||q.some((v,j)=>v<arm.lower[j]||v>arm.upper[j])||norm(from,q)<1e-6||norm(from,q)>.7)return null;
    if(!edge(from,q))return null;
    tree.push({q,parent});
    return {index:tree.length-1,reached:norm(q,target)<1e-6};
  };
  while(budget.remaining&&iterations++<1200) {
    const side=iterations%2,a=trees[side],b=trees[1-side];
    let target;
    if(iterations%5===0)target=b[0].q;
    else {
      const f=random(),centre=mix(start.q,end.q,f);
      const broad=iterations>120&&iterations%3===0;
      target=centre.map((v,j)=>clamp(broad?arm.lower[j]+random()*(arm.upper[j]-arm.lower[j]):
        v+(random()*2-1)*(j===0?2.4:j<3?.85:1.3),arm.lower[j],arm.upper[j]));
      target=project(target);if(!target)continue;
    }
    const added=extend(a,target);if(!added)continue;
    let connected;
    for(let attempt=0;attempt<14&&budget.remaining;attempt++) {
      connected=extend(b,a[added.index].q);
      if(!connected||connected.reached)break;
    }
    if(!connected?.reached)continue;
    let path=side===0?[...trace(a,added.index),...trace(b,connected.index).reverse().slice(1)]:
      [...trace(b,connected.index),...trace(a,added.index).reverse().slice(1)];
    // Shortcut only fully validated edges; retain the user's J1 preference.
    for(let i=0;i<path.length-2;i++)for(let j=path.length-1;j>i+1;j--) {
      if(edge(path[i],path[j])){path.splice(i+1,j-i-1);break;}
    }
    if(options.minimumJ1Share&&jointTravel(path.map(q=>({q}))).j1Share<options.minimumJ1Share)continue;
    return finish('found',path);
  }
  return finish('budget_exhausted');
}

export function detourFrames(arm,start,end,path) {
  const lengths=path.slice(1).map((q,i)=>norm(path[i],q));
  const total=lengths.reduce((s,v)=>s+v,0)||1;
  const frames=[];let travelled=0;
  for(let segment=0;segment<lengths.length;segment++) {
    const a=path[segment],b=path[segment+1],steps=Math.max(1,Math.ceil(lengths[segment]/.10));
    for(let i=1;i<=steps;i++) {
      const f=i/steps,q=mix(a,b,f),fk=arm.forward(q);
      const fraction=(travelled+lengths[segment]*f)/total,last=segment===lengths.length-1&&i===steps;
      frames.push({...start,...(last?end:{}),phase:end.phase,q,
        time:start.time+(end.time-start.time)*fraction,
        target:{position:fk.position.toArray(),quaternion:fk.quaternion.toArray()},moveType:'searched detour'});
    }
    travelled+=lengths[segment];
  }
  return {frames,suggestedDuration:Math.max(end.time-start.time,total/.7)};
}

export function tryDetour(arm,start,target,options={}) {
  const allowed=arm.poseAllowed;
  let endIK;
  try {
    arm.poseAllowed=q=>!arm.collision.pose(q,target.grip||0,target);
    endIK=arm.solveMultiple(target,start.q,18);
  } finally { arm.poseAllowed=allowed; }
  if(!endIK.ok)return {ok:false,status:'goal_ik_failed',method:'RRT-Connect',phase:target.phase,startTime:start.time,endTime:target.time,nodes:0};
  const end={...target,q:endIK.q,target:{position:target.position,quaternion:target.quaternion}};
  const result=searchJointPath(arm,start,end,options);
  if(!result.ok)return result;
  return {...result,...detourFrames(arm,start,end,result.path)};
}

// Preserve every process event and dwell, giving longer detours more time.
export function retimeDetours(result,knots,events=[]) {
  const successful=(result.searches||[]).filter(s=>s.ok&&s.suggestedDuration>s.endTime-s.startTime);
  if(!successful.length)return {result,knots,events,duration:knots.at(-1)?.time||0};
  const segments=successful.map(s=>({...s,factor:s.suggestedDuration/(s.endTime-s.startTime)})).sort((a,b)=>a.startTime-b.startTime);
  const map=t=>{
    let shift=0;
    for(const s of segments) {
      if(t<=s.startTime)return t+shift;
      if(t<=s.endTime)return s.startTime+shift+(t-s.startTime)*s.factor;
      shift+=s.suggestedDuration-(s.endTime-s.startTime);
    }
    return t+shift;
  };
  const failure=result.failure?{...result.failure,time:map(result.failure.time),
    previous:result.failure.previous?{...result.failure.previous,time:map(result.failure.previous.time)}:null,
    segment:result.failure.segment?{...result.failure.segment,startTime:map(result.failure.segment.startTime),endTime:map(result.failure.segment.endTime)}:undefined,
    tilt:result.failure.tilt?{...result.failure.tilt,peakTime:map(result.failure.tilt.peakTime)}:undefined}:null;
  const remapped=knots.map(k=>({...k,time:map(k.time)}));
  return {result:{...result,frames:result.frames.map(f=>({...f,time:map(f.time)})),failure},
    knots:remapped,events:events.map(e=>({...e,time:map(e.time)})),duration:remapped.at(-1).time};
}

export const searchMessage = search => !search?'':search.ok
  ? 'Obstacle search found a detour ('+search.nodes+' expansions).'
  : search.status==='goal_in_collision'?'No detour can reach this endpoint in its solved posture: it intersects an object. Move the working pose or equipment.'
  : search.status==='start_in_collision'?'Cannot start a detour from an overlapping pose. Move the robot or adjust clearance.'
  : search.status==='goal_ik_failed'?'No IK solution was found for the detour endpoint.'
  : search.status==='protected_motion'?'This is a constrained contact move. Change its approach/pre-pick pose or equipment position; it cannot be replaced by an arbitrary detour.'
  : search.status==='search_disabled'?'Detour search is disabled.'
  : 'No valid detour found within the search budget. This does not prove that none exists.';
