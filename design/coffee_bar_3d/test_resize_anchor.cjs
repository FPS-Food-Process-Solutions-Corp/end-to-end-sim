const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
function fixed(o, ax, ay) {
  const t=(o.yaw_deg||0)*Math.PI/180, x=ax*o.width/2, y=ay*o.depth/2;
  return [o.x+x*Math.cos(t)-y*Math.sin(t),o.y+x*Math.sin(t)+y*Math.cos(t)];
}
function sameAnchor(a,b,ax,ay) {const p=fixed(a,ax,ay),q=fixed(b,ax,ay);near(p[0],q[0]);near(p[1],q[1]);}
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1050}}), errors=[],passed=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8766/viewer.html');
    await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
    await page.evaluate(()=>{
      const e=coffeeEditor;e.flow.suspended=true;e.coffee.suspended=true;e.flow.invalidate(false);
      e.store.options.snap=false;e.store.options.resizeKeepChildren=false;e.store.options.showLabels=false;e.store.select('middle_counter');
      window.resizeBaseline=e.store.snapshot();window.resizeEvents=[];window.addEventListener('pointerdown',event=>window.resizeEvents.push({target:event.target.outerHTML.slice(0,400),x:event.clientX,y:event.clientY}),true);
    });
    assert.equal(await page.locator('[aria-label="Resize behaviour"]').inputValue(),'opposite');
    const object=()=>page.evaluate(()=>structuredClone(coffeeEditor.store.object('middle_counter')));
    async function reset(yaw=0) {
      await page.evaluate(yaw=>{
        const s=coffeeEditor.store;s.restore(resizeBaseline);s.options.resizeMode='opposite';
        s.options.resizeAnchorX='left';s.options.resizeAnchorY='top';
        s.patch('middle_counter',{yaw_deg:yaw});s.emit();
        coffeeEditor.plan.fit();
      },yaw);
    }
    async function drag(selector, dx, dy, shift=false) {
      const at=await page.locator(selector).evaluate((el,{dx,dy})=>{
        const b=el.getBBox(),matrix=el.getScreenCTM();
        const p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(matrix);
        const q=new DOMPoint(b.x+b.width/2+dx*200,b.y+b.height/2-dy*200).matrixTransform(matrix);
        return {x:p.x,y:p.y,toX:q.x,toY:q.y,hit:document.elementFromPoint(p.x,p.y)?.outerHTML};
      },{dx,dy});
      if(shift)await page.keyboard.down('Shift');
      await page.mouse.move(at.x,at.y);await page.mouse.down();
      await page.mouse.move(at.toX,at.toY,{steps:3});
      assert.equal(await page.locator('[data-resize-anchor]').count(),1, selector+' '+JSON.stringify(at)+' '+JSON.stringify(await page.evaluate(({x,y})=>({drag:coffeeEditor.plan.drag,hit:document.elementFromPoint(x,y)?.outerHTML,selected:coffeeEditor.store.selected,events:resizeEvents.slice(-2)}),at)));
      await page.mouse.up();
      if(shift)await page.keyboard.up('Shift');
      assert.equal(await page.locator('[data-resize-anchor]').count(),0);
    }
    for(const yaw of [0,37,90]) {
      for(const [sx,sy] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        await reset(yaw);const before=await object();
        await drag(`[data-resize-x="${sx}"][data-resize-y="${sy}"]`,sx*.12,sy*.18);
        const after=await object();near(after.width,before.width+.12);near(after.depth,before.depth+.18);
        sameAnchor(before,after,-sx,-sy);
        const model=await page.evaluate(()=>coffeeEditor.three.inspect('middle_counter'));
        near(model.position[0],after.x);near(model.position[2],-after.y);
        await page.locator('#undo').click();assert.deepEqual(await object(),before);
        await page.locator('#redo').click();assert.deepEqual(await object(),after);
      }
      for(const axis of ['width','depth'])for(const side of [-1,1]) {
        await reset(yaw);const before=await object();
        await drag(`[data-resize-axis="${axis}"][data-resize-side="${side}"]`,axis==='width'?side*.15:0,axis==='depth'?side*.15:0,true);
        const after=await object();near(after[axis],before[axis]+.15);
        near(after[axis==='width'?'depth':'width'],before[axis==='width'?'depth':'width']);
        sameAnchor(before,after,axis==='width'?-side:0,axis==='depth'?-side:0);
      }
    }
    passed.push('All four corners and edges preserve opposite anchors at 0°, 37° and 90°; edge drags stay single-axis with Shift; 3D transforms, undo and redo match.');
    await reset(37);
    await page.locator('[aria-label="Resize behaviour"]').selectOption('center');
    let before=await object();
    await drag('[data-resize-x="1"][data-resize-y="-1"]',.08,-.12);
    let after=await object();near(after.width,before.width+.16);near(after.depth,before.depth+.24);sameAnchor(before,after,0,0);
    before=after;
    await drag('[data-resize-axis="width"][data-resize-side="-1"]',-.10,0);
    after=await object();near(after.width,before.width+.20);near(after.depth,before.depth);sameAnchor(before,after,0,0);
    passed.push('Centre mode keeps the centre fixed for corners and edges.');
    async function field(name,value) {
      const input=page.locator(`[data-field="${name}"]`);await input.fill(String(value));await input.press('Tab');
    }
    for(const [axis,edge,ax,ay] of [['width','left',-1,0],['width','right',1,0],['depth','top',0,1],['depth','bottom',0,-1]]) {
      await reset(37);
      await page.locator(`[data-resize-option="resizeAnchor${axis==='width'?'X':'Y'}"]`).selectOption(edge);
      before=await object();
      await field(axis,(before[axis]+.22)*100);after=await object();
      near(after[axis],before[axis]+.22);sameAnchor(before,after,ax,ay);
      const support=await page.evaluate(()=>{
        const e=coffeeEditor;return {table:e.store.object('middle_counter'),child:e.store.object('nova5'),model:e.three.inspect('nova5'),old:resizeBaseline.scene.objects.find(o=>o.id==='nova5')};
      });
      near(support.model.position[0],support.child.x);near(support.model.position[2],-support.child.y);
    }
    await page.locator('#units').selectOption('px');
    before=await object();await field('depth',(before.depth+.13)*200);after=await object();sameAnchor(before,after,0,-1);near(after.depth,before.depth+.13);
    passed.push('Numeric resize supports all fixed edges in local rotated axes, pixel/cm units and mounted-equipment 3D updates.');
    await reset();before=await object();
    await drag('[data-resize-x="1"][data-resize-y="1"]',.21,.05,true);after=await object();
    near(after.width/before.width,after.depth/before.depth);sameAnchor(before,after,-1,-1);
    await reset();before=await object();
    await drag('[data-resize-x="1"][data-resize-y="-1"]',-.10,.15);after=await object();
    near(after.width,before.width-.10);near(after.depth,before.depth-.15);sameAnchor(before,after,-1,1);
    passed.push('Proportional and shrinking corner drags retain their fixed corners.');
    const helperChecks=await page.evaluate(async()=>{
      const {SceneStore,bounds,rotate}=await import('./editor/store.js');
      const {resizeAnchored,resizeDimension}=await import('./editor/resize-geometry.js');
      const s=new SceneStore(coffeeEditor.store.seed);s.options.resizeKeepChildren=false;
      s.scene.objects=[
        {id:'a',kind:'counter',x:1,y:2,width:1,depth:2,yaw_deg:31},
        {id:'b',kind:'counter',x:3,y:4,width:1,depth:1,yaw_deg:-19},
        {id:'child',kind:'machine',support:'a',x:1.1,y:2.2,width:.3,depth:.2,yaw_deg:31}
      ];
      s.scene.groups=[];
      const original=structuredClone(s.scene.objects),bb=bounds(s.resolve(['a','b']));
      resizeAnchored(s,['a','b'],bb.width*1.3,bb.depth*.8,[-1,1]);
      const ab=bounds(s.resolve(['a','b']));
      const group={before:bb,after:ab};
      s.scene.objects=structuredClone(original);
      const localBefore=rotate(.1,.2,-31);
      resizeAnchored(s,['a'],2,3,[-1,1]);
      const a=s.object('a'),c=s.object('child');
      const localAfter=rotate(c.x-a.x,c.y-a.y,-31);
      s.scene.objects=[{id:'r',kind:'robot',x:2,y:1,width:.2,depth:.3,yaw_deg:49}];
      const robotBefore=structuredClone(s.object('r'));resizeAnchored(s,['r'],.4,.9,[-1,-1]);const robotAfter=structuredClone(s.object('r'));
      s.scene.objects=[{id:'d',kind:'dispenser',x:2,y:1,width:.2,depth:.2,yaw_deg:71}];
      const dispenserBefore=structuredClone(s.object('d'));resizeDimension(s,['d'],'depth',.35);const dispenserAfter=structuredClone(s.object('d'));
      s.scene.objects=structuredClone(original);s.object('a').locked=true;resizeAnchored(s,['a','b'],7,7,[-1,1]);const locked=structuredClone(s.scene.objects);
      s.scene.objects=structuredClone(original);const clampBefore=structuredClone(s.object('a'));resizeAnchored(s,['a'],-3,-5,[-1,-1]);const clampAfter=structuredClone(s.object('a'));
      return {group,localBefore,localAfter,robotBefore,robotAfter,dispenserBefore,dispenserAfter,locked,original,clampBefore,clampAfter};
    });
    sameAnchor(helperChecks.group.before,helperChecks.group.after,-1,1);
    near(helperChecks.localAfter[0],helperChecks.localBefore[0]*2);near(helperChecks.localAfter[1],helperChecks.localBefore[1]*1.5);
    sameAnchor(helperChecks.robotBefore,helperChecks.robotAfter,-1,-1);near(helperChecks.robotAfter.depth,.6);
    sameAnchor(helperChecks.dispenserBefore,helperChecks.dispenserAfter,0,1);near(helperChecks.dispenserAfter.width,.35);
    assert.deepEqual(helperChecks.locked,helperChecks.original.map(o=>o.id==='a'?{...o,locked:true}:o));
    sameAnchor(helperChecks.clampBefore,helperChecks.clampAfter,-1,-1);near(helperChecks.clampAfter.width,.02);near(helperChecks.clampAfter.depth,.02);
    passed.push('Mixed rotated groups, mounted relative offsets, uniform robot/dispenser scaling, locks and minimum-size clamp preserve valid anchors.');
    await reset(37);await page.locator('[aria-label="Width field keeps"]').selectOption('right');
    await page.locator('[aria-label="Depth field keeps"]').selectOption('bottom');
    await page.waitForFunction(()=>{const v=JSON.parse(localStorage.getItem('coffee-layout-studio-v2'));return v?.editor_options?.resizeAnchorX==='right'&&v?.editor_options?.resizeAnchorY==='bottom'});
    const roundtrip=await page.evaluate(async()=>{
      const svg=await coffeeEditor.plan.exportSVG(false);
      const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
      const scene=JSON.parse(doc.querySelector('#coffee-scene-data').textContent);
      const {SceneStore}=await import('./editor/store.js');const s=new SceneStore(coffeeEditor.store.seed);s.importScene(scene);
      return {options:s.options,objects:s.scene.objects};
    });
    assert.equal(roundtrip.options.resizeMode,'opposite');assert.equal(roundtrip.options.resizeAnchorX,'right');assert.equal(roundtrip.options.resizeAnchorY,'bottom');
    await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:90000});
    assert.equal(await page.locator('[aria-label="Width field keeps"]').inputValue(),'right');
    assert.equal(await page.locator('[aria-label="Depth field keeps"]').inputValue(),'bottom');
    passed.push('Preferences survive autosave, reload and SVG/JSON round-trip.');
    await page.locator('[aria-label="Resize behaviour"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(__dirname,'output','resize-anchor-editor.png')});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(__dirname,'output','resize-anchor-report.json'),JSON.stringify({passed,errors},null,2));
    console.log(JSON.stringify({passed,errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
