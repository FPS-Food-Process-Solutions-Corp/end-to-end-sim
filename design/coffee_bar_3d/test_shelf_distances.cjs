const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const out=path.join(__dirname,'output'),near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1660,height:1080},acceptDownloads:true}),errors=[],passed=[];
  page.on('pageerror',e=>errors.push(e.stack));
  try{
    await page.goto('http://127.0.0.1:8766/viewer.html',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.coffeeEditor?.ready);
    const select=id=>page.evaluate(id=>coffeeEditor.store.select(id),id);
    const field=async(key,value)=>{const input=page.locator(`[data-field="${key}"]`);await input.fill(String(value));await input.press('Tab');};
    const shelf=()=>page.evaluate(async()=>{
      const {Vector3,Box3}=await import('./vendor/three.module.js'),s=coffeeEditor.store,o=s.object('shelf_1'),l=s.shelfLayout(o),r=coffeeEditor.three.instances.get(o.id),tiers=[],buns=[],dividers=[];
      r.node.updateMatrixWorld(true);r.mesh.traverse(n=>{if(n.userData.shelf_tier)tiers.push(n);if(n.userData.bread_ellipsoid)buns.push(n);if(n.userData.shelf_divider)dividers.push(n);});
      const lowest=tiers.map(t=>{const base=t.children.find(n=>n.name==='Continuous solid stainless tier base'),p=new Vector3(0,-.5,.5);base.localToWorld(p);return p.y-s.z(o);});
      const highest=Math.max(0,...tiers.map(t=>new Box3().setFromObject(t).max.y-s.z(o)));
      return {object:o,layout:l,lowest,highest,buns:buns.length,dividers:dividers.length,firstBun:buns[0]?.scale.toArray(),meshScale:r.node.scale.toArray(),other:s.shelfSettings(s.object('shelf_2')),planDividers:document.querySelectorAll('[data-object-id="shelf_1"] [data-shelf-divider]').length,planBread:document.querySelectorAll('[data-object-id="shelf_1"] [data-bread-ellipse]').length};
    });
    await select('nova2');
    let ds=await page.evaluate(()=>coffeeEditor.store.distances());assert.equal(ds.length,6);
    const expected={coffee_machine:[.52,1.30],tea_machine:[.52,1.88],ice_machine:[.99,1.62],lid_machine:[.45,.975],cup_dispenser:[1.32,1.55],lid_dispenser:[1.32,1.35]};
    for(const d of ds){near(d.b[0],expected[d.target][0]);near(d.b[1],expected[d.target][1]);near(d.distance,Math.hypot(.94-d.b[0],1.32-d.b[1]));assert.equal(d.targetMode,'front-center');near(d.z,d.target.includes('dispenser')?1.4:1.19);}
    assert.equal(await page.locator('[data-distance-robot="nova2"]').count(),6);assert.equal(await page.locator('[data-distance-arrow-robot="nova2"] [data-distance-arrowheads]').count(),6);
    await page.evaluate(()=>coffeeEditor.store.transact('Rotate press',()=>coffeeEditor.store.patch('lid_machine',{yaw_deg:180})));
    ds=await page.evaluate(()=>coffeeEditor.store.distances());near(ds.find(d=>d.target==='lid_machine').b[0],.25);near(ds.find(d=>d.target==='lid_machine').b[1],1.175);await page.locator('#undo').click();
    await page.locator('#distance-mode').selectOption('both');ds=await page.evaluate(()=>coffeeEditor.store.distances());assert.equal(ds.length,12);for(const d of ds.filter(d=>d.type==='edge')){near(d.b[0],expected[d.target][0]);near(d.b[1],expected[d.target][1]);}
    await page.locator('#distance-mode').selectOption('center');await select('nova5');ds=await page.evaluate(()=>coffeeEditor.store.distances());near(ds[0].distance,.35);assert.equal(ds[0].targetMode,'nearest-edge');
    passed.push('Six Nova-2 targets use rotated front-face centres; footprint mode retains those endpoints; shelf distance remains 35 cm to nearest edge.');
    await select('shelf_1');let s=await shelf();assert.equal(s.layout.maxTiers,4);assert.equal(s.layout.settings.tiers,4);near(s.layout.clearColumnWidth,.896/6-.002);near(s.lowest[0],.35);near(s.lowest[3],1.55);assert.ok(s.highest<=1.8+1e-6);near(s.layout.clearVerticalGap,.4-.002/Math.cos(s.layout.slope));
    await field('shelf_columns',8);await field('shelf_bread_length_1',9);await field('shelf_bread_length_2',18);await field('shelf_bread_height',5);
    s=await shelf();assert.equal(s.buns,32);assert.equal(s.dividers,28);assert.equal(s.planDividers,7);assert.equal(s.planBread,8);assert.equal(s.other.columns,6);near(s.firstBun[0]*2,.09);near(s.firstBun[1]*2,.05);near(s.firstBun[2]*2,.18);
    await field('shelf_tier_spacing',30);await field('shelf_tiers',99);s=await shelf();assert.equal(s.layout.settings.tiers,5);assert.equal(s.layout.maxTiers,5);assert.equal(await page.locator('[data-field="shelf_tiers"]').getAttribute('max'),'5');near(s.lowest[4],1.55);
    await field('shelf_back_to_front_drop',20);s=await shelf();near(s.layout.settings.back_to_front_drop,.2);assert.equal(s.layout.settings.tiers,4);near(s.lowest[0],.35);near(s.lowest[3],1.25);assert.ok(s.highest<=1.8+1e-6);
    await field('shelf_first_tier_front_height',50);s=await shelf();assert.equal(s.layout.maxTiers,4);assert.equal(s.layout.settings.tiers,4);near(s.lowest[0],.5);near(s.lowest[3],1.4);
    await field('shelf_tier_spacing',1);s=await shelf();near(s.layout.settings.tier_spacing,s.layout.minSpacing);assert.ok(s.layout.clearAboveDividers>=.005-1e-9);await page.locator('#undo').click();
    await page.locator('#units').selectOption('px');assert.equal(await page.locator('[data-field="shelf_bread_length_1"]').inputValue(),'18');assert.equal(await page.locator('[data-field="shelf_tier_spacing"]').inputValue(),'60');assert.equal(await page.locator('[data-field="shelf_first_tier_front_height"]').inputValue(),'100');await page.locator('#units').selectOption('cm');
    await field('width',110);s=await shelf();near(s.firstBun[0]*2,.09);assert.deepEqual(s.meshScale,[1,1,1]);near(s.layout.clearColumnWidth,1.046/8-.002);await page.locator('#undo').click();
    passed.push('Live columns, two bread axes, height, tier count, slope, pitch and bottom clearance work in cm/px; max tiers prevents frame overflow and pitch prevents overlaps. Real mesh vertices match bottom-edge heights.');
    await page.locator('#apply-shelf-settings').click();s=await shelf();assert.equal(s.other.columns,8);near(s.other.back_to_front_drop,.2);near(s.other.first_tier_front_height,.5);await page.locator('#undo').click();s=await shelf();assert.equal(s.other.columns,6);
    await page.locator('#shelf-show-bread').uncheck();s=await shelf();assert.equal(s.buns,0);assert.equal(s.planBread,0);await page.locator('#undo').click();
    const svg=await page.evaluate(()=>coffeeEditor.plan.exportSVG(false));fs.writeFileSync(path.join(out,'shelf-settings-test.svg'),svg);
    const config=await page.evaluate(()=>coffeeEditor.getState());fs.writeFileSync(path.join(out,'shelf-settings-test.json'),JSON.stringify(config,null,2));
    await page.evaluate(async svg=>{coffeeEditor.store.reset();await coffeeEditor.importText(svg,'shelf.svg');coffeeEditor.store.select('shelf_1');},svg);s=await shelf();assert.equal(s.layout.settings.columns,8);near(s.lowest[0],.5);assert.equal(s.dividers,28);
    const download=page.waitForEvent('download');await page.locator('#export-menu summary').click();await page.locator('[data-export="glb"]').click();await (await download).saveAs(path.join(out,'shelf-settings-test.glb'));
    const glb=fs.readFileSync(path.join(out,'shelf-settings-test.glb')),gltf=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
    const exported=gltf.nodes.filter(n=>n.extras?.shelf_configuration);assert.equal(exported.length,2);assert.ok(exported.some(n=>n.extras.shelf_configuration.columns===8));assert.ok(gltf.nodes.some(n=>n.extras?.bread_ellipsoid&&n.extras.length_1_m===.09));
    await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('Saved locally'));await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>coffeeEditor.ready);await select('shelf_1');s=await shelf();assert.equal(s.layout.settings.columns,8);near(s.lowest[0],.5);
    passed.push('Apply-to-all, undo, bread visibility, SVG round-trip, persisted JSON and GLB retain shelf configuration and real geometry.');
    await page.evaluate(()=>{const e=coffeeEditor,old=JSON.parse(JSON.stringify(e.store.seed));delete old.editor_revision;const n=old.objects.find(o=>o.id==='nova2');n.x=1.05;n.distanceTargets=['coffee_machine'];e.store.importScene(old);});
    let migrated=await page.evaluate(()=>coffeeEditor.getState());near(migrated.objects.find(o=>o.id==='nova2').x,1.05);assert.deepEqual(migrated.objects.find(o=>o.id==='nova2').distanceTargets,['coffee_machine','lid_machine','lid_dispenser','cup_dispenser']);
    await page.evaluate(()=>{const c=coffeeEditor.getState();c.objects.find(o=>o.id==='nova2').distanceTargets=['coffee_machine'];coffeeEditor.store.importScene(c);});assert.deepEqual(await page.evaluate(()=>coffeeEditor.store.object('nova2').distanceTargets),['coffee_machine']);
    passed.push('Older saved layouts gain missing coffee targets once, preserving positions; subsequent custom target selections remain unchanged.');
    await page.evaluate(()=>{coffeeEditor.store.reset();coffeeEditor.store.select('shelf_1');coffeeEditor.store.setOption('showLabels',false);coffeeEditor.three.focus();});
    await page.screenshot({path:path.join(out,'editor-shelf-settings.png')});
    await page.evaluate(()=>{const e=coffeeEditor;e.store.select('nova2');e.store.setOption('showLabels',true);e.plan.view={x:-25,y:680,width:335,height:350};e.plan.setView();e.three.controls.target.set(.78,1.12,-1.43);e.three.camera.position.set(2.8,3.6,1.8);e.three.controls.update();});
    await page.screenshot({path:path.join(out,'editor-front-distances.png')});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'shelf-distance-test-report.json'),JSON.stringify({passed,errors},null,2));console.log(JSON.stringify({passed,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
