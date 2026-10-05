const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1700,height:1080}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
  await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  const scene=JSON.parse(fs.readFileSync(__dirname+'/fixtures/collision-layout-regression.json','utf8'));
  await page.evaluate(scene=>{
   const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;
   scene.collision_settings={...scene.collision_settings,robotPairs:true,search:false};
   e.store.importScene(scene);e.three.sync();e.flow.suspended=false;e.flow.check();
  },scene);
  await page.waitForFunction(()=>coffeeEditor.flow.result,null,{timeout:180000});
  const initial=await page.evaluate(()=>({ok:coffeeEditor.flow.result.pathOK,pair:coffeeEditor.flow.result.pairCollision,failure:coffeeEditor.flow.result.failure}));
  assert.equal(initial.ok,false);assert.equal(initial.pair.status,'blocked');assert.equal(initial.failure.reason,'robot_collision');
  console.log('Original pair conflict',initial.failure.time,initial.failure.collision.first.part,initial.failure.collision.second.part);
  assert.equal(await page.locator('#flow-partial-play').isEnabled(),true);
  const reset=await page.evaluate(()=>{
   const e=coffeeEditor;e.flow.locateFailure();const located=e.three.collisions.failure?.poses?.length===2;
   e.flow.player.stop();return {located,cleared:!e.three.collisions.failure,
    restored:e.flow.result.failure.poses.every(p=>{const o=e.store.object(p.robotId),r=e.three.instances.get(p.robotId);return r.joints.every((j,i)=>{const d=j.rest.clone().invert().multiply(j.node.quaternion),q=2*Math.atan2(d.y,d.w);return Math.abs(q-(o.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180)<1e-6;});})};
  });
  assert.ok(reset.located&&reset.cleared&&reset.restored,JSON.stringify(reset));
  await page.locator('#flow-partial-play').click();
  const partial=await page.evaluate(()=>{
   const e=coffeeEditor,p=e.flow.player;p.playing=false;p.seekDiagnostic(Infinity);
   return {time:p.time,end:p.playbackEnd,diagnostic:p.diagnostic,ok:p.result.pathOK,bread:!!p.breadPlayer,fullDisabled:document.querySelector('#flow-play').disabled};
  });
  assert.equal(partial.diagnostic,true);assert.equal(partial.ok,false);assert.ok(partial.bread);assert.ok(partial.fullDisabled);assert.ok(partial.end<initial.failure.time);
  await page.screenshot({path:'design/coffee_bar_3d/output/nova-pair-partial-preview.png'});
  await page.evaluate(()=>{const e=coffeeEditor;e.flow.player.stop();e.flow.suspended=true;e.store.scene.collision_settings.search=true;e.flow.suspended=false;e.flow.check()});
  await page.waitForFunction(()=>coffeeEditor.flow.result,null,{timeout:240000});
  const recovered=await page.evaluate(()=>({ok:coffeeEditor.flow.result.pathOK,pair:coffeeEditor.flow.result.pairCollision,search:coffeeEditor.flow.result.pairSearch,duration:coffeeEditor.flow.result.route.duration}));
  console.log('Recovered pair',recovered.ok,recovered.search?.status,recovered.duration);
  assert.equal(recovered.ok,true);assert.equal(recovered.pair.status,'clear');assert.equal(recovered.search.status,'found');
  await page.evaluate(()=>{window.testValidPacking={request:coffeeEditor.flow.request,result:coffeeEditor.flow.result};coffeeEditor.flow.suspended=true;coffeeEditor.coffee.suspended=false;});
  await page.locator('[data-workflow="coffee"]').click();
  await page.waitForFunction(()=>coffeeEditor.coffee.result,null,{timeout:180000});
  const coffee=await page.evaluate(()=>({ok:coffeeEditor.coffee.result.pathOK,failure:coffeeEditor.coffee.result.failure,diagnostic:coffeeEditor.coffee.diagnostic&&{end:coffeeEditor.coffee.diagnostic.end,sourceEnd:coffeeEditor.coffee.diagnostic.sourceEnd},routeSearch:coffeeEditor.coffee.result.routeSearch}));
  console.log('Coffee failure',coffee.failure?.reason,coffee.failure?.phase,coffee.diagnostic);
  assert.equal(coffee.ok,false);assert.ok(coffee.diagnostic);
  assert.equal(await page.locator('#coffee-partial-play').isEnabled(),true);
  await page.locator('#coffee-partial-play').click();
  const coffeePartial=await page.evaluate(()=>{
   const e=coffeeEditor,p=e.coffee.player;p.playing=false;p.seekDiagnostic(Infinity);
   const data={time:p.time,end:p.playbackEnd,diagnostic:p.diagnostic,ok:p.result.pathOK,bound:p.result.speed.boundAfter,fullDisabled:document.querySelector('#coffee-play').disabled,html:e.coffee.panel.textContent};
   p.seekDiagnostic(-1);data.zero=p.time;p.seekDiagnostic(Infinity);return data;
  });
  assert.ok(coffeePartial.diagnostic&&coffeePartial.fullDisabled);assert.equal(coffeePartial.time,coffeePartial.end);assert.equal(coffeePartial.zero,0);assert.equal(coffeePartial.ok,false);assert.ok(coffeePartial.bound<=1.500001);
  await page.screenshot({path:'design/coffee_bar_3d/output/coffee-partial-preview.png'});
  await page.evaluate(()=>coffeeEditor.coffee.player.stop());
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.player.result===coffeeEditor.coffee.result),true);

  const breadPartial=await page.evaluate(()=>{
   const e=coffeeEditor,source=window.testValidPacking,r=structuredClone(source.result);
   const limit=r.bread.frames.findIndex(f=>f.phase==='Bread: carry above open bag');
   r.bread.frames=r.bread.frames.slice(0,limit+5);r.bread.pathOK=false;
   delete r.bread.startTime;delete r.bread.endTime;
   r.pathOK=false;r.bagPathOK=true;
   e.flow.player.configure(source.request,r);e.flow.player.seekDiagnostic(Infinity);
   const p=e.flow.player,data={end:p.time,expected:p.result.bread.startTime+r.bread.frames.at(-1).time,
    bread:!!p.breadPlayer,visible:p.bread.visible,ok:p.result.pathOK};
   p.stop();
   r.bread.frames=[];e.flow.player.configure(source.request,r);p.seekDiagnostic(Infinity);
   data.emptyPrefixEnd=p.time;data.loadingStart=r.route.knots.find(k=>k.phase==='Pull the bag open').time;
   data.noMagicBread=!p.bread.visible;p.stop();
   return data;
  });
  assert.equal(breadPartial.end,breadPartial.expected);assert.ok(breadPartial.bread&&breadPartial.visible&&!breadPartial.ok);
  assert.equal(breadPartial.emptyPrefixEnd,breadPartial.loadingStart);assert.ok(breadPartial.noMagicBread);
  await page.locator('[data-workflow="order"]').click();
  await page.evaluate(()=>{
   const e=coffeeEditor;e.order.routes.coffee={request:e.coffee.request,result:e.coffee.result,ok:false,error:true,message:'Regression inspection'};
   e.order.ready=false;e.order.render();
  });
  assert.equal(await page.locator('[data-order-action="record"]').isDisabled(),true);
  await page.locator('[data-order-action="inspect-coffee"]').click();
  const inspection=await page.evaluate(()=>({active:coffeeEditor.coffee.active,partial:coffeeEditor.coffee.player.diagnostic,playing:coffeeEditor.coffee.player.playing,ready:coffeeEditor.order.ready}));
  assert.ok(inspection.active&&inspection.partial&&inspection.playing&&!inspection.ready);

  assert.deepEqual(errors,[]);
  fs.writeFileSync('design/coffee_bar_3d/output/failure-preview-test-report.json',JSON.stringify({initial,partial,recovered,coffee,coffeePartial,breadPartial,inspection,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
