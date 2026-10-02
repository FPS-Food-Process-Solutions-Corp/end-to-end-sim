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
    const page = await browser.newPage({viewport: {width: 1700, height: 1150}, acceptDownloads: true});
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
    await page.waitForFunction(() => window.coffeeEditor?.ready && coffeeEditor.flow.result);
    const passed = [];
    const initial = await page.evaluate(() => ({
      request: coffeeEditor.flow.request,
      result: coffeeEditor.flow.result,
    }));
    assert.ok(initial.result.pathOK);
    assert.equal(initial.result.routeSearch.attempts.length, 24);
    assert.ok(initial.result.routeSearch.passed > 1);
    assert.equal(initial.result.route.duration, 27);
    assert.ok(initial.result.motion.transfers.every(transfer => transfer.j1Share > .95));
    assert.ok(initial.result.motion.maxTiltBoundDegrees <= 5);
    assert.equal(Number(await page.locator('#flow-scrub').getAttribute('max')), initial.result.route.duration);
    assert.ok(await page.locator('[data-flow-setting="prefer_j1"]').isChecked());
    passed.push('Default search compares 24 route/posture candidates and selects a 27-second upright path with more than 95% J1 share in both sweeps.');

    const preview = await page.evaluate(async () => {
      const THREE = await import('./vendor/three.module.js');
      const {flow} = coffeeEditor;
      const {player} = flow;
      const release = player.request.knots.find(knot => knot.phase === 'Release robot vacuum').time;
      let maxTilt = 0;
      let attachmentError = 0;
      for (let time = 3; time < release; time += .047) {
        player.seek(time);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.bag.quaternion);
        maxTilt = Math.max(maxTilt, Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI);
        const contact = player.record.tcp.getWorldPosition(new THREE.Vector3());
        const bagContact = new THREE.Vector3(0, flow.request.bag.contactHeight, 0)
          .applyQuaternion(player.bag.quaternion).add(player.bag.position);
        attachmentError = Math.max(attachmentError, contact.distanceTo(bagContact));
      }
      player.seek(release + .2);
      const placed = {
        bottom: player.bag.position.y,
        robotVacuum: document.querySelector('#flow-robot-vac').classList.contains('on'),
      };
      player.seek(player.request.duration);
      const finalTime = player.time;
      player.stop();
      return {maxTilt, attachmentError, placed, finalTime};
    });
    assert.ok(preview.maxTilt < .03);
    assert.ok(preview.maxTilt <= initial.result.motion.maxTiltBoundDegrees);
    assert.ok(preview.attachmentError < 1e-9);
    assert.ok(Math.abs(preview.placed.bottom - .902) < .00001);
    assert.equal(preview.placed.robotVacuum, false);
    assert.equal(preview.finalTime, 27);
    passed.push('Dense sampling of the actual animated mesh confirms upright carrying, a fixed suction contact, correct final placement and the extended timeline.');

    const constraints = await page.evaluate(async () => {
      const THREE = await import('./vendor/three.module.js');
      const {checkWorkflow} = await import('./editor/ik-core.js');
      const {flow} = coffeeEditor;
      const definition = await fetch('./robot-library/nova5_suction-kinematics.json').then(r => r.json());
      const narrowed = structuredClone(definition);
      narrowed.joints[0].lower = -Math.PI;
      narrowed.joints[0].upper = Math.PI;
      // This test-only robot model forces the search to use the long way round.
      const longResult = checkWorkflow(narrowed, flow.request);
      const pose = flow.request.targets[0];
      const tiltQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6)
        .multiply(new THREE.Quaternion(...pose.quaternion)).toArray();
      const knot = (time, quaternion) => ({
        ...pose, quaternion, time, phase: 'Test held-bag tilt',
        bagState: 'carried', bagDepth: .004, robotVacuum: true,
      });
      const tiltedRequest = {
        ...flow.request, settings: {...flow.request.settings, prefer_j1: false},
        knots: [knot(0, pose.quaternion), knot(1, tiltQuaternion)], duration: 1,
      };
      const tilted = checkWorkflow(definition, tiltedRequest);
      const {failureMarkup} = await import('./editor/flow-diagnostics.js');
      const frameLimitsOK = longResult.frames.every(frame =>
        frame.q.every((angle, joint) => angle >= narrowed.joints[joint].lower &&
          angle <= narrowed.joints[joint].upper));
      return {
        longPathOK: longResult.pathOK,
        route: longResult.route && {label: longResult.route.label, duration: longResult.route.duration},
        longFailure: longResult.failure && {reason: longResult.failure.reason, phase: longResult.failure.phase},
        frameLimitsOK,
        tilted: tilted.failure,
        tiltMessage: failureMarkup(tilted.failure),
      };
    });
    assert.ok(constraints.longPathOK, JSON.stringify(constraints));
    assert.ok(constraints.route.label.includes('long arc'));
    assert.ok(constraints.route.duration > initial.result.route.duration);
    assert.ok(constraints.frameLimitsOK);
    assert.equal(constraints.tilted.reason, 'bag_tilt_exceeded');
    assert.match(constraints.tiltMessage, /Held-bag tilt limit exceeded/);
    assert.match(constraints.tiltMessage, /not an IK reachability failure/);
    passed.push('A test model with narrower J1 limits finds a valid longer sweep; a reachable tilted target is rejected explicitly by the bag-tilt constraint.');

    await page.locator('[data-flow-setting="lift"]').fill('8');
    await page.locator('[data-flow-setting="lift"]').dispatchEvent('change');
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    assert.ok(await page.evaluate(() => coffeeEditor.flow.result.motion.transfers.every(t => t.j1Share > .95)));
    const lowLiftRoute = await page.evaluate(() => coffeeEditor.flow.result.route.id);
    await page.locator('[data-flow-setting="prefer_j1"]').uncheck();
    await page.waitForFunction(() => coffeeEditor.flow.result && !coffeeEditor.flow.result.pathOK);
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result.failure.reason), 'ik_not_converged');
    await page.locator('[data-flow-setting="prefer_j1"]').check();
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    passed.push('The old 8 cm straight-transfer failure passes using J1 sweeps without moving the arm or fixtures.');

    await page.locator('[data-flow-setting="min_j1_share"]').fill('100');
    await page.locator('[data-flow-setting="min_j1_share"]').dispatchEvent('change');
    await page.waitForFunction(() => coffeeEditor.flow.result);
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result.failure.reason), 'j1_share_too_low');
    assert.ok(await page.locator('#flow-play').isDisabled());
    assert.match(await page.locator('#flow-failure').innerText(), /J1 motion requirement not met/);
    await page.locator('[data-flow-setting="min_j1_share"]').fill('50');
    await page.locator('[data-flow-setting="min_j1_share"]').dispatchEvent('change');
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    passed.push('The editable minimum J1 share is enforced rather than silently relaxed.');

    const downloaded = page.waitForEvent('download');
    await page.locator('[data-flow-action="report"]').click();
    const download = await downloaded;
    const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.ok(report.result.route.knots.length > report.request.knots.length);
    assert.equal(report.layout.bag_workflow.prefer_j1, true);
    assert.equal(report.result.route.duration, Number(await page.locator('#flow-scrub').getAttribute('max')));
    assert.ok(report.result.motion.maxTiltBoundDegrees < report.request.settings.max_bag_tilt_deg);
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('Saved locally'));
    await page.reload();
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    assert.equal(await page.locator('[data-flow-setting="lift"]').inputValue(), '8');
    assert.equal(await page.locator('[data-flow-setting="min_j1_share"]').inputValue(), '50');
    assert.ok(await page.locator('[data-flow-setting="prefer_j1"]').isChecked());
    passed.push('IK export includes the selected route, constraints and search results; settings survive autosave and reload.');

    await page.locator('#flow-motion-summary').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const {flow} = coffeeEditor;
      const end = flow.player.request.knots.find(knot => knot.phase === 'J1 sweep to placement zone').time;
      flow.player.seek(end - 1);
    });
    await page.screenshot({path: path.join(__dirname, 'output/j1-bag-motion.png')});
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(__dirname, 'output/bag-motion-test-report.json'),
      JSON.stringify({passed, preview, motion: initial.result.motion, constraints, lowLiftRoute, errors}, null, 2));
    console.log(JSON.stringify({passed, preview, longerRoute: constraints.route, errors}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
