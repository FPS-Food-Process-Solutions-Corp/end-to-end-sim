import {searchMessage} from './motion-search.js';
import {NovaPairChecker} from './nova-pair-collision.js';
import * as THREE from '../vendor/three.module.js';
import {WorldCollisionChecker,collisionText,transformBox} from './collision-core.js';
import {collisionSettings,worldCollisionEnabled,captureWorld,collisionRequest} from './collision-scene.js';
import {poseSuctionRobot,setupSuctionJoints} from './suction-render.js';
import {poseTongGrip} from './bread-render.js';

const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function collisionFailureMarkup(f,kind='bag') {
  const action=kind==='coffee'?'data-coffee-action="failure"':'data-flow-action="'+(kind==='bread'?'bread-failure':'failure')+'"';
  if(f.reason==='robot_collision')return pairFailureMarkup(f,action);
  const c=f.collision;
  const robotLabel=kind==='coffee'?'Beverage Nova':kind==='bread'?'Nova-5 bread':'Nova-5 suction';
  return '<section class="flow-failure" aria-label="Collision failure details"><h3>'+robotLabel+' · '+escape(c.conservative?'Insufficient collision clearance':'World collision')+
    '</h3><p><b>'+escape(f.phase)+' · '+f.time.toFixed(3)+' s</b></p><p>'+escape(c.robot.link+' / '+c.robot.part)+
    '<br>↔ '+escape(c.world.label+' / '+c.world.part)+'</p><p>This stop is a collision check, not an IK failure. '+
    (c.conservative?'The swept proxies approach within '+((c.uncertainty||0)*1000).toFixed(2)+' mm of the requested margin.':'The simplified solid shapes overlap or violate the clearance margin.')+
    '</p>'+(f.search?'<p><b>'+escape(searchMessage(f.search))+'</b></p>':'')+'<p>Clearance: '+(c.margin*1000).toFixed(1)+' mm'+(c.margin<0?' · permits '+(-c.margin*1000).toFixed(1)+' mm clipping':'')+'. '+(kind==='bread'?'Time is relative to the bread-loading step.':'')+
    '</p><button class="flow-wide" '+action+'>Locate collision · show rejected pose</button><p class="flow-hint">Move the equipment or robot, or adjust the approach/lift and recheck. The planner searches transfer detours within its node budget. Contact moves retain their required approach. A failed search is not proof that no path exists.</p></section>';
}

export function packingCollisionMarkup(request,result) {
  if(!request)return '';
  const row=(kind,label,robot,data,checked,passed,used=true)=>{
    const failure=checked?.failure;
    const enabled=!!data?.enabled;
    const state=!used?'unused':!enabled?'off':!checked?'pending':
      failure?.reason==='world_collision'?'blocked':passed?'clear':'incomplete';
    const text=state==='unused'?'Not used by this bread-loading method':
      state==='off'?'Disabled · enable this robot’s world checks in Collisions':
      state==='pending'?'Waiting for this robot’s route check':
      state==='blocked'?collisionText(failure):
      state==='clear'?'Full route passed · arm, tool and held '+(kind==='suction'?'bag':'bun'):
      checked.errors?.join(' ')||'Route incomplete · collision clearance is not established for the full route';
    return '<div class="nova-collision-result '+state+'" data-nova-collision="'+kind+'" data-state="'+state+'">'+
      '<b>'+label+'</b>'+(robot?'<small>'+escape(robot.label)+'</small>':'')+
      '<p>'+escape(text)+'</p></div>';
  };
  return '<section class="nova-collision-summary" aria-label="Nova-5 world collision checks"><h3>Nova-5 world collision checks</h3>'+
    row('suction','Nova-5 suction',request.robot,request.collision,result,result?.bagPathOK??result?.pathOK)+
    row('bread','Nova-5 bread',request.breadTask?.robot,request.breadTask?.collision,result?.bread,result?.bread?.pathOK,!!request.breadTask)+
    '</section>';
}


export function pairCollisionMarkup(request,result,combined=false) {
  if(!request)return '';
  const report=result?.pairCollision;
  const enabled=!!request.pairCollision?.enabled;
  const state=!enabled?'off':report?.status||'pending';
  const text=!enabled?'Disabled · enable Nova-5 ↔ Nova-5 in Collisions':
    state==='clear'?'Both synchronized routes are clear · arms, tools and held objects':
    state==='blocked'?collisionText(report.failure)+' at '+report.failure.time.toFixed(3)+' s':
    state==='incomplete'?report.message:'Waiting for both routes and the synchronized collision check';
  const detour=result?.pairSearch?.status==='found'?'<p>Placement detour found around the stationary bread Nova-5; full synchronized route rechecked.</p>':'';
  const button=state==='blocked'?'<button '+(combined?'data-order-action="collision-bag"':'data-flow-action="failure"')+'>Inspect Nova-5 conflict</button>':'';
  return '<section class="nova-collision-result '+state+'" data-nova-pair-status="'+state+'"><b>Nova-5 suction ↔ Nova-5 bread</b><p>'+escape(text)+'</p>'+detour+button+'</section>';
}

