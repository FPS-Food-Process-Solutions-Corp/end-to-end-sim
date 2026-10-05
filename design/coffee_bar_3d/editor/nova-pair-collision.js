import {WorldCollisionChecker,makeBox,boxesOverlap} from './collision-core.js';

const mix=(a,b,f)=>a+(b-a)*f;

// Match the linear joint interpolation and discrete grasp transitions in playback.
export function sampleRobotTrack(frames,time,offset=0) {
  const local=Math.max(frames[0].time,Math.min(frames.at(-1).time,time-offset));
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].time<local)lo=mid+1;else hi=mid;}
  const b=frames[lo],a=frames[Math.max(0,lo-1)];
  const f=b.time===a.time?0:(local-a.time)/(b.time-a.time);
  return {...(f<1?a:b),time,phase:b.phase,
    q:a.q.map((q,j)=>mix(q,b.q[j],f)),grip:mix(a.grip||0,b.grip||0,f),
    bagDepth:mix(a.bagDepth||0,b.bagDepth||0,f)};
}

function between(a,b,f) {
  return {...a,time:mix(a.time,b.time,f),q:a.q.map((q,j)=>mix(q,b.q[j],f)),
    grip:mix(a.grip||0,b.grip||0,f),bagDepth:mix(a.bagDepth||0,b.bagDepth||0,f)};
}

// The receiving bag is hollow and open at the top. A solid envelope would
// incorrectly classify inserting a bun into its opening as a robot collision.
export function openBagShell(box,contentsSize) {
  const thickness=.001;
  const faces=[[0,-1,'left'],[0,1,'right'],[2,-1,'front'],[2,1,'back'],[1,-1,'bottom']];
  const walls=faces.map(([axis,sign,name])=>{
    const half=[...box.half],sheet=Math.min(thickness/2,half[axis]);
    const offset=sign*(half[axis]-sheet);
    half[axis]=sheet;
    const center=box.center.map((v,i)=>v+box.axes[axis][i]*offset);
    return makeBox(center,half,box.axes,{...box,part:'Held bag '+name+' wall'});
  });
  if(contentsSize) {
    const half=contentsSize.map(v=>v/2);
    const height=-box.half[1]+half[1]+.002;
    walls.push(makeBox(box.center.map((v,i)=>v+box.axes[1][i]*height),half,box.axes,
      {...box,part:'Bun inside held bag'}));
  }
  return walls;
}

export class NovaPairChecker {
  constructor(data) {
    this.data=data;
    this.margin=Math.max(-.02,Math.min(.05,Number(data.margin)||0));
    this.first=new WorldCollisionChecker({...data.first,enabled:true,world:[]});
    this.second=new WorldCollisionChecker({...data.second,enabled:true,world:[]});
  }
  shapes(checker,state) {
    return checker.shapes(state.q,state.grip||0,state).flatMap(box=>box.payload==='bag'?openBagShell(box,state.loaded?checker.data.payload.contentsSize:null):[box]);
  }
  hit(first,second,paddingFirst=[],paddingSecond=[]) {
    for(const a of first)for(const b of second) {
      const uncertainty=(paddingFirst[a.sourceIndex]||0)+(paddingSecond[b.sourceIndex]||0);
      if(boxesOverlap(a,b,this.margin+uncertainty))return {
        first:{...a,robotLabel:this.data.firstLabel},second:{...b,robotLabel:this.data.secondLabel},
        margin:this.margin,uncertainty};
    }
    return null;
  }
  pose(a,b) {return this.hit(this.shapes(this.first,a),this.shapes(this.second,b));}
  interval(a0,a1,b0,b1) {
    const travelA=this.first.travelBounds(a0,a1),travelB=this.second.travelBounds(b0,b1);
    const walk=(lo,hi,depth)=>{
      const mid=(lo+hi)/2,a=between(a0,a1,mid),b=between(b0,b1,mid);
      const shapesA=this.shapes(this.first,a),shapesB=this.shapes(this.second,b);
      const paddingA=travelA.map(d=>d*(hi-lo)/2),paddingB=travelB.map(d=>d*(hi-lo)/2);
      const possible=this.hit(shapesA,shapesB,paddingA,paddingB);
      if(!possible)return null;
      const uncertainty=Math.max(...paddingA)+Math.max(...paddingB);
      if(depth>=16||uncertainty<.0005) {
        const exact=this.hit(shapesA,shapesB);
        return {a,b,fraction:mid,collision:{...(exact||possible),conservative:!exact,uncertainty}};
      }
      return walk(lo,mid,depth+1)||walk(mid,hi,depth+1);
    };
    const crossing=walk(0,1,0);if(crossing)return crossing;
    const collision=this.pose(a1,b1);
    return collision?{a:a1,b:b1,fraction:1,collision}:null;
  }
  failure(hit,previousTime) {
    const {a,b,collision}=hit;
    return {reason:'robot_collision',time:a.time,phase:a.phase+' / '+b.phase,
      robotId:this.data.first.robotId,
      poses:[{robotId:this.data.first.robotId,label:this.data.firstLabel,q:a.q,grip:a.grip||0,gripAngles:this.first.rig.gripAngles},
        {robotId:this.data.second.robotId,label:this.data.secondLabel,q:b.q,grip:b.grip||0,gripAngles:this.second.rig.gripAngles}],
      collision,segment:{startTime:previousTime??a.time,endTime:a.time},
      target:{position:[collision.first.center[0],-collision.first.center[2],collision.first.center[1]],quaternion:[0,0,0,1]},
      toolDirection:[0,0,1],
      interpretation:'The synchronized Nova-5 arms, tools or held items overlap. Free suction transfers can attempt a detour around a stationary bread robot; simultaneous route rescheduling is not attempted.'};
  }
}

