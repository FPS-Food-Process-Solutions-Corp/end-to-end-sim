import {resolveBreadShelf} from './bread-geometry.js';
import {rotate} from './store.js';
import * as T from '../vendor/three.module.js';
const escape = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options = (key,label,values,settings)=>'<label class="flow-field">'+label+'<select data-flow-setting="'+key+'">'+
  values.map(([value,text,disabled])=>'<option value="'+escape(value)+'" '+(settings[key]===value?'selected ':'')+
    (disabled?'disabled':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';

export function breadControls(store,settings,result,request,number) {
  const robots=store.scene.objects.filter(o=>store.key(o)==='nova5').map(o=>[o.id,o.label]);
  const shelves=[['nearest','Nearest visible rack to selected robot'],
    ...store.scene.objects.filter(o=>o.kind==='shelf').map(o=>[o.id,o.label])];
  if(!robots.some(([id])=>id===settings.bread_robot_id))robots.unshift([settings.bread_robot_id,'Choose an available bread robot',true]);
  if(!shelves.some(([id])=>id===settings.bread_shelf_id))shelves.unshift([settings.bread_shelf_id,'Choose an available rack',true]);
  const r=result?.bread, picked=r?.candidate;
  const input=(key,label)=>'<label class="flow-field">'+label+'<div class="flow-number"><input type="number" step=".5" data-flow-setting="'+key+'" value="'+Number(((settings[key]||0)*100).toFixed(2))+'"><span>cm</span></div></label>';
  const report=r?'<p class="flow-meta">'+(r.pathOK?'✓ Bread path found':'× Bread path stopped')+
    ' · '+escape(request?.breadTask?.shelfLabel)+' · tier '+picked?.tier+', column '+picked?.column+
    ', front row<br>'+r.attempts.length+' candidate route'+(r.attempts.length===1?'':'s')+' checked'+
    (r.pathOK?' · '+r.duration.toFixed(1)+' s loading step':'')+(r.searches?.some(s=>s.ok)?' · obstacle detour found':'')+'</p>':'';
  const sync=result?.coordination;
  const schedule=sync?'<p class="flow-meta" data-packing-schedule>'+ (sync.parallel?'Concurrent packing':'Sequential packing')+
    ' · bag ready '+sync.bagReadyTime.toFixed(1)+' s · tongs clear '+sync.breadClearTime.toFixed(1)+' s'+
    (sync.parallel?'<br>Overlap removes '+sync.timeSavedBeforeCarry.toFixed(1)+' s before bag carry. Bread waits '+sync.breadWait.toFixed(1)+' s for opening.':'')+'</p>':'';
  return '<details class="flow-settings" open><summary>Bread loading</summary>'+
    options('bread_mode','Loading method',[['magic','Magic · bread falls from sky'],['nova','Pick with bread Nova-5'],
      ['atom','Pick with Atom-W · coming later',true]],settings)+
    (settings.bread_mode==='nova'?
      '<label class="checkline"><input type="checkbox" data-flow-setting="bread_parallel" '+(settings.bread_parallel?'checked':'')+'> Overlap bag opening + bread pickup</label>'+
      '<p class="flow-hint">Both robots start together. Bread waits above the bag until it is open; the bag waits until the bun is placed and the tongs withdraw. Changing this timing reruns enabled collision checks.</p>'+
      options('bread_robot_id','Bread Nova-5',robots,settings)+
      options('bread_shelf_id','Rack to pick from',shelves,settings)+
      options('bread_pick_method','Nova pickup method',[['aim','Pre-pick → aim in place → tool +Z'],['direct','Direct IK → tong contact']],settings)+
      options('bread_grasp','Grip orientation',[['sides','Sides · jaws left/right'],['top_bottom','Top / bottom · legacy']],settings)+
      options('bread_pre_pick_mode','Pre-pick position',[['offset','Offset from selected bun'],['fixed','Fixed point relative to rack']],settings)+
      input('bread_pre_pick_x',settings.bread_pre_pick_mode==='fixed'?'X · across rack from centre':'Across offset from bun')+
      (settings.bread_pre_pick_mode==='fixed'?input('bread_pre_pick_y','Y · rack centre; negative = front'):number('bread_approach','Setback in front of bun',settings.bread_approach,.1))+
      input('bread_pre_pick_z',settings.bread_pre_pick_mode==='fixed'?'Z · above rack base':'Height offset above bun')+
      '<div class="flow-actions"><button data-bread-action="preview">Show pre-pick pose</button><button data-bread-action="capture">Use displayed tool position</button></div>'+
      '<p class="flow-hint">Fixed coordinates move and rotate with the rack. The offset mode follows the selected bun. The tool aims at the bun from this point and advances along +Z.</p>'+
      number('bread_lift','Bread lift / overhead clearance',settings.bread_lift,.1)+
      '<p class="flow-hint">Side gripping uses the bun width and actual jaw aperture; oversized buns are reported. Tries front-row buns nearest the arm first. The tongs turn downward and lower the bun on its edge into the bag. The bag stays open until the jaws withdraw.</p>'+report+schedule+
      (request?.breadTask?'<p class="flow-meta">Bun entering opening: '+(request.breadSize[0]*100).toFixed(1)+' × '+
        (request.breadSize[2]*100).toFixed(1)+' cm (width × thickness).</p>':''):
      options('bread_shelf_id','Bread size reference rack',shelves,settings))+'</details>';
}


function framePrePick(view,shelf,pre,bun) {
  const centre=pre.clone().lerp(bun,.5),ray=new T.Raycaster();
  const toolBack=pre.clone().add(pre.clone().sub(bun).normalize().multiplyScalar(.13));
  const targets=[pre,bun,toolBack];
  view.physical.updateMatrixWorld(true);
  let best;
  // Prefer a close view from the open front of the rack, avoiding the robot
  // shoulder, counter signage and the tier above the selected bread.
  for(const front of [-.12,-.30,-.58])for(const height of [.08,.20,.35])for(const across of [-.45,.45,-.25,.25]) {
    const offset=rotate(across,front,shelf.yaw_deg||0);
    const camera=centre.clone().add(new T.Vector3(offset[0],height,-offset[1]));
    const clear=targets.map(target=>{
      ray.set(camera,target.clone().sub(camera).normalize());
      ray.near=0;ray.far=camera.distanceTo(target)-.045;
      return !ray.intersectObject(view.physical,true).length;
    });
    const score=(clear[0]?3:0)+(clear[1]?2:0)+(clear[2]?1:0);
    if(!best||score>best.score)best={camera,score};
    if(score===6)break;
  }
  view.controls.target.copy(centre);
  view.camera.position.copy(best.camera);
  view.controls.update();
}

export function handleBreadPoseAction(event,store,view,settings,toast,apply) {
  const action=event.target.closest('[data-bread-action]')?.dataset.breadAction;
  if(!action)return false;
  (async()=>{
    const {setupSuctionJoints,poseSuctionRobot}=await import('./suction-render.js');
    const {poseTongGrip,gripAngles}=await import('./bread-render.js');
    const robot=store.object(settings.bread_robot_id),shelf=resolveBreadShelf(store,settings);
    const record=robot&&view.instances.get(robot.id);
    if(!record||!shelf)throw new Error('Choose a loaded bread Nova and rack.');
    setupSuctionJoints(record);
    if(action==='capture') {
      const p=record.tcp.getWorldPosition(new T.Vector3()),local=rotate(p.x-shelf.x,-p.z-shelf.y,-(shelf.yaw_deg||0));
      apply({bread_pre_pick_mode:'fixed',bread_pre_pick_x:local[0],bread_pre_pick_y:local[1],bread_pre_pick_z:p.y-store.z(shelf)});
      toast('Displayed tool position saved relative to the rack.');return;
    }
    const {makeWorkflowRequest}=await import('./flow-geometry.js'),{SuctionArm}=await import('./ik-core.js');
    const request=makeWorkflowRequest(store,{...settings,bread_mode:'nova'}),bread=request.breadTask;
    const definition=await fetch('./robot-library/nova5_bread-kinematics.json').then(r=>r.json());
    const arm=new SuctionArm(definition,robot,store.z(robot));
    let candidate=bread.candidates[0],result;
    for(const c of bread.candidates) {
      const solved=arm.solveMultiple({position:c.prePosition,quaternion:c.toolQuaternion},arm.initial);
      if(!result||solved.ok){candidate=c;result=solved;}
      if(solved.ok)break;
    }
    store.setOption('view','scene');
    await Promise.resolve(); // Let an active combined preview finish its option refresh first.
    if(result.ok) {
      poseSuctionRobot(record,result.q);
      poseTongGrip(record,gripAngles(record,bread.graspWidth/(robot.robot_scale||1)).open);
    }
    if(view.breadPrePickGuide){view.clear(view.breadPrePickGuide);view.breadPrePickGuide.removeFromParent();}
    const group=new T.Group();group.name='Bread pre-pick inspection';group.userData={candidate,ikOK:result.ok};view.scene.add(group);view.breadPrePickGuide=group;
    const point=p=>new T.Vector3(p[0],p[2],-p[1]),pre=point(candidate.prePosition),bun=point(candidate.position);
    for(const [p,color] of [[pre,0x22cba8],[bun,0xf1ae42]]) {
      const marker=new T.Mesh(new T.SphereGeometry(.012,16,12),new T.MeshBasicMaterial({color,depthTest:false}));marker.position.copy(p);marker.renderOrder=1100;group.add(marker);
    }
    group.add(new T.ArrowHelper(bun.clone().sub(pre).normalize(),pre,pre.distanceTo(bun),0x22cba8,.04,.02));
    framePrePick(view,shelf,pre,bun);
    toast((result.ok?'Pre-pick pose shown':'Pre-pick IK did not converge')+' · tier '+candidate.tier+', column '+candidate.column+'. Green: tool start; amber: bun. Pre-pick IK only; check the full flow before playback.');
  })().catch(error=>toast(error.message));
  return true;
}
