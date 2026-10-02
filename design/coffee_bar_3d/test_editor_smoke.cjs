const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1660,height:1080},deviceScaleFactor:1});const errors=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:8766/viewer.html',{waitUntil:'networkidle'});
  try{await page.waitForFunction(()=>window.coffeeEditor?.ready,{timeout:60000});}catch(e){console.log('LOAD TIMEOUT',await page.locator('#model-status').textContent(),errors);throw e;}
  const state=await page.evaluate(()=>({objects:coffeeEditor.store.scene.objects.length,models:coffeeEditor.three.instances.size,templates:[...coffeeEditor.three.templates.keys()],selected:coffeeEditor.store.selected,rings:document.querySelectorAll('[data-reach-owner] circle').length,ice:coffeeEditor.three.inspect('ice_machine'),cart:coffeeEditor.store.object('nova5_cart')}));
  await page.screenshot({path:path.join(__dirname,'output','editor-overview.png')});console.log(JSON.stringify({state,errors},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
