"""Vendor the pinned browser build; verify npm's integrity before reading files."""
from pathlib import Path
import base64, hashlib, io, json, tarfile, urllib.request

HERE = Path(__file__).resolve().parent
metadata = json.load(urllib.request.urlopen('https://registry.npmjs.org/@dimforge/rapier3d-compat/0.19.3'))
archive = urllib.request.urlopen(metadata['dist']['tarball']).read()
assert metadata['dist']['integrity'] == 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
    for name in ['rapier.mjs', 'package.json']:
        data = package.extractfile('package/' + name).read()
        (HERE / ('rapier.js' if name == 'rapier.mjs' else name)).write_bytes(data)
license_url = 'https://raw.githubusercontent.com/dimforge/rapier.js/' + metadata.get('gitHead', 'master') + '/LICENSE'
license_text = urllib.request.urlopen(license_url).read()
assert b'Apache License' in license_text
(HERE / 'LICENSE').write_bytes(license_text)
(HERE / 'source.json').write_text(json.dumps({
    'package': metadata['name'], 'version': metadata['version'], 'license': metadata['license'],
    'tarball': metadata['dist']['tarball'], 'integrity': metadata['dist']['integrity'],
    'module_sha256': hashlib.sha256((HERE/'rapier.js').read_bytes()).hexdigest(),
    'browser_module': 'rapier.js (unchanged rapier.mjs contents; .js serves with the correct MIME type on Windows)',
    'license_url': license_url,
}, indent=2), encoding='utf-8')
print('Vendored Rapier 0.19.3; npm archive integrity verified.')
