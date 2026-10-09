const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const output = path.resolve(__dirname, '../output');

(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1100}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8766/object-lab/');
    await page.waitForFunction(() => window.objectSizeLab?.ready);
    const core = await page.evaluate(async () => {
      const {physicsEngine, PastryDropWorld, ReleaseBlockedError} = await import('./drop-physics.js');
      const {defaults, validateScene} = await import('./catalog.js');
      const {registerPastryType} = await import('./pastries.js');
      const {queueEntry} = await import('./drop-queue.js');
      const T = await import('three');
      const R = await physicsEngine(), state = defaults(), bag = state.objects.find(o => o.id === 'bag-12');
      const mini = state.objects.find(o => o.id === 'mini-donut'), large = state.objects.find(o => o.id === 'donut');
      const settings = {...state.drop, tilt: 0, bounce: .02};
      const world = new PastryDropWorld(R, bag, settings), settle = () => {while (!world.done) world.step();};
      const first = world.addPastry(mini, settings, 'first');
      let blocked = false;
      try {world.addPastry(mini, settings, 'overlap');} catch (error) {blocked = error instanceof ReleaseBlockedError;}
      settle(); const firstBefore = world.reportItem(first), handle = first.body.handle;
      world.addPastry(mini, settings, 'second'); settle();
      const stacked = world.report();
      world.addPastry(large, {...settings, x: 1, tilt: 12}, 'third');
      let woke = false;
      while (!world.done) {world.step(); woke ||= !first.body.isSleeping();}
      const mixed = world.report(), keptFirst = first.body.handle === handle && first.body.isDynamic();
      world.free();

      // An independently registered test pastry proves that the shared world,
      // queue validation and rendering use the type contract, not donut logic.
      registerPastryType('test-bun', {
        fields: [{key: 'width', label: 'Length'}, {key: 'depth', label: 'Depth'}, {key: 'height', label: 'Height'}],
        dimensions: p => ({width: p.width, depth: p.depth, height: p.height}),
        makeVisual: p => new T.Mesh(new T.BoxGeometry(p.width, p.height, p.depth), new T.MeshStandardMaterial()),
        massKg: () => .04,
        collisionGeometry: p => {
          const samples = [];
          for (const x of [-p.width / 200, p.width / 200]) for (const y of [-p.height / 200, p.height / 200]) for (const z of [-p.depth / 200, p.depth / 200]) samples.push(new T.Vector3(x, y, z));
          return {parts: [new Float32Array(samples.flatMap(p => p.toArray()))], samples};
        },
      });
      const bun = {name: 'Future test bun', kind: 'test-bun', width: 6, depth: 4, height: 2};
      state.dropQueue = [queueEntry(bun, settings)]; state.mode = 'drop'; state.bag = bag.id;
      objectSizeLab.importScene(validateScene(state));
      await objectSizeLab.drop.play();
      for (let i = 0; i < 300 && objectSizeLab.drop.playing; i++) objectSizeLab.drop.tick(.1);
      const future = objectSizeLab.drop.report();
      const futureVisible = objectSizeLab.view.records.get('drop:' + future.items[0].id)?.children[0].geometry.type;
      const legacy = defaults(); delete legacy.dropQueue; legacy.donut = mini.id; legacy.drop.x = 2;
      const migration = validateScene(legacy).dropQueue;
      const invalid = defaults(); invalid.dropQueue = [queueEntry(mini, settings, 21)];
      let rejected = false; try {validateScene(invalid);} catch {rejected = true;}
      return {blocked, firstBefore, stacked, mixed, woke, keptFirst, future, futureVisible, migration, rejected};
    });
    fs.writeFileSync(path.join(output, 'object-lab-multi-core.json'), JSON.stringify(core, null, 2));
    assert.ok(core.blocked, 'Overlapping release must not spawn a body');
    assert.equal(core.stacked.items.length, 2);
    assert.ok(core.stacked.items[1].bottomCm > 2, 'Second donut should land on the first, not pass through it');
    assert.ok(core.stacked.items[1].contacts.some(name => name.includes('#1')));
    assert.ok(core.woke && core.keptFirst, 'Earlier pastries must remain dynamic and wake on impact');
    assert.equal(core.mixed.items.length, 3);
    assert.ok(!core.mixed.timedOut);
    assert.ok(core.mixed.items.every(item => item.boundsCm.min[1] > -.1));
    assert.equal(core.future.items[0].outcome, 'Settled inside bag');
    assert.equal(core.futureVisible, 'BoxGeometry');
    assert.equal(core.migration[0].pastry.diameter, 7); assert.equal(core.migration[0].release.x, 2); assert.ok(core.rejected);

    await page.locator('#reset').click(); await page.locator('[data-mode="drop"]').click();
    await page.locator('#fit-bag').selectOption('bag-12'); await page.locator('#fit-donut').selectOption('mini-donut');
    await page.getByRole('spinbutton', {name: 'Release tilt', exact: true}).fill('0');
    await page.getByRole('spinbutton', {name: 'Release tilt', exact: true}).press('Tab');
    await page.locator('#drop-quantity').fill('2'); await page.locator('#queue-add').click();
    await page.locator('#fit-donut').selectOption('donut'); await page.locator('#drop-quantity').fill('1'); await page.locator('#queue-add').click();
    await page.locator('.queue-entry summary').nth(1).click();
    await page.getByRole('spinbutton', {name: 'Queued Outer diameter 2', exact: true}).fill('9');
    await page.getByRole('spinbutton', {name: 'Queued Outer diameter 2', exact: true}).press('Tab');
    assert.equal(await page.evaluate(() => objectSizeLab.getState().objects.find(o => o.id === 'donut').diameter), 10, 'Queue sizes must be independent of the catalogue');
    const runToPause = () => page.evaluate(() => {
      for (let i = 0; i < 2500 && objectSizeLab.drop.playing; i++) objectSizeLab.drop.tick(.1);
      return objectSizeLab.drop.report();
    });
    await page.locator('#drop-next').click(); await page.waitForFunction(() => objectSizeLab.drop.playing);
    const firstDrop = await runToPause(); assert.equal(firstDrop.released, 1); assert.equal(firstDrop.done, false);
    await page.evaluate(() => {window.firstWorld = objectSizeLab.drop.world;});
    await page.locator('#fit-donut').selectOption('mini-donut'); await page.locator('#queue-add').click();
    assert.equal(await page.evaluate(() => objectSizeLab.drop.world === window.firstWorld), true, 'Appending preserves the existing world');
    assert.deepEqual(await page.evaluate(() => objectSizeLab.drop.report().items[0].centerCm), firstDrop.items[0].centerCm);
    await page.locator('.queue-entry summary').nth(1).click();
    await page.screenshot({path: path.join(output, 'object-lab-multi-ready.png')});
    await page.locator('#drop-play').click(); await page.waitForFunction(() => objectSizeLab.drop.playing);
    const full = await runToPause(); assert.equal(full.released, 4); assert.equal(full.done, true); assert.equal(full.timedOut, false);
    assert.equal(await page.evaluate(() => [...objectSizeLab.view.records.keys()].filter(id => id.startsWith('drop:') && id !== 'drop:preview').length), 4);
    await page.locator('#drop-results summary').click();
    await page.locator('#fit-view').click();
    await page.screenshot({path: path.join(output, 'object-lab-multi-settled.png')});
    const exported = await page.evaluate(async () => {
      const {GLTFLoader} = await import('../vendor/GLTFLoader.js');
      const gltf = await new GLTFLoader().parseAsync(await objectSizeLab.view.exportGLB(), '');
      const ids = []; gltf.scene.traverse(node => {if (node.userData.instanceId) ids.push(node.userData.instanceId);});
      return ids;
    });
    assert.equal(exported.length, 4); assert.ok(!exported.includes('drop:preview'));

    const saved = await page.evaluate(() => objectSizeLab.getState());
    await page.reload(); await page.waitForFunction(() => objectSizeLab?.ready);
    assert.deepEqual(await page.evaluate(() => objectSizeLab.getState()), saved);
    assert.equal(await page.evaluate(() => objectSizeLab.drop.world), null);
    await page.locator('[data-drop="cadence"]').selectOption('timed');
    await page.getByRole('spinbutton', {name: 'Release interval', exact: true}).fill('.2');
    await page.getByRole('spinbutton', {name: 'Release interval', exact: true}).press('Tab');
    await page.locator('#drop-play').click(); await page.waitForFunction(() => objectSizeLab.drop.playing);
    await page.evaluate(() => {
      const end = objectSizeLab.drop.clock + .4;
      for (let i = 0; i < 200 && objectSizeLab.drop.clock < end; i++) objectSizeLab.drop.tick(1 / 60);
    });
    const inFlight = await page.evaluate(() => objectSizeLab.drop.report());
    assert.ok(inFlight.released >= 2, 'Timed release should allow overlapping flight times');
    await page.locator('#drop-play').click();
    const paused = await page.evaluate(() => objectSizeLab.drop.report().time);
    await page.locator('#units').selectOption('mm');
    assert.equal(await page.evaluate(() => objectSizeLab.drop.report().time), paused);
    await page.locator('#drop-play').click(); const timed = await runToPause();
    assert.equal(timed.released, 4); assert.ok(timed.done);
    await page.locator('#drop-reset').click();
    assert.equal(await page.evaluate(() => objectSizeLab.drop.report()), null);
    assert.equal(await page.evaluate(() => objectSizeLab.getState().dropQueue.length), 3);
    const blockedRecovery = await page.evaluate(async () => {
      const app = objectSizeLab, original = app.getState(), state = app.getState();
      state.objects.find(object => object.id === state.bag).height = 1;
      const first = structuredClone(state.dropQueue[0]); first.quantity = 1; first.release.height = .1;
      state.dropQueue = [first, {...structuredClone(first), id: 'blocked-second'}]; state.drop.cadence = 'settled';
      app.importScene(state); await app.drop.play();
      for (let i = 0; i < 500 && app.drop.playing; i++) app.drop.tick(.1);
      const world = app.drop.world, blocked = app.drop.blocked, released = app.drop.released;
      const corrected = app.getState(); corrected.dropQueue[1].release.height = 12;
      app.importScene(corrected); const preserved = app.drop.world === world;
      await app.drop.play(); for (let i = 0; i < 500 && app.drop.playing; i++) app.drop.tick(.1);
      const recovered = app.drop.report(); app.importScene(original);
      return {blocked, released, preserved, recovered};
    });
    assert.ok(blockedRecovery.blocked); assert.equal(blockedRecovery.released, 1);
    assert.ok(blockedRecovery.preserved); assert.equal(blockedRecovery.recovered.released, 2); assert.ok(blockedRecovery.recovered.done);
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({path: path.join(output, 'object-lab-multi-mobile.png'), fullPage: true});
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'object-lab-multi-test.json'), JSON.stringify({core, full, timed, blockedRecovery, exported, errors}, null, 2));
    console.log('Multi-pastry collision, queue, extensibility, persistence, export and responsive UI checks passed.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
