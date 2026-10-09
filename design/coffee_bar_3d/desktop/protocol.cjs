const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');

const SCHEME = 'layout-studio';
const ORIGIN = `${SCHEME}://studio`;

function resolveAsset(root, address) {
  const url = new URL(address);
  if (url.protocol !== SCHEME + ':' || url.hostname !== 'studio' || url.port || url.username || url.password)
    throw new Error('Invalid application origin');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':'))
    throw new Error('Invalid asset path');
  const relative = pathname === '/' ? 'viewer.html' : pathname.slice(1);
  if (relative.split('/').some(part => part === '..' || part.startsWith('.')))
    throw new Error('Invalid asset path');
  const file = path.resolve(root, relative);
  const inside = path.relative(path.resolve(root), file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Asset outside bundle');
  return file;
}

function contentSecurityPolicy(html) {
  const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(text => text.trim())
    .map(text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'none'",
  ].join('; ');
}

function createAssetHandler(root, netFetch, csp) {
  return async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
    let file;
    try { file = resolveAsset(root, request.url); }
    catch { return new Response('Forbidden', {status:403}); }
    try {
      if (!(await fs.stat(file)).isFile()) return new Response('Not found', {status:404});
      const result = await netFetch(pathToFileURL(file).href);
      const headers = new Headers(result.headers);
      headers.set('Content-Security-Policy', csp);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cache-Control', 'no-cache');
      const mime = {'.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml',
        '.glb':'model/gltf-binary', '.html':'text/html', '.css':'text/css'}[path.extname(file)];
      if (mime) headers.set('Content-Type', mime);
      if (path.extname(file) === '.blend') headers.set('Content-Disposition', 'attachment; filename="coffee_bar.blend"');
      return new Response(request.method === 'HEAD' ? null : result.body, {status:result.status, headers});
    } catch { return new Response('Not found', {status:404}); }
  };
}

module.exports = {SCHEME, ORIGIN, resolveAsset, contentSecurityPolicy, createAssetHandler};
