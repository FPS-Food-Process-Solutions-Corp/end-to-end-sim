const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const near = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const output = path.join(__dirname, 'output');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({viewport: {width: 1800, height: 1150}, acceptDownloads: true});
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto('http://127.0.0.1:8766/viewer.html', {waitUntil: 'networkidle'});
    await page.waitForFunction(() => coffeeEditor.ready && coffeeEditor.flow.result);
    await page.locator('[data-panel="flow"]').click();
    const passed = [];

    const initial = await page.evaluate(() => ({
      scene: coffeeEditor.getState(),
      request: coffeeEditor.flow.request,
      result: coffeeEditor.flow.result,
    }));
    assert.equal(initial.scene.objects.length, 24);
    assert.ok(!initial.scene.objects.some(object => object.id === 'nova5_cart' || object.id === 'me6_bag_robot'));
    for (const id of ['nova5', 'nova5_suction', 'bag_opener', 'bag_magazine']) {
      assert.equal(initial.scene.objects.find(object => object.id === id).support, 'middle_counter');
    }
    assert.ok(initial.result.pathOK);
    assert.equal(initial.result.endpoints.filter(target => target.ok).length, 4);
    assert.equal(initial.result.zoneSamples.filter(target => target.ok).length, 9);
    assert.ok(initial.result.frames.length > 250);
    assert.deepEqual(initial.request.errors, []);
    assert.ok(initial.request.warnings.some(message => message.includes('9.4')));
    passed.push('Both Nova-5s and both fixtures share one table; four contact poses, nine zone samples and the sampled path pass IK.');

    const geometry = await page.evaluate(async () => {
      const THREE = await import('./vendor/three.module.js');
      const {SuctionArm} = await import('./editor/ik-core.js');
      const {poseSuctionRobot, setupSuctionJoints} = await import('./editor/suction-render.js');
      const {flow, three} = coffeeEditor;
      const definition = await fetch('./robot-library/nova5_suction-kinematics.json').then(response => response.json());
      const arm = new SuctionArm(definition, flow.request.robot, flow.request.mountingHeight);
      const record = three.instances.get('nova5_suction');
      setupSuctionJoints(record);
      let tool;
      let cups = 0;
      const names = [];
      record.mesh.traverse(node => {
        if (node.userData.role === 'nova_suction_tool') tool = node;
        if (node.userData.vacuum_cup) cups++;
        names.push(node.name);
      });
      poseSuctionRobot(record, [0, 0, 0, 0, 0, 0]);
      const inverse = tool.parent.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      tool.traverse(node => {
        if (!node.isMesh) return;
        const points = node.geometry.attributes.position;
        for (let index = 0; index < points.count; index++) {
          box.expandByPoint(new THREE.Vector3().fromBufferAttribute(points, index)
            .applyMatrix4(node.matrixWorld).applyMatrix4(inverse));
        }
      });
      const comparisons = [];
      for (const angles of [[0,0,0,0,0,0], [.3,-.7,1.1,.8,-1.2,.4]]) {
        poseSuctionRobot(record, angles);
        const expected = arm.forward(angles).position;
        const actual = record.tcp.getWorldPosition(new THREE.Vector3());
        comparisons.push(actual.distanceTo(new THREE.Vector3(expected.x, expected.z, -expected.y)));
      }
      const framesWithinLimits = flow.result.frames.every(frame => frame.q.every((angle, index) =>
        angle >= definition.joints[index].lower && angle <= definition.joints[index].upper));
      const previewErrors = [];
      for (const index of [0, 40, 145, 240, flow.result.frames.length - 1]) {
        const frame = flow.result.frames[index];
        flow.player.seek(frame.time);
        const actual = record.tcp.getWorldPosition(new THREE.Vector3());
        previewErrors.push(actual.distanceTo(new THREE.Vector3(frame.target.position[0], frame.target.position[2], -frame.target.position[1])));
      }
      flow.player.seek(flow.player.request.knots.find(knot => knot.phase === 'Release robot vacuum').time);
      const placedBottom = flow.player.bag.position.y;
      flow.player.stop();
      return {
        cups, toolSize: box.getSize(new THREE.Vector3()).toArray(),
        tongMeshes: names.filter(name => /gripper|tong/i.test(name)),
        comparisons, framesWithinLimits, previewErrors, placedBottom,
      };
    });
    assert.equal(geometry.cups, 4);
    near(geometry.toolSize[0], .08, .0001);
    near(geometry.toolSize[1], .10, .0001); // Converted tool axis is Three +Y.
    near(geometry.toolSize[2], .08, .0001);
    assert.equal(geometry.tongMeshes.length, 0);
    assert.ok(geometry.comparisons.every(error => error < .000002));
    assert.ok(geometry.framesWithinLimits);
    assert.ok(geometry.previewErrors.every(error => error < .0011));
    near(geometry.placedBottom, .902, .0011);
    passed.push('The 80 × 80 × 100 mm tool has exactly four cups and no tongs; visible joint motion matches URDF FK and respects all joint limits.');

    // Edits must clear stale results immediately and then check the actual new pose.
    await page.evaluate(() => {
      coffeeEditor.store.transact('Move arm out of reach', () =>
        coffeeEditor.store.move(['nova5_suction'], -2.5, 0));
    });
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result), null);
    await page.waitForFunction(() => coffeeEditor.flow.result !== null);
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result.pathOK), false);
    assert.ok(await page.locator('#flow-play').isDisabled());
    await page.evaluate(() => coffeeEditor.store.undo());
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);

    const before = await page.evaluate(() => {
      const store = coffeeEditor.store;
      return ['nova5', 'nova5_suction', 'bag_magazine', 'bag_opener'].map(id => ({...store.object(id)}));
    });
    const after = await page.evaluate(() => {
      const {store, three} = coffeeEditor;
      store.transact('Move shared table', () => store.move(['middle_counter'], .1, .2));
      return ['nova5', 'nova5_suction', 'bag_magazine', 'bag_opener'].map(id => ({
        object: store.object(id), model: three.inspect(id),
      }));
    });
    before.forEach((object, index) => {
      near(after[index].object.x, object.x + .1);
      near(after[index].object.y, object.y + .2);
      near(after[index].model.position[0], object.x + .1);
    });
    await page.evaluate(() => coffeeEditor.store.undo());
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    passed.push('Moving an arm rejects stale IK and reports failure; moving the shared table carries both robots and fixtures in both views.');

    await page.locator('[data-flow-action="zone"]').click();
    const oldZone = initial.scene.objects.find(object => object.id === 'placement_zone');
    const localX = page.locator('[data-field="support_x"]');
    await localX.fill('40');
    await localX.press('Tab');
    const changedZone = await page.evaluate(() => coffeeEditor.store.object('placement_zone'));
    near(changedZone.x, 1.1);
    await page.waitForFunction(() => coffeeEditor.flow.result !== null);
    assert.ok(await page.evaluate(() => coffeeEditor.flow.request.errors.some(message => message.includes('overlaps'))));
    await page.evaluate(() => coffeeEditor.store.undo());
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK && !coffeeEditor.flow.request.errors.length);

    // Draw a real placement rectangle with the SVG pointer interaction.
    await page.locator('[data-flow-action="draw"]').click();
    const points = await page.locator('#plan').evaluate(svg => {
      const transform = svg.getScreenCTM();
      const a = new DOMPoint(1.23 * 200, (5.75 - 2.08) * 200).matrixTransform(transform);
      const b = new DOMPoint(1.39 * 200, (5.75 - 1.84) * 200).matrixTransform(transform);
      return {a: {x: a.x, y: a.y}, b: {x: b.x, y: b.y}};
    });
    await page.mouse.move(points.a.x, points.a.y);
    await page.mouse.down();
    await page.mouse.move(points.b.x, points.b.y, {steps: 5});
    await page.mouse.up();
    const drawn = await page.evaluate(() => {
      const id = coffeeEditor.store.scene.bag_workflow.placement_zone_id;
      return {zone: coffeeEditor.store.object(id), model: coffeeEditor.three.inspect(id)};
    });
    near(drawn.zone.width, .16, .004);
    near(drawn.zone.depth, .24, .004);
    assert.equal(drawn.zone.support, 'coffee_station');
    assert.ok(drawn.model.visible);
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    passed.push('Support-relative numeric edits work; occupied zones are flagged and a drawn rectangle becomes a synchronized, IK-tested 3D placement zone.');

    await page.evaluate(() => {
      coffeeEditor.store.transact('Adjust bread placeholder to fit', () => {
        const shelf = coffeeEditor.store.object('shelf_2');
        shelf.shelf_overrides = {...shelf.shelf_overrides, bread_length_2: .08};
      });
    });
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK && coffeeEditor.flow.request.breadFits);
    await page.locator('[data-flow-action="play"]').click();
    await page.evaluate(() => {
      coffeeEditor.flow.player.playing = false;
      const player = coffeeEditor.flow.player;
      player.seek(player.request.knots.find(knot => knot.phase === 'Wait for bun loading').time + .3);
    });
    const loading = await page.evaluate(() => {
      const {player} = coffeeEditor.flow;
      return {bread: player.bread.visible, robot: document.querySelector('#flow-robot-vac').classList.contains('on'),
        fixed: document.querySelector('#flow-fixed-vac').classList.contains('on')};
    });
    assert.deepEqual(loading, {bread: true, robot: true, fixed: true});
    await page.evaluate(() => {
      const player = coffeeEditor.flow.player;
      player.seek(player.request.knots.find(knot => knot.phase === 'Release fixed suction').time + .3);
    });
    assert.equal(await page.locator('#flow-fixed-vac').evaluate(element => element.classList.contains('on')), false);
    passed.push('The bread fit warning responds to shelf dimensions; loading preview and opposing-vacuum release follow the sequence.');

    // Paste the entire shared assembly, including its supports and target references.
    await page.evaluate(() => {
      coffeeEditor.flow.player.stop();
      coffeeEditor.store.select('area_middle');
      coffeeEditor.store.duplicate();
    });
    const copied = await page.evaluate(() => {
      const store = coffeeEditor.store;
      const parts = store.resolve();
      const robot = parts.find(object => object.model_key === 'nova5_suction');
      return {parts: parts.length, robot, mesh: coffeeEditor.three.inspect(robot.id)};
    });
    assert.equal(copied.parts, 5);
    assert.notEqual(copied.robot.support, 'middle_counter');
    assert.ok(copied.mesh.visible);
    const svg = await page.evaluate(() => coffeeEditor.plan.exportSVG(false));
    assert.ok(svg.includes(copied.robot.id) && svg.includes(drawn.zone.id));
    const glbInfo = await page.evaluate(async () => {
      const buffer = await coffeeEditor.three.glb();
      const length = new DataView(buffer).getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
      return {ids: json.nodes.flatMap(node => node.extras?.editorId || []), bytes: buffer.byteLength};
    });
    assert.ok(glbInfo.ids.includes(copied.robot.id) && glbInfo.ids.includes(drawn.zone.id));
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('Saved locally'));
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForFunction(() => coffeeEditor.ready && coffeeEditor.flow.result);
    assert.equal(await page.evaluate(id => coffeeEditor.store.scene.bag_workflow.placement_zone_id === id, drawn.zone.id), true);
    assert.ok(await page.evaluate(id => coffeeEditor.three.instances.has(id), copied.robot.id));
    passed.push('Copied suction stations and zones survive SVG/GLB export and reload with workflow settings intact.');

    const oldScene = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/revision-5-me6.json'), 'utf8'));
    const migration = await page.evaluate(async saved => {
      const {SceneStore} = await import('./editor/store.js');
      const {captureComponents, insertComponents} = await import('./editor/component-copy.js');
      const store = new SceneStore(saved);
      store.select('me6_bag_robot');
      insertComponents(store, captureComponents(store));
      const legacy = store.selected[0];
      const data = store.exportScene();
      data.objects.find(object => object.id === 'coffee_machine').x += .123;
      const upgraded = new SceneStore(coffeeEditor.store.seed);
      upgraded.importScene(data);
      coffeeEditor.store.importScene(data);
      return {
        revision: upgraded.scene.editor_revision,
        legacy, legacyMesh: coffeeEditor.three.instances.has(legacy),
        coffee: upgraded.object('coffee_machine').x,
        supports: ['nova5','nova5_suction','bag_magazine','bag_opener'].map(id => upgraded.object(id).support),
      };
    }, oldScene);
    assert.equal(migration.revision, 6);
    assert.ok(migration.legacyMesh);
    near(migration.coffee, oldScene.objects.find(object => object.id === 'coffee_machine').x + .123);
    assert.deepEqual(migration.supports, Array(4).fill('middle_counter'));
    passed.push('Revision-5 saves migrate to the shared table without losing coffee edits or previously copied ME6 models.');

    await page.evaluate(() => coffeeEditor.store.reset());
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    await page.locator('[data-panel="flow"]').click();
    await page.locator('[data-flow-action="frame"]').click();
    await page.evaluate(() => {
      const player = coffeeEditor.flow.player;
      player.seek(player.request.knots.find(knot => knot.phase === 'Pull the bag open').time);
    });
    await page.screenshot({path: path.join(output, 'suction-workflow.png')});
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'suction-workflow-test-report.json'), JSON.stringify({passed, geometry, errors}, null, 2));
    console.log(JSON.stringify({passed, errors}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
