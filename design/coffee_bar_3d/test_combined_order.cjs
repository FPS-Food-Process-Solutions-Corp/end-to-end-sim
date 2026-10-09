const {chromium}=require('./desktop/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'output'),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' != '+b);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true});
  const page=await context.newPage(),errors=[],passed=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html?mode=advanced&workflow=order');
  await page.waitForFunction(()=>window.coffeeEditor?.ready);
  assert.ok(await page.locator('[data-workflow="order"]').evaluate(n=>n.classList.contains('active')));
  assert.equal(await page.locator('[data-order-bread="bread_mode"]').inputValue(),'nova');
  // Use the maintained demo, including a reachable top-pick bag magazine.
  await page.evaluate(async()=>coffeeEditor.store.importScene(await fetch('./layouts/standard-demo.json').then(r=>r.json())));
  // Use bread narrow enough for the real tongs to grip from the sides.
  await page.evaluate(()=>{for(const shelf of coffeeEditor.store.scene.objects.filter(o=>o.kind==='shelf'))shelf.shelf_overrides={...coffeeEditor.store.shelfSettings(shelf),bread_length_1:.06};coffeeEditor.three.sync();});
  await page.locator('[data-order-action="place"]').click();
  await page.waitForFunction(()=>!coffeeEditor.order.busy,null,{timeout:90000});
  const solved=await page.evaluate(()=>{
   const {order:o,flow,coffee}=coffeeEditor;o.playing=false;o.seek(15);
   const first={time:o.time,bag:flow.player.time,coffee:coffee.player.time,bagVisible:!!flow.player.overlay,coffeeVisible:!!coffee.player.overlay,
    bread:!!flow.player.breadPlayer,ready:o.ready,duration:o.duration,bagDuration:flow.player.request.duration,coffeeDuration:coffee.player.request.duration};
   o.seek(Math.min(flow.player.request.duration,coffee.player.request.duration)+1);
   const done={bag:flow.player.time,coffee:coffee.player.time,cup:coffee.player.cup.root.position.toArray()};
   o.seek(0);const rewind={bag:flow.player.time,coffee:coffee.player.time,cupHidden:!coffee.player.cup.root.visible};
   return {first,done,rewind};
  });
  assert.ok(solved.first.ready&&solved.first.bagVisible&&solved.first.coffeeVisible&&solved.first.bread);
  near(solved.first.bag,15);near(solved.first.coffee,15);
  const midway=Math.min(solved.first.bagDuration,solved.first.coffeeDuration)+1;
  near(solved.done.coffee,Math.min(midway,solved.first.coffeeDuration));near(solved.done.bag,Math.min(midway,solved.first.bagDuration));
  near(solved.rewind.bag,0);near(solved.rewind.coffee,0);assert.ok(solved.rewind.cupHidden);
  await page.locator('[data-order-action="play"]').click();await page.waitForTimeout(350);
  const clocks=await page.evaluate(()=>[coffeeEditor.order.time,coffeeEditor.flow.player.time,coffeeEditor.coffee.player.time]);
  near(clocks[0],clocks[1]);near(clocks[0],clocks[2]);assert.ok(clocks[0]>0);
  await page.locator('[data-order-action="play"]').click();
  passed.push('A single clock drives bag, tong Nova-5 and Nova-2; shorter drink flow holds its final state; pause/rewind work.');

  const gating=await page.evaluate(async()=>{
   const {order:o,store}=coffeeEditor,original=store.exportScene();
   store.transact('Test invalid beverage',()=>store.object('nova2').x=20);
   await o.validate(true);
   const failed={ready:o.ready,playing:o.playing,bagOK:o.routes.bag.ok,coffeeError:o.routes.coffee.error,overlay:!!o.coffee.player.overlay};
   store.importScene(original);
   const pending=o.validate(true);
   store.transact('Test stale checks',()=>store.object('cup_dispenser').visible=false);
   await pending;
   const stale={ready:o.ready,playing:o.playing};
   await o.validate(true);
   const hidden={ready:o.ready,coffeeError:o.routes.coffee.error,message:o.routes.coffee.message};
   store.importScene(original);
   return {failed,stale,hidden};
  });
  assert.equal(gating.failed.ready,false);assert.equal(gating.failed.playing,false);assert.equal(gating.failed.overlay,false);
  assert.ok(gating.failed.bagOK&&gating.failed.coffeeError);
  assert.deepEqual(gating.stale,{ready:false,playing:false});assert.ok(!gating.hidden.ready&&gating.hidden.coffeeError);
  assert.match(gating.hidden.message,/hidden/);
  passed.push('One invalid route blocks both; edits cancel stale checks and hidden equipment is rejected.');

  await page.evaluate(async()=>{await coffeeEditor.order.validate(false);coffeeEditor.order.frame();});
  assert.equal(await page.evaluate(()=>coffeeEditor.order.ready),true);
  await page.locator('[data-order-action="save-camera"]').click();
  const camera=await page.evaluate(()=>coffeeEditor.store.scene.order_camera);
  await page.evaluate(()=>{coffeeEditor.three.camera.position.x+=1;coffeeEditor.order.restoreCamera();});
  assert.deepEqual(await page.evaluate(()=>coffeeEditor.three.camera.position.toArray()),camera.position);
  assert.equal(await page.evaluate(()=>coffeeEditor.order.ready),true);
  passed.push('Saving/restoring the camera keeps route validation and persists the selected viewpoint.');

  await page.locator('[data-order-action="record"]').click();
  await page.waitForFunction(()=>coffeeEditor.order.recorder.state==='recording');
  const locked=await page.evaluate(()=>{
   const {order:o,three}=coffeeEditor,recorded=o.recorder.camera.position.toArray();
   three.camera.position.x+=.25;
   return {recorded,after:o.recorder.camera.position.toArray(),controls:three.controls.enabled,w:o.recorder.canvas.width,h:o.recorder.canvas.height};
  });
  assert.deepEqual(locked.recorded,locked.after);assert.equal(locked.controls,false);assert.equal(locked.w,1280);assert.equal(locked.h,720);
  console.log('Recording the complete '+solved.first.duration.toFixed(1)+' second order…');
  await page.waitForFunction(()=>coffeeEditor.order.recorder.state==='ready'||coffeeEditor.order.recorder.state==='error',null,{timeout:120000});
  const video=await page.evaluate(async()=>{
   const {order:o}=coffeeEditor,r=o.recorder;
   if(r.state!=='ready')return {error:r.error};
   const v=document.createElement('video');v.muted=true;v.src=r.url;
   await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Recorded video failed to decode'));});
   const canvas=document.createElement('canvas');canvas.width=80;canvas.height=45;const ctx=canvas.getContext('2d');
   const pixels=()=>{ctx.drawImage(v,0,0,80,45);return [...ctx.getImageData(0,0,80,45).data].reduce((s,x)=>s+x,0);};
   await new Promise(resolve=>{v.onseeked=resolve;v.currentTime=.1;});
   const first=pixels();
   await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;v.currentTime=10;});
   return {state:r.state,reason:r.reason,size:r.blob.size,type:r.blob.type,width:v.videoWidth,height:v.videoHeight,
    first,second:pixels(),videoDuration:v.duration,time:o.time,duration:o.duration,controls:o.view.controls.enabled,playing:o.playing};
  });
  assert.equal(video.state,'ready',JSON.stringify(video));assert.equal(video.reason,'Complete order');assert.ok(video.size>100000);
  assert.equal(video.width,1280);assert.equal(video.height,720);assert.ok(video.first>0);assert.notEqual(video.first,video.second);assert.ok(Number.isFinite(video.videoDuration)&&video.videoDuration>=video.duration);
  near(video.time,video.duration);assert.ok(video.controls&&!video.playing);
  const download=page.waitForEvent('download');await page.locator('[data-order-action="save-video"]').click();
  const videoFile=await download;await videoFile.saveAs(path.join(out,videoFile.suggestedFilename()));
  passed.push('A complete fixed-POV 720p video encodes, decodes changing frames, downloads and automatically finishes with the full order.');

  // Partial 1080p capture also stops cleanly on a layout edit.
  await page.locator('#order-video-height').selectOption('1080');
  await page.locator('[data-order-action="record"]').click();await page.waitForTimeout(500);
  const captureSize=await page.evaluate(()=>[coffeeEditor.order.recorder.canvas.width,coffeeEditor.order.recorder.canvas.height]);
  assert.deepEqual(captureSize,[1920,1080]);
  await page.evaluate(()=>coffeeEditor.store.transact('Test capture invalidation',()=>coffeeEditor.store.object('coffee_machine').x+=.01));
  await page.waitForFunction(()=>coffeeEditor.order.recorder.state==='ready');
  assert.equal(await page.evaluate(()=>coffeeEditor.order.ready),false);
  assert.equal(await page.evaluate(()=>coffeeEditor.order.recorder.reason),'Stopped early');
  passed.push('1080p capture and partial recording recovery work; a layout edit stops playback and requires revalidation.');

  await page.locator('#snapshots-button').click();
  await page.locator('.snapshot-form [name="name"]').fill('Working layout <A>');
  await page.locator('.snapshot-form [name="description"]').fill('Wrist stamper; one bread + coffee.\nKeep this spacing.');
  await page.locator('.snapshot-form button[type="submit"]').click();
  const snapshot=await page.evaluate(()=>coffeeEditor.snapshots.items[0]);
  assert.equal(snapshot.name,'Working layout <A>');assert.ok(snapshot.description.includes('\n'));
  assert.equal(await page.locator('.snapshot-card h3').textContent(),'Working layout <A>');
  assert.equal(await page.locator('.snapshot-card h3 a').count(),0);
  await page.screenshot({path:path.join(out,'scene-snapshots-preview.png')});
  const baseline=await page.evaluate(()=>coffeeEditor.store.scene.objects.length);
  await page.locator('[data-snapshot-action="restore"]').focus();await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(()=>coffeeEditor.store.scene.objects.length),baseline);
  await page.locator('[data-snapshot-action="close"]').click();
  await page.evaluate(()=>{
   const {store,three}=coffeeEditor;
   store.transact('Test later edits',()=>{store.object('nova2').x+=.12;store.scene.coffee_workflow.temperature='cold';});
   three.camera.position.set(8,9,10);
  });
  await page.locator('#snapshots-button').click();await page.locator('[data-snapshot-action="restore"]').click();
  const restored=await page.evaluate(()=>({scene:coffeeEditor.store.exportScene(),camera:coffeeEditor.three.camera.position.toArray(),ready:coffeeEditor.order.ready,playing:coffeeEditor.order.playing}));
  near(restored.scene.objects.find(o=>o.id==='nova2').x,snapshot.scene.objects.find(o=>o.id==='nova2').x);
  assert.equal(restored.scene.coffee_workflow.temperature,snapshot.scene.coffee_workflow.temperature);
  assert.deepEqual(restored.camera,snapshot.camera.position);assert.ok(!restored.ready&&!restored.playing);
  passed.push('Named snapshots restore the full layout, workflow settings and camera without stale playback; text and modal keyboard actions are safe.');

  await page.reload();await page.waitForFunction(()=>window.coffeeEditor?.ready);
  assert.equal(await page.evaluate(()=>coffeeEditor.snapshots.items.length),1);
  await page.locator('#snapshots-button').click();
  await page.locator('[data-snapshot-action="delete"]').click();assert.equal(await page.locator('.snapshot-card').count(),0);
  await page.locator('[data-snapshot-action="undo"]').click();assert.equal(await page.locator('.snapshot-card').count(),1);
  const backup=page.waitForEvent('download');await page.locator('[data-snapshot-action="export"]').click();
  const backupFile=await backup,backupPath=path.join(out,'test-scene-snapshots.json');await backupFile.saveAs(backupPath);
  const data=JSON.parse(fs.readFileSync(backupPath,'utf8'));assert.equal(data.snapshots.length,1);
  await page.locator('#snapshots-import').setInputFiles(backupPath);
  await page.waitForFunction(()=>coffeeEditor.snapshots.items.length===2);
  const quota=await page.evaluate(()=>{
   const native=Storage.prototype.setItem;
   Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
   let message;
   try{coffeeEditor.snapshots.save('Should not be lost');}catch(error){message=error.message;}
   finally{Storage.prototype.setItem=native;}
   return {message,count:coffeeEditor.snapshots.items.length};
  });
  assert.match(quota.message,/Storage may be full/);assert.equal(quota.count,2);
  // Another editor tab may have saved a snapshot since this dialog was opened.
  const other=await page.context().newPage();
  await other.goto('http://127.0.0.1:8766/viewer.html');await other.waitForFunction(()=>window.coffeeEditor?.ready);
  await other.evaluate(()=>coffeeEditor.snapshots.save('From another tab'));
  await page.evaluate(()=>coffeeEditor.snapshots.save('From original tab'));
  assert.equal(await page.evaluate(()=>coffeeEditor.snapshots.items.length),4);
  await other.close();
  passed.push('Snapshots survive reload, deletion undo, JSON backup/import, full storage and saves from another editor tab.');
  assert.deepEqual(errors,[]);
  const report={passed,solved,video,gating,errors};
  fs.writeFileSync(path.join(out,'combined-order-test-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
