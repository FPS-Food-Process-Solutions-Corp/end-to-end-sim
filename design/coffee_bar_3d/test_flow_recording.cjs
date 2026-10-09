const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'output');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,a+' != '+b);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:1100},acceptDownloads:true}),errors=[],passed=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
  await page.waitForFunction(()=>window.coffeeEditor?.ready&&coffeeEditor.flow.result,null,{timeout:90000});
  await page.evaluate(()=>{
    const {store,flow}=coffeeEditor;
    store.transact('Configure pastry fixture and invalid beverage route',()=>{
      for(const shelf of store.scene.objects.filter(o=>o.kind==='shelf'))
        shelf.shelf_overrides={...store.shelfSettings(shelf),bread_length_1:.06};
      store.scene.bag_workflow={...flow.settings(),bread_mode:'nova',auto_check:false};
      store.object('nova2').x=20;
    });
    flow.check();
  });
  await page.waitForFunction(()=>coffeeEditor.flow.result?.bread&&!coffeeEditor.flow.worker,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>coffeeEditor.flow.result.pathOK),true);
  const bag=page.locator('#flow-panel [data-flow-video]');
  await bag.locator('[data-video-setting="segment"]').selectOption('pastry');
  const selection=await page.evaluate(async()=>{
    const e=coffeeEditor,{sceneKey}=await import('./editor/handoff-validation.js');
    const before=sceneKey(e.store.exportScene()),ready=e.flow.result;
    e.three.controls.target.set(1.5,.8,-2.7);e.three.camera.position.set(-2.2,3.2,0);e.three.controls.update();
    e.flow.video.saveCamera();e.flow.video.updateSettings({height:720});
    const after=sceneKey(e.store.exportScene());
    return {before,after,sameResult:ready===e.flow.result,range:e.flow.video.range,duration:e.flow.player.request.duration};
  });
  assert.equal(selection.before,selection.after);assert.ok(selection.sameResult);
  assert.ok(selection.range.start>0&&selection.range.end<selection.duration);
  await bag.locator('[data-video-action="record"]').click();
  await page.waitForFunction(()=>coffeeEditor.flow.video.recorder.state==='recording');
  const frozen=await page.evaluate(()=>{
    const e=coffeeEditor,r=e.flow.video.recorder,before=r.camera.position.toArray();
    e.three.camera.position.x+=.2;
    return {before,after:r.camera.position.toArray(),controls:e.three.controls.enabled,
      otherPlaying:e.coffee.player.playing,otherOverlay:!!e.coffee.player.overlay,
      playDisabled:document.querySelector('#flow-play').disabled};
  });
  assert.deepEqual(frozen.before,frozen.after);assert.ok(!frozen.controls&&!frozen.otherPlaying&&!frozen.otherOverlay&&frozen.playDisabled);
  console.log('Recording pastry segment ('+(selection.range.end-selection.range.start).toFixed(1)+' s)…');
  await page.waitForFunction(()=>['ready','error'].includes(coffeeEditor.flow.video.recorder.state),null,{timeout:90000});
  const pastry=await inspectVideo(page,'flow');
  assert.equal(pastry.state,'ready',JSON.stringify(pastry));assert.equal(pastry.reason,'Complete pastry pick');
  near(pastry.time,selection.range.end);assert.ok(pastry.duration>=selection.range.end-selection.range.start);
  assert.notEqual(pastry.first,pastry.second);assert.ok(pastry.controls);
  const pastryName=await saveVideo(page,bag);
  assert.match(pastryName,/^pastry-pick\.(webm|mp4)$/);
  passed.push('Pastry recording captures only the validated pick/place interval, retains bag synchronization and leaves invalid coffee idle.');

  await bag.locator('[data-video-setting="segment"]').selectOption('packing');
  await bag.locator('[data-video-setting="height"]').selectOption('1080');
  await bag.locator('[data-video-action="record"]').click();
  await page.waitForFunction(()=>coffeeEditor.flow.video.recorder.state==='recording');
  assert.deepEqual(await page.evaluate(()=>[coffeeEditor.flow.video.recorder.canvas.width,coffeeEditor.flow.video.recorder.canvas.height]),[1920,1080]);
  await page.waitForTimeout(600);await bag.locator('[data-video-action="stop"]').click();
  await page.waitForFunction(()=>coffeeEditor.flow.video.recorder.state==='ready');
  assert.match(await saveVideo(page,bag),/^bread-bag-flow-partial\.(webm|mp4)$/);
  passed.push('Whole-packing 1080p recording can be stopped and saved as a partial clip.');

  await page.evaluate(()=>{
    const {store}=coffeeEditor;
    store.transact('Valid coffee, invalid packing',()=>{
      store.object('nova2').x=store.seed.objects.find(o=>o.id==='nova2').x;
      store.object(store.scene.bag_workflow.robot_id).x=20;
    });
  });
  await page.locator('[data-workflow="coffee"]').click();
  await page.waitForFunction(()=>coffeeEditor.coffee.result&&!coffeeEditor.coffee.worker,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.result.pathOK),true);
  const coffee=page.locator('#coffee-flow-panel [data-flow-video]');
  await page.evaluate(()=>{
    const e=coffeeEditor;e.three.controls.target.set(.7,1.05,-1.1);e.three.camera.position.set(-2.1,2.8,.5);e.three.controls.update();
  });
  await coffee.locator('[data-video-action="save-camera"]').click();
  await coffee.locator('[data-video-action="record"]').click();
  await page.waitForFunction(()=>coffeeEditor.coffee.video.recorder.state==='recording');
  assert.deepEqual(await page.evaluate(()=>[coffeeEditor.flow.player.playing,!!coffeeEditor.flow.player.overlay]),[false,false]);
  console.log('Recording the coffee-only flow…');
  await page.waitForFunction(()=>['ready','error'].includes(coffeeEditor.coffee.video.recorder.state),null,{timeout:120000});
  const drink=await inspectVideo(page,'coffee');
  assert.equal(drink.state,'ready',JSON.stringify(drink));assert.equal(drink.reason,'Complete coffee flow');
  near(drink.time,await page.evaluate(()=>coffeeEditor.coffee.player.request.duration));
  assert.notEqual(drink.first,drink.second);assert.ok(drink.controls);
  assert.match(await saveVideo(page,coffee),/^coffee-flow\.(webm|mp4)$/);
  passed.push('Coffee-only recording completes and decodes changing frames while the invalid packing route remains idle.');

  await coffee.locator('[data-video-action="record"]').click();
  await page.waitForTimeout(600);
  await page.evaluate(()=>coffeeEditor.store.transact('Edit during recording',()=>coffeeEditor.store.object('coffee_machine').x+=.01));
  await page.waitForFunction(()=>coffeeEditor.coffee.video.recorder.state==='ready');
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.video.recorder.reason),'Layout or order changed');
  assert.ok(await page.evaluate(()=>coffeeEditor.three.controls.enabled));
  assert.match(await saveVideo(page,coffee),/^coffee-flow-partial\.(webm|mp4)$/);
  await page.waitForFunction(()=>coffeeEditor.coffee.result?.pathOK&&!coffeeEditor.coffee.worker,null,{timeout:90000});
  await coffee.locator('[data-video-action="record"]').click();await page.waitForTimeout(600);
  await page.locator('[data-workflow="bag"]').click();
  await page.waitForFunction(()=>coffeeEditor.coffee.video.recorder.state==='ready');
  assert.equal(await page.evaluate(()=>coffeeEditor.coffee.video.recorder.reason),'Workflow changed');
  assert.equal(await page.evaluate(()=>coffeeEditor.three.activeRecorder),null);
  assert.ok(await page.evaluate(()=>coffeeEditor.three.controls.enabled));
  passed.push('Edits and workflow changes stop safely, preserve partial video and release the camera/recorder.');

  const saved=await page.evaluate(()=>coffeeEditor.store.scene.flow_video);
  await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready);
  assert.deepEqual(await page.evaluate(()=>coffeeEditor.store.scene.flow_video),saved);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'flow-recording-test-report.json'),JSON.stringify({passed,pastry,drink,errors},null,2));
  console.log(JSON.stringify({passed,pastry,drink,errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});

async function saveVideo(page,host){
 const pending=page.waitForEvent('download');await host.locator('[data-video-action="save"]').click();
 const download=await pending;await download.saveAs(path.join(output,download.suggestedFilename()));return download.suggestedFilename();
}
async function inspectVideo(page,flow){
 return page.evaluate(async flow=>{
  const e=coffeeEditor,r=e[flow].video.recorder;
  if(r.state!=='ready')return {state:r.state,error:r.error};
  const video=document.createElement('video');video.muted=true;video.src=r.url;
  await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video decode failed'));});
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
  const context=canvas.getContext('2d');
  const read=async time=>{
    await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=time;});
    context.drawImage(video,0,0,160,90);return [...context.getImageData(0,0,160,90).data].reduce((sum,pixel)=>sum+pixel,0);
  };
  const first=await read(.1),second=await read(Math.min(video.duration/2,10));
  return {state:r.state,reason:r.reason,bytes:r.blob.size,width:video.videoWidth,height:video.videoHeight,
    duration:video.duration,first,second,time:e[flow].player.time,controls:e.three.controls.enabled};
 },flow);
}
