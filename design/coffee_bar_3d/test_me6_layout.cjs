const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'output');
const oldLayout = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tmp/pre-me6-replacement-scene.json'), 'utf8'));
const near = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({viewport: {width: 1800, height: 1150}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto('http://127.0.0.1:8766/viewer.html', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.coffeeEditor?.ready);

  const model = await page.evaluate(async () => {
    const {Vector3} = await import('./vendor/three.module.js');
    const {store, three} = coffeeEditor;
    const robot = three.instances.get('me6_bag_robot');
    const fixture = three.instances.get('bag_opener');
    const magazine = three.instances.get('bag_magazine');
    const find = (record, predicate) => {
      const result = [];
      record.node.traverse(node => {if (predicate(node)) result.push(node);});
      return result;
    };
    const world = node => node.getWorldPosition(new Vector3()).toArray();
    return {
      count: store.scene.objects.length,
      robotCups: find(robot, node => node.userData.vacuum_cup).length,
      fixedCups: find(fixture, node => node.userData.vacuum_cup).length,
      flatBags: find(magazine, node => node.name.startsWith('Stored_flat_bag')).length,
      robotTemplate: robot.template.spec.layout_component,
      tcp: world(find(robot, node => node.userData.role === 'tcp')[0]),
      bag: world(find(fixture, node => node.userData.role === 'moving_bag')[0]),
      counter: store.object('middle_counter'),
      objects: store.scene.objects,
    };
  });
  assert.equal(model.count, 24);
  assert.equal(model.robotCups, 4);
  assert.equal(model.fixedCups, 4);
  assert.equal(model.flatBags, 14);
  assert.equal(model.robotTemplate, 'me6_robot');
  near(model.counter.x + model.counter.width / 2, 2.55);
  near(model.tcp[0], model.bag[0], .001);
  near(model.tcp[2], model.bag[2], .001);
  near(model.tcp[1] - model.bag[1], .206, .001);

  const migration = await page.evaluate(async oldLayout => {
    const {SceneStore} = await import('./editor/store.js');
    const seed = coffeeEditor.store.seed;
    const store = new SceneStore(seed);
    const object = id => oldLayout.objects.find(item => item.id === id);
    object('coffee_machine').x += .123;
    object('middle_counter').yaw_deg = 90;
    object('middle_counter').height = 1.02;
    object('bag_opener').x = object('middle_counter').x + .08;
    object('bag_opener').y = object('middle_counter').y;
    object('bag_opener').yaw_deg = 0;
    object('bag_opener').visible = false;
    store.importScene(oldLayout);
    const initial = structuredClone(store.scene);
    const visibility = ['bag_opener', 'bag_magazine', 'me6_bag_robot'].map(id => store.visible(id));
    const heights = ['bag_opener', 'me6_bag_robot'].map(id => store.z(store.object(id)));
    const roundtrip = store.exportScene();
    roundtrip.objects = roundtrip.objects.filter(item => item.id !== 'bag_magazine');
    store.importScene(roundtrip);
    const deletedStaysDeleted = !store.object('bag_magazine');
    const removedOld = structuredClone(oldLayout);
    removedOld.objects = removedOld.objects.filter(item => item.id !== 'bag_opener');
    store.importScene(removedOld);
    return {initial, visibility, heights, deletedStaysDeleted, oldDeletionPreserved: !store.object('me6_bag_robot')};
  }, oldLayout);
  const migrated = id => migration.initial.objects.find(item => item.id === id);
  const oldCoffee = oldLayout.objects.find(item => item.id === 'coffee_machine');
  near(migrated('coffee_machine').x, oldCoffee.x + .123);
  near(migrated('middle_counter').y, 3.45);
  near(migrated('middle_counter').x, 2.375);
  near(migrated('bag_opener').x, 2.375 + .08 + .2);
  near(migrated('bag_opener').y, 3.45 + .035);
  near(migration.heights[0], 1.02);
  near(migration.heights[1], 1.028);
  assert.deepEqual(migration.visibility, [false, false, false]);
  assert.ok(migration.deletedStaysDeleted && migration.oldDeletionPreserved);

  const interactions = await page.evaluate(async () => {
    const {store, three, plan} = coffeeEditor;
    const ids = ['middle_counter', 'me6_bag_robot', 'bag_magazine', 'bag_opener'];
    const before = ids.map(id => ({...store.object(id)}));
    store.transact('Move bag counter', () => store.move(['middle_counter'], .1, -.2));
    const moved = ids.map(id => three.inspect(id));
    store.undo();
    store.toggleVisibility('middle_counter');
    const hidden = ids.map(id => three.instances.get(id).node.visible);
    store.undo();
    store.select('me6_bag_robot');
    const reaches = three.guides.children.filter(node => node.userData.reachOwner === 'me6_bag_robot').length;
    const distances = store.distances().map(distance => distance.target);
    const svg = await plan.exportSVG(true);
    store.select('bag_opener');
    const inspector = document.querySelector('#inspector')?.textContent || document.body.textContent;
    return {before, moved, hidden, reaches, distances, svg, inspector};
  });
  interactions.before.forEach((object, index) => {
    near(interactions.moved[index].position[0], object.x + .1);
    near(interactions.moved[index].position[2], -object.y + .2);
  });
  assert.deepEqual(interactions.hidden, [false, false, false, false]);
  assert.equal(interactions.reaches, 2);
  assert.deepEqual(interactions.distances, ['bag_magazine', 'bag_opener']);
  assert.ok(interactions.svg.includes('me6_bag_robot') && interactions.svg.includes('bag_magazine'));
  assert.ok(interactions.inspector.includes('four fixed rear cups'));
  fs.writeFileSync(path.join(output, 'me6-layout.svg'), interactions.svg);

  await page.evaluate(() => {
    const {store, three} = coffeeEditor;
    store.select(null);
    store.setOption('view', '3d');
    three.controls.target.set(2.15, .95, -3.65);
    three.camera.position.set(-.6, 2.9, -2.2);
    three.camera.lookAt(three.controls.target);
    three.controls.update();
  });
  await page.waitForTimeout(500);
  await page.locator('#scene').screenshot({path: path.join(output, 'me6-layout-station.png')});

  assert.deepEqual(errors, []);
  const report = {
    passed: [
      'Final posed ME6, four robot cups, four fixed cups and fourteen stored bags load.',
      'Robot contact point aligns with open bag face; counter keeps rear edge at 2.55 m.',
      'Old saves migrate at their edited pose and height, preserving coffee edits and hidden/deleted state.',
      'Counter movement and visibility propagate to all station components in 3D.',
      'ME6 retains reach spheres, distance targets and separate SVG layers.',
    ],
    model, errors,
  };
  fs.writeFileSync(path.join(output, 'me6-layout-test-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({passed: report.passed, errors}, null, 2));
  await browser.close();
})().catch(error => {console.error(error); process.exit(1);});
