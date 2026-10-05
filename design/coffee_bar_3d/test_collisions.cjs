const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1700,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=coffee');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.coffee.result?.pathOK,null,{timeout:60000});
  const report=await page.evaluate(async()=>{
   const T=await import('./vendor/three.module.js'),C=await import('./editor/collision-core.js'),S=await import('./editor/collision-scene.js');
   const {makeWorkflowRequest}=await import('./editor/flow-geometry.js'),{makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js'),{poseSuctionRobot}=await import('./editor/suction-render.js');
   const {poseTongGrip}=await import('./editor/bread-render.js');
   const e=coffeeEditor,checks=[];
   function check(ok,name){if(!ok)throw new Error(name);checks.push(name);}
   const a=C.makeBox([0,0,0],[1,1,1]);
   check(C.boxesOverlap(a,C.makeBox([1.5,0,0],[1,1,1])),'Overlapping solids');
   check(!C.boxesOverlap(a,C.makeBox([2,0,0],[1,1,1])),'Tangency allowed without clearance');
   check(C.boxesOverlap(a,C.makeBox([2.01,0,0],[1,1,1]),.02),'Clearance margin');
   const rotated=C.transformBox({center:[0,0,0],half:[.5,.05,.05]},new T.Matrix4().makeRotationY(Math.PI/4));
   check(!C.boxesOverlap(rotated,C.makeBox([.3,0,.3],[.03,.03,.03])),'SAT separates rotated boxes with overlapping AABBs');
   const synthetic={enabled:true,margin:0,robotId:'test',mountingHeight:0,world:[],rig:{scale:1,gripAngles:{open:0,closed:0},nodes:[
    {parent:-1,matrix:new T.Matrix4().toArray(),joint:0},{parent:0,matrix:new T.Matrix4().makeTranslation(1,0,0).toArray()}],
    boxes:[{node:1,bounds:{center:[0,0,0],half:[.01,.01,.01]},part:'test tool',link:'Link1'}]}};
   synthetic.world=[C.makeBox([Math.cos(.37),0,-Math.sin(.37)],[.0005,.05,.0005],undefined,{objectId:'thin',label:'Thin divider',part:'divider'})];
   const sweep=new C.WorldCollisionChecker(synthetic),from={q:[0,0,0,0,0,0],time:0},to={q:[1,0,0,0,0,0],time:1};
   check(!sweep.pose(from.q)&&!sweep.pose(to.q),'Thin divider clear at both endpoints');
   const hit=sweep.interval(from,to);check(!!hit&&hit.fraction>.3&&hit.fraction<.43,'Between-frame sweep catches a thin divider');
   e.store.scene.collision_settings={enabled:true,margin:0,show:false};
   const world=S.captureWorld(e.three),objects=e.store.scene.objects;
   check(!world.some(w=>objects.find(o=>o.id===w.objectId)?.kind==='robot'),'All robots excluded from world');
   check(world.filter(w=>w.objectId==='shelf_1'&&/tier base/.test(w.part)).length===e.store.shelfSettings(e.store.object('shelf_1')).tiers,'Shelves use separate sloped tier bases');
   const disp=e.store.object('cup_dispenser'),gap=C.makeBox([disp.x,e.store.z(disp)+.15,-disp.y],[.015,.015,.015]);
   check(!world.filter(w=>w.objectId===disp.id).some(w=>C.boxesOverlap(gap,w)),'Dispenser lower gripper gap is open');
   const table=e.store.object('middle_counter'),under=C.makeBox([table.x,e.store.z(table)+.5,-table.y],[.04,.04,.04]);
   check(!world.filter(w=>w.objectId===table.id).some(w=>C.boxesOverlap(under,w)),'Space below worktop remains open');
   const top=C.makeBox([table.x,e.store.z(table)+table.height-.01,-table.y],[.03,.03,.03]);
   check(world.filter(w=>w.objectId===table.id).some(w=>C.boxesOverlap(top,w)),'Worktop itself is solid');
   const hidden=e.store.object('milk_fridge');hidden.visible=false;e.three.sync();
   check(!S.captureWorld(e.three).some(w=>w.objectId===hidden.id),'Hidden equipment omitted');hidden.visible=true;e.three.sync();
   const request=S.attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));
   const bag=S.attachCollisions(e.three,makeWorkflowRequest(e.store,{bread_mode:'nova'}));
   const cases=[['cup',request.collision,{collisionCup:'held'}],['bag',bag.collision,{bagState:'carried',bagDepth:bag.bag.depth}],['bread',bag.breadTask.collision,{breadState:'held'}]];
   const payloads=[];
   for(const [kind,data,state] of cases){
    data.world=[];const checker=new C.WorldCollisionChecker(data),q=[.3,-.6,1.2,.2,-.8,.4],grip=.5;
    const shapes=checker.shapes(q,grip,state),payload=shapes.find(s=>s.payload),body=shapes.filter(s=>!s.payload);
    check(!!payload,'Held '+kind+' extends robot shape');
    let obstacle;
    outer:for(const x of [-.8,0,.8])for(const y of [-.8,0,.8])for(const z of [-.8,0,.8]){
      const centre=payload.center.map((v,i)=>v+payload.axes.reduce((s,axis,j)=>s+axis[i]*payload.half[j]*[x,y,z][j],0));
      const b=C.makeBox(centre,[.001,.001,.001],undefined,{objectId:'test-world',label:'Test obstacle',part:'Thin block'});
      if(!body.some(s=>C.boxesOverlap(s,b))){obstacle=b;break outer;}
    }
    check(!!obstacle,'Find '+kind+' space outside arm/tool');data.world.push(obstacle);
    check(!checker.pose(q,grip),'Arm/tool clear without '+kind);
    const collision=checker.pose(q,grip,state);
    check(collision?.robot.payload===kind,'Only held '+kind+' collision blocks route');
    payloads.push({kind,point:obstacle.center});
    // Collision proxies and the live robot must have exactly the same link transforms.
    const record=e.three.instances.get(data.robotId);poseSuctionRobot(record,q);
    if(kind==='bread')poseTongGrip(record,data.rig.gripAngles.open+(data.rig.gripAngles.closed-data.rig.gripAngles.open)*grip);
    const named=new Map(body.map(s=>[s.part,s]));let maxError=0;
    record.mesh.traverse(n=>{if(!n.isMesh)return;const expected=named.get(n.userData.name||n.name);if(!expected)return;
      n.geometry.computeBoundingBox();const actual=C.transformBox({center:n.geometry.boundingBox.getCenter(new T.Vector3()).toArray(),half:n.geometry.boundingBox.getSize(new T.Vector3()).multiplyScalar(.5).toArray()},n.matrixWorld);
      maxError=Math.max(maxError,new T.Vector3(...actual.center).distanceTo(new T.Vector3(...expected.center)));
    });
    check(maxError<1e-6,kind+' rig proxy matches animated link/tool transforms');
   }
   e.three.sync();
   // Each flow uses the same checker, including the two Nova-5 planners.
   const {checkWorkflow}=await import('./editor/ik-core.js'),{checkBreadWorkflow}=await import('./editor/bread-flow.js');
   const suctionDefinition=await fetch('./robot-library/nova5_suction-kinematics.json').then(r=>r.json());
   const breadDefinition=await fetch('./robot-library/nova5_bread-kinematics.json').then(r=>r.json());
   const enclosing=C.makeBox([1,1,-2],[5,5,5],undefined,{objectId:'enclosure',label:'World enclosure',part:'Wall'});
   const novaRequest=S.attachCollisions(e.three,makeWorkflowRequest(e.store,{bread_mode:'nova',bread_grasp:'top_bottom'}));
   novaRequest.collision.world=[enclosing];novaRequest.breadTask.collision.world=[enclosing];
   check(checkWorkflow(suctionDefinition,novaRequest).failure?.reason==='world_collision','Suction Nova route rejects world collision');
   const breadBlocked=checkBreadWorkflow(breadDefinition,novaRequest.breadTask);check(breadBlocked.failure?.reason==='world_collision','Bread Nova route rejects world collision: '+JSON.stringify({reason:breadBlocked.failure?.reason,errors:breadBlocked.errors,phase:breadBlocked.failure?.phase}));
   const originalCoffee=e.store.scene.coffee_workflow;
   e.store.scene.coffee_workflow={...originalCoffee,temperature:'cold'};
   const cold=S.attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));cold.collision.world=[];
   check(solveCoffeeFlow(e.coffee.definition,cold).pathOK,'Cold drink collision setup works without a stamping rest');
   e.store.scene.coffee_workflow=originalCoffee;
   const carried=structuredClone(synthetic);
   carried.rig.boxes.push({node:1,bounds:{center:[1,0,0],half:[.02,.02,.02]},payload:'cup',part:'Held cup',link:'Held cup'});
   carried.payload={kind:'cup'};
   carried.world=[C.makeBox([2*Math.cos(.4),0,-2*Math.sin(.4)],[.001,.05,.001],undefined,{objectId:'thin',label:'Divider',part:'Wall'})];
   const carriedCheck=new C.WorldCollisionChecker(carried);
   check(!carriedCheck.interval(from,to),'Bare robot sweep clears remote divider');
   check(carriedCheck.interval({...from,collisionCup:'held'},{...to,collisionCup:'held'})?.collision.robot.payload==='cup','Held item participates in between-frame collision sweep');
   const empty=S.attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));empty.collision.world=[];
   const valid=solveCoffeeFlow(e.coffee.definition,empty);
   check(valid.pathOK&&valid.collision.enabled&&valid.collision.heldPayload==='cup','Collision-enabled clear route passes');
   check(valid.speed.boundAfter<=1.5+1e-6,'Speed cap retained with collision checks');
   const blockedRequest=S.attachCollisions(e.three,makeCoffeeRequest(e.store,e.coffee.definition));
   // An enclosing world object must block all postures and all route candidates.
   blockedRequest.collision.world=[C.makeBox([1,1,-2],[5,5,5],undefined,{objectId:'test-blocker',label:'Test enclosing obstacle',part:'Block'})];
   const blocked=solveCoffeeFlow(e.coffee.definition,blockedRequest);
   check(!blocked.pathOK&&blocked.failure.reason==='world_collision','Collision blocks route independently of IK');
   check(blocked.routeSearch.attempts.length===blockedRequest.collisionRoutes.length+1,'All configured avoidance route candidates attempted');
   const disabled=solveCoffeeFlow(e.coffee.definition,{...blockedRequest,collision:{enabled:false}});
   check(disabled.pathOK,'Disabled collision toggle restores route behavior');
   e.store.scene.collision_settings={enabled:false,margin:0,show:false};
   return {checks,payloads,sweepFraction:hit.fraction,worldParts:world.length,routeCandidates:blocked.routeSearch.attempts.length};
  });
  await page.locator('#collision-menu summary').click();
  await page.locator('#collision-enabled').check();
  await page.waitForFunction(()=>coffeeEditor.coffee.result?.failure?.reason==='world_collision',null,{timeout:120000});
  assert.ok(await page.locator('#coffee-play').isDisabled());
  await page.locator('#collision-menu summary').click();
  await page.locator('[data-coffee-action="failure"]').click();
  const ui=await page.evaluate(()=>({failure:coffeeEditor.coffee.result.failure.phase,kind:coffeeEditor.coffee.result.failure.reason,
    parts:coffeeEditor.three.collisions.group.children.length,enabled:coffeeEditor.store.exportScene().collision_settings.enabled,
    attempts:coffeeEditor.coffee.result.routeSearch.attempts.length}));
  assert.ok(ui.parts>=4);assert.ok(ui.enabled);assert.equal(ui.kind,'world_collision');
  await page.screenshot({path:'design/coffee_bar_3d/output/collision-inspection.png'});
  await page.locator('[data-workflow="order"]').click();
  await page.evaluate(()=>coffeeEditor.order.validate(false));
  await page.waitForFunction(()=>!coffeeEditor.order.busy,null,{timeout:120000});
  assert.ok(await page.locator('#order-play').isDisabled());
  assert.ok(await page.locator('[data-order-action="record"]').isDisabled());
  assert.ok((await page.evaluate(()=>Object.values(coffeeEditor.order.routes).some(r=>r.result?.failure?.reason==='world_collision'||r.result?.bread?.failure?.reason==='world_collision'))));
  await page.locator('[data-workflow="coffee"]').click();
  await page.locator('#collision-menu summary').click();
  await page.locator('#collision-enabled').uncheck();
  await page.waitForFunction(()=>coffeeEditor.coffee.result?.pathOK,null,{timeout:60000});
  assert.ok(await page.locator('#coffee-play').isEnabled());
  assert.deepEqual(errors,[]);
  const output={...report,ui,errors};fs.writeFileSync('design/coffee_bar_3d/output/collision-test-report.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});