function pairFailureMarkup(f,action) {
  const c=f.collision;
  return '<section class="flow-failure" aria-label="Nova-5 pair collision details"><h3>Nova-5 ↔ Nova-5 collision</h3>'+
    '<p><b>'+f.time.toFixed(3)+' s · '+escape(f.phase)+'</b></p>'+
    '<p>'+escape(c.first.robotLabel+' / '+c.first.link+' / '+c.first.part)+'<br>↔ '+
    escape(c.second.robotLabel+' / '+c.second.link+' / '+c.second.part)+'</p>'+
    '<p>'+(c.conservative?'The swept shapes could not be certified clear between samples.':'The two robots’ arm, tool or held-item shapes overlap.')+
    ' This is a synchronized collision check, not an IK failure.</p>'+
    '<p>Clearance: '+(c.margin*1000).toFixed(1)+' mm. Move the robots, change the pre-pick/approach poses, or adjust clearance and recheck. Free suction transfers can search a detour after the bread arm has stopped. Overlaps while both arms move require changing their routes; arbitrary rescheduling is not attempted.</p>'+
    '<button class="flow-wide" '+action+'>Locate collision · show both robots</button></section>';
}

export class CollisionControls {
  constructor(store,view,toast,pairSelection) {
    Object.assign(this,{store,view,toast,pairSelection});
    view.collisions=this;
    this.group=new THREE.Group();this.group.name='Collision inspection overlays';view.scene.add(this.group);
    const host=document.createElement('details');host.className='collision-menu';host.id='collision-menu';
    host.innerHTML='<summary>Collisions <span id="collision-indicator">off</span></summary><div class="collision-settings">'+
      '<label><input id="collision-enabled" type="checkbox"> Avoid world collisions</label>'+
      '<div id="collision-world-robots" class="collision-world-robots" role="group" aria-label="World checks per Nova"></div>'+
      '<p>Each checkbox includes the arm, tool and held items. Pair checks below are independent.</p>'+
      '<label><input id="collision-pair-enabled" type="checkbox"> Nova-5 ↔ Nova-5 collisions</label>'+
      '<label><input id="collision-search" type="checkbox"> Search obstacle detours</label><label>Search budget <input id="collision-nodes" type="number" min="100" max="3000" step="100"> nodes</label>'+
      '<label><input id="collision-shapes" type="checkbox"> Show collision shapes</label>'+
      '<label>Clearance <input id="collision-margin" type="number" min="-2" max="5" step=".1" value="0"> cm</label>'+
      '<p>Negative clearance allows that much clipping (e.g. −0.3 cm = 3 mm). Zero requires no overlap; positive values keep a gap.</p><p>Nova arms, tools and held items against visible world objects. The separate Nova-5 pair check compares the selected suction and bread arms. Self collisions and other robot pairs are excluded.</p>'+
      '<button id="collision-check-poses">Check all Nova arm/tool poses</button><button id="collision-check-nova5">Check Nova-5 pair poses</button><div id="collision-status" role="status"></div>'+ 
      '<div id="collision-pose-results"></div><p>Solid boxes approximate each modeled part. Shelf openings and dispenser gaps remain open. Flow checks also test motion between poses.</p></div>';
    document.querySelector('.guides-bar').append(host);this.host=host;
    host.querySelector('#collision-enabled').onchange=e=>store.transact('Changed world collision checking',()=>{
      store.scene.collision_settings={...collisionSettings(store),enabled:e.target.checked};
    });
    host.querySelector('#collision-world-robots').onchange=e=>{
      const id=e.target.dataset.collisionRobotEnabled;if(!id)return;
      const checked=e.target.checked;
      store.transact('Changed world collision checking for '+store.object(id).label,()=>{
        const settings=collisionSettings(store);
        store.scene.collision_settings={...settings,worldRobots:{...settings.worldRobots,[id]:checked}};
      });
    };
    host.querySelector('#collision-margin').onchange=e=>{
      const value=Number(e.target.value);if(!Number.isFinite(value)||value< -2||value>5){this.render();return;}
      store.transact('Changed collision clearance',()=>{store.scene.collision_settings={...collisionSettings(store),margin:value/100};});
    };
    host.querySelector('#collision-search').onchange=e=>store.transact('Changed obstacle search',()=>{store.scene.collision_settings={...collisionSettings(store),search:e.target.checked};});
    host.querySelector('#collision-nodes').onchange=e=>{
      const value=Number(e.target.value);if(!Number.isFinite(value)||value<100||value>3000){this.render();return;}
      store.transact('Changed obstacle search budget',()=>{store.scene.collision_settings={...collisionSettings(store),searchNodes:Math.round(value)};});
    };
    host.querySelector('#collision-shapes').onchange=e=>{
      store.scene.collision_settings={...collisionSettings(store),show:e.target.checked};
      store.emit('option');this.renderShapes();
    };
    host.querySelector('#collision-check-poses').onclick=()=>this.checkPoses(true);
    host.querySelector('#collision-check-nova5').onclick=()=>this.checkPairPose();
    host.querySelector('#collision-pair-enabled').onchange=e=>store.transact('Changed Nova-5 pair collision checking',()=>{store.scene.collision_settings={...collisionSettings(store),robotPairs:e.target.checked};});
    host.querySelector('#collision-pose-results').onclick=e=>{
      if(e.target.closest('[data-pair-pose-result]')&&this.pairPoseFailure)this.locate(this.pairPoseFailure);
      const index=e.target.closest('[data-collision-result]')?.dataset.collisionResult;
      if(index!==undefined)this.locate(this.poseFailures[index]);
    };
    store.on(type=>{
      this.render();
      if(['camera','workflow'].includes(type))return;
      if(!['selection','option'].includes(type)){this.failure=null;clearTimeout(this.timer);this.timer=setTimeout(()=>this.checkPoses(),220);}
      this.renderShapes();
    });
    this.render();
    let last=0;
    const tick=time=>{requestAnimationFrame(tick);if(time-last>250&&collisionSettings(store).show&&view.ready){last=time;this.renderShapes();}};
    requestAnimationFrame(tick);
  }
  render() {
    const s=collisionSettings(this.store);
    this.host.querySelector('#collision-enabled').checked=s.enabled;
    const robots=this.store.scene.objects.filter(o=>o.kind==='robot'&&['nova2','nova5','nova5_suction','nova5_coffee'].includes(this.store.key(o)));
    this.host.querySelector('#collision-world-robots').innerHTML=robots.map(o=>
      '<label><input type="checkbox" data-collision-robot-enabled="'+escape(o.id)+'" '+(s.worldRobots[o.id]!==false?'checked ':'')+(s.enabled?'':'disabled ')+
      '><span>'+escape(o.label)+'<small>'+escape(o.id)+(this.store.visible(o.id)?'':' · hidden')+'</small></span></label>').join('')||'<p>No Nova robots in this scene.</p>';
    this.host.querySelector('#collision-pair-enabled').checked=s.robotPairs;
    this.host.querySelector('#collision-shapes').checked=s.show;
    this.host.querySelector('#collision-search').checked=s.search;
    this.host.querySelector('#collision-nodes').value=s.searchNodes;
    this.host.querySelector('#collision-margin').value=Number((s.margin*100).toFixed(3));
    this.host.querySelector('#collision-indicator').textContent=s.enabled?(s.robotPairs?'world + pair':'world'):(s.robotPairs?'pair':'off');
    if(!s.enabled){this.host.querySelector('#collision-status').textContent='World collisions do not block previews while disabled.';this.host.querySelector('#collision-pose-results').innerHTML='';}
  }
  checkPoses(force=false,nova5Only=false) {
    const policy=collisionSettings(this.store);
    if(!this.view.ready||(!policy.enabled&&!force))return;
    try {
      const world=captureWorld(this.view);this.poseFailures=[];this.poseResults=[];
      const keys=nova5Only?['nova5','nova5_suction']:['nova2','nova5','nova5_suction','nova5_coffee'];
      for(const o of this.store.scene.objects.filter(o=>o.kind==='robot'&&keys.includes(this.store.key(o))&&this.store.visible(o.id))) {
        const variant=this.store.key(o)==='nova5_suction'?'Nova-5 suction':this.store.key(o)==='nova5'?'Nova-5 bread':this.store.key(o)==='nova5_coffee'?'Nova-5 beverages':'Nova-2';
        const entry={robotId:o.id,label:o.label,variant,status:'clear'};
        if(!force&&!worldCollisionEnabled(policy,o.id)){entry.status='off';this.poseResults.push(entry);continue;}
        try {
          const checker=new WorldCollisionChecker(collisionRequest(this.view,o,undefined,world,undefined,{...policy,enabled:true}));
          const r=this.view.instances.get(o.id);
          setupSuctionJoints(r);
          const q=r.joints.map(j=>{
            const d=j.rest.clone().invert().multiply(j.node.quaternion);
            return 2*Math.atan2(d.y,d.w);
          });
          let grip=0;
          const j=r.gripJoints?.[0];
          if(j) {
            const d=j.rest.clone().invert().multiply(j.node.quaternion),angle=2*Math.atan2(new THREE.Vector3(d.x,d.y,d.z).dot(j.axis),d.w)/j.multiplier;
            const range=checker.rig.gripAngles.closed-checker.rig.gripAngles.open;
            if(range)grip=(angle-checker.rig.gripAngles.open)/range;
          }
          const shapes=checker.shapes(q,grip),collision=checker.hit(shapes);
          if(collision){
            entry.status='blocked';
            entry.failureIndex=this.poseFailures.length;
            entry.failure={reason:'world_collision',robotId:o.id,q,grip,gripAngles:checker.rig.gripAngles,collision,time:0,phase:variant+' · current posture'};
            this.poseFailures.push(entry.failure);
          }
        }catch(error){entry.status='error';entry.error=error.message;}
        this.poseResults.push(entry);
      }
      this.host.querySelector('#collision-status').textContent=this.poseResults.length?
        this.poseResults.filter(r=>r.status!=='off').length+' robot arm/tool poses checked · '+this.poseFailures.length+' overlap(s). '+(!policy.enabled?'Route blocking is off. ':'')+'Use the flow check for moving routes and held items.':
        'No visible '+(nova5Only?'Nova-5':'Nova')+' robots to check.';
      this.host.querySelector('#collision-pose-results').innerHTML=this.poseResults.map(r=>
        '<div class="nova-collision-result '+r.status+'" data-collision-robot="'+escape(r.robotId)+'" data-state="'+r.status+'"><b>'+escape(r.variant)+'</b><small>'+escape(r.label)+'</small>'+
        (r.failure?'<button data-collision-result="'+r.failureIndex+'">'+escape(collisionText(r.failure))+' · Locate</button>':
          '<p>'+escape(r.status==='off'?'World checks disabled for this robot':r.error||'Current arm/tool pose is clear')+'</p>')+'</div>').join('');
      this.renderShapes();
    }catch(e){this.host.querySelector('#collision-status').textContent=e.message;}
  }
  checkPairPose() {
    if(!this.view.ready)return;
    try {
      const s=this.pairSelection?.()||this.store.scene.bag_workflow||{};
      const first=this.store.object(s.robot_id)||this.store.scene.objects.find(o=>this.store.key(o)==='nova5_suction');
      const second=this.store.object(s.bread_robot_id)||this.store.scene.objects.find(o=>this.store.key(o)==='nova5');
      if(!first||!second||!this.store.visible(first.id)||!this.store.visible(second.id))throw new Error('Choose two visible Nova-5 robots in the packing settings.');
      const policy={...collisionSettings(this.store),enabled:true};
      const data={first:collisionRequest(this.view,first,undefined,[],undefined,policy),
        second:collisionRequest(this.view,second,undefined,[],undefined,policy),
        firstLabel:first.label,secondLabel:second.label,margin:policy.margin};
      const state=(o,rig)=>{
        const r=this.view.instances.get(o.id);setupSuctionJoints(r);
        const q=r.joints.map(j=>{const d=j.rest.clone().invert().multiply(j.node.quaternion);return 2*Math.atan2(d.y,d.w);});
        let grip=0;const j=r.gripJoints?.[0],range=rig.gripAngles.closed-rig.gripAngles.open;
        if(j&&range){const d=j.rest.clone().invert().multiply(j.node.quaternion);const angle=2*Math.atan2(new THREE.Vector3(d.x,d.y,d.z).dot(j.axis),d.w)/j.multiplier;grip=(angle-rig.gripAngles.open)/range;}
        return {q,grip,time:0,phase:o.label+' current posture'};
      };
      const checker=new NovaPairChecker(data),a=state(first,data.first.rig),b=state(second,data.second.rig);
      const collision=checker.pose(a,b);
      this.pairPoseFailure=collision?checker.failure({a,b,collision}):null;
      this.host.querySelector('#collision-status').textContent=collision?'The selected Nova-5 arm/tool poses overlap.':'The selected Nova-5 arm/tool poses are clear of each other.';
      this.host.querySelector('#collision-pose-results').innerHTML='<p>'+escape(first.label)+' ↔ '+escape(second.label)+'</p>'+
        (collision?'<button data-pair-pose-result>Locate Nova-5 conflict</button>':'')+
        '<p>Current arm/tool poses only. Run the packing flow check for synchronized motion and held bag/bun checks.</p>';
    }catch(error){this.host.querySelector('#collision-status').textContent=error.message;}
  }

