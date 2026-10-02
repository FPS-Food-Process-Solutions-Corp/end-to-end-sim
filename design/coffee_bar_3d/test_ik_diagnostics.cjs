const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const passed = [];
  try {
    const page = await browser.newPage({viewport: {width: 1700, height: 1150}, acceptDownloads: true});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.stack));
    await page.goto('http://127.0.0.1:8766/viewer.html?workflow=1');
    await page.waitForFunction(() => window.coffeeEditor?.ready && coffeeEditor.flow.result);
    assert.equal(await page.evaluate(() => coffeeEditor.flow.result.pathOK), true);
    assert.equal(await page.locator('#flow-failure').count(), 0);
    passed.push('The default passing path has no failure panel.');

    // Keep the original direct path to reproduce the previous low-lift failure.
    await page.locator('[data-flow-setting="prefer_j1"]').uncheck();
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK && !coffeeEditor.flow.result.motion.preferJ1);
    await page.locator('[data-flow-setting="lift"]').fill('8');
    await page.locator('[data-flow-setting="lift"]').dispatchEvent('change');
    await page.waitForFunction(() => coffeeEditor.flow.result?.failure);
    const failure = await page.evaluate(() => coffeeEditor.flow.result.failure);
    assert.equal(failure.reason, 'ik_not_converged');
    assert.equal(failure.phase, 'Carry to placement zone');
    assert.equal(failure.time, 18.25);
    assert.ok(failure.positionError > failure.tolerance.position);
    assert.ok(failure.orientationError < Math.PI / 180);
    assert.deepEqual(failure.failedTolerances, ['position']);
    assert.ok(failure.nearLimits.some(joint => joint.name === 'joint3' && joint.nearestLimit === 'upper'));
    assert.ok(failure.alternative.ok);
    assert.ok(failure.alternative.maxStep > failure.maxJointStep);
    assert.ok(failure.previous.time < failure.time);
    assert.equal(failure.segment.sample, 15);
    assert.equal(failure.segment.samples, 42);
    assert.ok(await page.locator('#flow-failure').innerText().then(text =>
      text.includes('IK did not converge') && text.includes('2.56 mm') &&
      text.includes('this same target IS reachable') && text.includes('joint3') &&
      text.includes('166.07, 269.57, 113.27 cm')));
    assert.equal(await page.locator('[data-workflow-failure="true"]').count(), 1);
    assert.equal(await page.locator('#flow-play').isDisabled(), true);
    const verification = await page.evaluate(async () => {
      const {SuctionArm} = await import('./editor/ik-core.js');
      const THREE = await import('./vendor/three.module.js');
      const {flow, three, store} = coffeeEditor;
      const definition = await fetch('./robot-library/nova5_suction-kinematics.json').then(r => r.json());
      const arm = new SuctionArm(definition, flow.request.robot, flow.request.mountingHeight);
      const failure = flow.result.failure;
      const alternate = arm.forward(failure.alternative.q).position;
      const last = flow.result.frames.at(-1);
      return {
        alternateError: alternate.distanceTo(new THREE.Vector3(...failure.target.position)),
        previousMatches: JSON.stringify(last.q) === JSON.stringify(failure.previous.q),
        rejectedIsAbsent: flow.result.frames.every(frame => frame.time < failure.time),
        failureMarker: flow.guideGroup.getObjectByName('Rejected IK target').position.toArray(),
        snapshot: JSON.stringify(store.scene),
      };
    });
    assert.ok(verification.alternateError <= .001);
    assert.ok(verification.previousMatches && verification.rejectedIsAbsent);
    assert.deepEqual(verification.failureMarker, [
      failure.target.position[0], failure.target.position[2], -failure.target.position[1],
    ]);
    passed.push('Low lift reproduces IK failure with precise target, errors, sample/time, joint-3 limit proximity and a reachable independent posture; no failed/restarted pose enters the path.');

    await page.locator('[data-flow-action="failure"]').click();
    const shown = await page.evaluate(async () => {
      const {SuctionArm} = await import('./editor/ik-core.js');
      const THREE = await import('./vendor/three.module.js');
      const {flow, store, three} = coffeeEditor;
      const definition = await fetch('./robot-library/nova5_suction-kinematics.json').then(r => r.json());
      const arm = new SuctionArm(definition, flow.request.robot, flow.request.mountingHeight);
      const pose = arm.forward(flow.result.failure.previous.q);
      const record = three.instances.get(flow.request.robot.id);
      return {
        mismatch: record.tcp.getWorldPosition(new THREE.Vector3())
          .distanceTo(new THREE.Vector3(pose.position.x, pose.position.z, -pose.position.y)),
        scene: JSON.stringify(store.scene),
        guideVisible: flow.guideGroup.visible,
        cameraFinite: three.camera.position.toArray().every(Number.isFinite),
      };
    });
    assert.ok(shown.mismatch < .000002);
    assert.equal(shown.scene, verification.snapshot);
    assert.ok(shown.guideVisible && shown.cameraFinite);
    assert.match(await page.locator('#flow-phase').innerText(), /Last valid pose/);
    await page.screenshot({path: path.join(__dirname, 'output/ik-failure-location.png')});
    passed.push('Locate failure focuses the rejected contact point and displays exactly the last accepted joint posture without editing the scene.');

    const downloaded = page.waitForEvent('download');
    await page.locator('[data-flow-action="report"]').click();
    const download = await downloaded;
    const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(report.result.failure.target, failure.target);
    assert.equal(report.result.failure.reason, failure.reason);
    assert.equal(report.result.failure.alternative.ok, true);
    passed.push('Export IK report preserves all diagnostic evidence and both requested and previous poses.');

    const synthetic = await page.evaluate(async () => {
      const {checkWorkflow} = await import('./editor/ik-core.js');
      const {flow} = coffeeEditor;
      const definition = await fetch('./robot-library/nova5_suction-kinematics.json').then(r => r.json());
      const base = flow.request;
      const knot = (pose, time, phase) => ({...pose, time, phase, bagState: 'carried', bagDepth: .004});
      const start = base.targets[0];
      const next = base.targets[1];
      const jumpRequest = {...base, knots: [
        knot(start, 0, 'Start'), knot(next, .001, 'Discontinuous test transfer'),
      ]};
      const jump = checkWorkflow(definition, jumpRequest);
      flow.result = jump;
      flow.player.configure(jumpRequest, jump);
      flow.drawGuides();
      flow.render();
      const unreachableRequest = {...base, knots: [
        knot(start, 0, 'Start'), knot({...next, position: [8, 8, 8]}, .001, 'Out of reach'),
      ]};
      const unreachable = checkWorkflow(definition, unreachableRequest);
      const initialRequest = {...base, knots: [
        knot({...start, position: [8, 8, 8]}, 0, 'Approach magazine'), knot(next, 1, 'Finish'),
      ]};
      const initial = checkWorkflow(definition, initialRequest);
      return {jump: jump.failure, unreachable: unreachable.failure, initial: initial.failure};
    });
    assert.equal(synthetic.jump.reason, 'joint_step_exceeded');
    assert.equal(synthetic.jump.ok, true);
    assert.ok(Math.abs(synthetic.jump.largestStep.delta) > synthetic.jump.maxJointStep);
    assert.match(await page.locator('#flow-failure').innerText(), /Joint-step guard stopped the path/);
    assert.match(await page.locator('#flow-failure').innerText(), /target pose itself passes IK/);
    assert.match(await page.locator('#flow-failure').innerText(), /not a physical joint-speed limit/);
    assert.equal(synthetic.unreachable.reason, 'ik_not_converged');
    assert.equal(synthetic.unreachable.alternative.ok, false);
    assert.equal(synthetic.initial.previous, null);
    assert.equal(synthetic.initial.phase, 'Initial approach');
    assert.deepEqual(synthetic.initial.target.position, [8, 8, 8]);
    passed.push('Genuine discontinuous, unreachable and initial-approach failures retain distinct and accurate evidence.');

    // Exercise the initial-failure UI separately: it must not offer a nonexistent prior pose.
    await page.evaluate(failure => {
      coffeeEditor.flow.result.failure = failure;
      coffeeEditor.flow.result.frames = [];
      coffeeEditor.flow.drawGuides();
      coffeeEditor.flow.render();
    }, synthetic.initial);
    await page.locator('[data-flow-action="failure"]').click();
    assert.match(await page.locator('#flow-failure').innerText(), /there is no valid preceding path sample/);
    passed.push('Initial approach failure can be located without a prior frame.');

    await page.locator('[data-flow-setting="lift"]').fill('25');
    await page.locator('[data-flow-setting="lift"]').dispatchEvent('change');
    await page.waitForFunction(() => coffeeEditor.flow.result?.pathOK);
    assert.equal(await page.locator('#flow-failure').count(), 0);
    assert.equal(await page.locator('[data-workflow-failure="true"]').count(), 0);
    assert.equal(await page.locator('#flow-play').isDisabled(), false);
    assert.equal(await page.evaluate(() => !!coffeeEditor.flow.guideGroup.getObjectByName('Rejected IK target')), false);
    passed.push('Rechecking a corrected layout removes stale failure markers and restores playback.');
    assert.deepEqual(pageErrors, []);
    const result = {passed, lowLiftFailure: failure, errors: pageErrors};
    fs.writeFileSync(path.join(__dirname, 'output/ik-diagnostics-test-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({passed, lowLiftFailure: {
      time: failure.time, target: failure.target.position, positionError: failure.positionError,
      reason: failure.reason, alternativeIK: failure.alternative.ok,
    }}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
