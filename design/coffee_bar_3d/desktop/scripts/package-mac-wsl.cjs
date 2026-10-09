const {spawnSync} = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'win32') throw new Error('This launcher is for Windows with an existing WSL distribution.');
const distribution = process.env.LAYOUT_STUDIO_WSL_DISTRO || 'Ubuntu-22.04';
const common = ['--distribution', distribution, '--exec'];
const converted = spawnSync('wsl.exe', [...common, 'wslpath', '-u', path.resolve(__dirname, '..')], {encoding:'utf8'});
if (converted.status !== 0) throw new Error('Cannot locate the desktop project inside WSL: ' + converted.stderr);
const folder = converted.stdout.trim();
const result = spawnSync('wsl.exe', ['--distribution', distribution, '--cd', folder, '--exec',
  'python3', 'scripts/package-mac-wsl.py', ...process.argv.slice(2)], {stdio:'inherit'});
process.exitCode = result.status ?? 1;
