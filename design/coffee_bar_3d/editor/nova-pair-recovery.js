import {SuctionArm} from './ik-core.js';
import {WorldCollisionChecker} from './collision-core.js';
import {NovaPairChecker,checkNovaPair} from './nova-pair-collision.js';
import {searchJointPath,detourFrames,retimeDetours} from './motion-search.js';
import {MOTION_DEFAULTS,inspectHeldInterval,jointTravel} from './bag-motion.js';

// Recover free transfers only after the bread arm has completed its route.
// Its final geometry is then a valid obstacle for every instant of the detour.
// The complete synchronized route must still pass the independent pair sweep.
export function recoverNovaPair(definition,request,result,progress=()=>{}) {
  const initial=checkNovaPair(request,result,progress);
  if(initial.status!=='blocked'||request.collision?.search===false)return result;
  const diagnostic={method:'stationary Nova-5 avoidance; upright RRT-Connect',attempts:[],originalFailure:initial.failure};
  const unchanged=status=>({...result,pairSearch:{...diagnostic,status}});
  const knots=result.route?.knots||[];
  const index=knots.findIndex((k,i)=>i>0&&initial.failure.time>knots[i-1].time&&initial.failure.time<=k.time);
  if(index<1)return unchanged('no_free_segment');
  const a=knots[index-1],b=knots[index];
  if(!(b.clearance||b.transfer||b.alignmentFor)||a.fixedVacuum||b.fixedVacuum||a.bagState!==b.bagState)
    return unchanged('protected_motion');
  if(result.bread&&a.time<result.bread.endTime-1e-8)return unchanged('other_robot_moving');
  const from=result.frames.findIndex(f=>Math.abs(f.time-a.time)<1e-7);
  const to=result.frames.findIndex(f=>Math.abs(f.time-b.time)<1e-7);
  if(from<0||to<=from)return unchanged('missing_segment_endpoints');
  const start=result.frames[from],end=result.frames[to];
  const pair=new NovaPairChecker(request.pairCollision);
  if(result.bread?.candidate)pair.second.setPayloadRotation(result.bread.candidate.relative);
  const stationary=result.bread?.frames.at(-1)||request.pairCollision.stationaryBread;
  const obstacles=pair.shapes(pair.second,stationary).map(box=>({...box,
    objectId:request.pairCollision.second.robotId,label:request.pairCollision.secondLabel}));
  const arm=new SuctionArm(definition,request.robot,request.mountingHeight);
  arm.collision=new WorldCollisionChecker({...request.collision,enabled:true,
    world:[...(request.collision.enabled?request.collision.world:[]),...obstacles]});
  const settings={...MOTION_DEFAULTS,...request.settings};
  const held=start.bagState==='carried'&&start.robotVacuum;
  const cap=Math.min(4800,Math.max(1200,request.collision.searchNodes||600));
  for(const nodes of [...new Set([cap,Math.min(4800,cap*2)])]) {
    progress({phase:'nova-pair-recovery',completed:diagnostic.attempts.length,total:2});
    const found=searchJointPath(arm,start,end,{budget:{remaining:nodes,used:0,searches:0},
      tiltLimit:held?settings.max_bag_tilt_deg:null,
      minimumJ1Share:held&&settings.prefer_j1?settings.min_j1_share:0});
    const report={...found,path:undefined,budget:nodes};diagnostic.attempts.push(report);
    if(!found.ok)continue;
    const detour=detourFrames(arm,start,end,found.path);
    report.suggestedDuration=detour.suggestedDuration;
    const frames=[...result.frames.slice(0,from+1),...detour.frames,...result.frames.slice(to+1)];
    let peak=0,bound=0;
    if(held)for(let i=from+1;i<=from+detour.frames.length;i++) {
      const tilt=inspectHeldInterval(arm,frames[i-1],frames[i],settings.max_bag_tilt_deg);
      peak=Math.max(peak,tilt.peakDegrees);bound=Math.max(bound,tilt.upperBoundDegrees);
      if(!tilt.ok){report.ok=false;report.status='tilt_check_failed';break;}
    }
    if(!report.ok)continue;
    // Existing searches were already retimed. Apply only this new segment's timing.
    const timed=retimeDetours({...result,frames,searches:[report]},knots);
    const changed=[start,...detour.frames];
    const motion={...result.motion,...jointTravel(timed.result.frames),
      maxBagTiltDegrees:Math.max(result.motion?.maxBagTiltDegrees||0,peak),
      maxTiltBoundDegrees:Math.max(result.motion?.maxTiltBoundDegrees||0,bound),
      transfers:(result.motion?.transfers||[]).map(t=>t.id===b.transfer?
        {...t,route:'stationary Nova-5 detour',...jointTravel(changed)}:t)};
    const candidate={...timed.result,motion,searches:[...(result.searches||[]),report],
      route:{...result.route,knots:timed.knots,duration:timed.duration}};
    // Bread finishes before this segment, so its start/end and local frames stay fixed.
    const checked=checkNovaPair(request,candidate,progress);
    report.pairStatus=checked.status;
    if(checked.status==='clear')return {...candidate,pairSearch:{...diagnostic,status:'found'},pairCollision:checked};
    report.ok=false;report.status='synchronized_recheck_blocked';report.failure=checked.failure;
  }
  return unchanged('no_valid_detour');
}
