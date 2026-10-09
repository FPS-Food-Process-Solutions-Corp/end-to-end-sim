const {_electron:electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const desktop = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(desktop, 'test-results', packaged ? 'packaged' : 'development', String(Date.now()));
fs.mkdirSync(output, {recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-studio-smoke-'));
const errors = [], requests = [], failedRequests = [], passed = [];
const mark = message => {passed.push(message); console.log(message);};
let instance, page;

function executable() {
  if (!packaged) return require('electron');
  if (process.platform === 'win32') return path.join(desktop, 'dist/win-unpacked/Layout Studio.exe');
  const macFolder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
  return path.join(desktop, 'dist', macFolder, 'Layout Studio.app/Contents/MacOS/Layout Studio');
}

async function launch() {
  const env = {...process.env, LAYOUT_STUDIO_TEST:'1', LAYOUT_STUDIO_TEST_PROFILE:profile};
  delete env.ELECTRON_RUN_AS_NODE;
  instance = await electron.launch({executablePath:executable(),
    args:[...(!packaged ? [desktop] : []), '--enable-unsafe-swiftshader'], env, timeout:60000});
  page = await instance.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  page.on('request', request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  page.on('requestfailed', request => failedRequests.push(request.url() + ': ' + request.failure()?.errorText));
  await page.waitForFunction(() => window.coffeeEditor?.ready, null, {timeout:120000});
  await instance.evaluate(({session}, folder) => {
    globalThis.desktopDownloads = [];
    // Substitute an explicit test destination for the native Save dialog.
    session.fromPartition('persist:layout-studio').on('will-download', (_event, item) => {
      item.setSavePath(folder + '/' + item.getFilename().split(/[\\/]/).pop());
      item.once('done', (_event, state) => globalThis.desktopDownloads.push({name:item.getFilename(), state,
        bytes:item.getReceivedBytes(), total:item.getTotalBytes(), url:item.getURL(), path:item.getSavePath()}));
    });
  }, output);
}

async function saveExport(kind, name) {
  await page.evaluate(kind => coffeeEditor.exportFile(kind), kind);
  await waitDownload(name);
  const bytes = fs.readFileSync(path.join(output, name));
  assert.ok(bytes.length > 100, name + ' was empty');
  return bytes;
}

async function waitDownload(name) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const result = await instance.evaluate((_, name) => globalThis.desktopDownloads.find(item => item.name === name), name);
    if (result) {assert.equal(result.state, 'completed', JSON.stringify(result)); return result;}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native export did not complete: ' + name);
}

(async () => {
  try {
    await launch();
    const capabilities = await page.evaluate(() => ({
      secure:isSecureContext, node:typeof require, process:typeof process,
      objects:coffeeEditor.three.instances.size,
    }));
    assert.equal(capabilities.secure, true);
    assert.equal(capabilities.node, 'undefined');
    assert.equal(capabilities.process, 'undefined');
    assert.ok(capabilities.objects > 15);
    mark('Offline models and editor load inside an isolated renderer');

    const editing = await page.evaluate(() => {
      const {store, flow} = coffeeEditor;
      flow.suspended = true;
      const object = store.scene.objects.find(item => item.kind === 'machine' && store.visible(item.id));
      store.select(object.id);
      return {id:object.id,x:object.x};
    });
    await page.locator('#plan').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs(await page.evaluate(id => coffeeEditor.store.object(id).x, editing.id) - editing.x - .01) < 1e-6);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    assert.ok(Math.abs(await page.evaluate(id => coffeeEditor.store.object(id).x, editing.id) - editing.x) < 1e-6,
      'Native app menus must not swallow the editor undo shortcut');
    await page.evaluate(() => {coffeeEditor.flow.suspended = false;});
    mark('Canvas editing and undo keyboard shortcuts work');

    await page.evaluate(() => coffeeEditor.flow.check());
    await page.waitForFunction(() => coffeeEditor.flow.result && !coffeeEditor.flow.worker, null, {timeout:120000});
    console.log('Bag worker finished; checking coffee worker.');
    await page.evaluate(() => coffeeEditor.coffee.check());
    await page.waitForFunction(() => coffeeEditor.coffee.result && !coffeeEditor.coffee.worker, null, {timeout:120000});
    mark('Both real module workers return IK results, with local kinematics');

    const original = await page.evaluate(() => coffeeEditor.getState());
    original.title = 'Desktop persistence smoke';
    const firstMachine = original.objects.find(object => object.kind === 'machine');
    firstMachine.label = 'Desktop import ✓';
    await page.locator('#import-file').setInputFiles({name:'desktop-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
    await page.waitForFunction(() => coffeeEditor.store.scene.title === 'Desktop persistence smoke');
    await page.evaluate(() => {
      coffeeEditor.flow.suspended = true;
      clearTimeout(coffeeEditor.flow.timer);
      coffeeEditor.snapshots.save('Desktop smoke snapshot', 'Preserved across application restarts');
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('coffee-layout-studio-v2'))?.title === 'Desktop persistence smoke');
    mark('JSON file import and named snapshot save');

    const json = JSON.parse((await saveExport('json','coffee-bar-edited.json')).toString());
    assert.equal(json.title, original.title);
    assert.match((await saveExport('svg','coffee-bar-edited.svg')).toString(), /<svg/);
    const glb = await saveExport('glb','coffee-bar-edited.glb');
    assert.equal(glb.toString('ascii',0,4), 'glTF');
    const png = await saveExport('png','coffee-bar-edited.png');
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    mark('SVG, JSON, PNG and GLB save to actual files');

    const recording = await page.evaluate(async () => {
      const {OrderRecorder} = await import('./editor/order-recorder.js');
      window.desktopRecorder = new OrderRecorder(coffeeEditor.three, () => {});
      desktopRecorder.start(720, {filename:'desktop-video', completeReason:'Desktop smoke'});
      const until = performance.now() + 1400;
      while (performance.now() < until) {
        coffeeEditor.three.scene.rotation.y += .003;
        desktopRecorder.capture();
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      coffeeEditor.three.scene.rotation.y = 0;
      desktopRecorder.stop('Desktop smoke');
      return desktopRecorder.mimeType;
    });
    await page.waitForFunction(() => desktopRecorder.state === 'ready', null, {timeout:30000});
    await page.evaluate(() => desktopRecorder.save());
    const videoName = recording.startsWith('video/mp4') ? 'desktop-video.mp4' : 'desktop-video.webm';
    await waitDownload(videoName);
    assert.ok(fs.statSync(path.join(output, videoName)).size > 1000);
    const dimensions = await page.evaluate(async () => {
      const video = document.createElement('video');
      video.src = desktopRecorder.url;
      await new Promise((resolve,reject) => {video.onloadeddata = resolve; video.onerror = () => reject(new Error('Recorded video cannot decode'));});
      return [video.videoWidth,video.videoHeight];
    });
    assert.deepEqual(dimensions, [1280,720]);
    mark('Real 720p canvas recording saves and decodes: ' + recording);

    await page.screenshot({path:path.join(output, 'studio.png')});
    await instance.evaluate(({session}) => session.fromPartition('persist:layout-studio').flushStorageData());
    await instance.close(); instance = null;
    await launch();
    assert.equal(await page.evaluate(() => coffeeEditor.store.scene.title), original.title);
    assert.equal(await page.evaluate(() => coffeeEditor.snapshots.items[0]?.name), 'Desktop smoke snapshot');
    assert.equal(await page.evaluate(() => coffeeEditor.store.scene.objects.find(o => o.kind === 'machine').label), 'Desktop import ✓');
    mark('Autosave and snapshots survive a full process restart');
    assert.deepEqual(requests, [], 'No runtime HTTP/network dependencies');
    assert.deepEqual(failedRequests, []);
    assert.deepEqual(errors, []);
    console.log('Desktop smoke test passed.');
  } catch (error) {
    if (page) {
      try {await page.screenshot({path:path.join(output, 'failure.png')});} catch {}
      try {console.error(await page.evaluate(() => ({status:document.querySelector('#model-status')?.textContent,
        bag:window.coffeeEditor?.flow.message, coffee:window.coffeeEditor?.coffee.message})));} catch {}
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({packaged,passed,errors,failedRequests,requests},null,2));
    if (instance) await instance.close();
    // The profile was created exclusively by this test in the OS temp folder.
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('layout-studio-smoke-'))
      fs.rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})();
