const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({viewport: {width: 1660, height: 1080}});
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto('http://127.0.0.1:8766/viewer.html', {waitUntil: 'networkidle'});
    await page.waitForFunction(() => window.coffeeEditor?.ready);

    const select = id => page.locator(`[data-layer="${id}"] .layer-label`).click();
    const state = () => page.evaluate(() => ({
      scene: coffeeEditor.getState(),
      selected: coffeeEditor.store.selected,
      instances: [...coffeeEditor.three.instances.keys()],
    }));
    const passed = [];
    await select('nova5_suction');
    const original = (await state()).scene.objects.find(object => object.id === 'nova5_suction');
    await page.keyboard.press('Control+c');
    // The clipboard must preserve the copied pose even if the original is edited.
    await page.evaluate(() => coffeeEditor.store.transact('Move original', () =>
      coffeeEditor.store.move(['nova5_suction'], .25, .1)));
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => coffeeEditor.store.scene.objects.length === 30);
    let current = await state();
    const firstId = current.selected[0];
    const first = current.scene.objects.find(object => object.id === firstId);
    near(first.x, original.x + .15);
    near(first.y, original.y - .15);
    assert.equal(first.support, 'middle_counter');
    assert.equal(first.model_key, 'nova5_suction');
    const cups = await page.evaluate(id => {
      let count = 0;
      coffeeEditor.three.instances.get(id).node.traverse(node => {
        if (node.userData.vacuum_cup) count++;
      });
      return count;
    }, firstId);
    assert.equal(cups, 4);
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => coffeeEditor.store.scene.objects.length === 31);
    current = await state();
    const second = current.scene.objects.find(object => object.id === current.selected[0]);
    near(second.x, original.x + .3);
    assert.notEqual(firstId, second.id);
    await page.keyboard.press('Control+z');
    assert.equal((await state()).scene.objects.length, 30);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await state()).scene.objects.length, 31);
    passed.push('Native Ctrl+C/V copies a frozen component snapshot with its custom Nova-5 suction model; repeat paste, undo and redo work.');

    await page.evaluate(() => coffeeEditor.store.reset());
    await select('area_middle');
    await page.locator('#copy').click();
    await page.locator('#paste').click();
    current = await state();
    const groupId = current.selected[0];
    const station = current.scene.objects.filter(object => object.parentId === groupId);
    assert.equal(station.length, 5);
    assert.equal(current.scene.objects.length, 34);
    const counter = station.find(object => object.kind === 'table');
    const robot = station.find(object => object.model_key === 'nova5_suction');
    const bag = station.find(object => object.layout_component === 'fixed_suction');
    const magazine = station.find(object => object.layout_component === 'magazine');
    for (const object of [robot, bag, magazine]) assert.equal(object.support, counter.id);
    assert.deepEqual(robot.distanceTargets, [magazine.id, bag.id, 'placement_zone']);
    const moved = await page.evaluate(({counterId, robotId}) => {
      const {store, three} = coffeeEditor;
      store.transact('Move pasted counter', () => store.move([counterId], .4, -.2));
      return {robot: store.object(robotId), model: three.inspect(robotId)};
    }, {counterId: counter.id, robotId: robot.id});
    near(moved.robot.x, robot.x + .4);
    near(moved.model.position[0], moved.robot.x);
    near(moved.model.position[2], -moved.robot.y);
    assert.ok(current.instances.includes(robot.id));
    assert.ok(await page.locator(`[data-object-id="${robot.id}"]`).count());

    // A copied assembly remains usable after the originals have been deleted.
    await select('area_middle');
    await page.locator('#delete').click();
    await page.locator('#paste').click();
    current = await state();
    const newGroup = current.selected[0];
    const replacement = current.scene.objects.filter(object => object.parentId === newGroup);
    assert.equal(replacement.length, 5);
    assert.ok(!current.scene.objects.some(object => object.id === 'nova5_suction'));
    assert.equal(new Set(current.scene.objects.map(object => object.id)).size, current.scene.objects.length);
    passed.push('Toolbar copy/paste preserves a complete area, remaps supports and distance targets, and survives deleting the originals.');

    const pure = await page.evaluate(async () => {
      const {SceneStore} = await import('./editor/store.js');
      const {captureComponents, insertComponents} = await import('./editor/component-copy.js');
      const store = new SceneStore(coffeeEditor.store.seed);
      store.select('area_coffee');
      const packet = captureComponents(store);
      insertComponents(store, packet);
      const groupId = store.selected[0];
      const subgroups = store.scene.groups.filter(group => group.parentId === groupId);
      const copiedObjects = store.resolve([groupId]);
      const coffee = copiedObjects.find(object => object.asset_key === 'coffee_machine');
      const nested = subgroups.length === 1 && coffee.parentId === subgroups[0].id;
      const robot = copiedObjects.find(object => object.model_key === 'nova2');
      const targetsAreCopies = robot.distanceTargets.every(id => copiedObjects.some(object => object.id === id));
      const newBunRobot = store.addRobot('nova5', 1.8, 2.8);
      store.select(store.object(newBunRobot).support);
      const cartPacket = captureComponents(store);
      insertComponents(store, cartPacket);
      const cart = store.object(store.selected[0]);
      const carried = store.scene.objects.filter(object => object.support === cart.id);
      store.select('nova5_suction');
      const detached = captureComponents(store);
      const elevation = store.z(store.object('nova5_suction'));
      store.select('middle_counter');
      store.removeSelected();
      insertComponents(store, detached);
      const pasted = store.object(store.selected[0]);
      const detachedHeight = store.z(pasted);
      const beforeInvalid = JSON.stringify(store.scene);
      const invalid = structuredClone(packet);
      invalid.objects[0].support = invalid.objects[0].id;
      let rejected = false;
      try {insertComponents(store, invalid);} catch {rejected = true;}
      const rejectedWithoutChanges = rejected && beforeInvalid === JSON.stringify(store.scene);
      store.select('shelf_1');
      store.object('shelf_1').shelf_overrides = {columns: 8, bread_length_1: .072};
      const shelfPacket = captureComponents(store);
      insertComponents(store, shelfPacket);
      const shelf = store.object(store.selected[0]);
      return {
        nested, targetsAreCopies, carried: carried.length,
        cartSupport: carried[0]?.support, cartId: cart.id,
        elevation, detachedHeight, detachedSupport: pasted.support,
        rejectedWithoutChanges,
        rejected, shelfSettings: shelf.shelf_overrides,
      };
    });
    assert.ok(pure.nested && pure.targetsAreCopies);
    assert.equal(pure.carried, 1);
    assert.equal(pure.cartSupport, pure.cartId);
    near(pure.elevation, pure.detachedHeight);
    assert.equal(pure.detachedSupport, null);
    assert.ok(pure.rejectedWithoutChanges);
    assert.equal(pure.shelfSettings.columns, 8);
    near(pure.shelfSettings.bread_length_1, .072);
    passed.push('Nested coffee groups, cart-mounted robots, shelf overrides and deleted external supports retain correct relationships and elevation.');

    // Copy and paste in a text field must keep normal browser editing behavior.
    const beforeText = (await state()).scene.objects.length;
    await select(newGroup);
    const input = page.locator('#item-name');
    await input.fill('Copied station label');
    await input.selectText();
    await page.keyboard.press('Control+c');
    await input.fill('');
    await page.keyboard.press('Control+v');
    assert.equal(await input.inputValue(), 'Copied station label');
    await input.press('Tab');
    assert.equal((await state()).scene.objects.length, beforeText);
    passed.push('Text-field copy/paste is unaffected and does not add scene objects.');

    const svg = await page.evaluate(() => coffeeEditor.plan.exportSVG(false));
    assert.ok(svg.includes(robot.id));
    const glb = await page.evaluate(async id => {
      const buffer = await coffeeEditor.three.glb();
      const view = new DataView(buffer);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
      return {found: json.nodes.some(node => node.extras?.editorId === id), bytes: buffer.byteLength};
    }, robot.id);
    assert.ok(glb.found && glb.bytes > 100000);
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('Saved locally'));
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForFunction(() => coffeeEditor.ready);
    current = await state();
    assert.equal(current.scene.objects.length, beforeText);
    assert.ok(current.instances.includes(robot.id));
    assert.ok(await page.locator('#paste').isEnabled());
    await page.locator('#paste').click();
    assert.equal((await state()).scene.objects.length, beforeText + 5);
    passed.push('Pasted geometry is included in SVG and GLB, and scene/clipboard persistence survives reload.');

    const secondPage = await context.newPage();
    await secondPage.goto('http://127.0.0.1:8766/viewer.html', {waitUntil: 'networkidle'});
    await secondPage.waitForFunction(() => coffeeEditor.ready);
    const otherBefore = await secondPage.evaluate(() => coffeeEditor.store.scene.objects.length);
    await secondPage.locator('#paste').click();
    assert.equal(await secondPage.evaluate(() => coffeeEditor.store.scene.objects.length), otherBefore + 5);
    await secondPage.close();
    passed.push('Toolbar Paste works in another editor tab.');

    assert.deepEqual(errors, []);
    await page.screenshot({path: path.join(__dirname, 'output/clipboard-editor.png')});
    fs.writeFileSync(path.join(__dirname, 'output/clipboard-test-report.json'), JSON.stringify({passed, errors}, null, 2));
    console.log(JSON.stringify({passed, errors}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
