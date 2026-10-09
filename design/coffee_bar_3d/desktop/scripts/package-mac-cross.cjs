const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {prepareStudio} = require('./prepare-studio.cjs');

const desktop = path.resolve(__dirname, '..');
const output = path.join(desktop, 'dist', 'mac-cross');
const work = process.env.LAYOUT_STUDIO_MAC_WORKDIR ? path.resolve(process.env.LAYOUT_STUDIO_MAC_WORKDIR) : output;
if (work !== output && (path.dirname(work) !== path.resolve(os.tmpdir()) || !path.basename(work).startsWith('layout-studio-mac-')))
  throw new Error('Mac build work directory must be a dedicated temporary folder');
const source = path.join(work, 'source');

async function build() {
  const {packager} = await import('@electron/packager');
  const metadata = require('../package.json');
  const fromWindows = process.argv.includes('--from-windows');
  const windowsArchive = path.join(desktop, 'dist/win-unpacked/resources/app.asar');
  if (fromWindows && !fs.existsSync(windowsArchive)) throw new Error('Build the Windows app first.');
  if (!fromWindows) prepareStudio();
  if (path.relative(work, source) !== 'source')
    throw new Error('Unexpected staging path');
  fs.rmSync(source, {recursive:true,force:true});
  fs.mkdirSync(source, {recursive:true});
  if (fromWindows) {
    const {extractAll} = await import('@electron/asar');
    extractAll(windowsArchive, source);
    console.log('Using the previously verified Windows application source snapshot.');
  } else {
    for (const file of ['main.cjs','protocol.cjs']) fs.copyFileSync(path.join(desktop, file), path.join(source, file));
    fs.cpSync(path.join(desktop, 'studio'), path.join(source, 'studio'), {recursive:true});
  }
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name:metadata.name, productName:metadata.productName, version:metadata.version,
    main:metadata.main, description:metadata.description, author:metadata.author,
    license:metadata.license,
  }, null, 2) + '\n');
  // Separate from native electron-builder output: these are unsigned bundles,
  // and are not substitutes for the signed/tested macOS CI releases.
  const paths = await packager({
    dir:source, out:work, name:'Layout Studio', platform:'darwin', arch:['x64','arm64'],
    electronVersion:metadata.devDependencies.electron, appVersion:metadata.version,
    appBundleId:'com.fps.layoutstudio', appCategoryType:'public.app-category.productivity',
    asar:true, prune:false, overwrite:true,
    download:{cacheRoot:path.join(work, 'electron-cache')},
  });
  if (paths.length !== 2) throw new Error('The host could not create both Mac bundles. On Windows use npm run dist:mac:wsl -- --from-windows, or use the native macOS CI build.');
  console.log('Created unsigned Mac application folders:\n' + paths.join('\n'));
  if (process.platform === 'win32') {
    throw new Error('Use WSL to ZIP the Mac bundles with Unix executable permissions and symlinks intact.');
  }
  fs.mkdirSync(output, {recursive:true});
  const archive = spawnSync('python3', [path.join(__dirname, 'zip-mac-bundles.py'), output, metadata.version, ...paths], {stdio:'inherit'});
  if (archive.status !== 0) throw new Error('Mac ZIP creation or validation failed');
}

build().catch(error => {console.error(error); process.exitCode = 1;});
