const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8766/object-lab/');
    await page.waitForFunction(() => window.objectSizeLab?.ready);
    const metrics = await page.evaluate(async () => {
      const {defaults} = await import('./catalog.js');
      const {queueEntry} = await import('./drop-queue.js');
      const state = defaults(); state.mode = 'drop'; state.bag = 'bag-12';
      state.drop.cadence = 'timed'; state.drop.interval = .3;
      state.dropQueue = [queueEntry(state.objects.find(object => object.id === 'mini-donut'), state.drop, 12)];
      const app = objectSizeLab; app.importScene(state); await app.drop.play();
      for (let frame = 0; frame < 2000 && app.drop.released < 12; frame++) app.drop.tick(1 / 60);
      const released = app.drop.released;
      // An abnormally delayed frame must not request a .1 s catch-up burst.
      app.drop.tick(1);
      const catchUpSteps = app.drop.frameStats.steps;
      const times = [], steps = [], frameTimes = [];
      const originalTick = app.drop.tick.bind(app.drop);
      app.drop.tick = seconds => {
        const before = performance.now(); originalTick(seconds);
        times.push(performance.now() - before); steps.push(app.drop.frameStats.steps);
      };
      const start = performance.now(); let previous = start;
      await new Promise(resolve => {
        const frame = () => {
          const now = performance.now(); frameTimes.push(now - previous); previous = now;
          if (now - start >= 2500) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      app.drop.tick = originalTick;
      const percentile = (values, percentile) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * percentile))];
      const stepCount = Math.max(...steps), beforeClock = app.drop.clock;
      await app.drop.play(); // Pause via the same action used by the UI.
      app.drop.tick(.1); const paused = app.drop.clock === beforeClock;
      return {released, catchUpSteps, maxStepsPerFrame: stepCount, paused,
        tickMedianMs: percentile(times, .5), tickP95Ms: percentile(times, .95), tickMaxMs: Math.max(...times),
        frameMedianMs: percentile(frameTimes, .5), frameP95Ms: percentile(frameTimes, .95), samples: times.length};
    });
    assert.equal(metrics.released, 12);
    assert.ok(metrics.catchUpSteps <= 8 && metrics.maxStepsPerFrame <= 8, 'Physics catch-up must stay bounded');
    assert.ok(metrics.tickP95Ms < 50, '12-pastry physics should not monopolize the UI with long tasks');
    assert.ok(metrics.paused); assert.deepEqual(errors, []);
    fs.writeFileSync(path.resolve(__dirname, '../output/object-lab-performance-test.json'), JSON.stringify({metrics, errors}, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
