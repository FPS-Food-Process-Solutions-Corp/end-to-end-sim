const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const near=(a,b,e=.006)=>assert.ok(Math.abs(a-b)<e,a+' differs from '+b);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:1100},acceptDownloads:true});
  const errors=[],passed=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=coffee');
  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result,null,{timeout:60000});
  assert.ok(await page.locator('#coffee-play').isEnabled());
  const data=await page.evaluate(async()=>{
   const {coffee:c,store,three}=coffeeEditor,T=await import('./vendor/three.module.js');
   const {SuctionArm}=await import('./editor/ik-core.js');
   const {makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js');
   const {poseSuctionRobot,setupSuctionJoints}=await import('./editor/suction-render.js');
   const definition=c.definition,original=store.exportScene(),record=three.instances.get('nova2');
   setupSuctionJoints(record);
   const arm=new SuctionArm(definition,c.request.robot,c.request.mountingHeight),fkErrors=[];
   for(const q of [[0,0,0,0,0,0],[.3,-.6,1.2,.2,-.8,.4]]){
    poseSuctionRobot(record,q);const fk=arm.forward(q);
    for(const [node,offset] of [[record.tcp,definition.cup_offset],[record.stampTcp,definition.stamp_offset]]){
     const expected=new T.Vector3(...offset).applyQuaternion(fk.quaternion).add(fk.position);
     fkErrors.push(node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(expected.x,expected.z,-expected.y)));
    }
   }
   let stamp,mount,hasBridge=false;
   record.mesh.traverse(n=>{
    if(n.userData.shape==='truncated_cone')stamp=n.userData;
    if(n.userData.role==='cup_stamp')mount={...n.userData,parentLink:n.parent.userData.urdf_link};
    if(n.name.includes('stamper mounting bridge'))hasBridge=true;
   });
   const wristQ=[.3,-.6,1.2,.2,-.8,0];
   poseSuctionRobot(record,wristQ);
   const wristStamp=record.stampTcp.getWorldPosition(new T.Vector3());
   wristQ[5]=1.7;poseSuctionRobot(record,wristQ);
   const stampJ6Drift=wristStamp.distanceTo(record.stampTcp.getWorldPosition(new T.Vector3()));
   const combinations=[];
   for(const temperature of ['hot','cold'])for(const drink of ['coffee','milk_tea']){
    store.scene.coffee_workflow={...store.scene.coffee_workflow,temperature,drink,sugar:'0%',milk:'oat'};
    const input=makeCoffeeRequest(store,definition),result=solveCoffeeFlow(definition,input),request={...input,...result.route};
    const phases=request.knots.map(k=>k.phase),maxTilt=Math.max(...result.frames.filter(f=>f.cup==='held').map(f=>{
     const up=new T.Vector3(0,-1,0).applyQuaternion(arm.forward(f.q).quaternion);
     return Math.acos(Math.max(-1,Math.min(1,up.z)))*180/Math.PI;
    }));
    combinations.push({temperature,drink,ok:result.pathOK,errors:request.errors,phases,events:request.events,maxTilt,
      service:request.targets.map(t=>({id:t.id,z:t.mouthHeight,base:store.z(store.object(t.id)),height:store.object(t.id).height})),
      maxKnotError:Math.max(...request.knots.map(k=>{const f=result.frames.find(f=>Math.abs(f.time-k.time)<1e-8);return f?arm.forward(f.q).position.distanceTo(new T.Vector3(...k.position)):Infinity;})),
      withinLimits:result.frames.every(f=>f.q.every((q,j)=>q>=definition.joints[j].lower&&q<=definition.joints[j].upper))});
   }
   store.scene.coffee_workflow={...original.coffee_workflow,temperature:'hot',drink:'coffee'};
   const input=makeCoffeeRequest(store,definition),result=solveCoffeeFlow(definition,input),request={...input,...result.route};
   c.request=request;c.result=result;c.player.configure(request,result);
   const snapshots=[];
   for(const phase of ['Cup drops into prong','Fill coffee','Paper lid rests on cup','Set cup on stamping rest','Press paper lid','Slide prong around sealed cup','Set drink on counter']){
    const knot=request.knots.find(k=>k.phase===phase);c.player.seek(knot.time);
    snapshots.push({phase,position:c.player.cup.root.position.toArray(),lid:c.player.cup.lid.visible,liquid:c.player.cup.liquid.visible,
      stamp:c.player.record.stampTcp.getWorldPosition(new T.Vector3()).toArray(),state:knot.cup});
   }
   c.player.seek(0);const rewindHidden=!c.player.cup.root.visible;
   c.player.stop();const resetRemoved=!three.physical.children.some(n=>n.name==='Coffee flow preview');
   // Both old source and old autosaves gain the fixtures once; versioned deletion is respected.
   const {SceneStore}=await import('./editor/store.js');
   const legacy=structuredClone(original);delete legacy.coffee_flow_revision;delete legacy.coffee_workflow;
   legacy.objects=legacy.objects.filter(o=>!['plastic_cup_dispenser','cup_stamping_rest','beverage_pickup_zone'].includes(o.id));
   const migrated=new SceneStore(original);migrated.importScene(legacy);
   const count=migrated.scene.objects.length;
   const exported=migrated.exportScene();migrated.importScene(exported);const twice=migrated.scene.objects.length;
   exported.objects=exported.objects.filter(o=>o.id!=='plastic_cup_dispenser');
   migrated.importScene(exported);const deletionRespected=!migrated.object('plastic_cup_dispenser');
   // Hidden dispensers, invalid pickup and oversized scaled cup prong reject stale requests.
   store.object('cup_dispenser').visible=false;let hidden;
   try{makeCoffeeRequest(store,definition)}catch(e){hidden=e.message}
   store.object('cup_dispenser').visible=true;
   const pickup=store.object('beverage_pickup_zone'),x=pickup.x;pickup.x=20;
   const outside=makeCoffeeRequest(store,definition).errors;pickup.x=x;
   const bad={...request,robot:{...request.robot,x:20}};
   const failed=solveCoffeeFlow(definition,bad);
   store.importScene(original);
   return {fkErrors,stamp,mount,hasBridge,stampJ6Drift,combinations,snapshots,rewindHidden,resetRemoved,count,twice,deletionRespected,hidden,outside,
     unreachable:!failed.pathOK,failure:failed.failure?.phase,request};
  });
  assert.ok(data.fkErrors.every(e=>e<1e-5));
  assert.ok(data.stamp.distal_diameter_m>data.stamp.proximal_diameter_m);
  near(data.stamp.distal_diameter_m,.088,1e-6);
  assert.equal(data.mount.parentLink,'Link5');assert.equal(data.mount.mount_type,'direct_socket');
  assert.equal(data.hasBridge,false);assert.ok(data.stampJ6Drift<1e-8);
  near(data.stamp.socket_diameter_m,.073,1e-6);
  assert.ok(data.stamp.proximal_diameter_m>data.stamp.socket_diameter_m);
  assert.ok(data.stamp.socket_depth_m>0&&data.stamp.socket_depth_m<data.stamp.length_m);
  for(const c of data.combinations){
   assert.ok(c.ok,JSON.stringify(c));assert.deepEqual(c.errors,[]);assert.ok(c.withinLimits);assert.ok(c.maxTilt<3,'Held cup tilted too far');assert.ok(c.maxKnotError<.006,'A service endpoint missed its target');
   assert.ok(c.events.some(e=>e.command==='dispense_drink'&&e.preferences.sugar==='0%'&&e.preferences.milk==='oat'));
   assert.equal(c.phases.includes('Press paper lid'),c.temperature==='hot');
   assert.equal(c.events.some(e=>e.command==='dispense_ice'),c.temperature==='cold');
   const machine=c.service.find(s=>s.id===(c.drink==='coffee'?'coffee_machine':'tea_machine'));
   near(machine.z-machine.base,machine.height*.25,1e-8);
  }
  passed.push('Hot/cold coffee and milk tea solve; preferences select the correct devices and simulated signals; service rims use the lower 25%.');
  const by=p=>data.snapshots.find(s=>s.phase===p);
  assert.ok(!by('Cup drops into prong').lid&&!by('Cup drops into prong').liquid);
  assert.ok(by('Fill coffee').liquid&&by('Paper lid rests on cup').lid);
  const pressed=by('Press paper lid'),rest=data.request.park;
  near(pressed.position[1],rest.floor,1e-8);near(pressed.stamp[1],rest.floor+.11+.009);
  near(pressed.stamp[0],rest.position[0]);near(pressed.stamp[2],-rest.position[1]);
  assert.equal(by('Slide prong around sealed cup').state,'held');
  near(by('Set drink on counter').position[1],data.request.delivery.floor,1e-8);
  assert.ok(data.rewindHidden&&data.resetRemoved);
  passed.push('Cup and lid animation, parking, opposing stamp contact, regrip, delivery, scrubbing and reset agree with the articulated model.');
  assert.equal(data.count,29);assert.equal(data.twice,29);assert.ok(data.deletionRespected);
  assert.match(data.hidden,/hidden/);assert.ok(data.outside.length);assert.ok(data.unreachable);
  passed.push('Saved layouts migrate once without resurrecting deleted fixtures; hidden and unreachable equipment and invalid pickup areas are rejected.');

  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result,null,{timeout:60000});
  await page.locator('[data-coffee-setting="temperature"]').selectOption('cold');
  await page.locator('[data-coffee-setting="drink"]').selectOption('milk_tea');
  await page.locator('[data-coffee-setting="ice"]').selectOption('none');
  await page.locator('[data-coffee-setting="sugar"]').selectOption('0%');
  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result?.pathOK&&coffeeEditor.coffee.request.settings.ice==='none',null,{timeout:60000});
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.request.events.some(e=>e.command==='dispense_ice')),false);
  const saved=await page.evaluate(async()=>{
   const {coffee:c,store,plan,three}=coffeeEditor;
   c.player.seek(c.player.request.knots.find(k=>k.phase==='Plastic lid applied').time);
   const cup=c.player.cup.root.name,lid=c.player.cup.lid.name;
   const svg=await plan.exportSVG(false),glb=await three.glb();
   const bytes=glb instanceof Blob?await glb.arrayBuffer():glb;
   const view=new DataView(bytes),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,view.getUint32(12,true))).trim());
   return {cup,lid,svgHasSettings:svg.includes('coffee_workflow')&&svg.includes('milk_tea'),
     glbHasStamp:json.nodes.some(n=>n.extras?.role==='cup_stamp'),glbHasCup:json.nodes.some(n=>n.name==='Plastic beverage cup')};
  });
  assert.match(saved.cup,/Plastic/);assert.match(saved.lid,/plastic/);
  assert.ok(saved.svgHasSettings&&saved.glbHasStamp&&saved.glbHasCup);
  await page.locator('[data-coffee-action="report"]').click();
  await page.locator('[data-workflow="bag"]').click();
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.player.overlay),null);
  await page.locator('[data-workflow="coffee"]').click();
  await page.waitForTimeout(500);await page.reload();
  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result,null,{timeout:60000});
  const restored=await page.evaluate(()=>coffeeEditor.coffee.request.settings);
  assert.equal(restored.temperature,'cold');assert.equal(restored.drink,'milk_tea');assert.equal(restored.ice,'none');assert.equal(restored.sugar,'0%');
  passed.push('The UI chooses hot/cold branches, omits ice when requested, exports current cup/stamper geometry and settings, and restores preferences after reload.');
  await page.evaluate(()=>{const {coffee:c}=coffeeEditor;c.frame();c.player.seek(c.player.request.knots.find(k=>k.phase==='Plastic lid applied').time);});
  await page.screenshot({path:path.join(__dirname,'output/coffee-flow-cold-preview.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(__dirname,'output/coffee-flow-test-report.json'),JSON.stringify({passed,data,saved,errors},null,2));
  console.log(JSON.stringify({passed,maxTilt:data.combinations.map(c=>[c.temperature,c.drink,c.maxTilt]),errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
