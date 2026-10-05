import {coordinatePacking} from './packing-timeline.js';
import {SuctionArm} from './ik-core.js';
import {limitCoffeeSpeed} from './coffee-timing.js';

export function acceptedEnd(result) {
  if(!result?.frames?.length)return 0;
  const end=result.frames.at(-1).time;
  return result.failure?.reason==='robot_collision'
    ?Math.min(end,result.failure.segment?.startTime??0):end;
}

export function packingDiagnostic(request,result) {
  if(!request||!result||result.pathOK)return null;
  if(request.settings?.bread_parallel===true&&result.bread&&!result.coordination&&result.route) {
    const preview=coordinatePacking(result,result.bread,true);
    const bagEnd=result.bagPathOK?Infinity:acceptedEnd(preview);
    const breadEnd=result.bread.pathOK?Infinity:preview.bread.frames.at(-1)?.time||0;
    const end=Math.min(bagEnd,breadEnd);
    return end>0&&Number.isFinite(end)?{end,result:preview}:null;
  }
  if(result.bread&&!result.bread.pathOK&&result.bagPathOK) {
    const bread=result.bread,last=bread.frames.at(-1)?.time||0;
    const start=result.route.knots.find(k=>k.phase==='Pull the bag open')?.time;
    const oldEnd=result.route.knots.find(k=>k.phase==='Wait for bun loading')?.time;
    if(start===undefined||oldEnd===undefined)return null;
    const end=start+last,shift=Math.max(0,last+.01-(oldEnd-start));
    const remap=t=>t<=start?t:t>=oldEnd?t+shift:start+(t-start)*(oldEnd+shift-start)/(oldEnd-start);
    return {end,result:{...result,frames:result.frames.map(f=>({...f,time:remap(f.time)})),
      route:{...result.route,duration:result.route.duration+shift,knots:result.route.knots.map(k=>({...k,time:remap(k.time)}))},
      bread:last?{...bread,startTime:start,endTime:end,duration:last}:null}};
  }
  const end=acceptedEnd(result);
  if(end<=0)return null;
  return {end,result:{...result,bread:result.bread?.startTime!==undefined?result.bread:null}};
}

export function coffeeDiagnostic(request,result,definition) {
  const end=acceptedEnd(result);
  if(!request||!result||result.pathOK||end<=0||!definition)return null;
  const route=result.route||request;
  const knots=route.knots.filter(k=>k.time<=end);
  if(knots.at(-1).time<end) {
    const a=knots.at(-1),b=route.knots.find(k=>k.time>end),f=(end-a.time)/(b.time-a.time);
    knots.push({...a,phase:b.phase,time:end,fill:a.fill+(b.fill-a.fill)*f});
  }
  const partial={...request,knots,events:route.events.filter(e=>e.time<=end),duration:end};
  const arm=new SuctionArm(definition,request.robot,request.mountingHeight);
  // Retiming only the accepted prefix does not change the failed validation result.
  const timed=limitCoffeeSpeed(arm,partial,{...result,frames:result.frames.filter(f=>f.time<=end)}, {partial:true});
  return {end:timed.duration,sourceEnd:end,result:timed,request:{...request,...timed.route}};
}
