const {chromium,_electron:electron}=require('./desktop/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'output');
(async()=>{
  const desktop=process.argv.includes('--electron'),env={...process.env,LAYOUT_STUDIO_TEST:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  if(desktop)env.LAYOUT_STUDIO_TEST_PROFILE=fs.mkdtempSync(path.join(out,'standard-profile-'));
  const nativeOutput=desktop?fs.mkdtempSync(path.join(out,'standard-downloads-')):out;
  const browser=desktop?await electron.launch({executablePath:require('./desktop/node_modules/electron'),args:[path.join(__dirname,'desktop'),'--enable-unsafe-swiftshader'],env,timeout:60000}):await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const passed=[],errors=[];
  try{
    const page=desktop?await browser.firstWindow():await browser.newPage({viewport:{width:1700,height:1080},acceptDownloads:true});
    page.on('pageerror',e=>errors.push(e.message));
    if(!desktop)await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:8766/viewer.html');
    await page.waitForFunction(()=>window.coffeeEditor?.ready,null,{timeout:120000});
    if(desktop)await browser.evaluate(({session},folder)=>{
      globalThis.standardDownloads=[];
      session.fromPartition('persist:layout-studio').on('will-download',(_event,item)=>{
        item.setSavePath(folder+'/'+item.getFilename().split(/[\\/]/).pop());
        item.once('done',(_event,state)=>globalThis.standardDownloads.push({name:item.getFilename(),path:item.getSavePath(),state,url:item.getURL()}));
      });
    },nativeOutput);
    const nextDownload=()=>{
      if(!desktop)return page.waitForEvent('download');
      return (async()=>{
        for(let i=0;i<200;i++){
          const file=await browser.evaluate(()=>globalThis.standardDownloads.shift());
          if(file){assert.equal(file.state,'completed',JSON.stringify(file));return {suggestedFilename:()=>file.name,saveAs:async target=>fs.copyFileSync(file.path,target)};}
          await new Promise(r=>setTimeout(r,150));
        }
        throw Error('Native download did not complete');
      })();
    };
    const waitReady=async()=>{
      await page.waitForFunction(()=>!coffeeEditor.order.busy&&(coffeeEditor.standard.valid||coffeeEditor.order.failed),null,{timeout:120000});
      const result=await page.evaluate(()=>({valid:coffeeEditor.standard.valid,kind:coffeeEditor.standard.kind,message:coffeeEditor.order.message,routes:Object.fromEntries(Object.entries(coffeeEditor.order.routes).map(([k,v])=>[k,v.message]))}));
      if(!result.valid)fs.writeFileSync(path.join(out,'standard-failure.json'),JSON.stringify(await page.evaluate(()=>({scene:coffeeEditor.store.exportScene(),route:coffeeEditor.order.routes.bag})),null,2));
      assert.ok(result.valid,JSON.stringify(result));
    };
    const waitFailed=()=>page.waitForFunction(()=>coffeeEditor.order.failed&&!coffeeEditor.order.busy,null,{timeout:120000});
    const done=text=>{passed.push(text);console.log(text);};
    assert.equal(await page.locator('#studio-mode').inputValue(),'standard');
    await page.evaluate(()=>coffeeEditor.store.select('nova2'));
    assert.ok(await page.locator('#support').isVisible());
    assert.ok(!await page.locator('#show-reach').isVisible());
    assert.ok(!await page.locator('.collision-menu').isVisible());
    const before=await page.evaluate(()=>JSON.stringify(coffeeEditor.store.exportScene()));
    await page.locator('#studio-mode').selectOption('advanced');
    assert.ok(await page.locator('#show-reach').isVisible());
    assert.ok(await page.locator('.collision-menu').isVisible());
    await page.locator('#studio-mode').selectOption('standard');
    assert.equal(await page.evaluate(()=>JSON.stringify(coffeeEditor.store.exportScene())),before);
    done('Modes preserve project and collision policies; Standard keeps Support and hides diagnostics.');

    await page.locator('#plan-names').selectOption('hover');await page.mouse.move(20,20);
    const text=page.locator('#plan [data-object-id="coffee_machine"] [data-label-text]');
    assert.equal(await text.evaluate(n=>getComputedStyle(n).opacity),'0');
    await page.locator('#plan [data-object-id="coffee_machine"]').hover({force:true});
    assert.equal(await text.evaluate(n=>getComputedStyle(n).opacity),'1');
    assert.equal(await page.evaluate(()=>coffeeEditor.store.options.showLabels),true);
    await page.locator('#plan-names').selectOption('always');await page.mouse.move(20,20);
    await page.locator('#labels').uncheck();
    assert.equal(await text.evaluate(n=>getComputedStyle(n).opacity),'1');
    await page.locator('#labels').check();await page.locator('#plan-names').selectOption('hover');
    await page.waitForTimeout(400);await page.reload();await page.waitForFunction(()=>coffeeEditor?.ready);
    assert.equal(await page.locator('#plan-names').inputValue(),'hover');
    done('Names hover/always works, persists, and stays independent of 3D labels.');

    await page.locator('[data-panel="library"]').click();
    const n=await page.evaluate(()=>coffeeEditor.store.scene.objects.length);
    await page.locator('#library-search').fill('counter');
    await page.locator('[data-asset] button').first().click();
    assert.ok(await page.evaluate(()=>coffeeEditor.store.scene.objects.length)>n);
    await page.locator('#undo').click();await page.locator('[data-panel="flow"]').click();
    await page.locator('#standard-flow-panel .standard-options').last().locator('summary').click();
    await page.locator('[data-standard-action="demo"]').click();
    await page.waitForFunction(()=>coffeeEditor.store.scene.title==='Layout Studio demo');
    await waitReady();
    assert.equal(await page.evaluate(()=>coffeeEditor.store.scene.title),'Layout Studio demo');
    await page.locator('[data-standard-action="play"]').click();
    await page.waitForFunction(()=>coffeeEditor.order.time>0||coffeeEditor.order.failed,null,{timeout:15000});
    const times=await page.evaluate(()=>[coffeeEditor.order.time,coffeeEditor.flow.player.time,coffeeEditor.coffee.player.time]);
    assert.ok(times[0]>0);assert.equal(times[0],times[1]);assert.equal(times[0],times[2]);
    await page.locator('[data-standard-action="play"]').click();
    done('Object library adds assets; demo validates both routes and plays on one clock.');
    await page.screenshot({path:path.join(out,'standard-mode-preview.png')});
    const working=await page.evaluate(()=>coffeeEditor.store.exportScene());

    await page.evaluate(()=>coffeeEditor.store.transact('Invalid bag test',()=>coffeeEditor.store.object('nova5_suction').x=20));
    await waitFailed();assert.equal(await page.evaluate(()=>coffeeEditor.order.playing),false);
    assert.ok(await page.locator('[data-standard-action="restore"]').isVisible());
    await page.locator('[data-standard-setting="kind"]').selectOption('drink');await waitReady();
    assert.deepEqual(await page.evaluate(()=>coffeeEditor.order.routeKinds),['coffee']);
    assert.equal(await page.evaluate(()=>coffeeEditor.flow.player.overlay==null),true);
    await page.locator('[data-standard-action="record"]').click();
    await page.waitForFunction(()=>coffeeEditor.order.recorder.state==='recording');
    assert.ok(await page.locator('#studio-mode').isDisabled());await page.waitForTimeout(1600);
    await page.locator('[data-standard-action="stop-record"]').click();
    await page.waitForFunction(()=>coffeeEditor.order.recorder.state==='ready');
    const video=await page.evaluate(async()=>{
      const r=coffeeEditor.order.recorder,v=document.createElement('video');v.src=r.url;v.muted=true;
      await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});
      return {size:r.blob.size,type:r.blob.type,w:v.videoWidth,h:v.videoHeight};
    });
    assert.ok(video.size>10000);assert.equal(video.w,1280);assert.equal(video.h,720);
    assert.match(video.type,/video\/(mp4|webm)/);
    let download=nextDownload();await page.locator('[data-standard-action="save-video"]').click();
    assert.match((await download).suggestedFilename(),/^drink-order.*\.(mp4|webm)$/);
    done('Failed orders block; drink-only ignores an invalid bag station and records a decodable 720p video.');

    await page.evaluate(scene=>coffeeEditor.store.importScene(scene),working);
    await page.locator('[data-standard-setting="kind"]').selectOption('bread');await waitReady();
    assert.deepEqual(await page.evaluate(()=>coffeeEditor.order.routeKinds),['bag']);
    await page.evaluate(()=>coffeeEditor.store.transact('Later edit',()=>coffeeEditor.store.object('nova5_suction').x=20));
    await waitFailed();await page.locator('[data-standard-action="restore"]').click();await waitReady();
    assert.deepEqual(await page.evaluate(()=>coffeeEditor.order.routeKinds),['bag']);
    assert.ok(await page.locator('#undo').isEnabled());
    done('Bread-only validates independently; last working layout restores, rechecks, and is undoable.');

    await page.locator('#export-menu summary').click();
    assert.ok(await page.locator('[data-export="json"]').isVisible());
    assert.ok(!await page.locator('[data-export="svg"]').isVisible());
    download=nextDownload();await page.locator('[data-export="json"]').click();
    const project=await download,projectFile=path.join(out,'standard-test-project.json');await project.saveAs(projectFile);
    assert.ok(JSON.parse(fs.readFileSync(projectFile,'utf8')).objects.length);
    await page.locator('#import-file').setInputFiles(projectFile);
    await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Project opened');
    assert.equal(await page.locator('#toast').textContent(),'Project opened');
    download=nextDownload();await page.locator('[data-standard-action="image"]').click();
    assert.match((await download).suggestedFilename(),/\.png$/);
    await page.locator('#ui-language').selectOption('zh-CN');
    await page.waitForFunction(()=>document.querySelector('#standard-flow-panel h2').textContent.includes('运行'));
    assert.equal(await page.locator('#plan-names option[value="hover"]').textContent(),'悬停时显示');
    await page.screenshot({path:path.join(out,'standard-mode-chinese.png')});
    await page.locator('#ui-language').selectOption('en');
    await page.waitForFunction(()=>document.querySelector('#standard-flow-panel h2').textContent==='See it in motion.');
    done('Project import/export, PNG and reversible Chinese translation work.');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,errors,video},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
