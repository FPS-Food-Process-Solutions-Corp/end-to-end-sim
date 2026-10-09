const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {resolveAsset, createAssetHandler, contentSecurityPolicy} = require('../protocol.cjs');
const {prepareStudio, inspectAsset} = require('../scripts/prepare-studio.cjs');
const root = path.resolve(__dirname, '../studio');

test('macOS matrix jobs package only their requested architecture', () => {
  const {computeArchToTargetNamesMap} = require('app-builder-lib/out/targets/targetFactory');
  const {Arch} = require('builder-util');
  const {Platform} = require('app-builder-lib');
  const config = require('../electron-builder.cjs');
  for (const arch of [Arch.x64, Arch.arm64]) {
    const map = computeArchToTargetNamesMap(new Map([[arch,[]]]), {platformSpecificBuildOptions:config.mac}, Platform.MAC);
    assert.deepEqual([...map.keys()], [arch]);
    assert.deepEqual(map.get(arch), ['dmg','zip']);
  }
});

test('custom origin serves only assets inside the bundle', () => {
  assert.equal(resolveAsset(root, 'layout-studio://studio/editor/app.js?revision=1'), path.join(root, 'editor/app.js'));
  assert.equal(resolveAsset(root, 'layout-studio://studio/'), path.join(root, 'viewer.html'));
  for (const url of ['file:///etc/passwd','https://studio/editor/app.js','layout-studio://other/viewer.html',
    'layout-studio://studio/%2e%2e%2fmain.cjs','layout-studio://studio/.git/config',
    'layout-studio://studio/%5c..%5cmain.cjs','layout-studio://studio/C:%5cWindows',
    'layout-studio://studio/%00','layout-studio://studio/%ZZ','layout-studio://user@studio/viewer.html'])
    assert.throws(() => resolveAsset(root, url), undefined, url);
});

test('staged bundle includes valid model bytes and complete JS imports, excluding local output', () => {
  const manifest = prepareStudio();
  for (const file of manifest.files) assert.deepEqual(inspectAsset(path.join(root, file.path)), {bytes:file.bytes, sha256:file.sha256});
  const paths = manifest.files.map(file => file.path);
  assert.ok(paths.includes('output/coffee_bar.glb'));
  assert.ok(paths.includes('editor/coffee-worker.js'));
  assert.ok(paths.includes('robot-library/nova5_coffee-kinematics.json'));
  assert.ok(!paths.some(file => /node_modules|\.log$|\.webm$|test_/.test(file)));
  assert.deepEqual(paths.filter(file => file.startsWith('output/')).sort(), ['output/built_config.json','output/coffee_bar.glb']);
  assert.ok(!fs.readFileSync(path.join(root, 'viewer.html'), 'utf8').includes('href="./output/coffee_bar.blend"'));
});

test('asset handler rejects writes and missing files and supplies secure response headers', async () => {
  const html = fs.readFileSync(path.join(root, 'viewer.html'), 'utf8');
  const csp = contentSecurityPolicy(html);
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.ok(!csp.includes('unsafe-eval'));
  const handler = createAssetHandler(root, async () => new Response('export {};'), csp);
  assert.equal((await handler({method:'POST',url:'layout-studio://studio/viewer.html'})).status, 405);
  assert.equal((await handler({method:'GET',url:'layout-studio://other/viewer.html'})).status, 403);
  assert.equal((await handler({method:'GET',url:'layout-studio://studio/missing.js'})).status, 404);
  const response = await handler({method:'GET',url:'layout-studio://studio/editor/app.js'});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/javascript');
  assert.equal(response.headers.get('content-security-policy'), csp);
});

test('LFS pointers cannot silently produce a model-less installer', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-asset-test-'));
  try {
    const file = path.join(folder, 'robot.glb');
    fs.writeFileSync(file, 'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 9000\n');
    assert.throws(() => inspectAsset(file), /LFS pointer/);
  } finally {fs.rmSync(folder, {recursive:true, force:true});}
});
