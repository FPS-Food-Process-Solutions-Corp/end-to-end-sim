const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],passed=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
    await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
    await page.evaluate(()=>{const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;e.flow.invalidate(false);e.store.select(null)});
    await page.locator('[data-view="split"]').click();
    const button=page.locator('#resize-settings-button'),panel=page.locator('#resize-settings-panel');
    assert.ok(await button.isVisible());
    await button.click();assert.ok(await panel.isVisible());
    assert.ok(await panel.locator('[data-resize-option="resizeKeepChildren"]').isChecked());
    await panel.locator('[aria-label="Resize behaviour"]').selectOption('center');
    assert.equal(await page.evaluate(()=>coffeeEditor.store.options.resizeMode),'center');
    await panel.locator('[aria-label="Resize behaviour"]').selectOption('opposite');
    await panel.locator('[aria-label="Close resize settings"]').click();
    await page.evaluate(()=>{
      const s=coffeeEditor.store;s.select('middle_counter');s.transact('Rotate support',()=>s.patch('middle_counter',{yaw_deg:32}));
    });
    assert.match(await page.locator('#selection-count').textContent(),/1 selected/);
    const order=await page.locator('#properties > section h3').allTextContents();
    assert.equal(order[0],'Resize settings');
    passed.push('Resize settings is visible above the views without a selection and at the top of the selected-object inspector.');
    const state=()=>page.evaluate(()=>{
      const e=coffeeEditor,ids=['middle_counter'];
      return {table:structuredClone(e.store.object(ids[0])),children:e.store.resolve(ids,true).filter(o=>o.id!==ids[0]).map(o=>({object:structuredClone(o),model:e.three.inspect(o.id)}))};
    });
    const fixed=(o,sx,sy)=>{
      const a=(o.yaw_deg||0)*Math.PI/180,x=sx*o.width/2,y=sy*o.depth/2;
      return [o.x+x*Math.cos(a)-y*Math.sin(a),o.y+x*Math.sin(a)+y*Math.cos(a)];
    };
    function check(before,after,sx,sy){
      assert.notDeepEqual(after.table,before.table);
      assert.deepEqual(after.children,before.children);
      const a=fixed(before.table,sx,sy),b=fixed(after.table,sx,sy);near(a[0],b[0]);near(a[1],b[1]);
    }
    async function field(axis,value){
      const input=page.locator('#properties [data-field="'+axis+'"]');await input.fill(String(value));await input.press('Tab');
    }
    let before=await state();
    await field('width',(before.table.width+.30)*100);
    let after=await state();check(before,after,-1,0);
    await page.locator('#undo').click();assert.deepEqual(await state(),before);
    await page.locator('#redo').click();assert.deepEqual(await state(),after);
    before=after;await field('depth',(before.table.depth-.20)*100);after=await state();check(before,after,0,1);
    await button.click();await panel.locator('[aria-label="Resize behaviour"]').selectOption('center');await panel.locator('[aria-label="Close resize settings"]').click();
    before=await state();await field('width',(before.table.width+.17)*100);after=await state();check(before,after,0,0);
    await button.click();await panel.locator('[aria-label="Resize behaviour"]').selectOption('opposite');await panel.locator('[aria-label="Close resize settings"]').click();
    // Drag a corner in the rotated local axes.
    await page.evaluate(()=>coffeeEditor.plan.fit());
    before=await state();
    const points=await page.locator('[data-resize-x="1"][data-resize-y="-1"]').evaluate(el=>{
      const b=el.getBBox(),m=el.getScreenCTM(),x=b.x+b.width/2,y=b.y+b.height/2;
      const a=new DOMPoint(x,y).matrixTransform(m),z=new DOMPoint(x+40,y+24).matrixTransform(m);
      return {a:[a.x,a.y],z:[z.x,z.y],hit:document.elementFromPoint(a.x,a.y)?.outerHTML};
    });
    await page.mouse.move(...points.a);await page.mouse.down();await page.mouse.move(...points.z,{steps:3});
    check(before,await state(),-1,1);await page.mouse.up();after=await state();check(before,after,-1,1);
    passed.push('Fixed children retain their exact positions, dimensions and 3D transforms during rotated anchored/corner/numeric and centre resizes; undo and redo restore the support.');
    await button.click();await panel.locator('[data-resize-option="resizeKeepChildren"]').uncheck();
    assert.equal(await page.locator('#properties [data-resize-option="resizeKeepChildren"]').isChecked(),false);
    await panel.locator('[aria-label="Close resize settings"]').click();
    before=await state();await field('width',(before.table.width+.2)*100);after=await state();
    assert.ok(after.children.some((o,i)=>Math.hypot(o.object.x-before.children[i].object.x,o.object.y-before.children[i].object.y)>.01));
    await button.click();await panel.locator('[data-resize-option="resizeKeepChildren"]').check();await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(),false);assert.deepEqual(await page.evaluate(()=>coffeeEditor.store.selected),['middle_counter']);
    before=await state();
    await page.evaluate(()=>coffeeEditor.store.transact('Move support',()=>coffeeEditor.store.move(['middle_counter'],.1,-.1)));
    after=await state();for(let i=0;i<before.children.length;i++){near(after.children[i].object.x,before.children[i].object.x+.1);near(after.children[i].object.y,before.children[i].object.y-.1);}
    passed.push('Unchecking restores the previous child-follow behavior. Ordinary support movement still carries equipment; Escape closes settings without losing selection.');
    const grouped=await page.evaluate(async()=>{
      const {SceneStore}=await import('./editor/store.js');
      const {resizeAnchored}=await import('./editor/resize-geometry.js');
      const s=new SceneStore(coffeeEditor.store.seed);s.scene.groups=[];
      s.scene.objects=[
        {id:'a',kind:'counter',x:1,y:1,width:1,depth:1,yaw_deg:0},
        {id:'b',kind:'counter',x:3,y:1,width:1,depth:1,yaw_deg:0},
        {id:'child',kind:'dispenser',support:'a',x:.8,y:.8,width:.2,depth:.2,diameter:.2,yaw_deg:0},
        {id:'nested',kind:'robot',support:'child',x:.8,y:.8,width:.1,depth:.2,yaw_deg:10,robot_scale:1},
      ];
      const children=structuredClone(s.scene.objects.slice(2));
      resizeAnchored(s,['a','b'],4,1.5,[-1,1]);
      const fixed=structuredClone(s.scene.objects.slice(2));
      s.scene.groups=[{id:'g',label:'Area'}];s.scene.objects.forEach(o=>o.parentId='g');
      resizeAnchored(s,['g'],8,3,[-1,1]);
      return {children,fixed,group:s.scene.objects.slice(2)};
    });
    assert.deepEqual(grouped.children,grouped.fixed);
    assert.notEqual(grouped.group[0].width,grouped.fixed[0].width);
    passed.push('Multiple supports keep nested mounted objects fixed, while explicitly resizing an area still transforms its selected members.');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('coffee-layout-studio-v2'))?.editor_options?.resizeKeepChildren===true);
    const roundtrip=await page.evaluate(async()=>{
      const {SceneStore}=await import('./editor/store.js'),s=new SceneStore(coffeeEditor.store.seed);
      const svg=await coffeeEditor.plan.exportSVG(false),xml=new DOMParser().parseFromString(svg,'image/svg+xml');
      const data=JSON.parse(xml.querySelector('#coffee-scene-data').textContent);s.importScene(data);
      return s.options.resizeKeepChildren;
    });assert.equal(roundtrip,true);
    await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
    await button.click();assert.ok(await panel.locator('[data-resize-option="resizeKeepChildren"]').isChecked());
    await panel.locator('[aria-label="Close resize settings"]').click();
    await page.setViewportSize({width:850,height:800});
    assert.ok(await button.isVisible());await button.click();assert.ok(await panel.isVisible());
    const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=850&&box.y>=0&&box.y+box.height<=800);
    await page.keyboard.press('Escape');await page.locator('#fullscreen-view').click();await button.click();assert.ok(await panel.isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#fullscreen-view').getAttribute('aria-pressed'),'true');
    await page.locator('#fullscreen-view').click();
    passed.push('Setting persists through reload and SVG/JSON; the toolbar controls work when the inspector is hidden on narrow screens and in fullscreen.');
    await page.setViewportSize({width:1500,height:980});await button.click();
    await page.screenshot({path:path.join(__dirname,'output','resize-children-settings.png')});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(__dirname,'output','resize-children-report.json'),JSON.stringify({passed,errors},null,2));
    console.log(JSON.stringify({passed,errors},null,2));
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1;});
