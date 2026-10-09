const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const folder = path.resolve(__dirname, '../dist');
const files = fs.readdirSync(folder).filter(name => /\.(exe|dmg|zip)$/.test(name)).sort();
if (!files.length) throw new Error('No installers or archives found in dist.');
const lines = files.map(name => createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex') + '  ' + name);
fs.writeFileSync(path.join(folder, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log('Wrote SHA256SUMS.txt for ' + files.length + ' artifacts.');
