const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8766/viewer.html');
  await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  const report=await page.evaluate(async()=>{
   const T=await import('./vendor/three.module.js');
   const {makeBox,boxesOverlap}=await import('./editor/collision-core.js');
   const {NovaPairChecker,checkNovaPair,openBagShell,sampleRobotTrack}=await import('./editor/nova-pair-collision.js');
   const {collisionSettings,attachCollisions}=await import('./editor/collision-scene.js');
   const {makeWorkflowRequest}=await import('./editor/flow-geometry.js');
   const checks=[],check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name)};
   const q=x=>[x,0,0,0,0,0],frame=(x,time)=>({q:q(x),time,phase:'Synthetic transfer',grip:0});
   const data=(id,center,half=[.01,.01,.01],joint=true)=>({
    enabled:false,robotId:id,world:[],margin:0,mountingHeight:0,
    rig:{scale:1,gripAngles:{open:0,closed:0},nodes:[
     {parent:-1,matrix:new T.Matrix4().toArray(),...(joint?{joint:0}:{})},
     {parent:0,matrix:new T.Matrix4().makeTranslation(...center).toArray()}],
     boxes:[{node:1,bounds:{center:[0,0,0],half},part:id+' tool',link:'Link6'}]}
   });
   const request={pairCollision:{enabled:true,margin:0,first:data('suction',[1,0,0]),second:data('bread',[1,0,0]),firstLabel:'Suction Nova',secondLabel:'Bread Nova'},duration:1};
   const a0=frame(0,0),a1=frame(1,1),b0=frame(.8,0),b1=frame(-.2,1);
   const pair=new NovaPairChecker(request.pairCollision);
   check(!pair.pose(a0,b0)&&!pair.pose(a1,b1),'Both moving robots clear at endpoints');
   const hit=pair.interval(a0,a1,b0,b1);
   check(hit&&hit.a.time>.35&&hit.a.time<.45,'Synchronized sweep catches robot-to-robot contact between frames');
   check(pair.first.enabled&&pair.second.enabled,'Pair checking remains active with world checks disabled');
   const result={pathOK:true,frames:[a0,a1],route:{duration:1},bread:{pathOK:true,startTime:0,frames:[b0,b1]}};
   const blocked=checkNovaPair(request,result);
   check(blocked.status==='blocked'&&blocked.failure.poses.length===2,'Report identifies both robot poses');
   check(blocked.failure.segment.startTime===0,'Report retains last fully accepted timeline boundary');
   check(checkNovaPair({...request,pairCollision:{enabled:false}},result).status==='disabled','Pair toggle disables only the pair check');
   check(checkNovaPair(request,{...result,pathOK:false}).status==='incomplete','Failed individual route cannot be declared pair-clear');
   const overlap={...request.pairCollision,first:data('a',[0,0,0],[.05,.05,.05],false),second:data('b',[.098,0,0],[.05,.05,.05],false)};
   check(!!new NovaPairChecker(overlap).pose(a0,a0),'Zero clearance rejects 2 mm pair overlap');
   check(!new NovaPairChecker({...overlap,margin:-.003}).pose(a0,a0),'Negative 3 mm clearance accepts 2 mm pair overlap');
   const bag=makeBox([0,0,0],[.075,.14,.045],undefined,{payload:'bag',sourceIndex:4});
   const walls=openBagShell(bag),inside=makeBox([0,0,0],[.03,.03,.02]);
   check(walls.length===5&&!walls.some(w=>boxesOverlap(w,inside)),'Open bag shell permits a bun within its empty interior');
   check(walls.some(w=>boxesOverlap(w,makeBox([.074,0,0],[.004,.004,.004]))),'Bag side-wall contact remains detectable');
   check(!walls.some(w=>boxesOverlap(w,makeBox([0,.142,0],[.01,.008,.01]))),'Bag mouth remains open for insertion');
   const contents=openBagShell(bag,[.06,.08,.04]),probe=makeBox([0,-.1,0],[.005,.005,.005]);
   check(!walls.some(w=>boxesOverlap(w,probe))&&contents.some(w=>boxesOverlap(w,probe)),'Bun inside the held bag is part of the loaded payload');
   check(contents.every(w=>w.sourceIndex===4),'Shell and contents retain full payload sweep bounds');
   const held=data('bag',[0,0,0],[.075,.14,.045],false);
   held.payload={kind:'bag',depth:.09,contentsSize:[.06,.08,.04]};
   held.rig.boxes[0].payload='bag';
   const payloadPair=new NovaPairChecker({...overlap,first:held,second:data('probe',[.074,0,-.045],[.004,.004,.004],false)});
   check(!payloadPair.pose({...a0,bagState:'magazine'},a0)&&payloadPair.pose({...a0,bagState:'carried',bagDepth:.09},a0),'Bag becomes a robot collision shape only while held');
   const sample=sampleRobotTrack([{...a0,bagState:'magazine',bagDepth:.01},{...a1,bagState:'carried',bagDepth:.09}],.5);
   check(sample.q[0]===.5&&sample.bagState==='magazine'&&Math.abs(sample.bagDepth-.05)<1e-9,'Sampling matches playback grasp transitions and opening depth');
   const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;
   e.store.scene.collision_settings={enabled:false,robotPairs:true,margin:-.003};
   const captured=attachCollisions(e.three,makeWorkflowRequest(e.store));
   check(!captured.collision.enabled&&captured.pairCollision.enabled&&captured.pairCollision.first.rig.boxes.length>0,'Actual scene captures both robot rigs independently of world toggle');
   check(collisionSettings(e.store).robotPairs&&e.store.exportScene().collision_settings.robotPairs,'Pair policy persists in exported scene metadata');
   return {checks,conflictTime:hit.a.time,parts:[hit.collision.first.part,hit.collision.second.part]};
  });
  assert.ok(report.checks.length>=18);console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
