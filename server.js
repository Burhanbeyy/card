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
const adminSecret = process.env.ADMIN_SECRET;
const sessionSecret = process.env.SESSION_SECRET;
const sessions = new Map();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!adminSecret || !sessionSecret) {
  console.error('Missing required environment variables: ADMIN_SECRET, SESSION_SECRET');
  process.exit(1);
}

if (dbType !== 'sqlite') {
  console.error('Unsupported DB_TYPE. Only sqlite is supported in this deployment setup.');
  process.exit(1);
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
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
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

async function sendSubmissionEmail(submission) {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!apiKey || !adminEmail) {
    return;
  }

  try {
    const subject = `New form submission from ${submission.name}`;
    const text = `Name: ${submission.name}\nEmail: ${submission.email}\nMessage:\n${submission.message}\n\nSubmitted: ${submission.createdAt}`;
    const payload = {
      from: 'onboarding@resend.dev',
      to: [adminEmail],
      subject,
      text
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(errorText || `Resend returned ${response.status}`);
    }
  } catch (err) {
    console.error('Failed to send submission email via Resend:', err && err.message ? err.message : err);
  }
}

const server = http.createServer(async (req, res) => {
  const { method, url = '/' } = req;
  const pathname = new URL(url, `http://${req.headers.host || '127.0.0.1'}`).pathname;

  if (method === 'POST' && pathname === '/api/submit-form') {
    try {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const email = (body.email || '').trim();
      const message = (body.message || '').trim();

      if (!name || !email || !message) {
        sendJson(res, 400, { ok: false, error: 'Name, email and message are required' });
        return;
      }

      const submission = {
        id: Date.now().toString(36),
        name,
        email,
        message,
        createdAt: new Date().toISOString()
      };

      db.prepare('INSERT INTO submissions (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
        submission.id,
        submission.name,
        submission.email,
        submission.message,
        submission.createdAt
      );

      sendJson(res, 200, { ok: true, message: 'Submission saved' });
      // Attempt to notify admin asynchronously; failures should not affect the response
      try {
        sendSubmissionEmail(submission).catch((err) => console.error('Email send error:', err && err.message ? err.message : err));
      } catch (err) {
        console.error('Failed to start email send:', err && err.message ? err.message : err);
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
    const providedSecret = req.headers['x-admin-secret'];
    if (providedSecret !== adminSecret) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
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
    const providedSecret = req.headers['x-admin-secret'];
    if (providedSecret !== adminSecret) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }
    serveStatic(req, res, 'admin.html');
    return;
  }

  if (method === 'GET' && pathname === '/admin/submissions') {
    const providedSecret = req.headers['x-admin-secret'];
    if (providedSecret !== adminSecret) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }
    serveStatic(req, res, 'admin-submissions.html');
    return;
  }

  if (method === 'GET' && pathname === '/api/submissions') {
    const providedSecret = req.headers['x-admin-secret'];
    if (providedSecret !== adminSecret) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }
    const rows = db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all();
    sendJson(res, 200, { ok: true, submissions: rows });
    return;
  }

  if (method === 'GET' && pathname === '/login') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  if (method === 'GET' && pathname === '/signup') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
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
