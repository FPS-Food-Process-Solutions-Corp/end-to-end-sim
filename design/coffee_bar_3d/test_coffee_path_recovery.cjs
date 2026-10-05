const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=coffee');
  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result,null,{timeout:90000});
  const report=await page.evaluate(async()=>{
   const {makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {collisionRequest}=await import('./editor/collision-scene.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js');
   const {SuctionArm}=await import('./editor/ik-core.js');
   const {store,coffee,three}=coffeeEditor;
   const request=makeCoffeeRequest(store,coffee.definition);
   const start={...request.knots[0],time:0},end={...request.knots[1],time:1,phase:'Move clear / recovery regression',cup:start.cup};
   const data=collisionRequest(three,request.robot,undefined,[],undefined,{enabled:true,search:true,searchNodes:100,margin:0});
   const input={...request,knots:[start,end],events:[],duration:1,collision:data};
   const original=SuctionArm.prototype.solveMultiple;
   const run=failAlways=>{
    let injected=0;
    SuctionArm.prototype.solveMultiple=function(target,...args){
     const result=original.call(this,target,...args);
     if(target.phase===end.phase&&(failAlways||injected++===0))return {...result,ok:false};
     return result;
    };
    try{return solveCoffeeFlow(coffee.definition,input);}
    finally{SuctionArm.prototype.solveMultiple=original;}
   };
   const recovered=run(false),failed=run(true);
   return {ok:recovered.pathOK,searches:recovered.searches,frames:recovered.frames.length,
    detour:recovered.frames.some(f=>f.moveType==='searched detour'),bound:recovered.speed?.boundAfter,
    route:recovered.route?.knots.map(k=>k.phase),failed:{ok:failed.pathOK,frames:failed.frames.length,reason:failed.failure.reason,search:failed.failure.obstacleSearch.status,route:failed.route.knots.map(k=>k.phase)}};
  });
  assert.ok(report.ok&&report.detour,JSON.stringify(report));
  assert.ok(report.searches.some(s=>s.ok&&s.trigger==='ik_not_converged'));
  assert.ok(report.bound<=1.500001);
  assert.equal(report.route.at(-1),'Move clear / recovery regression');
  assert.equal(report.failed.ok,false);assert.equal(report.failed.frames,1);
  assert.equal(report.failed.reason,'ik_not_converged');assert.equal(report.failed.search,'goal_ik_failed');
  assert.deepEqual(report.failed.route,report.route);
  console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

