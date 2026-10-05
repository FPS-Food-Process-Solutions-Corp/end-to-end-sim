const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1650,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=coffee');
  await page.waitForFunction(()=>window.coffeeEditor?.coffee.result,null,{timeout:90000});
  const report=await page.evaluate(async()=>{
   const {coffee:c,store}=coffeeEditor,T=await import('./vendor/three.module.js');
   const {makeCoffeeRequest}=await import('./editor/coffee-geometry.js');
   const {solveCoffeeFlow}=await import('./editor/coffee-solver.js');
   const {limitCoffeeSpeed}=await import('./editor/coffee-timing.js');
   const {SuctionArm}=await import('./editor/ik-core.js');
   const original=store.exportScene(),results=[];
   const point=(arm,q,off)=>{const fk=arm.forward(q);return new T.Vector3(...off).applyQuaternion(fk.quaternion).add(fk.position);};
   for(const temperature of ['hot','cold'])for(const drink of ['coffee','milk_tea']){
    store.scene.coffee_workflow={...store.scene.coffee_workflow,temperature,drink,max_tcp_speed:1e6};
    const originalRequest=makeCoffeeRequest(store,c.definition),nominal=solveCoffeeFlow(c.definition,originalRequest);
    const request={...originalRequest,settings:{...originalRequest.settings,max_tcp_speed:1.5}};
    const arm=new SuctionArm(c.definition,request.robot,request.mountingHeight);
    const result=limitCoffeeSpeed(arm,request,{...nominal,route:undefined});
    let maximum=0;
    for(let i=1;i<result.frames.length;i++){
     const a=result.frames[i-1],b=result.frames[i],dt=b.time-a.time;
     const qAt=s=>a.q.map((q,j)=>q+(b.q[j]-q)*s);
     for(let j=0;j<=16;j++){
      const s=j/16,lo=Math.max(0,s-1e-5),hi=Math.min(1,s+1e-5);
      for(const off of Object.values(request.offsets)){
       const speed=point(arm,qAt(lo),off).distanceTo(point(arm,qAt(hi),off))/((hi-lo)*dt);
       maximum=Math.max(maximum,speed);
      }
     }
    }
    const samePath=result.frames.every((f,i)=>JSON.stringify(f.q)===JSON.stringify(nominal.frames[i].q));
    const waits=result.speed.segments.filter(s=>s.sourceEnd-s.sourceStart>0&&s.speedBound<1e-8);
    const events=result.route.events.every(event=>result.route.knots.some(k=>k.phase===event.phase&&Math.abs(k.time-event.time)<1e-8));
    const slower=limitCoffeeSpeed(arm,{...request,settings:{...request.settings,max_tcp_speed:.4}},{...nominal,route:undefined});
    const stampTime=result.route.knots.find(k=>k.phase==='Press paper lid')?.time;
    c.player.configure(request,result);
    if(stampTime)c.player.seek(stampTime);
    const stamp=stampTime?c.player.record.stampTcp.getWorldPosition(new T.Vector3()).toArray():null;
    c.player.stop();
    results.push({temperature,drink,ok:result.pathOK,maximum,samePath,waitsUnchanged:waits.every(s=>s.factor===1),events,
     duration:result.duration,nominal:request.duration,sourcePeak:result.speed.peakBefore,bound:result.speed.boundAfter,
     slowerDuration:slower.duration,slowerBound:slower.speed.boundAfter,stamp,
     stampHeight:request.park?request.park.floor+request.cupSpec.height+.009:null});
   }
   store.scene.coffee_workflow.max_tcp_speed=0;let invalid;
   try{makeCoffeeRequest(store,c.definition)}catch(error){invalid=error.message}
   store.importScene(original);
   return {results,invalid};
  });
  for(const r of report.results){
   assert.ok(r.ok&&r.samePath&&r.waitsUnchanged&&r.events,JSON.stringify(r));
   assert.ok(r.maximum<=1.500001&&r.bound<=1.500001,JSON.stringify(r));
   assert.ok(r.duration>=r.nominal-1e-8&&r.slowerDuration>=r.duration-1e-8&&r.slowerBound<=.400001,JSON.stringify(r));
   if(r.sourcePeak>1.5)assert.ok(r.duration>r.nominal);
   if(r.stamp)assert.ok(Math.abs(r.stamp[1]-r.stampHeight)<.006);
  }
  assert.match(report.invalid,/positive/);
  await page.waitForFunction(()=>coffeeEditor.coffee.result?.pathOK);
  const speed=page.locator('[data-coffee-setting="max_tcp_speed"]');await speed.evaluate(e=>e.closest('details').open=true);
  await speed.fill('.5');await speed.press('Tab');
  await page.waitForFunction(()=>coffeeEditor.coffee.result?.speed?.limit===.5,null,{timeout:60000});
  const standalone=await page.evaluate(()=>({duration:coffeeEditor.coffee.result.duration,playerDuration:coffeeEditor.coffee.player.request.duration,
   max:Number(document.querySelector('#coffee-scrub').max)}));
  assert.equal(standalone.duration,standalone.playerDuration);assert.equal(standalone.duration,standalone.max);
  await page.evaluate(()=>{for(const shelf of coffeeEditor.store.scene.objects.filter(o=>o.kind==='shelf'))shelf.shelf_overrides={...coffeeEditor.store.shelfSettings(shelf),bread_length_1:.06};coffeeEditor.three.sync();});
  await page.locator('[data-workflow="order"]').click();
  assert.equal(await page.locator('[data-order-coffee="max_tcp_speed"]').inputValue(),'0.5');
  await page.evaluate(()=>coffeeEditor.order.validate(false));
  const combined=await page.evaluate(async()=>{
   const {order:o,coffee}=coffeeEditor;
   o.seek(coffee.player.request.duration-.1);
   const result={ready:o.ready,duration:o.duration,coffeeDuration:coffee.player.request.duration,coffeeTime:coffee.player.time,
    bound:o.routes.coffee.result.speed.boundAfter,limit:o.routes.coffee.request.settings.max_tcp_speed};
   const svg=await coffeeEditor.plan.exportSVG(false);result.saved=svg.includes('max_tcp_speed');
   return result;
  });
  assert.ok(combined.ready&&combined.saved&&combined.bound<=.500001);
  assert.ok(combined.duration>=combined.coffeeDuration);assert.equal(combined.limit,.5);
  await page.waitForTimeout(400);await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready);
  assert.equal(await page.evaluate(()=>coffeeEditor.store.scene.coffee_workflow.max_tcp_speed),.5);
  assert.deepEqual(errors,[]);
  const output={...report,standalone,combined,errors};
  fs.writeFileSync(path.join(__dirname,'output/coffee-speed-test-report.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
