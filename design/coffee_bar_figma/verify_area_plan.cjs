const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert/strict');
const {chromium}=require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'layout-data.json'),'utf8'));
  new vm.Script(fs.readFileSync(path.join(__dirname,'native-figma-importer/code.js'),'utf8'));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:data.width,height:data.height},deviceScaleFactor:1});
    await page.goto('file:///'+path.join(__dirname,'coffee-bar-figma.svg').replaceAll('\\','/'));
    const report=await page.evaluate(()=>{
      const svg=document.querySelector('svg');
      const robots=[...svg.querySelectorAll('g[data-role="robot_package"]')].map(g=>{
        const shapes=[...g.children].filter(n=>n.tagName!=='title');
        const rings=shapes.filter(n=>['reach_effective','reach_placement'].includes(n.getAttribute('data-role')) && n.tagName==='ellipse');
        const body=shapes.find(n=>n.getAttribute('data-role')==='robot_base');
        const cart=shapes.find(n=>n.getAttribute('data-role')==='nova5_cart');
        const b=body.getBBox();
        return {name:g.getAttribute('data-robot'),reference:g.getAttribute('data-reference')==='true',parent:g.parentElement.getAttribute('data-name'),rings:rings.map(n=>({kind:n.getAttribute('data-role'),diameterCm:Number(n.getAttribute('data-diameter-cm')),size:[n.getBBox().width,n.getBBox().height],stroke:n.getAttribute('stroke'),dash:n.getAttribute('stroke-dasharray')})),baseSize:[b.width,b.height],cart:cart?{width:cart.getBBox().width,height:cart.getBBox().height,topGap:b.y-cart.getBBox().y,rightGap:cart.getBBox().x+cart.getBBox().width-b.x-b.width}:null};
      });
      const labels=[...svg.querySelectorAll('g[aria-label]')];
      const overflow=labels.filter(n=>{const b=n.getBoundingClientRect();return b.left<-1||b.top<-1||b.right>2901||b.bottom>1741}).map(n=>n.getAttribute('aria-label'));
      return {topGroups:[...svg.querySelectorAll(':scope > g')].map(n=>n.getAttribute('data-name')),robots,images:svg.querySelectorAll('image,foreignObject,text').length,overflow};
    });
    assert.equal(report.robots.length,8);
    assert.equal(report.robots.filter(r=>r.reference).length,5);
    assert.equal(report.images,0);
    assert.deepEqual(report.overflow,[]);
    assert(report.topGroups.includes('Area / coffee station'));
    assert(!report.topGroups.includes('Motion ranges - dotted'));
    for(const r of report.robots){
      const inv=data.parameters.robot_inventory[r.name];
      assert.equal(r.rings.length,2);
      for(const ring of r.rings){
        const expected=ring.kind==='reach_effective'?inv.effective_diameter_cm:inv.placement_diameter_cm;
        assert(Math.abs(ring.diameterCm-expected)<1e-9);
        for(const size of ring.size) assert(Math.abs(size-expected*2)<1e-3);
      }
      assert.notEqual(r.rings[0].stroke,r.rings[1].stroke);
      assert.notEqual(r.rings[0].dash,r.rings[1].dash);
      if(r.name==='nova5') assert.deepEqual(r.cart,{width:120,height:160,topGap:8,rightGap:20});
      if(r.name==='atom_w') assert.deepEqual(r.baseSize,[140,102]);
    }
    assert(report.robots.find(r=>r.name==='nova2'&&!r.reference).parent.startsWith('Coffee equipment'));
    await page.locator('svg').screenshot({path:path.join(__dirname,'coffee-bar-preview.png')});
    await page.screenshot({path:path.join(__dirname,'coffee-bar-plan-preview.png'),clip:{x:0,y:0,width:1070,height:1740}});
    await page.goto('file:///'+path.join(__dirname,'robot-reference.svg').replaceAll('\\','/'));
    await page.locator('svg').screenshot({path:path.join(__dirname,'robot-reference-preview.png')});
    fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({passed:true,...report},null,2)+'\n');
    console.log(JSON.stringify({passed:true,area_groups:report.topGroups.length,robot_packages:report.robots.length,reference_robots:5,scale:'2px/cm',nova5_cart:'120 x 160px; top gap8px/right gap20px',overflow:report.overflow}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
