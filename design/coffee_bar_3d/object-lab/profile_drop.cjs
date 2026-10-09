const {chromium} = require('C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path');
(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
    await page.goto('http://127.0.0.1:8766/object-lab/');
    await page.waitForFunction(() => window.objectSizeLab?.ready);
    const metrics = await page.evaluate(async () => {
      const {physicsEngine, PastryDropWorld, STEP} = await import('./drop-physics.js');
      const {defaults} = await import('./catalog.js');
      const state = defaults(), R = await physicsEngine();
      const bag = state.objects.find(o => o.id === 'bag-12'), donut = state.objects.find(o => o.id === 'mini-donut');
      const sim = new PastryDropWorld(R, bag, state.drop), rows = [];
      let rawMs = 0, jsMs = 0, steps = 0, nextAt = 0, lastCount = 0;
      const rawStep = sim.world.step.bind(sim.world);
      sim.world.step = (...args) => {const start = performance.now(); const result = rawStep(...args); rawMs += performance.now() - start; return result;};
      const start = performance.now();
      for (let frame = 0; frame < 10 / STEP; frame++) {
        if (frame * STEP >= nextAt && sim.items.length < 12) {
          try {sim.addPastry(donut, state.drop, 'bench-' + sim.items.length);} catch (error) {if (error.name !== 'ReleaseBlockedError') throw error;}
          nextAt = frame * STEP + .3;
        }
        const before = performance.now(), beforeRaw = rawMs;
        sim.step(); jsMs += performance.now() - before - (rawMs - beforeRaw); steps++;
        if (sim.items.length !== lastCount || frame % Math.round(1 / STEP) === 0) {
          rows.push({time: frame * STEP, bodies: sim.items.length, rawMs, jsMs, steps});
          lastCount = sim.items.length;
        }
        if (performance.now() - start > 60000) break;
      }
      const totalMs = performance.now() - start;
      const result = {step: STEP, bodies: sim.items.length, colliders: sim.items.reduce((n, item) => n + item.colliders.length, 0), totalMs, steps, simulatedSeconds: steps * STEP, rawMs, jsMs, rows};
      sim.free(); return result;
    });
    const output = process.argv[2] || 'object-lab-drop-profile.json';
    fs.writeFileSync(path.resolve(__dirname, '../output', output), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
