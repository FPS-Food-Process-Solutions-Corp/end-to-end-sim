const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({viewport: {width: 1700, height: 1150}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
    await page.waitForFunction(() => window.coffeeEditor?.ready && coffeeEditor.flow.result);
    const passed = [];
    assert.ok(await page.evaluate(() => coffeeEditor.flow.result.pathOK));
    assert.match(await page.locator('.flow-boundary-status').innerText(), /All four corners fit/);
    assert.equal(await page.locator('#flow-play').isDisabled(), false);

    const math = await page.evaluate(async () => {
      const {SceneStore, rotate} = await import('./editor/store.js');
      const {placementAssessment, placementError} = await import('./editor/placement-validation.js');
      const store = new SceneStore(coffeeEditor.store.seed);
      const table = store.object('coffee_station');
      const zone = store.object('placement_zone');
      Object.assign(table, {x: 2, y: 2, width: 1.2, depth: .8, yaw_deg: 37});
      Object.assign(zone, {width: .3, depth: .2, yaw_deg: 60, support: table.id});
      const extent = .15 * Math.cos(23 * Math.PI / 180) + .1 * Math.sin(23 * Math.PI / 180);
      const place = offset => {
        const local = rotate(.6 - extent + offset, .05, table.yaw_deg);
        zone.x = table.x + local[0]; zone.y = table.y + local[1];
        return placementAssessment(store, zone);
      };
      const flush = place(0);
      const roundoff = place(.00005);
      const tiny = place(.0002);
      const outside = place(.012);
      const message = placementError(outside);
      zone.x += outside.correction[0];
      zone.y += outside.correction[1];
      const corrected = placementAssessment(store, zone);
      zone.width = 2;
      const oversized = placementAssessment(store, zone);
      return {flush, roundoff, tiny, outside, corrected, oversized, message};
    });
    assert.ok(math.flush.inside && math.roundoff.inside);
    assert.equal(math.tiny.inside, false);
    assert.equal(math.outside.overhangs.length, 1);
    assert.ok(Math.abs(math.outside.overhangs[0].amount - .012) < 1e-10);
    assert.match(math.message, /right \(local \+X\) edge by 1.20 cm/);
    assert.ok(math.corrected.inside);
    assert.equal(math.oversized.correction, null);
    passed.push('Rotated-table checks accept flush boundaries and numerical roundoff, identify the exact overhang, and reject oversized rectangles.');

    await page.evaluate(() => {
      const {store} = coffeeEditor;
      store.transact('Disable automatic checking and move zone outside table', () => {
        store.scene.bag_workflow.auto_check = false;
        store.object('placement_zone').x = 1.49;
      });
    });
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result), null);
    assert.match(await page.locator('.flow-boundary-status').innerText(), /coffee_station/);
    assert.match(await page.locator('.flow-boundary-status').innerText(), /17.00 cm/);
    assert.match(await page.locator('#flow-preview-reason').innerText(), /Preview unavailable.*coffee_station/);
    assert.ok(await page.locator('#flow-play').isDisabled());
    assert.equal(await page.locator('[data-flow-action="frame"]').isDisabled(), false);
    await page.locator('[data-flow-action="check"]').click();
    await page.waitForFunction(() => coffeeEditor.flow.result);
    assert.ok(await page.locator('#flow-play').isDisabled());
    await page.locator('[data-flow-action="placement"]').click();
    assert.ok(await page.locator('[data-placement-overhang="true"]').count() > 0);
    assert.equal(await page.locator('[data-placement-table="coffee_station"]').count(), 1);
    assert.ok(await page.evaluate(() =>
      !!coffeeEditor.flow.guideGroup.getObjectByName('Assigned placement table boundary')));
    await page.screenshot({path: path.join(__dirname, 'output/placement-boundary-diagnostics.png')});
    passed.push('A real overhang names its assigned table and blocks playback, while the camera control remains enabled and both views highlight the offending corners.');

    const originalSize = await page.evaluate(() => {
      const zone = coffeeEditor.store.object('placement_zone');
      return {width: zone.width, depth: zone.depth, yaw: zone.yaw_deg};
    });
    await page.locator('[data-flow-action="fit-zone"]').click();
    assert.match(await page.locator('.flow-boundary-status').innerText(), /All four corners fit/);
    assert.ok(!(await page.evaluate(() => coffeeEditor.flow.request.errors)).some(error => error.includes('extends beyond')));
    assert.match(await page.locator('#flow-preview-reason').innerText(), /current layout passes Check IK/);
    assert.ok(await page.locator('#flow-play').isDisabled());
    const corrected = await page.evaluate(() => {
      const zone = coffeeEditor.store.object('placement_zone');
      return {width: zone.width, depth: zone.depth, yaw: zone.yaw_deg, x: zone.x};
    });
    assert.deepEqual({width: corrected.width, depth: corrected.depth, yaw: corrected.yaw}, originalSize);
    assert.ok(Math.abs(corrected.x - 1.32) < 1e-10);
    await page.locator('[data-flow-action="check"]').click();
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    assert.equal(await page.locator('#flow-play').isDisabled(), false);
    assert.ok(await page.locator('#flow-preview-reason').isHidden());
    await page.evaluate(() => coffeeEditor.store.undo());
    assert.match(await page.locator('.flow-boundary-status').innerText(), /17.00 cm/);
    passed.push('Move-inside applies only the required translation and supports undo. Boundary warnings update with automatic IK off; playback waits for a fresh successful check.');

    await page.evaluate(() => {
      const {store} = coffeeEditor;
      store.transact('Move rectangle over packing table', () => {
        Object.assign(store.object('placement_zone'), {x: 1.62, y: 3.04});
      });
    });
    assert.match(await page.locator('#flow-placement').innerText(), /This rectangle fits on:.*Shared packing table/);
    const beforeSupport = await page.evaluate(() => {
      const z = coffeeEditor.store.object('placement_zone'); return {x: z.x, y: z.y};
    });
    await page.locator('[data-flow-support]').selectOption('middle_counter');
    assert.match(await page.locator('.flow-boundary-status').innerText(), /All four corners fit/);
    const afterSupport = await page.evaluate(() => {
      const z = coffeeEditor.store.object('placement_zone'); return {x: z.x, y: z.y, support: z.support};
    });
    assert.deepEqual({x: afterSupport.x, y: afterSupport.y}, beforeSupport);
    assert.equal(afterSupport.support, 'middle_counter');
    passed.push('A support mismatch identifies the table that actually contains the rectangle; changing support keeps its XY position.');

    const drawn = await page.evaluate(() => {
      coffeeEditor.flow.addZone({x: 1.62, y: 3.04, width: .16, depth: .24});
      const zone = coffeeEditor.store.object(coffeeEditor.store.scene.bag_workflow.placement_zone_id);
      return {support: zone.support, errors: coffeeEditor.flow.request.errors};
    });
    assert.equal(drawn.support, 'middle_counter');
    assert.ok(!drawn.errors.some(error => error.includes('extends beyond')));
    passed.push('New placement rectangles attach to the table they are drawn on instead of always attaching to the coffee table.');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(__dirname, 'output/placement-validation-test-report.json'),
      JSON.stringify({passed, errors}, null, 2));
    console.log(JSON.stringify({passed, errors}, null, 2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exit(1);});
