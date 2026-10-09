const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/object-lab/');await page.waitForFunction(()=>window.objectSizeLab?.ready);
  const physics=await page.evaluate(async()=>{
   const {defaults,validateScene,DROP_DEFAULTS}=await import('./catalog.js');
   const {physicsEngine,DonutDrop,STEP}=await import('./drop-physics.js');
   const R=await physicsEngine(),state=defaults(),find=id=>state.objects.find(o=>o.id===id),results=[];
   const cases=[
    ['centre','bag-12','mini-donut',{tilt:0}],
    ['rim','bag-2','mini-donut',{tilt:0}],
    ['miss','bag-12','mini-donut',{tilt:10,x:25}],
    ['tilted','bag-12','donut',{tilt:65,x:2,z:.6}],
    ['fast-rim','bag-2','donut',{tilt:0,height:100}],
   ];
   for(const [name,bag,donut,options] of cases){
    const sim=new DonutDrop(R,find(bag),find(donut),{...DROP_DEFAULTS,...options});
    const initial=sim.pose().position.y;
    for(let i=0;i<24;i++)sim.step();
    const earlyFall=initial-sim.pose().position.y;
    const holeHit=name==='centre'?sim.world.castRay(new R.Ray({x:0,y:1,z:0},{x:0,y:-1,z:0}),2,true):null;
    const holeClear=holeHit?!sim.donutColliders.some(c=>c.handle===holeHit.collider.handle):null;
    let minimum=Infinity;
    while(!sim.done){sim.step();minimum=Math.min(minimum,sim.bounds().min.y);}
    results.push({name,earlyFall,holeClear,minimum,report:sim.report()});sim.free();
   }
   const old=defaults();delete old.catalog_revision;old.objects.find(o=>o.id==='mini-donut').height=3.3;old.objects.find(o=>o.id==='bag-2').x=23;
   const migrated=validateScene(old);old.objects.find(o=>o.id==='mini-donut').height=3.1;const custom=validateScene(old);
   return {results,migration:{mini:migrated.objects.find(o=>o.id==='mini-donut').height,custom:custom.objects.find(o=>o.id==='mini-donut').height,keptPosition:migrated.objects.find(o=>o.id==='bag-2').x}};
  });
  console.log(JSON.stringify(physics,null,2));
  assert.deepEqual(physics.migration,{mini:2.8,custom:3.1,keptPosition:23});
  const get=name=>physics.results.find(r=>r.name===name);
  assert.equal(get('centre').report.outcome,'Settled inside bag');assert.equal(get('centre').holeClear,true);
  assert.deepEqual(get('centre').report.contacts,['Bag bottom'],'Interior floor must not double up with ground contacts');
  assert.ok(Math.hypot(get('centre').report.centerCm[0],get('centre').report.centerCm[2])<.5,'A centred flat drop should not gain significant sideways movement');
  assert.ok(get('centre').report.rotation[3]>.99,'A centred flat drop should not flip');
  assert.ok(Math.abs(get('centre').earlyFall-.04905)<.004,'Incorrect gravity or centimetre/metre conversion');
  assert.equal(get('rim').report.outcome,'Resting on the rim');
  assert.equal(get('miss').report.outcome,'Settled outside bag');
  assert.equal(get('tilted').report.outcome,'Settled inside bag');
  assert.notEqual(get('fast-rim').report.outcome,'Settled inside bag');
  assert.ok(get('fast-rim').report.bottomCm>16,'Fast donut tunneled through the rim');
  assert.ok(physics.results.every(r=>r.minimum>-.001),'Donut tunneled through ground');
  await page.locator('[data-mode="drop"]').click();
  await page.locator('#fit-bag').selectOption('bag-12');await page.locator('#fit-donut').selectOption('mini-donut');
  await page.getByRole('spinbutton',{name:'Release tilt',exact:true}).fill('25');await page.getByRole('spinbutton',{name:'Release tilt',exact:true}).press('Tab');
  await page.locator('#queue-add').click();
  await page.locator('#drop-play').click();await page.waitForFunction(()=>objectSizeLab.drop.playing);
  await page.waitForTimeout(150);await page.locator('#drop-play').click();
  const paused=await page.evaluate(()=>objectSizeLab.drop.report().time);await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>objectSizeLab.drop.report().time),paused);
  await page.locator('#units').selectOption('mm');
  assert.equal(await page.getByRole('spinbutton',{name:'Release height',exact:true}).inputValue(),'120');
  assert.equal(await page.evaluate(()=>objectSizeLab.drop.report().time),paused);
  await page.locator('#drop-play').click();await page.waitForFunction(()=>objectSizeLab.drop.report()?.done,null,{timeout:20000});
  assert.match(await page.locator('#drop-status').innerText(),/Settled inside bag/);
  const geometry=await page.evaluate(async()=>{
   const T=await import('../vendor/three.module.js'),d=objectSizeLab.drop,root=objectSizeLab.view.records.get('drop:'+d.world.items[0].id);
   const box=new T.Box3().setFromObject(root),center=box.getCenter(new T.Vector3());
   return {center:center.toArray(),physics:d.report().centerCm,min:box.min.y};
  });
  geometry.center.forEach((v,i)=>assert.ok(Math.abs(v-geometry.physics[i])<.03));
  await page.screenshot({path:path.resolve(__dirname,'../output/object-lab-drop-settled.png')});
  await page.locator('#drop-reset').click();assert.equal(await page.evaluate(()=>objectSizeLab.drop.report()),null);
  await page.screenshot({path:path.resolve(__dirname,'../output/object-lab-drop-ready.png')});
  await page.locator('#drop-play').click();await page.waitForFunction(()=>objectSizeLab.drop.playing);
  await page.locator('.queue-entry summary').click();
  await page.getByRole('spinbutton',{name:'Queued Offset X 1',exact:true}).fill('15');await page.getByRole('spinbutton',{name:'Queued Offset X 1',exact:true}).press('Tab');
  assert.equal(await page.evaluate(()=>objectSizeLab.drop.report()),null);assert.equal(await page.evaluate(()=>objectSizeLab.drop.playing),false);
  await page.reload();await page.waitForFunction(()=>window.objectSizeLab?.ready);
  assert.equal(await page.evaluate(()=>objectSizeLab.getState().mode),'drop');assert.equal(await page.evaluate(()=>objectSizeLab.getState().dropQueue[0].release.x),1.5);
  assert.equal(await page.evaluate(()=>objectSizeLab.drop.report()),null);
  await page.locator('[data-mode="compare"]').click();assert.equal(await page.evaluate(()=>objectSizeLab.drop.world),null);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.resolve(__dirname,'../output/object-lab-drop-test.json'),JSON.stringify({physics,geometry,errors,passed:['Gravity, torus hole, rim/ground CCD, angled collisions and three settlement outcomes','Older default mini-donut size migrates without overwriting custom sizes or positions','Pause/resume, reset, edits invalidate simulation, unit switch preserves time, reload restores settings only','Rendered donut follows the physics body']},null,2));
  console.log('Drop physics and UI checks passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
