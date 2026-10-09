const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const source = path.resolve(desktop, '..');
const destination = path.join(desktop, 'studio');
const required = [
  'viewer.html', 'scene_config.json', 'layouts/standard-demo.json', 'editor/app.js', 'editor/robot-reference.svg',
  'editor/ik-worker.js', 'editor/coffee-worker.js', 'vendor/three.module.js',
  'output/coffee_bar.glb', 'output/built_config.json',
  'me6-bag-station/layout-assets/me6_robot.glb', 'robot-library/nova5_cart.json',
  ...['nova5_suction','nova5_bread','nova2_coffee','nova5_coffee'].map(key => `robot-library/${key}-kinematics.json`),
];

function inspectAsset(file) {
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.subarray(0, 42).toString().startsWith('version https://git-lfs.github.com/spec/'))
    throw new Error(`Missing asset content (empty file or LFS pointer): ${file}`);
  if (file.endsWith('.json')) JSON.parse(bytes);
  if (file.endsWith('.glb') && (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length))
    throw new Error(`Invalid GLB asset: ${file}`);
  return {bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')};
}

function filesBelow(folder, prefix = '') {
  return fs.readdirSync(folder, {withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the application bundle: ${entry.name}`);
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesBelow(path.join(folder, entry.name), name + '/') : [name];
  }).sort();
}

function validateModules(root) {
  for (const file of filesBelow(root).filter(name => name.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const references = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)];
    for (const [, reference] of references) {
      if (reference === 'three') continue;
      if (!reference.startsWith('.')) continue;
      const target = path.resolve(root, path.dirname(file), reference);
      if (path.relative(root, target).startsWith('..') || !fs.existsSync(target))
        throw new Error(`Missing bundled module: ${file} -> ${reference}`);
    }
  }
}

function prepareStudio() {
  const includeBlend = process.env.LAYOUT_STUDIO_INCLUDE_BLEND === '1' || process.argv.includes('--include-blend');
  for (const file of [...required, ...(includeBlend ? ['output/coffee_bar.blend'] : [])]) {
    if (!fs.existsSync(path.join(source, file)))
      throw new Error(`Required desktop asset is missing: ${file}. Restore the tracked runtime assets or rebuild the scene with Blender. See desktop/README.md.`);
    inspectAsset(path.join(source, file));
  }
  // This is our generated staging directory only. Never remove source/output.
  if (path.dirname(destination) !== desktop || path.basename(destination) !== 'studio')
    throw new Error('Unsafe staging directory');
  fs.rmSync(destination, {recursive:true, force:true});
  fs.mkdirSync(destination, {recursive:true});
  const copy = file => {
    const from = path.join(source, file), to = path.join(destination, file);
    fs.mkdirSync(path.dirname(to), {recursive:true});
    fs.copyFileSync(from, to);
  };
  for (const file of ['viewer.html','scene_config.json','output/coffee_bar.glb','output/built_config.json']) copy(file);
  for (const folder of ['editor','vendor','robot-library','me6-bag-station/layout-assets','layouts']) {
    for (const file of filesBelow(path.join(source, folder))) {
      if (/\.(?:js|css|svg|json|glb|txt|png|jpg|woff2?)$/i.test(file)) copy(folder + '/' + file);
    }
  }
  if (includeBlend) copy('output/coffee_bar.blend');
  else {
    // The 108 MB Blender authoring file is optional; current-scene GLB export
    // remains available in every build. Do not leave a broken download link.
    const viewer = path.join(destination, 'viewer.html');
    fs.writeFileSync(viewer, fs.readFileSync(viewer, 'utf8').replace(
      /<a\s+(?:class="advanced-only"\s+)?href="\.\/output\/coffee_bar\.blend"[^>]*>[^<]*<\/a>/,
      '<span class="menu-check advanced-only" title="Build with LAYOUT_STUDIO_INCLUDE_BLEND=1 to bundle the original authoring file">Blender source not bundled · export GLB</span>'
    ));
  }
  validateModules(destination);
  let revision = null;
  try {revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:source, stdio:['ignore','pipe','ignore']}).toString().trim();} catch {}
  const entries = filesBelow(destination).map(file => ({path:file, ...inspectAsset(path.join(destination, file))}));
  const manifest = {
    schema_version:1, version:require('../package.json').version, git_revision:revision,
    source:'Working tree at build time (may include uncommitted changes)',
    blender_source_included:includeBlend, files:entries,
  };
  fs.writeFileSync(path.join(destination, 'desktop-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Prepared ${entries.length} files (${(entries.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(1)} MiB) for Layout Studio.`);
  return manifest;
}

if (require.main === module) prepareStudio();
module.exports = {prepareStudio, inspectAsset, validateModules, filesBelow};
