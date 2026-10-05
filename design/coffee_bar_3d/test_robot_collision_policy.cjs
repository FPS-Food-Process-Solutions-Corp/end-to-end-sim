const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1650,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=coffee');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.coffee.result?.pathOK,null,{timeout:90000});
  await page.evaluate(()=>{coffeeEditor.flow.suspended=true;coffeeEditor.coffee.suspended=true;coffeeEditor.flow.invalidate(false)});
  const toggle=id=>page.locator('[data-collision-robot-enabled="'+id+'"]');
  await page.locator('#collision-menu summary').click();
  assert.equal(await page.locator('[data-collision-robot-enabled]').count(),3);
  assert.ok(await toggle('nova2').isChecked());
  assert.ok(await toggle('nova2').isDisabled());
  await page.locator('#collision-enabled').check();
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.result),null,'Policy edit invalidates the previously valid route');
  await page.locator('#collision-pair-enabled').check();
  const checks=[];
  const capture=()=>page.evaluate(async()=>{
   const e=coffeeEditor,S=await import('./editor/collision-scene.js');
   const {makeWorkflowRequest}=await import('./editor/flow-geometry.js'),{makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {WorldCollisionChecker,makeBox}=await import('./editor/collision-core.js'),{NovaPairChecker}=await import('./editor/nova-pair-collision.js');
   const coffee=S.attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));
   const bag=S.attachCollisions(e.three,makeWorkflowRequest(e.store,{bread_mode:'nova'}));
   const enclosure=makeBox([1,1,-2],[5,5,5],undefined,{objectId:'test-enclosure',label:'Enclosure',part:'Solid'});
   const obstacle=data=>{
    const checker=new WorldCollisionChecker({...data,world:[enclosure]});
    return !!checker.pose([0,0,0,0,0,0],0,{bagState:'carried',breadState:'held',collisionCup:'held',bagDepth:.09});
   };
   const pair=new NovaPairChecker(bag.pairCollision);
   // Coincident copies must still collide even with both world policies off.
   const coincident=new NovaPairChecker({...bag.pairCollision,second:structuredClone(bag.pairCollision.first)});
   return {
    flags:[coffee.collision.enabled,bag.collision.enabled,bag.breadTask.collision.enabled],
    blocked:[coffee.collision,bag.collision,bag.breadTask.collision].map(obstacle),
    alternatives:coffee.collisionRoutes?.length||0,
    pair:pair.first.enabled&&pair.second.enabled&&pair.first.rig.boxes.length>0&&pair.second.rig.boxes.length>0,
    pairConflict:!!coincident.pose({q:[0,0,0,0,0,0],time:0},{q:[0,0,0,0,0,0],time:0}),
    policy:S.collisionSettings(e.store)
   };
  });
  let state=await capture();assert.deepEqual(state.flags,[true,true,true]);assert.deepEqual(state.blocked,state.flags);assert.ok(state.alternatives>0);
  checks.push('Legacy scenes enable all Nova world checks when the master is on');
  await toggle('nova2').uncheck();
  state=await capture();assert.deepEqual(state.flags,[false,true,true]);assert.deepEqual(state.blocked,state.flags);assert.equal(state.alternatives,0);assert.ok(state.pair);
  const disabledCoffee=await page.evaluate(async()=>{
   const e=coffeeEditor,{attachCollisions}=await import('./editor/collision-scene.js'),{makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js'),{makeBox}=await import('./editor/collision-core.js');
   const request=attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));
   request.collision.world=[makeBox([1,1,-2],[5,5,5],undefined,{objectId:'enclosure',label:'Enclosure',part:'Solid'})];
   const result=solveCoffeeFlow(e.coffee.definition,request);
   return {valid:result.pathOK,collision:result.collision,speed:result.speed.boundAfter};
  });
  assert.ok(disabledCoffee.valid&&!disabledCoffee.collision.enabled&&disabledCoffee.speed<=1.5+1e-6);
  checks.push('Nova-2 world disable bypasses world geometry and route alternatives, retaining IK and the speed limit');
  await toggle('nova2').check();await toggle('nova5').uncheck();
  state=await capture();assert.deepEqual(state.flags,[true,true,false]);assert.deepEqual(state.blocked,state.flags);assert.ok(state.pair);
  checks.push('Bread Nova can skip the world while suction and coffee remain checked');
  await toggle('nova5').check();await toggle('nova5_suction').uncheck();
  state=await capture();assert.deepEqual(state.flags,[true,false,true]);assert.deepEqual(state.blocked,state.flags);
  checks.push('Suction Nova can skip the world while bread and coffee remain checked');
  await toggle('nova5').uncheck();await toggle('nova2').uncheck();
  state=await capture();assert.deepEqual(state.flags,[false,false,false]);assert.deepEqual(state.blocked,state.flags);assert.ok(state.pair&&state.pairConflict);
  checks.push('Nova-5 pair collision detection remains active with both arms exempt from the world');
  await page.locator('#collision-enabled').uncheck();assert.ok(await toggle('nova2').isDisabled());
  await page.locator('#collision-enabled').check();assert.equal(await toggle('nova2').isChecked(),false);
  checks.push('Master switch preserves individual choices');
  const copyId=await page.evaluate(()=>{const s=coffeeEditor.store;s.select('nova5');s.duplicate();return s.selected[0]});
  assert.ok(copyId!=='nova5'&&await toggle(copyId).isChecked());
  await toggle(copyId).uncheck();
  assert.equal(await toggle(copyId).isChecked(),false);assert.equal(await toggle('nova5').isChecked(),false);
  await page.evaluate(()=>coffeeEditor.store.undo());assert.ok(await toggle(copyId).isChecked());
  await page.evaluate(()=>coffeeEditor.store.redo());assert.equal(await toggle(copyId).isChecked(),false);
  await toggle('nova5').check();assert.equal(await toggle(copyId).isChecked(),false);
  checks.push('Copies have independent checkboxes; edits support undo and redo');
  const copyRoute=await page.evaluate(async copyId=>{
   const e=coffeeEditor,{attachCollisions}=await import('./editor/collision-scene.js'),{makeWorkflowRequest}=await import('./editor/flow-geometry.js');
   return attachCollisions(e.three,makeWorkflowRequest(e.store,{bread_mode:'nova',bread_robot_id:copyId})).breadTask.collision.enabled;
  },copyId);assert.equal(copyRoute,false);
  checks.push('Assigning a copy to the bread workflow uses that copy’s policy');
  await page.evaluate(()=>coffeeEditor.collisions.checkPoses());
  assert.equal(await page.locator('[data-collision-robot="nova2"]').getAttribute('data-state'),'off');
  await page.locator('#collision-check-poses').click();
  assert.notEqual(await page.locator('[data-collision-robot="nova2"]').getAttribute('data-state'),'off');
  checks.push('Automatic pose checks skip exempt robots; explicit Check all still inspects every visible Nova');
  const saved=await page.evaluate(()=>coffeeEditor.store.exportScene().collision_settings);
  const roundtrip=await page.evaluate(async()=>{
   const e=coffeeEditor,svg=await e.plan.exportSVG(false),before=JSON.stringify(e.store.exportScene().collision_settings);
   await e.importText(svg,'per-robot-policy.svg');
   return before===JSON.stringify(e.store.exportScene().collision_settings);
  });assert.ok(roundtrip);
  checks.push('SVG export/import preserves per-robot policy');
  await page.screenshot({path:__dirname+'/output/per-robot-collision-controls.png'});
  await page.waitForTimeout(600);await page.reload();
  await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  assert.deepEqual(await page.evaluate(()=>coffeeEditor.store.exportScene().collision_settings),saved);
  checks.push('Autosave/reload preserves per-robot and independent pair settings');
  assert.deepEqual(errors,[]);
  const report={checks,disabledCoffee,lastPolicy:saved,copyId,errors};
  fs.writeFileSync(__dirname+'/output/robot-collision-policy-test-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
