import {Vector3} from '../vendor/three.module.js';

/** Bound TCP speed for the same linear joint interpolation used by the player. */
export function intervalToolSpeed(arm,from,to,offsets) {
  const dt=to.time-from.time;
  const delta=to.q.map((q,j)=>q-from.q[j]);
  if(dt<=0)return {sampled:0,bound:0};
  let sampled=0,bound=0;
  const divisions=8;
  const poses=Array.from({length:divisions+1},(_,i)=>
    arm.forward(from.q.map((q,j)=>q+delta[j]*i/divisions)));
  for(const offset of Object.values(offsets)){
    let peak=0;
    for(const pose of poses){
      const tcp=new Vector3(...offset).applyQuaternion(pose.quaternion).add(pose.position);
      const derivative=new Vector3();
      for(let j=0;j<delta.length;j++)
        derivative.add(pose.axes[j].clone().cross(tcp.clone().sub(pose.origins[j])).multiplyScalar(delta[j]));
      peak=Math.max(peak,derivative.length());
    }
    // A serial-chain translation contributes at most length * sum(|dq|)^2
    // to |d²TCP/ds²|. Add a half-sample Lipschitz margin, so curved motion
    // between samples is covered too; a TCP chord alone would underestimate it.
    let angularSum=0,secondDerivative=0;
    arm.joints.forEach((joint,j)=>{
      secondDerivative+=Math.hypot(...joint.xyz)*arm.scale*angularSum**2;
      angularSum+=Math.abs(delta[j]);
    });
    secondDerivative+=(Math.hypot(...offset)+Math.abs(arm.definition.tool_length||0)*arm.scale)*angularSum**2;
    sampled=Math.max(sampled,peak/dt);
    bound=Math.max(bound,(peak+secondDerivative/(2*divisions))/dt);
  }
  return {sampled,bound};
}

/** Stretch each taught stage uniformly; preserve its path and all dwell times. */
export function limitCoffeeSpeed(arm,request,result,options={}) {
  if(!result.pathOK&&!options.partial)return result;
  const limit=request.settings.max_tcp_speed;
  if(!Number.isFinite(limit)||limit<=0)throw new Error('End-effector speed must be a positive number in m/s.');
  const original=result.frames;
  const frames=[{...original[0]}],knots=[{...request.knots[0]}],segments=[];
  let cursor=1,time=request.knots[0].time;
  let peakBefore=0,boundBefore=0,peakAfter=0,boundAfter=0;
  for(let k=1;k<request.knots.length;k++){
    const a=request.knots[k-1],b=request.knots[k],indices=[];
    let segmentPeak=0,segmentBound=0;
    while(cursor<original.length&&original[cursor].time<=b.time+1e-8){
      const speed=intervalToolSpeed(arm,original[cursor-1],original[cursor],request.offsets);
      segmentPeak=Math.max(segmentPeak,speed.sampled);
      segmentBound=Math.max(segmentBound,speed.bound);
      indices.push(cursor++);
    }
    const factor=Math.max(1,segmentBound/limit*(1+1e-10));
    const start=time;
    for(const index of indices)
      frames.push({...original[index],time:start+(original[index].time-a.time)*factor});
    time=start+(b.time-a.time)*factor;
    knots.push({...b,time});
    peakBefore=Math.max(peakBefore,segmentPeak);boundBefore=Math.max(boundBefore,segmentBound);
    peakAfter=Math.max(peakAfter,segmentPeak/factor);boundAfter=Math.max(boundAfter,segmentBound/factor);
    segments.push({phase:b.phase,sourceStart:a.time,sourceEnd:b.time,start,end:time,factor,
      sampledPeak:segmentPeak/factor,speedBound:segmentBound/factor});
  }
  const mapTime=value=>{
    const segment=segments.find(s=>value<=s.sourceEnd+1e-8)||segments.at(-1);
    return segment?segment.start+(value-segment.sourceStart)*segment.factor:value;
  };
  const events=request.events.map(event=>({...event,time:mapTime(event.time)}));
  return {...result,frames,duration:time,route:{knots,events,duration:time},
    speed:{limit,nominalDuration:request.duration,duration:time,peakBefore,boundBefore,peakAfter,boundAfter,segments,
      points:['cup prong centre','stamper contact'],method:'Stage retiming with a continuous TCP-speed bound; no joint angular-speed cap.'},
    checks:result.checks+' Cup-prong and stamper contact speed limited by trajectory retiming.'};
}
