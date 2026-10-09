const {chromium, _electron:electron} = require('./desktop/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'output');
const types = {'.js':'text/javascript', '.html':'text/html', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.glb':'model/gltf-binary'};
const server = http.createServer((request, response) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) throw new Error('Not found');
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(response);
  } catch { response.writeHead(404); response.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  const desktopMode = process.argv.includes('--electron');
  const env = {...process.env, LAYOUT_STUDIO_TEST:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  if (desktopMode) env.LAYOUT_STUDIO_TEST_PROFILE = fs.mkdtempSync(path.join(output, 'language-profile-'));
  const browser = desktopMode
    ? await electron.launch({executablePath:require('./desktop/node_modules/electron'),
      args:[path.join(root,'desktop'), '--enable-unsafe-swiftshader'], env, timeout:60000})
    : await chromium.launch({headless:true, executablePath:chrome,
      args:['--enable-webgl', '--ignore-gpu-blocklist']});
  const passed = [], errors = [];
  try {
    const page = desktopMode ? await browser.firstWindow()
      : await browser.newPage({viewport:{width:1600,height:1000}});
    page.on('pageerror', error => errors.push(error.message));
    if (!desktopMode) await page.goto('http://127.0.0.1:' + server.address().port + '/viewer.html');
    await page.waitForFunction(() => window.coffeeEditor?.ready, null, {timeout:120000});
    await page.locator('#studio-mode').selectOption('advanced');
    await page.evaluate(() => coffeeEditor.store.select('nova2'));
    const headings = await page.locator('#properties > section > h3').allTextContents();
    assert.equal(headings[0], 'Support');
    assert.equal(headings[1], 'Position on support');
    const supports = page.locator('#support');
    assert.equal(await supports.count(), 1);
    const originalSupport = await supports.inputValue();
    await supports.selectOption('');
    assert.equal(await page.evaluate(() => coffeeEditor.store.object('nova2').support), null);
    await supports.selectOption(originalSupport);
    assert.equal(await page.evaluate(() => coffeeEditor.store.z(coffeeEditor.store.object('nova2'))),
      await page.evaluate(id => {const s=coffeeEditor.store,t=s.object(id);return s.z(t)+t.height;}, originalSupport));
    passed.push('Support first, single selector, mounting elevation and editing work');

    // Intentionally choose names that also exist in the translation dictionary.
    await page.evaluate(() => {
      const s=coffeeEditor.store;
      s.transact('Custom test names', () => {
        s.object('nova2').label='Support';
        s.object('coffee_station').label='Coffee';
      });
      coffeeEditor.snapshots.save('Support', 'Coffee');
    });
    const stateBefore = await page.evaluate(() => JSON.stringify(coffeeEditor.store.exportScene()));
    const undoBefore = await page.evaluate(() => coffeeEditor.store.undoStack.length);
    await page.locator('#ui-language').selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.querySelector('[data-panel="library"]').textContent.includes('添加'));
    assert.equal(await page.evaluate(() => JSON.stringify(coffeeEditor.store.exportScene())), stateBefore);
    assert.equal(await page.evaluate(() => coffeeEditor.store.undoStack.length), undoBefore);
    assert.equal(await page.locator('#item-name').inputValue(), 'Support');
    assert.equal(await page.locator('[data-layer="nova2"] .layer-label').textContent(), 'Support');
    assert.equal(await page.locator('#support option[value="coffee_station"]').textContent(), 'Coffee');
    assert.equal(await page.locator('#selection-status').textContent(), 'Support');
    assert.match(await page.locator('#properties > section > h3').first().textContent(), /[\u4e00-\u9fff]/);
    passed.push('Chinese UI preserves custom names, dimensions, project state and undo history');

    await page.locator('#snapshots-button').click();
    assert.equal(await page.locator('.snapshot-info h3').first().textContent(), 'Support');
    assert.equal(await page.locator('.snapshot-info > p').first().textContent(), 'Coffee');
    assert.match(await page.locator('#snapshots-title').textContent(), /[\u4e00-\u9fff]/);
    await page.locator('[data-snapshot-action="close"]').click();

    await page.locator('[data-panel="library"]').click();
    await page.locator('#library-category').selectOption('Furniture');
    assert.equal(await page.locator('#library-category').inputValue(), 'Furniture');
    assert.match(await page.locator('#library-category option[value="Furniture"]').textContent(), /[\u4e00-\u9fff]/);
    const furnitureCount = await page.locator('[data-asset]').count();
    assert.ok(furnitureCount > 0);
    await page.locator('#library-category').selectOption('');
    await page.locator('#library-search').fill('家具');
    assert.equal(await page.locator('[data-asset]').count(), furnitureCount);
    await page.locator('#library-search').fill('');
    const count = await page.evaluate(() => coffeeEditor.store.scene.objects.length);
    await page.locator('[data-asset="between_shelves_counter"] button').click();
    const added = await page.evaluate(() => {
      const e=coffeeEditor, id=e.store.selected[0];
      return {id, count:e.store.scene.objects.length, model:e.three.instances.has(id), label:e.store.object(id).label};
    });
    assert.equal(added.count, count+1); assert.ok(added.model);
    assert.equal(await page.locator('#plan [data-object-id="'+added.id+'"]').count(), 1);
    passed.push('Translated library categories keep English values; Chinese search and object insertion update both views');

    await page.locator('[data-panel="flow"]').click();
    await page.locator('[data-workflow="coffee"]').click();
    const drink = page.locator('[data-coffee-setting="drink"]');
    await drink.selectOption('milk_tea');
    assert.equal(await drink.inputValue(), 'milk_tea');
    assert.match(await drink.locator('option[value="milk_tea"]').textContent(), /[\u4e00-\u9fff]/);
    await page.evaluate(() => {document.querySelector('#coffee-status').textContent='Preparing step 2 / 6';});
    await page.waitForFunction(() => /[\u4e00-\u9fff]/.test(document.querySelector('#coffee-status').textContent));
    passed.push('Dynamic workflow rendering/progress and translated drink options remain functional');

    await page.evaluate(() => coffeeEditor.store.select('nova2'));
    await page.screenshot({path:path.join(output,'chinese-interface'+(desktopMode?'-desktop':'')+'.png')});
    await page.reload();
    await page.waitForFunction(() => window.coffeeEditor?.ready, null, {timeout:120000});
    assert.equal(await page.locator('#ui-language').inputValue(), 'zh-CN');
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    await page.locator('#ui-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal((await page.locator('[data-panel="library"]').textContent()).replace(/\d+/g,'').trim(), 'Add objects');
    await page.evaluate(() => coffeeEditor.store.select('nova2'));
    assert.equal(await page.locator('#properties > section > h3').first().textContent(), 'Support');
    assert.equal(await page.locator('#item-name').inputValue(), 'Support');
    passed.push('Preference survives reload and switching back restores English');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output,'ui-language-test-report'+(desktopMode?'-desktop':'')+'.json'), JSON.stringify({passed,errors}, null, 2));
    console.log(passed.join('\n'));
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error); server.close(); process.exitCode=1;});
