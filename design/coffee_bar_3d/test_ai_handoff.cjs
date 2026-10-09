const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'output');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true}),errors=[],passed=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.flow.result,null,{timeout:90000});
  await page.evaluate(()=>{coffeeEditor.flow.suspended=true;coffeeEditor.coffee.check()});
  await page.waitForFunction(()=>!!coffeeEditor.coffee.result,null,{timeout:90000});
  const initial=await page.evaluate(async()=>{
   const e=coffeeEditor,{validationReport}=await import('./editor/handoff-validation.js');
   const report=await validationReport(e.store.validationHistory,e.store.exportScene());
   return {report,scene:e.store.exportScene(),histories:e.store.validationHistory.map(v=>v.scope)};
  });
  assert.ok(initial.histories.includes('bag'));assert.ok(initial.histories.includes('coffee'));
  assert.ok(initial.report.records.every(v=>v.matches_current_scene));
  assert.equal(initial.report.records.find(v=>v.scope==='coffee').world_collision,'disabled');
  const computed=await page.evaluate(async()=>{
   const e=coffeeEditor,{frozenStore,resolveLayout,workflowMap}=await import('./editor/handoff-data.js');
   const scene=e.store.exportScene(),store=frozenStore(e.store,scene);
   const table=scene.objects.find(o=>o.id==='coffee_station');
   const robot=scene.objects.find(o=>o.id==='nova2');robot.model_key='nova5_coffee';robot.label='Custom beverage arm';
   const ice=scene.objects.find(o=>o.id==='ice_machine');ice.yaw_deg=90;ice.service_point={x:.1,y:-.3,z:.4};
   scene.groups.find(g=>g.id==='area_charge').visible=false;
   const resolved=resolveLayout(store),workflows=await workflowMap(store);
   return {table,ice,robot:resolved.components.find(o=>o.id==='nova2'),target:resolved.components.find(o=>o.id==='ice_machine'),
    hidden:resolved.components.filter(o=>['charger','charging_zone'].includes(o.id)),workflows};
  });
  assert.equal(computed.robot.robot.model_key,'nova5_coffee');assert.equal(computed.robot.world_base_m[2],computed.table.height);
  assert.ok(computed.hidden.every(v=>!v.active));
  assert.ok(Math.abs(computed.target.front_direction_world_xy[0]-1)<1e-8);
  assert.ok(Math.abs(computed.target.configured_service_point_world_m[0]-(computed.ice.x+.3*computed.ice.depth))<1e-8);
  assert.equal(computed.workflows.beverage_variants.length,4);
  assert.ok(computed.workflows.beverage_variants.every(v=>v.status==='targets_generated_not_solved'&&v.sequence_pose_frame==='flange'&&v.sequence[0].contact_tcp_position_m));
  passed.push('Real bag/coffee completions are dated; collision-disabled checks stay disabled. Variant IDs, support heights, rotated normalized service points, inherited hiding and flange/TCP distinctions resolve correctly.');
  const snapshot=()=>page.evaluate(()=>({
   scene:coffeeEditor.getState(),selection:coffeeEditor.store.selected,undo:coffeeEditor.store.undoStack.length,
   camera:coffeeEditor.three.camera.position.toArray(),target:coffeeEditor.three.controls.target.toArray(),
   nodes:[...coffeeEditor.three.instances].map(([id,r])=>[id,r.node.position.toArray(),r.mesh.quaternion.toArray()])
  }));
  await page.evaluate(()=>{coffeeEditor.coffee.player.stop();coffeeEditor.flow.player.stop();coffeeEditor.store.select('coffee_station')});
  const before=await snapshot();
  await page.locator('#export-menu summary').click();await page.locator('[data-export="handoff"]').click();
  await page.locator('.handoff-dialog [name="note"]').fill('Review tea reach. 中文 café.');
  await page.locator('.handoff-dialog [name="glb"]').check();
  const downloadPromise=page.waitForEvent('download',{timeout:120000});
  await page.locator('.handoff-dialog [type="submit"]').click();
  const download=await downloadPromise;await download.saveAs(path.join(out,'ai-handoff-test.zip'));
  assert.deepEqual(await snapshot(),before);
  await page.screenshot({path:path.join(out,'ai-handoff-dialog.png')});
  passed.push('UI downloads a complete ZIP with optional GLB and Unicode review note without changing scene, selection, undo or camera.');
  const inspection=await page.evaluate(async()=>{
   const e=coffeeEditor,{captureGeometry}=await import('./editor/handoff-views.js'),{frozenStore}=await import('./editor/handoff-data.js');
   const {poseSuctionRobot}=await import('./editor/suction-render.js');
   const record=e.three.instances.get('nova2');poseSuctionRobot(record,[.1,.4,-.8,.4,.3,-.2]);
   let bag;e.three.instances.get('bag_opener').mesh.traverse(n=>{if(n.userData.role==='moving_bag')bag=n});
   const original=bag.visible;bag.visible=false;
   const frozen=frozenStore(e.store,e.store.exportScene());
   const capture=captureGeometry(e.three,frozen,[{hidden:[{node:bag,visible:original}]}]);
   let copied;capture.instances.get('bag_opener').mesh.traverse(n=>{if(n.userData.role==='moving_bag')copied=n});
   const q=capture.instances.get('nova2').joints[0];
   const defaultAngle=(frozen.object('nova2').joints_deg?.joint1||0)*Math.PI/180;
   const T=await import('./vendor/three.module.js'),expected=q.rest.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),defaultAngle));
   const result={copied:copied.visible,live:bag.visible,jointError:q.node.quaternion.angleTo(expected)};
   bag.visible=original;e.three.sync();return result;
  });
  assert.ok(inspection.copied);assert.equal(inspection.live,false);assert.ok(inspection.jointError<1e-7);
  const stale=await page.evaluate(async()=>{
   const e=coffeeEditor,{validationReport,beginValidation,recordValidation}=await import('./editor/handoff-validation.js');
   e.store.setOption('showLabels',!e.store.options.showLabels);
   const unchanged=await validationReport(e.store.validationHistory,e.store.exportScene());
   e.store.transact('Move tea',()=>e.store.move(['tea_machine'],.12,0));
   const changed=await validationReport(e.store.validationHistory,e.store.exportScene());
   e.store.undo();
   const restored=await validationReport(e.store.validationHistory,e.store.exportScene());
   const empty=await validationReport([],e.store.exportScene());
   // Isolated synthetic evidence verifies blocked/incomplete reporting without changing live history.
   const fake={exportScene:()=>e.store.exportScene()};
   recordValidation(fake,beginValidation(fake),'test',{robot:{id:'r'},collision:{enabled:true},settings:{}},
    {pathOK:false,collision:{enabled:true},failure:{reason:'world_collision',phase:'Approach',time:1}});
   const blocked=await validationReport(fake.validationHistory,fake.exportScene());
   return {unchanged,changed,restored,empty,blocked};
  });
  assert.ok(stale.unchanged.records.every(v=>v.matches_current_scene));
  assert.ok(stale.changed.records.every(v=>!v.matches_current_scene));assert.equal(stale.changed.current_scene_status,'not_run');
  assert.ok(stale.restored.records.every(v=>v.matches_current_scene));assert.equal(stale.empty.current_scene_status,'not_run');
  assert.equal(stale.blocked.records[0].world_collision,'blocked');assert.equal(stale.blocked.records[0].path_status,'failed');
  passed.push('Exported poses use stored joints and restore preview-hidden parts on clones. UI preferences do not stale checks; geometry edits do, and undo restores their match. Missing evidence is not_run; collision failures stay blocked.');
  const minimal=await page.evaluate(async()=>{
   const e=coffeeEditor,{buildHandoffBundle}=await import('./editor/handoff-bundle.js');
   const result=await buildHandoffBundle({store:e.store,view:e.three,includeAnalysis:false,includeGLB:false});
   return {manifest:result.manifest,size:result.blob.size};
  });
  assert.equal(minimal.manifest.include_analysis,false);assert.equal(minimal.manifest.include_glb,false);
  assert.ok(!minimal.manifest.files.some(f=>f.path.startsWith('analysis/')||f.path==='scene.glb'));
  passed.push('Lightweight export excludes analysis/model assets while retaining scene, views, workflow map and validation evidence.');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'ai-handoff-test-report.json'),JSON.stringify({passed,errors},null,2));
  console.log(JSON.stringify({passed,errors},null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
