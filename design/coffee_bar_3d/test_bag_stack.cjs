const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1700, height: 1050}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
    await page.waitForFunction(() => window.coffeeEditor?.ready && coffeeEditor.flow.result, null, {timeout: 120000});
    const initial = await page.evaluate(async () => {
      const T = await import('./vendor/three.module.js');
      const {fixtureBag, fixedContact, stackSettings} = await import('./editor/bag-fixture-parameters.js');
      const {captureWorld} = await import('./editor/collision-scene.js');
      const {flow, store, three} = coffeeEditor;
      const fixture = store.object('bag_opener'), holder = store.object('bag_magazine');
      const fixed = three.instances.get(fixture.id), stack = three.instances.get(holder.id);
      let tool, cups = 0;
      fixed.mesh.traverse(node => {if (node.userData.role === 'fixed_suction_tool') tool = node; if (node.userData.vacuum_cup) cups++;});
      const toolBox = new T.Box3();
      const inverse = tool.matrixWorld.clone().invert();
      tool.traverse(node => {
        if (!node.geometry) return;
        const positions = node.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) toolBox.expandByPoint(new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse));
      });
      const names = []; stack.mesh.traverse(node => names.push(node.name));
      const world = captureWorld(three).filter(o => [fixture.id, holder.id].includes(o.objectId));
      return {cups, toolSize: toolBox.getSize(new T.Vector3()).toArray(), names,
        stack: stackSettings(holder), bag: fixtureBag(fixture), contact: fixedContact(fixture),
        request: flow.request, result: flow.result, worldParts: world.map(o => o.part)};
    });
    const reportPath = path.join(__dirname, 'output/bag-stack-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(initial, null, 2));
    console.log(JSON.stringify({pathOK: initial.result.pathOK, errors: initial.request.errors, failure: initial.result.failure,
      endpoints: initial.result.endpoints.map(o => ({id: o.id, ok: o.ok})), cups: initial.cups, toolSize: initial.toolSize}, null, 2));
    assert.equal(initial.cups, 4);
    [.08, .08, .10].forEach((n, i) => near(initial.toolSize[i], n));
    assert.ok(initial.names.includes('Stack holder front cheek'));
    assert.ok(!initial.names.some(n => /spring|follower|singulation/i.test(n)));
    assert.ok(initial.worldParts.includes('Fixed gripper backplate'));
    assert.ok(initial.worldParts.includes('Stack holder side'));
    assert.ok(!initial.worldParts.some(n => /Stored.flat.bag/.test(n)));
    assert.deepEqual(initial.request.errors, []);
    assert.equal(initial.result.pathOK, true);
    const pickup = initial.request.targets.find(t => t.id === 'magazine');
    near(pickup.position[2], .8 + initial.stack.top);
    const observed = await page.evaluate(async () => {
      const T = await import('./vendor/three.module.js');
      const {flow} = coffeeEditor, player = flow.player;
      const output = [];
      for (const phase of ['Grip top bag', 'Turn empty bag upright', 'Wait for bun loading', 'Release robot vacuum']) {
        const knot = flow.result.route.knots.find(k => k.phase === phase);
        player.seek(knot.time);
        const up = new T.Vector3(0, 1, 0).applyQuaternion(player.bag.quaternion);
        output.push({phase, up: up.toArray(), bottom: new T.Box3().setFromObject(player.bag).min.y});
      }
      player.stop(); return output;
    });
    near(observed[0].up[1], 0, .003);
    for (const item of observed.slice(1)) near(item.up[1], 1, .003);
    assert.ok(observed[1].bottom > .93);
    const integration = await page.evaluate(async () => {
      const {GLTFLoader} = await import('./vendor/GLTFLoader.js');
      const {migrateBagFixtures} = await import('./editor/bag-fixture-parameters.js');
      const {collisionRequest, captureWorld} = await import('./editor/collision-scene.js');
      const {WorldCollisionChecker} = await import('./editor/collision-core.js');
      const {store, three, flow} = coffeeEditor;
      const old = await fetch('./scene_config.json').then(r => r.json());
      const original = old.objects.find(o => o.id === 'bag_magazine');
      original.x = 1.234; original.visible = false;
      migrateBagFixtures(old); const once = JSON.stringify(old); migrateBagFixtures(old);
      const noDuplicates = once === JSON.stringify(old);
      const persisted = old.objects.find(o => o.id === 'bag_magazine');
      const bytes = await three.glb(), loaded = await new GLTFLoader().parseAsync(bytes, '');
      let fixedTool = 0, holderSides = 0;
      loaded.scene.traverse(n => {if (n.userData.role === 'fixed_suction_tool') fixedTool++; if (/^Stack_holder_side/.test(n.name)) holderSides++;});
      const r = flow.request;
      const data = collisionRequest(three, r.robot, undefined,
        captureWorld(three).filter(o => o.objectId === 'bag_magazine'),
        {kind:'bag',...r.bag,fixtureId:r.fixture.id,magazineId:r.settings.magazine_id,tableId:r.zone.support},
        {enabled:true,margin:0});
      const checker = new WorldCollisionChecker(data);
      const pickupEnd = flow.result.route.knots.find(k => k.phase === 'Turn empty bag upright').time;
      const pickupFrames = flow.result.frames.filter(f => f.time <= pickupEnd);
      let collision = null;
      for (const f of pickupFrames) {
        const hit = checker.pose(f.q, 0, f);
        if (hit) {collision = {phase:f.phase,robot:hit.robot.part,world:hit.world.part}; break;}
      }
      return {noDuplicates, preserved: persisted.x === 1.234 && persisted.visible === false,
        fixedTool, holderSides, glbBytes: bytes.byteLength, holderCollision: collision};
    });
    console.log(JSON.stringify(integration));
    assert.equal(integration.noDuplicates, true); assert.equal(integration.preserved, true);
    assert.equal(integration.fixedTool, 1); assert.equal(integration.holderSides, 2);
    assert.equal(integration.holderCollision, null);
    // The new pickup must still share the timeline with real bread loading.
    await page.evaluate(() => {
      const e=coffeeEditor; e.flow.suspended=true;
      e.store.transact('Check coordinated bread loading',()=>{
        for(const shelf of e.store.scene.objects.filter(o=>o.kind==='shelf')) shelf.shelf_overrides={...e.store.shelfSettings(shelf),bread_length_1:.06};
        e.store.scene.bag_workflow={...e.flow.settings(),bread_mode:'nova',bread_parallel:true};
      });
      e.flow.suspended=false; e.flow.check();
    });
    await page.waitForFunction(()=>!coffeeEditor.flow.worker,null,{timeout:60000});
    const combined=await page.evaluate(()=>({message:coffeeEditor.flow.message,ok:coffeeEditor.flow.result?.pathOK,coordination:coffeeEditor.flow.result?.coordination}));
    assert.ok(combined.ok,combined.message);
    assert.ok(combined.coordination.parallel);
    assert.ok(combined.coordination.insertionStartTime>=combined.coordination.bagReadyTime);
    assert.ok(combined.coordination.bagHoldEndTime>=combined.coordination.breadClearTime);
    console.log('PASS: parallel bread loading waits for the open bag and blocks bag departure until the bread arm clears.');
    await page.evaluate(() => {
      const {store, three, flow} = coffeeEditor;
      store.scene.bag_workflow.auto_check = false;
      store.select('bag_magazine');
      store.setOption('view', 'scene');
      for (const [id, r] of three.instances) r.node.visible = ['bag_magazine', 'bag_opener', 'middle_counter'].includes(id);
      three.guides.visible = false; three.outlines.visible = false; flow.guideGroup.visible = false;
      three.camera.position.set(.95, 1.6, -2.65); three.controls.target.set(1.86, .94, -3.18); three.controls.update();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path: path.join(__dirname, 'output/bag-stack-fixtures.png')});
    // A close-up with only the illustrative bag hidden exposes all four cups.
    await page.evaluate(() => {
      coffeeEditor.three.instances.get('bag_opener').mesh.traverse(node => {if(node.userData.role === 'moving_bag') node.visible=false;});
    });
    await page.locator('#scene').screenshot({path: path.join(__dirname, 'output/bag-stack-gripper.png')});
    await page.locator('[data-field="stack_bag_count"]').fill('10');
    await page.locator('[data-field="stack_bag_count"]').press('Tab');
    const changed = await page.evaluate(async () => {
      const {makeWorkflowRequest} = await import('./editor/flow-geometry.js');
      const {store} = coffeeEditor;
      return {count: store.object('bag_magazine').bag_stack.bag_count, pickup: makeWorkflowRequest(store).targets[0].position};
    });
    assert.equal(changed.count, 10);
    near(changed.pickup[2], pickup.position[2] - 10 * initial.stack.bag_thickness);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('coffee-layout-studio-v2')).objects.find(o => o.id === 'bag_magazine').bag_stack.bag_count === 10);
    await page.reload(); await page.waitForFunction(() => window.coffeeEditor?.ready);
    assert.equal(await page.evaluate(() => coffeeEditor.store.object('bag_magazine').bag_stack.bag_count), 10);
    assert.deepEqual(errors, []);
    console.log('PASS: top-pick IK, bag orientation, four-cup tool bounds, holder collision shapes, stack-height editing and reload persistence.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
