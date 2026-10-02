const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('child_process'),{once}=require('events'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const output=path.join(__dirname,'output'),motion=JSON.parse(fs.readFileSync(path.join(__dirname,'motion.json')));
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:960,height:780},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/me6-bag-station/?capture=1',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.me6Proposal?.ready);
 let maxError=0;
 for(let i=0;i<motion.frames.length;i+=8){
  const f=motion.frames[i],actual=await page.evaluate(t=>{me6Proposal.seek(t);return me6Proposal.inspect();},f.time);
  const target=[f.tcp[0],motion.parameters.table.height+f.tcp[2],-f.tcp[1]];
  const error=Math.hypot(...target.map((x,k)=>x-actual.tcp[k]));maxError=Math.max(maxError,error);
  assert.ok(error<.00015,'Rendered TCP disagrees with solved motion at '+f.time);
  assert.equal(actual.jointCount,6);
 }
 const movie=path.join(output,'me6-overhead.mp4');
 const ff=spawn('D:/Software/ffmpeg/ffmpeg-8.0.1-essentials_build/bin/ffmpeg.exe',['-y','-v','error','-f','image2pipe','-framerate',String(motion.parameters.motion.fps),'-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',movie],{stdio:['pipe','ignore','pipe'],windowsHide:true});
 let stderr='';ff.stderr.on('data',d=>stderr+=d);const completion=once(ff,'close');
 const length=motion.parameters.motion.duration*motion.parameters.motion.fps;
 for(let i=0;i<length;i++){
  await page.evaluate(t=>{me6Proposal.seek(t);me6Proposal.render();},i/motion.parameters.motion.fps);
  const bytes=await page.screenshot({type:'jpeg',quality:92});
  if(!ff.stdin.write(bytes))await once(ff.stdin,'drain');
  if(i%96===0)console.log('Recording frame '+i+' / '+length);
 }
 ff.stdin.end();const [exit]=await completion;assert.equal(exit,0,stderr);
 for(const [name,t] of [['pickup',5.5],['transfer',10.5],['opposing-suction',15],['open',24]]){
  await page.evaluate(t=>me6Proposal.seek(t),t);
  await page.screenshot({path:path.join(output,'step-'+name+'.png')});
 }
 assert.deepEqual(errors,[]);
 const report={rendered_tcp_max_error_mm:maxError*1000,frames:length,duration_seconds:motion.parameters.motion.duration,errors,movie_bytes:fs.statSync(movie).size};
 fs.writeFileSync(path.join(output,'viewer-check.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
