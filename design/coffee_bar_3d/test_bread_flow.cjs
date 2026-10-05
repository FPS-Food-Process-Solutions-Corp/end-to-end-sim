const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:1100}});
  const errors=[],passed=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.flow.result,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>coffeeEditor.flow.result.pathOK),true);
  // A 6 cm bun fits the real Lebai aperture for the new side grip.
  await page.evaluate(()=>{for(const shelf of coffeeEditor.store.scene.objects.filter(o=>o.kind==='shelf'))shelf.shelf_overrides={...coffeeEditor.store.shelfSettings(shelf),bread_length_1:.06};coffeeEditor.three.sync();});
  await page.locator('[data-panel="flow"]').click();
  await page.locator('[data-flow-setting="bread_mode"]').selectOption('nova');
  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread,null,{timeout:90000});
  const initial=await page.evaluate(()=>({r:coffeeEditor.flow.result,request:coffeeEditor.flow.request}));
  assert.ok(initial.r.pathOK);
  assert.equal(initial.r.bread.shelfId,'shelf_2');
  assert.equal(initial.request.breadFits,true);
  assert.equal(initial.request.errors.length,0);
  assert.ok(await page.locator('#flow-play').isEnabled());
  assert.ok(await page.locator('[data-flow-setting="bread_mode"] option[value="atom"]').evaluate(el=>el.disabled));
  const bread=initial.r.bread,knots=bread.knots;
  const pre=knots.find(k=>k.phase==='Bread: move to pre-pick'),aim=knots.find(k=>k.phase.includes('aim tool'));
  assert.deepEqual(pre.position,aim.position);
  const advance=knots.find(k=>k.phase.includes('advance'));
  const advanceFrames=bread.frames.filter(f=>f.time>aim.time&&f.time<=advance.time);
  const direction=advance.position.map((v,i)=>v-aim.position[i]);
  const length=Math.hypot(...direction);
  for(const frame of advanceFrames){
   const delta=frame.target.position.map((v,i)=>v-aim.position[i]);
   const fraction=delta.reduce((s,v,i)=>s+v*direction[i],0)/(length*length);
   near(Math.hypot(...delta.map((v,i)=>v-direction[i]*fraction)),0,1e-8);
  }
  const lower=knots.find(k=>k.phase.includes('lower vertically')),above=knots.find(k=>k.phase.includes('carry above'));
  near(lower.position[0],above.position[0]);near(lower.position[1],above.position[1]);
  const holdStart=initial.r.route.knots.find(k=>k.phase==='Pull the bag open').time;
  const fixedRelease=initial.r.route.knots.find(k=>k.phase==='Release fixed suction').time;
  assert.ok(fixedRelease>bread.endTime);
  const hold=initial.r.frames.filter(f=>f.time>=holdStart&&f.time<bread.endTime);
  assert.ok(hold.every(f=>f.fixedVacuum&&f.robotVacuum));
  assert.ok(hold.every(f=>f.q.every((q,j)=>Math.abs(q-hold[0].q[j])<.001)));
  passed.push('Aimed pickup keeps TCP fixed, approaches along tool +Z, and lowers vertically; both vacuums hold until the bread arm withdraws.');

  const visuals=await page.evaluate(async()=>{
   const {flow,three,store}=coffeeEditor,T=await import('./vendor/three.module.js');
   const {SuctionArm}=await import('./editor/ik-core.js');
   const {poseSuctionRobot,setupSuctionJoints}=await import('./editor/suction-render.js');
   const {rackBreads}=await import('./editor/bread-geometry.js');
   const d=await fetch('./robot-library/nova5_bread-kinematics.json').then(r=>r.json());
   const arm=new SuctionArm(d,flow.request.breadTask.robot,flow.request.breadTask.mountingHeight);
   const record=three.instances.get('nova5');setupSuctionJoints(record);
   const fkErrors=[];
   for(const q of [[0,0,0,0,0,0],[.2,-.4,1.1,.7,-1.2,.3]]){
    poseSuctionRobot(record,q);const fk=arm.forward(q);
    fkErrors.push(record.tcp.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(fk.position.x,fk.position.z,-fk.position.y)));
   }
   const r=flow.result.bread,grab=r.knots.find(k=>k.breadState==='held').time;
   flow.player.seek(r.startTime+grab);
   const bp=flow.player.breadPlayer,source=bp.source;
   const expected=new T.Vector3(r.candidate.position[0],r.candidate.position[2],-r.candidate.position[1]);
   const sourceError=source.getWorldPosition(new T.Vector3()).distanceTo(expected);
   const grabbed={sourceHidden:!source.visible,breadVisible:flow.player.bread.visible,angles:bp.angles,
     centreError:flow.player.bread.position.distanceTo(record.tcp.getWorldPosition(new T.Vector3())),
     orientationError:flow.player.bread.quaternion.angleTo(source.getWorldQuaternion(new T.Quaternion()))};
   const held=r.knots.find(k=>k.phase.includes('carry above')).time;
   flow.player.seek(r.startTime+held);
   const heldCentre=flow.player.bread.position.distanceTo(record.tcp.getWorldPosition(new T.Vector3()));
   flow.player.seek(flow.result.route.duration);
   const final=flow.player.bread.position.clone();
   const finalBag=flow.player.bag.position.clone();
   flow.player.seek(0);
   const backward={sourceVisible:source.visible,breadHidden:!flow.player.bread.visible};
   flow.player.stop();
   return {fkErrors,sourceError,grabbed,heldCentre,final:final.toArray(),finalBag:finalBag.toArray(),
     backward,resetVisible:source.visible,allLimits:r.frames.every(f=>f.q.every((q,i)=>q>=d.joints[i].lower&&q<=d.joints[i].upper))};
  });
  assert.ok(visuals.fkErrors.every(e=>e<1e-5));
  near(visuals.sourceError,0);
  assert.ok(visuals.grabbed.sourceHidden&&visuals.grabbed.breadVisible);
  near(visuals.grabbed.centreError,0);near(visuals.heldCentre,0);
  assert.ok(visuals.grabbed.orientationError<Math.PI/180);
  assert.ok(visuals.grabbed.angles.open>visuals.grabbed.angles.closed);
  assert.ok(visuals.grabbed.angles.open<=Math.PI/3);
  near(visuals.grabbed.angles.contactGap,.06,.001);
  assert.ok(visuals.backward.sourceVisible&&visuals.backward.breadHidden&&visuals.resetVisible);
  assert.ok(visuals.allLimits);
  passed.push('Rendered tong TCP agrees with URDF FK; the exact selected bun is removed/restored; jaw contact and all arm/gripper joint limits are respected.');

  await page.locator('[data-flow-setting="bread_pick_method"]').selectOption('direct');
  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread&&coffeeEditor.flow.request.settings.bread_pick_method==='direct',null,{timeout:90000});
  const direct=await page.evaluate(()=>({r:coffeeEditor.flow.result.bread,ok:coffeeEditor.flow.result.pathOK}));
  assert.ok(direct.ok);
  assert.ok(!direct.r.knots.some(k=>k.phase.includes('aim tool')));
  assert.ok(direct.r.knots.some(k=>k.phase.includes('direct IK')));
  passed.push('Direct IK pickup also solves and omits the in-place aiming step.');

  const extra=await page.evaluate(async()=>{
   const {store,flow}=coffeeEditor;
   store.scene.bag_workflow.auto_check=false;
   const {makeWorkflowRequest}=await import('./editor/flow-geometry.js');
   const {checkBreadWorkflow}=await import('./editor/bread-flow.js');
   const {SceneStore}=await import('./editor/store.js');
   const {captureComponents,insertComponents}=await import('./editor/component-copy.js');
   const original=store.exportScene();
   // A cloned tongs robot is independently selectable; auto rack follows its location.
   const copy=JSON.parse(JSON.stringify(store.object('nova5')));copy.id='bread_copy';copy.label='Second bread Nova';copy.y=4.65;
   store.transact('Test copied bread arm',()=>{store.scene.objects.push(copy);store.scene.bag_workflow.bread_robot_id=copy.id;});
   const copied=makeWorkflowRequest(store);
   const copyOptions=[...document.querySelectorAll('[data-flow-setting="bread_robot_id"] option')].map(o=>o.value);
   store.scene.bag_workflow.bread_shelf_id='shelf_2';
   const explicit=makeWorkflowRequest(store);
   const exported=store.exportScene();
   const roundTrip=new SceneStore(exported);
   const importTask=makeWorkflowRequest(roundTrip).breadTask;
   // Missing/hidden robot and empty shelf cannot retain a valid preview.
   copy.visible=false;let hidden;
   try{makeWorkflowRequest(store)}catch(e){hidden=e.message}
   copy.visible=true;store.object('shelf_2').shelf_overrides={show_buns:false};let empty;
   try{makeWorkflowRequest(store)}catch(e){empty=e.message}
   store.importScene(original);store.scene.bag_workflow.auto_check=false;
   const request=makeWorkflowRequest(store);
   request.breadTask.robot={...request.breadTask.robot,x:20};
   request.breadTask.candidates=request.breadTask.candidates.slice(0,1);
   const def=await fetch('./robot-library/nova5_bread-kinematics.json').then(r=>r.json());
   const failure=checkBreadWorkflow(def,request.breadTask);
   const oversizedGrip=checkBreadWorkflow(def,{...request.breadTask,size:[.102,.094,.10],graspWidth:.102});
   const {failureMarkup}=await import('./editor/flow-diagnostics.js');
   const markup=failureMarkup(failure.failure,'bread');
   store.object('shelf_2').shelf_overrides={bread_length_1:.3};
   const oversized=makeWorkflowRequest(store).errors;
   store.importScene(original);store.scene.bag_workflow.auto_check=false;
   flow.check();
   return {copyOptions,copyRobot:copied.breadTask.robot.id,autoShelf:copied.breadTask.shelfId,
     explicitShelf:explicit.breadTask.shelfId,importRobot:importTask.robot.id,hidden,empty,
     failed:failure.pathOK,failure:failure.failure,markup,oversized,oversizedGrip};
  });
  assert.ok(extra.copyOptions.includes('bread_copy'));
  assert.equal(extra.copyRobot,'bread_copy');assert.equal(extra.autoShelf,'shelf_1');
  assert.equal(extra.explicitShelf,'shelf_2');assert.equal(extra.importRobot,'bread_copy');
  assert.match(extra.hidden,/hidden/);assert.match(extra.empty,/no visible bread/i);
  assert.equal(extra.failed,false);assert.equal(extra.failure.robotId,'nova5');
  assert.ok(extra.failure.positionError>.001);assert.match(extra.markup,/Bread Nova/);
  assert.equal(extra.oversizedGrip.pathOK,false);assert.match(extra.oversizedGrip.errors[0],/tongs open/);
  assert.match(extra.markup,/bread-failure/);assert.ok(extra.oversized.some(e=>e.includes('does not fit')));
  passed.push('Copied robot, nearest/explicit rack, import persistence, hidden/empty inputs, oversized buns, and robot-specific IK failures work.');

  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread,null,{timeout:90000});
  const saved=await page.evaluate(async()=>{
   const {flow,store,plan,three}=coffeeEditor;
   const svg=await plan.exportSVG(false);
   flow.player.seek(flow.result.bread.startTime+flow.result.bread.knots.find(k=>k.phase.includes('carry above')).time);
   const glb=await three.glb();
   const data=glb instanceof Blob?await glb.arrayBuffer():glb;
   const view=new DataView(data),length=view.getUint32(12,true);
   const document=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,length)).trim());
   flow.player.stop();
   // Save the existing settings through the normal UI store event.
   store.transact('Persist bread flow',()=>{store.scene.bag_workflow.auto_check=false;});
   return {svg:svg.includes('bread_pick_method')&&svg.includes('direct'),glbNames:document.nodes.map(n=>n.name||''),bytes:data.byteLength};
  });
  assert.ok(saved.svg);assert.ok(saved.glbNames.some(n=>/Bread[ _]grasp[ _]centre/.test(n)));
  assert.ok(saved.bytes>100000);
  await page.waitForTimeout(600);await page.reload();
  await page.waitForFunction(()=>window.coffeeEditor?.ready);
  const restored=await page.evaluate(()=>coffeeEditor.flow.settings());
  assert.equal(restored.bread_mode,'nova');assert.equal(restored.bread_pick_method,'direct');
  passed.push('SVG retains flow settings; GLB exports the articulated robot and paused bun; reload restores the selected loading method.');

  await page.evaluate(()=>{const {store,flow,three}=coffeeEditor;store.setOption('view','scene');store.select(null);store.setOption('showAllReach',false);flow.frame();three.controls.target.set(2,1.02,-2.95);three.camera.position.set(.4,2.4,-1.2);three.controls.update();});
  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread,null,{timeout:90000});
  await page.evaluate(()=>{const f=coffeeEditor.flow;f.player.seek(f.result.bread.startTime+f.result.bread.knots.find(k=>k.phase.includes('carry above')).time)});
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(__dirname,'output/bread-flow-preview.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(__dirname,'output/bread-flow-test-report.json'),JSON.stringify({passed,visuals,selected:initial.r.bread.candidate,duration:initial.r.route.duration},null,2));
  console.log(JSON.stringify({passed,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
