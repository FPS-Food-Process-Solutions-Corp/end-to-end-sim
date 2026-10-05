const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1700,height:1080}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.flow.result,null,{timeout:90000});
  const unit=await page.evaluate(async()=>{
   const {coordinatePacking}=await import('./editor/packing-timeline.js');
   const {packingDiagnostic}=await import('./editor/failure-preview.js');
   const checks=[],check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name)};
   const frame=(time,phase,breadState='held')=>({time,phase,breadState,q:[time,0,0,0,0,0],grip:1});
   const bread={pathOK:true,duration:12,knots:[frame(3,'Bread: move to pre-pick','rack'),frame(5,'Bread: carry above open bag'),
    frame(8,'Bread: lower vertically into bag'),frame(9,'Bread: release bun','released'),frame(10,'Bread: settle in bag','loaded'),frame(12,'Bread: withdraw jaws vertically','loaded')]};
   bread.frames=[frame(0,'Bread: move to pre-pick','rack'),...bread.knots];
   const bag={pathOK:true,frames:[frame(0,'Start'),frame(20,'Pull the bag open'),frame(23,'Wait for bun loading'),frame(24,'Release fixed suction'),frame(40,'Finish')],
    route:{duration:40,knots:[{time:0,phase:'Start'},{time:20,phase:'Pull the bag open'},{time:23,phase:'Wait for bun loading'},{time:24,phase:'Release fixed suction'},{time:40,phase:'Finish'}]}};
   const original=JSON.stringify([bag,bread]),parallel=coordinatePacking(bag,bread,true),serial=coordinatePacking(bag,bread,false);
   check(parallel.bread.startTime===0&&serial.bread.startTime===20,'Toggle selects simultaneous or sequential start');
   check(parallel.coordination.insertionStartTime===20&&parallel.bread.waitForBag===15,'Early bread waits above the bag until opening finishes');
   const wait=parallel.bread.frames.find(f=>f.phase==='Bread: wait for bag to open');
   check(wait.time===20&&wait.q[0]===5,'Wait inserts a stationary pose rather than slowing or moving the arm');
   check(parallel.coordination.bunPlacedTime===25&&parallel.coordination.breadClearTime===27,'Bun settling and tong withdrawal keep their process durations');
   check(parallel.route.knots.find(k=>k.phase==='Release fixed suction').time===28,'Fixed suction cannot release before placement and withdrawal finish');
   check(parallel.route.duration===44&&serial.route.duration===49&&parallel.coordination.timeSavedBeforeCarry===5,'Overlap removes serial waiting from the overall timeline');
   check(JSON.stringify([bag,bread])===original,'Scheduling does not mutate original solved routes');
   const quickBag=structuredClone(bag);quickBag.route.knots[1].time=2;quickBag.route.knots[2].time=5;
   const slowBread=coordinatePacking(quickBag,bread,true);
   check(slowBread.bread.waitForBag===0&&slowBread.coordination.insertionStartTime===5&&slowBread.coordination.bagHoldEndTime===12,'Bag waits when bread pickup takes longer');
   const request={settings:{bread_parallel:true}},failed={...bread,pathOK:false,frames:bread.frames.slice(0,2),failure:{time:4,phase:'Pick failed'}};
   const early=packingDiagnostic(request,{...bag,pathOK:false,bagPathOK:true,bread:failed});
   check(early.end===3&&early.result.bread.frames.length===2,'Failed pickup prefix does not invent a waiting pose or advance to insertion');
   const later={...bread,pathOK:false,frames:bread.frames.slice(0,4),failure:{time:8.2,previous:{time:8},segment:{startTime:5,endTime:8.2}}};
   const partial=packingDiagnostic(request,{...bag,pathOK:false,bagPathOK:true,bread:later});
   check(partial.end===23&&partial.result.bread.failure.time===23.2,'Failures after the wait have synchronized diagnostic times');
   const bagFailed={...bag,pathOK:false,frames:[frame(0,'Start'),frame(8,'Opening failed')],bread};
   const stopped=packingDiagnostic(request,bagFailed);
   check(stopped.end===8&&stopped.result.bread.insertionStartTime===20,'Failed bag opening stops concurrent preview before insertion');
   check(packingDiagnostic(request,{...bag,pathOK:false,bagPathOK:true,bread:{...failed,frames:[]}})===null,'No accepted bread prefix means no concurrent preview');
   return checks;
  });
  await page.evaluate(()=>{
   const e=coffeeEditor;e.flow.suspended=true;
   e.store.transact('Test real bread',()=>{
    for(const shelf of e.store.scene.objects.filter(o=>o.kind==='shelf'))shelf.shelf_overrides={...e.store.shelfSettings(shelf),bread_length_1:.06};
    e.store.scene.bag_workflow={...e.flow.settings(),bread_mode:'nova',bread_parallel:false};
   });
   e.three.sync();e.flow.suspended=false;e.flow.check();
  });
  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread,null,{timeout:90000});
  const serial=await page.evaluate(()=>({ok:coffeeEditor.flow.result.pathOK,duration:coffeeEditor.flow.result.route.duration,frames:coffeeEditor.flow.result.bread.frames}));
  assert.ok(serial.ok);
  await page.locator('[data-flow-setting="bread_parallel"]').check();
  await page.waitForFunction(()=>coffeeEditor.flow.result?.coordination?.parallel,null,{timeout:90000});
  const concurrent=await page.evaluate(async()=>{
   const e=coffeeEditor,r=e.flow.result,c=r.coordination;
   const {sampleRobotTrack}=await import('./editor/nova-pair-collision.js');
   e.flow.player.seek(2);
   const rendered=(id,q)=>e.three.instances.get(id).joints.every((j,i)=>{
    const d=j.rest.clone().invert().multiply(j.node.quaternion);
    return Math.abs(2*Math.atan2(d.y,d.w)-q[i])<1e-6;
   });
   const both=rendered(e.flow.request.robot.id,sampleRobotTrack(r.frames,2).q)&&rendered(e.flow.request.breadTask.robot.id,sampleRobotTrack(r.bread.frames,2).q);
   const open=sampleRobotTrack(r.frames,c.bagReadyTime),middle=sampleRobotTrack(r.frames,(c.bagReadyTime+c.breadClearTime)/2);
   const held=open.q.every((v,i)=>Math.abs(v-middle.q[i])<1e-6)&&middle.fixedVacuum;
   e.flow.player.seek(c.bunPlacedTime);
   const bunVisible=e.flow.player.bread.visible;
   e.flow.frame();
   return {ok:r.pathOK,duration:r.route.duration,coordination:c,both,held,bunVisible,
    frames:r.bread.frames.filter(f=>f.phase!=='Bread: wait for bag to open'),
    svg:(await e.plan.exportSVG(false)).includes('bread_parallel')};
  });
  assert.ok(concurrent.ok&&concurrent.both&&concurrent.held&&concurrent.bunVisible&&concurrent.svg);
  assert.ok(concurrent.duration<serial.duration);
  assert.deepEqual(concurrent.frames.map(f=>f.q),serial.frames.map(f=>f.q));
  assert.ok(concurrent.coordination.insertionStartTime>=concurrent.coordination.bagReadyTime);
  assert.ok(concurrent.coordination.bagHoldEndTime>=concurrent.coordination.breadClearTime);
  await page.screenshot({path:__dirname+'/output/parallel-packing-preview.png'});
  delete concurrent.frames;delete serial.frames;
  await page.locator('[data-workflow="order"]').click();
  assert.equal(await page.locator('[data-order-bread="bread_parallel"]').isChecked(),true);
  await page.locator('[data-order-bread="bread_parallel"]').uncheck();
  assert.equal(await page.evaluate(()=>coffeeEditor.order.breadSettings().bread_parallel),false);
  await page.locator('[data-order-bread="bread_parallel"]').check();
  assert.equal(await page.evaluate(()=>coffeeEditor.order.breadSettings().bread_parallel),true);
  await page.evaluate(()=>coffeeEditor.order.validate(false));
  const combined=await page.evaluate(()=>{const e=coffeeEditor,o=e.order;o.seek(2);return {ready:o.ready,parallel:o.routes.bag.result.coordination.parallel,time:o.time,bag:e.flow.player.time,coffee:e.coffee.player.time,recordable:!document.querySelector('[data-order-action="record"]').disabled}});
  assert.ok(combined.ready&&combined.parallel&&combined.recordable);assert.equal(combined.time,combined.bag);assert.equal(combined.time,combined.coffee);
  await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  assert.deepEqual(await page.evaluate(()=>[coffeeEditor.flow.settings().bread_parallel,coffeeEditor.order.breadSettings().bread_parallel]),[true,true]);
  const supplied=JSON.parse(fs.readFileSync(__dirname+'/fixtures/collision-layout-regression.json','utf8'));
  await page.evaluate(scene=>{
   const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;e.order.setActive(false);
   scene.bag_workflow.bread_parallel=true;scene.collision_settings={...scene.collision_settings,robotPairs:true};
   e.store.importScene(scene);e.three.sync();e.flow.suspended=false;e.flow.check();
  },supplied);
  await page.waitForFunction(()=>coffeeEditor.flow.result?.coordination?.parallel,null,{timeout:240000});
  const fixture=await page.evaluate(async()=>{
   const e=coffeeEditor,r=e.flow.result;
   const {checkNovaPair}=await import('./editor/nova-pair-collision.js');
   const checked=checkNovaPair(e.flow.request,{...r,pathOK:true});
   return {ok:r.pathOK,coordination:r.coordination,duration:r.route.duration,pair:r.pairCollision.status,independentPair:checked.status,
    failure:r.failure&&{reason:r.failure.reason,time:r.failure.time,phase:r.failure.phase},recovery:r.pairSearch?.status,fullDisabled:document.querySelector('#flow-play').disabled};
  });
  assert.equal(fixture.pair,fixture.independentPair);
  if(fixture.pair==='blocked'){assert.equal(fixture.ok,false);assert.equal(fixture.failure.reason,'robot_collision');assert.ok(fixture.fullDisabled)}
  else {assert.equal(fixture.pair,'clear');assert.ok(fixture.ok)}
  assert.deepEqual(errors,[]);
  const report={unit,serial,concurrent,combined,fixture,errors};
  fs.writeFileSync(__dirname+'/output/parallel-packing-test-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
