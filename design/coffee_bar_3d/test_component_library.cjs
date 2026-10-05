const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html');
  await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  await page.evaluate(()=>{coffeeEditor.flow.suspended=true;coffeeEditor.coffee.suspended=true;coffeeEditor.flow.invalidate(false)});
  await page.locator('[data-panel="library"]').click();
  const count=Number(await page.locator('#library-count').textContent());assert.ok(count>=30);
  await page.locator('#library-search').fill('counter');
  assert.ok(await page.locator('[data-asset="between_shelves_counter"]').isVisible());
  assert.equal(await page.locator('[data-robot]').count(),0);
  await page.locator('[data-asset="between_shelves_counter"] button').click();
  const counter=await page.evaluate(()=>{
   const e=coffeeEditor,o=e.store.object(e.store.selected[0]),a=e.store.object('shelf_1'),b=e.store.object('shelf_2');
   return {object:o,mid:[(a.x+b.x)/2,(a.y+b.y)/2],model:e.three.instances.has(o.id),plan:!!document.querySelector('[data-object-id="'+o.id+'"]')};
  });
  assert.equal(counter.object.x,counter.mid[0]);assert.equal(counter.object.y,counter.mid[1]);assert.ok(counter.model&&counter.plan);
  assert.deepEqual([counter.object.width,counter.object.depth,counter.object.height],[.35,.6,.9]);
  const counterId=counter.object.id;
  await page.evaluate(()=>coffeeEditor.store.removeSelected());
  await page.locator('[data-asset="between_shelves_counter"] button').click();
  assert.equal(await page.evaluate(()=>coffeeEditor.store.selected[0]),counterId);
  await page.evaluate(()=>coffeeEditor.store.undo());assert.equal(await page.evaluate(id=>!!coffeeEditor.store.object(id),counterId),false);
  await page.evaluate(()=>coffeeEditor.store.redo());assert.equal(await page.evaluate(id=>!!coffeeEditor.store.object(id),counterId),true);
  await page.locator('#library-search').fill('');
  await page.locator('#library-category').selectOption('Coffee equipment');
  assert.equal(await page.locator('[data-robot]').count(),0);
  await page.evaluate(()=>coffeeEditor.store.select('coffee_station'));
  await page.locator('[data-asset="coffee_machine"] button').click();
  const mounted=await page.evaluate(()=>{const e=coffeeEditor,o=e.store.object(e.store.selected[0]);return {id:o.id,support:o.support,z:e.store.z(o),model:e.three.instances.has(o.id),label:o.label}});
  assert.equal(mounted.support,'coffee_station');assert.equal(mounted.z,.9);assert.ok(mounted.model);
  // Actual HTML drop event into the SVG; convert the chosen world point to screen coordinates.
  await page.locator('[data-view="plan"]').click();
  const dropped=await page.evaluate(()=>{
   const e=coffeeEditor,svg=document.querySelector('#plan'),table=e.store.object('coffee_station');
   const point={x:table.x+.1,y:table.y+.1},p=new DOMPoint(...e.plan.toPlan([point.x,point.y])).matrixTransform(svg.getScreenCTM());
   const transfer=new DataTransfer();transfer.setData('application/scene-asset-key','cup_dispenser');
   svg.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:p.x,clientY:p.y}));
   const o=e.store.object(e.store.selected[0]);return {object:o,point,model:e.three.instances.has(o.id)};
  });
  assert.ok(Math.abs(dropped.object.x-dropped.point.x)<.01&&Math.abs(dropped.object.y-dropped.point.y)<.01,JSON.stringify(dropped)); // Browser pointer coordinates round to CSS pixels.
  assert.equal(dropped.object.support,'coffee_station');assert.ok(dropped.model);
  const every=await page.evaluate(async()=>{
   const {sceneAssetCatalog,addSceneAsset}=await import('./editor/asset-library.js');
   const e=coffeeEditor,base=e.store.exportScene(),assets=sceneAssetCatalog(e.store),checks=[];
   for(const asset of assets){
    e.store.select('coffee_station');
    const id=addSceneAsset(e.store,asset.key);
    const object=e.store.object(id),record=e.three.instances.get(id);
    if(!record)throw Error('Missing 3D model: '+asset.key);
    let meshes=0;record.mesh.traverse(n=>{if(n.isMesh)meshes++});
    if(meshes===0)throw Error('Empty 3D model: '+asset.key);
    checks.push({key:asset.key,meshes,support:object.support});
   }
   const svg=await e.plan.exportSVG(false),glb=await e.three.glb(),bytes=glb instanceof Blob?await glb.arrayBuffer():glb;
   const view=new DataView(bytes),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,view.getUint32(12,true))).trim());
   const exported={svg:svg.includes('between_shelves_counter'),glb:json.nodes.some(n=>n.name==='Between-shelves counter')};
   const saved=e.store.exportScene();await e.importText(JSON.stringify(saved),'library-test.json');
   const roundtrip=e.store.scene.objects.length===saved.objects.length&&e.three.instances.size===saved.objects.length;
   e.store.importScene(base);
   return {checks,exported,roundtrip};
  });
  assert.ok(every.roundtrip&&every.exported.svg&&every.exported.glb);
  await page.locator('#library-category').selectOption('Furniture');
  await page.locator('[data-view="split"]').click();
  await page.evaluate(id=>coffeeEditor.store.select(id),counterId);
  await page.screenshot({path:__dirname+'/output/component-library-preview.png'});
  await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
  assert.ok(await page.evaluate(id=>coffeeEditor.store.object(id)&&coffeeEditor.three.instances.has(id),counterId));
  assert.deepEqual(errors,[]);
  const report={count,counter,mounted,dropped,every,errors};fs.writeFileSync(__dirname+'/output/component-library-test-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
