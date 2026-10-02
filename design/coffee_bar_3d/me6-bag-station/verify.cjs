const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/me6-bag-station/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.me6Proposal?.ready);
 const animation=await page.evaluate(async()=>{
  const T=await import('../vendor/three.module.js'),{GLTFLoader}=await import('../vendor/GLTFLoader.js'),g=await new GLTFLoader().loadAsync('output/me6-station-animated.glb'),d=await fetch('motion.json').then(r=>r.json());
  const mixer=new T.AnimationMixer(g.scene);g.animations.forEach(a=>mixer.clipAction(a).play());let tcp;g.scene.traverse(n=>{if(n.userData.role==='tcp')tcp=n;});
  const checks=[];for(const time of [0,4.5,8,12,15.5,20,23.9]){mixer.setTime(time);g.scene.updateMatrixWorld(true);const f=d.frames[Math.round(time*24)],target=new T.Vector3(f.tcp[0],d.parameters.table.height+f.tcp[2],-f.tcp[1]);checks.push({time,error_mm:tcp.getWorldPosition(new T.Vector3()).distanceTo(target)*1000});}
  return {clips:g.animations.map(a=>({name:a.name,duration:a.duration,tracks:a.tracks.length})),checks};
 });
 assert.equal(animation.clips.length,1);assert.ok(animation.checks.every(x=>x.error_mm<1),JSON.stringify(animation));
 await page.locator('#top').click();assert.equal(await page.locator('#top').getAttribute('aria-pressed'),'true');
 await page.locator('[data-time="5.55"]').click();await page.locator('#play').click();await page.waitForTimeout(300);await page.locator('#play').click();assert.ok(await page.evaluate(()=>me6Proposal.time)>5.55);
 await page.locator('#reset').click();assert.equal(await page.evaluate(()=>me6Proposal.time),0);
 await page.locator('[data-time="24"]').click();await page.locator('#iso').click();await page.screenshot({path:path.join(__dirname,'output/viewer-final.png')});
 const video=await page.locator('video').evaluate(async v=>{await v.play();v.pause();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error?.message};});
 assert.ok(video.duration>=23.9&&video.duration<=24.1);assert.ok(!video.error);
 const downloads=await page.evaluate(async()=>{const urls=['output/me6-bag-station.blend','output/me6-between-racks.blend','output/me6-station-animated.glb','output/me6-overhead.mp4','parameters.json'];return Promise.all(urls.map(async url=>({url,status:(await fetch(url,{method:'HEAD'})).status})));});assert.ok(downloads.every(d=>d.status===200));
 await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 await page.screenshot({path:path.join(__dirname,'output/viewer-mobile.png')});assert.deepEqual(errors,[]);
 const report={animation,video,downloads,mobileOverflow:overflow,errors};fs.writeFileSync(path.join(__dirname,'output/validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
