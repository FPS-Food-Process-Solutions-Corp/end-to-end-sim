const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const output = path.resolve(__dirname, '../output');
(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}, acceptDownloads: true}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8766/object-lab/');
    await page.waitForFunction(() => window.objectSizeLab?.ready, null, {timeout: 30000});
    const initial = await page.evaluate(async () => {
      const T = await import('../vendor/three.module.js'), app = objectSizeLab;
      return {state: app.getState(), boxes: [...app.view.records].map(([id, root]) => ({id, size: new T.Box3().setFromObject(root).getSize(new T.Vector3()).toArray()}))};
    });
    assert.equal(initial.state.objects.length, 12);
    const near = (a,b) => assert.ok(Math.abs(a-b)<.0001, `${a} != ${b}`);
    for (const [id,w,d,h] of [['bag-2',9,5.5,17],['bag-3',12,7,21],['bag-4',13,8,24],['bag-6',15,9,27],['bag-8',15.5,10,30],['bag-12',18,11,32],['bag-13',20,12.5,30],['bag-14',25,14,33],['bag-15',25,14,28],['bag-16',28,15,28],['mini-donut',7,7,2.8],['donut',10,10,3.3]]) {
      const a = initial.boxes.find(o => o.id === id).size; near(a[0],w);near(a[1],h);near(a[2],d);
    }
    await page.screenshot({path:path.join(output,'object-lab-overview.png')});
    await page.getByRole('button',{name:'Donut in bag',exact:true}).click();
    await page.locator('#fit-bag').selectOption('bag-2'); await page.locator('#fit-donut').selectOption('mini-donut');
    assert.equal(await page.evaluate(()=>objectSizeLab.fit().fits),false);
    await page.locator('#fit-orientation').selectOption('upright');
    assert.equal(await page.evaluate(()=>objectSizeLab.fit().fits),true);
    const upright = await page.evaluate(async()=>{const T=await import('../vendor/three.module.js');return new T.Box3().setFromObject(objectSizeLab.view.records.get('mini-donut')).getSize(new T.Vector3()).toArray();});
    near(upright[0],7); near(upright[1],7); near(upright[2],2.8);
    await page.screenshot({path:path.join(output,'object-lab-bag-fit.png')});
    await page.locator('#fit-donut').selectOption('donut'); await page.locator('#fit-bag').selectOption('bag-8');
    assert.equal(await page.evaluate(()=>objectSizeLab.fit().fits),false);
    await page.locator('#fit-bag').selectOption('bag-12');
    assert.equal(await page.evaluate(()=>objectSizeLab.fit().fits),true);
    await page.getByRole('button',{name:'Compare sizes',exact:true}).click();
    await page.getByRole('button',{name:'Select Mini donut',exact:true}).click();
    await page.locator('#units').selectOption('mm');
    assert.equal(await page.getByRole('spinbutton',{name:'Outer diameter',exact:true}).inputValue(),'70');
    await page.getByRole('spinbutton',{name:'Outer diameter',exact:true}).fill('80'); await page.getByRole('spinbutton',{name:'Outer diameter',exact:true}).press('Tab');
    near(await page.evaluate(()=>objectSizeLab.getState().objects.find(o=>o.id==='mini-donut').diameter),8);
    await page.getByRole('button',{name:'Duplicate',exact:true}).click();
    assert.equal(await page.evaluate(()=>objectSizeLab.getState().objects.length),13);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.evaluate(()=>objectSizeLab.getState().objects.length),12);
    await page.getByRole('button',{name:'Select No. 12 bag',exact:true}).click();
    await page.locator('[data-camera="top"]').click(); await page.locator('#move').click();
    const drag=await page.evaluate(async()=>{
      const T=await import('../vendor/three.module.js'), app=objectSizeLab, o=app.getState().objects.find(o=>o.id==='bag-12');
      // The open bag bottom is pickable from directly above.
      const p=new T.Vector3(o.x, .015, o.z).project(app.view.camera), rect=app.view.canvas.getBoundingClientRect();
      return {x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2,oldX:o.x};
    });
    await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.x+35,drag.y,{steps:8});await page.mouse.up();
    assert.ok(Math.abs(await page.evaluate(()=>objectSizeLab.getState().objects.find(o=>o.id==='bag-12').x)-drag.oldX)>1);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('#move').click();
    await page.getByRole('checkbox',{name:'Show No. 2 bag',exact:true}).uncheck();
    assert.equal(await page.evaluate(()=>objectSizeLab.view.records.has('bag-2')),false);
    await page.getByRole('button',{name:'+ Add an object',exact:true}).click();
    await page.locator('#new-name').fill('Custom reference'); await page.getByRole('button',{name:'Add to workspace',exact:true}).click();
    assert.equal(await page.evaluate(()=>objectSizeLab.getState().objects.at(-1).kind),'box');
    const prior = await page.evaluate(()=>objectSizeLab.getState());
    const validation = await page.evaluate(()=>{try{const s=objectSizeLab.getState();s.objects[0].width=-1;objectSizeLab.importScene(s);return false}catch{return true}});
    assert.ok(validation); assert.deepEqual(await page.evaluate(()=>objectSizeLab.getState()),prior);
    await page.locator('#export-menu summary').click();
    const downloadEvent=page.waitForEvent('download'); await page.locator('[data-export="json"]').click();
    const download=await downloadEvent, saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.deepEqual(saved,prior);
    const exports=await page.evaluate(async()=>{
      const T=await import('../vendor/three.module.js'), {GLTFLoader}=await import('../vendor/GLTFLoader.js');
      const bytes=await objectSizeLab.view.exportGLB(), gltf=await new GLTFLoader().parseAsync(bytes,'');
      const actual=new T.Box3().setFromObject(gltf.scene).getSize(new T.Vector3()).toArray();
      const expected=objectSizeLab.view.bounds().getSize(new T.Vector3()).multiplyScalar(.01).toArray();
      const png=await objectSizeLab.view.exportPNG();return {actual,expected,pngBytes:png.size};
    });
    exports.actual.forEach((v,i)=>near(v,exports.expected[i])); assert.ok(exports.pngBytes>10000);
    await page.reload(); await page.waitForFunction(()=>window.objectSizeLab?.ready);
    assert.deepEqual(await page.evaluate(()=>objectSizeLab.getState()),prior);
    await page.getByRole('button',{name:'Reset',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-camera="top"]').click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false); await page.screenshot({path:path.join(output,'object-lab-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    const report={passed:['All twelve rendered bounds match supplied centimetre sizes','Flat/upright fit checks and donut geometry agree','Millimetre editing preserves physical size','3D dragging, duplicate, undo, hide, custom objects, import validation and persistence','JSON, labelled PNG and metre-scaled GLB exports','Mobile layout has no horizontal overflow'],exports,errors};
    fs.writeFileSync(path.join(output,'object-lab-test-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
