const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dataDir = path.join(root, 'database');
const port = Number(process.env.PORT) || 8080;

const COLLECTIONS = new Set([
  'institution.json',
  'schemes.json',
  'products.json',
  'cards.json',
  'token-requestors.json',
  'eligibility.json',
  'risk-score-bands.json',
  'risk-reason-rules.json',
  'stepup.json',
  'templates.json',
  'auth-rules.json',
  'limits.json',
  'response-codes.json',
  'reason-codes.json',
  'cascade-rules.json',
  'tokens.json',
  'transactions.json',
  'audits.json',
  'users.json'
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8'
};

function inside(parent, target) {
  const rel = path.relative(parent, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readMeta() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
    if (!meta || typeof meta !== 'object') throw new Error('bad meta');
    meta.revision = Number(meta.revision) || 0;
    meta.files = meta.files && typeof meta.files === 'object' ? meta.files : {};
    return meta;
  } catch (e) {
    return { revision: 0, updatedAt: null, files: {} };
  }
}

function replaceFile(dest, text) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, text);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.writeFileSync(dest, text);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function writeMeta(meta) {
  replaceFile(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const target = path.resolve(root, '.' + rel);
  if (!inside(root, target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/database/')) {
    send(res, 204, '');
    return;
  }
  if (url.pathname.startsWith('/database/')) {
    const name = path.basename(url.pathname);
    if (name !== path.basename(url.pathname) || name.includes('..')) {
      send(res, 400, 'Bad file');
      return;
    }
    if (req.method === 'GET' && name === 'meta.json') {
      if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
        send(res, 404, 'Not found', 'application/json; charset=utf-8');
        return;
      }
      send(res, 200, JSON.stringify(readMeta()), 'application/json; charset=utf-8');
      return;
    }
    if (!COLLECTIONS.has(name)) {
      send(res, 404, 'Not found', 'application/json; charset=utf-8');
      return;
    }
    const dest = path.join(dataDir, name);
    if (req.method === 'GET') {
      if (!fs.existsSync(dest)) {
        send(res, 404, 'Not found', 'application/json; charset=utf-8');
        return;
      }
      send(res, 200, fs.readFileSync(dest), 'application/json; charset=utf-8');
      return;
    }
    if (req.method === 'PUT') {
      try {
        const text = await readBody(req);
        const data = JSON.parse(text);
        if (!Array.isArray(data)) {
          send(res, 400, 'Collection must be a JSON array', 'application/json; charset=utf-8');
          return;
        }
        replaceFile(dest, JSON.stringify(data, null, 2));
        const meta = readMeta();
        meta.revision += 1;
        meta.updatedAt = new Date().toISOString();
        meta.files[name] = meta.revision;
        writeMeta(meta);
        send(res, 200, JSON.stringify(meta), 'application/json; charset=utf-8');
      } catch (e) {
        send(res, 400, 'Invalid JSON', 'application/json; charset=utf-8');
      }
      return;
    }
    send(res, 405, 'Method not allowed');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }
  serveStatic(req, res, url.pathname);
});

fs.mkdirSync(dataDir, { recursive: true });

server.listen(port, () => {
  console.log('IRIS Tokenization Operations Portal at http://127.0.0.1:' + port);
  console.log('Shared JSON folder: /database');
});