export function checkNovaPair(request,result,progress=()=>{}) {
  const data=request.pairCollision;
  if(!data?.enabled)return {enabled:false,status:'disabled'};
  const base={enabled:true,robots:[data.first.robotId,data.second.robotId],
    margin:data.margin,method:'synchronized per-part OBB sweep; hollow held bag',intervalsChecked:0};
  if(!result.pathOK||(request.breadTask&&!result.bread?.pathOK))
    return {...base,status:'incomplete',message:'Complete both individual routes before checking their synchronized motion.'};
  const checker=new NovaPairChecker(data);
  if(result.bread?.candidate)checker.second.setPayloadRotation(result.bread.candidate.relative);
  const duration=result.route?.duration||request.duration;
  const secondFrames=result.bread?.frames||[{...data.stationaryBread,time:0,phase:'Bread Nova-5 stationary',breadState:'rack'}];
  const offset=result.bread?.startTime||0;
  const times=[...new Set([0,duration,...result.frames.map(f=>f.time),...secondFrames.map(f=>f.time+offset)]
    .filter(t=>t>=0&&t<=duration))].sort((a,b)=>a-b);
  const states=t=>{
    const bag=sampleRobotTrack(result.frames,t),bread=sampleRobotTrack(secondFrames,t,offset);
    bag.loaded ||= bread.breadState==='loaded';
    return [bag,bread];
  };
  let previous=states(0),checked=0;
  const initial=checker.pose(...previous);
  if(initial)return {...base,status:'blocked',checkedUntil:0,failure:checker.failure({a:previous[0],b:previous[1],collision:initial})};
  for(let i=1;i<times.length;i++) {
    const current=states(times[i]);
    const hit=checker.interval(previous[0],current[0],previous[1],current[1]);
    checked++;
    if(hit)return {...base,status:'blocked',intervalsChecked:checked,checkedUntil:hit.a.time,
      failure:checker.failure(hit,times[i-1])};
    previous=current;
    if(i%40===0)progress({phase:'nova-pair',completed:i,total:times.length-1});
  }
  return {...base,status:'clear',checkedUntil:duration,intervalsChecked:checked};
}

export function applyNovaPairCheck(request,result,progress) {
  result.pairCollision=checkNovaPair(request,result,progress);
  if(result.pairCollision.failure) {
    result.bagPathOK=result.bagPathOK??result.pathOK;
    result.failure=result.pairCollision.failure;
    result.pathOK=false;
  }
  return result;
}