  addBox(box,color,solid=false) {
    const geometry=new THREE.BoxGeometry(...box.half.map(v=>Math.max(.0001,2*v)));
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:solid?1:.35,depthTest:!solid}));
    const matrix=new THREE.Matrix4().makeBasis(...box.axes.map(a=>new THREE.Vector3(...a)));
    edges.quaternion.setFromRotationMatrix(matrix);edges.position.fromArray(box.center);
    edges.renderOrder=1001;this.group.add(edges);
    if(solid){const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,depthWrite:false}));mesh.position.copy(edges.position);mesh.quaternion.copy(edges.quaternion);this.group.add(mesh);}
    else geometry.dispose();
  }
  renderShapes() {
    if(!this.view.ready)return;
    this.view.clear(this.group);
    if(collisionSettings(this.store).show) {
      for(const box of captureWorld(this.view))if(box.objectId!=='floor')this.addBox(box,0x42bbc4);
      for(const o of this.store.relevantRobots(true)) {
        if(!['nova2','nova5','nova5_suction','nova5_coffee'].includes(this.store.key(o)))continue;
        const record=this.view.instances.get(o.id);record.node.updateMatrixWorld(true);
        record.mesh.traverse(n=>{if(!n.isMesh)return;if(!n.geometry.boundingBox)n.geometry.computeBoundingBox();
          this.addBox(transformBox({center:n.geometry.boundingBox.getCenter(new THREE.Vector3()).toArray(),
            half:n.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray()},n.matrixWorld),0xf1b365);});
      }
    }
    if(this.failure){const c=this.failure.collision;this.addBox(c.first||c.robot,0xff754b,true);this.addBox(c.second||c.world,0xff335a,true);}
  }
  resetInspection() {
    if(!this.failure)return;
    const ids=this.failure.poses?.map(p=>p.robotId)||[this.failure.robotId];
    for(const id of ids) {
      const object=this.store.object(id),record=this.view.instances.get(id);
      if(!object||!record)continue;
      poseSuctionRobot(record,Array.from({length:6},(_,i)=>(object.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180));
      if(record.gripJoints?.length)poseTongGrip(record,(object.joints_deg?.gripper_r_joint1||0)*Math.PI/180);
    }
    this.failure=null;this.renderShapes();
  }

  locate(f) {
    this.resetInspection();
    this.store.select(null);this.store.setOption('view','scene');this.failure=f;
    this.host.open=false;
    if(f.reason==='robot_collision') {
      for(const pose of f.poses) {
        const record=this.view.instances.get(pose.robotId);if(!record)continue;
        poseSuctionRobot(record,pose.q);
        if(pose.gripAngles&&(pose.gripAngles.open||pose.gripAngles.closed))poseTongGrip(record,pose.gripAngles.open+(pose.gripAngles.closed-pose.gripAngles.open)*pose.grip);
      }
      this.renderShapes();
      const centre=new THREE.Vector3(...f.collision.first.center).lerp(new THREE.Vector3(...f.collision.second.center),.5);
      this.view.controls.target.copy(centre);this.view.camera.position.copy(centre).add(new THREE.Vector3(-1.1,.8,1.1));this.view.controls.update();
      this.toast('Both Nova-5s at the conflict time. Orange and red mark the conflicting parts.');return;
    }
    const record=this.view.instances.get(f.robotId);
    if(record&&f.q)poseSuctionRobot(record,f.q);
    if(record?.gripJoints&&f.grip!==undefined&&f.gripAngles)
      poseTongGrip(record,f.gripAngles.open+(f.gripAngles.closed-f.gripAngles.open)*f.grip);
    this.renderShapes();
    const centre=new THREE.Vector3(...f.collision.robot.center).lerp(new THREE.Vector3(...f.collision.world.center),.5);
    this.view.controls.target.copy(centre);this.view.camera.position.copy(centre).add(new THREE.Vector3(-1.1,.8,1.1));
    this.view.controls.update();
    this.toast('Orange: rejected robot / held-item shape. Red: blocking world object.');
  }
}
