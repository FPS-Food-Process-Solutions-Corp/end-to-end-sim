const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const input=path.join(__dirname,'layouts/coffee-bar-nova5-floor-tea.json');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1650,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html');
  await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  const source=JSON.parse(fs.readFileSync(input,'utf8'));
  await page.evaluate(async source=>{
   const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;e.flow.invalidate(false);
   await e.importText(JSON.stringify(source),'coffee-bar-nova5-floor-tea.json');
  },source);
  const report=await page.evaluate(async()=>{
   const {store,three,coffee,plan}=coffeeEditor;
   const T=await import('./vendor/three.module.js');
   const {loadCoffeeDefinition}=await import('./editor/coffee-robots.js');
   const {makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js');
   const {SuctionArm}=await import('./editor/ik-core.js');
   const {poseSuctionRobot,setupSuctionJoints}=await import('./editor/suction-render.js');
   const {corners,rotate}=await import('./editor/store.js');
   const definition=await loadCoffeeDefinition(store),robot=store.object('nova5_coffee'),record=three.instances.get(robot.id);
   setupSuctionJoints(record);
   const arm=new SuctionArm(definition,robot,store.z(robot)),fkErrors=[],links=[],roles=[];
   record.mesh.traverse(n=>{if(n.userData.urdf_link)links.push(n.userData.urdf_link);if(n.userData.role)roles.push(n.userData.role)});
   for(const q of [[0,0,0,0,0,0],[.3,-.6,1.2,.2,-.8,.4]]){
    poseSuctionRobot(record,q);const fk=arm.forward(q);
    for(const [node,offset] of [[record.tcp,definition.cup_offset],[record.stampTcp,definition.stamp_offset]]){
     const expected=new T.Vector3(...offset).applyQuaternion(fk.quaternion).add(fk.position);
     fkErrors.push(node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(expected.x,expected.z,-expected.y)));
    }
   }
   const supports=store.scene.objects.filter(o=>o.parentId==='coffee_equipment'&&o.support).map(o=>{
    const table=store.object(o.support);
    const inside=corners(o).every(p=>{const q=rotate(p[0]-table.x,p[1]-table.y,-table.yaw_deg);return Math.abs(q[0])<=table.width/2+1e-8&&Math.abs(q[1])<=table.depth/2+1e-8;});
    return {id:o.id,support:o.support,inside};
   });
   const routes=[];
   for(const temperature of ['hot','cold'])for(const drink of ['coffee','milk_tea']){
    const request=makeCoffeeRequest(store,definition,{temperature,drink});
    const result=solveCoffeeFlow(definition,{...request,collision:{enabled:false}});
    routes.push({temperature,drink,ok:result.pathOK,errors:request.errors,frames:result.frames.length,phase:result.failure?.phase,
     reason:result.failure?.reason,positionError:result.failure?.positionError,duration:result.duration,
     initial:result.frames[0]?.q,firstFailure:result.failure,targets:request.targets,speed:result.speed?.boundAfter,
     cartesianTea:request.knots.filter(k=>/milk-tea|Withdraw level/.test(k.phase)).map(k=>({phase:k.phase,motion:k.motion}))});
   }
   const {attachCollisions}=await import('./editor/collision-scene.js');
   const {collisionText}=await import('./editor/collision-core.js');
   const collisionOptions=structuredClone(store.scene.collision_settings);
   store.scene.collision_settings={...collisionOptions,enabled:true,search:false,worldRobots:{...collisionOptions.worldRobots,nova5_coffee:true}};
   const strictRequest=attachCollisions(three,makeCoffeeRequest(store,definition));
   delete strictRequest.collisionRoutes;
   const strict=solveCoffeeFlow(definition,strictRequest);
   const collisionCheck={ok:strict.pathOK,phase:strict.failure?.phase,reason:strict.failure?.reason,detail:collisionText(strict.failure),failure:strict.failure};
   store.scene.collision_settings=collisionOptions;
   const hot=routes[0];if(hot.initial)robot.joints_deg=Object.fromEntries(hot.initial.map((v,i)=>['joint'+(i+1),v*180/Math.PI]));
   three.sync();
   const svg=await plan.exportSVG(false);
   const bytes=await three.glb();
   const buf=bytes instanceof Blob?await bytes.arrayBuffer():bytes;
   const data=new DataView(buf);
   const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,20,data.getUint32(12,true))).trim());
   store.setOption('view','scene');store.select(null);
   three.controls.target.set(.9,1.05,-2.25);three.camera.position.set(3.9,3.3,.8);three.controls.update();
   const upgraded=store.exportScene();
   return {fkErrors,links,roles,routes,supports,upgraded,collisionCheck,
    svg:{robot:svg.includes('nova5_coffee'),table:svg.includes('coffee_station_return')},
    glb:{stamp:gltf.nodes.some(n=>n.extras?.role==='cup_stamp'),robot:gltf.nodes.some(n=>n.extras?.layout_id==='nova5_coffee')}};
  });
  await page.evaluate(async()=>{const c=coffeeEditor.coffee;c.suspended=false;await c.check();});
  await page.waitForFunction(()=>window.coffeeEditor.coffee.result,null,{timeout:60000});
  report.workflow=await page.evaluate(()=>({ok:coffeeEditor.coffee.result.pathOK,robot:coffeeEditor.coffee.request.robot.id,definition:coffeeEditor.coffee.definition.source}));
  assert.ok(report.workflow.ok&&report.workflow.robot==='nova5_coffee'&&report.workflow.definition.includes('nova5'));
  await page.screenshot({path:path.join(__dirname,'output/nova5-beverage-layout.png')});
  fs.writeFileSync(path.join(__dirname,'output/nova5-beverage-check.json'),JSON.stringify({...report,errors},null,2));
  assert.deepEqual(errors,[]);assert.ok(report.fkErrors.every(e=>e<1e-5));
  assert.ok(report.links.every(x=>['base_link','Link1','Link2','Link3','Link4','Link5','Link6'].includes(x)));
  assert.ok(report.roles.includes('cup_tcp')&&report.roles.includes('stamp_tcp'));
  assert.ok(report.routes.every(r=>r.ok),JSON.stringify(report.routes.map(r=>[r.temperature,r.drink,r.phase])));
  assert.ok(report.routes.every(r=>r.speed<=source.coffee_workflow.max_tcp_speed+1e-6));
  assert.ok(report.supports.every(o=>o.inside),JSON.stringify(report.supports));
  assert.ok(report.svg.robot&&report.svg.table&&report.glb.robot&&report.glb.stamp);
  console.log(JSON.stringify({fkErrors:report.fkErrors,supports:report.supports,routes:report.routes.map(({temperature,drink,ok,phase,positionError})=>({temperature,drink,ok,phase,positionError})),svg:report.svg,glb:report.glb,workflow:report.workflow,collisionCheck:{ok:report.collisionCheck.ok,phase:report.collisionCheck.phase,detail:report.collisionCheck.detail},errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
