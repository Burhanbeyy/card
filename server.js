const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const port = Number(process.env.PORT) || 3000;

const dataDir = path.join(__dirname, 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'app.sqlite');

const adminSecret = process.env.ADMIN_SECRET;

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!adminSecret) {
  console.error('Missing ADMIN_SECRET');
  process.exit(1);
}

// ---------------- DB ----------------
function openDatabase() {
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      type TEXT,
      brand TEXT,
      payload TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      message TEXT,
      created_at TEXT
    );
  `);

  return db;
}

const db = openDatabase();

// ---------------- HELPERS ----------------
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function isAdminAuthorized(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const secret = url.searchParams.get('secret');
  return secret === adminSecret;
}

// ---------------- SERVER ----------------
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // ---------- SUBMIT FORM ----------
  if (method === 'POST' && pathname === '/api/submit-form') {
    try {
      const body = await parseBody(req);

      const name = (body.name || '').trim();
      const email = (body.email || '').trim();
      const message = (body.message || '').trim();

      if (!name || !email || !message) {
        return sendJson(res, 400, { ok: false, error: 'Missing fields' });
      }

      db.prepare(`
        INSERT INTO submissions (id, name, email, message, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        Date.now().toString(36),
        name,
        email,
        message,
        new Date().toISOString()
      );

      return sendJson(res, 200, { ok: true });

    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Server error' });
    }
  }

  // ---------- ADMIN PAGE ----------
  if (method === 'GET' && pathname === '/admin') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    }

    const file = fs.readFileSync(path.join(__dirname, 'admin.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(file);
  }

  // ---------- ADMIN SUBMISSIONS PAGE ----------
  if (method === 'GET' && pathname === '/admin/submissions') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    }

    const file = fs.readFileSync(path.join(__dirname, 'admin-submissions.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(file);
  }

  // ---------- API SUBMISSIONS ----------
  if (method === 'GET' && pathname === '/api/submissions') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    }

    const rows = db.prepare(
      'SELECT * FROM submissions ORDER BY created_at DESC'
    ).all();

    return sendJson(res, 200, { ok: true, submissions: rows });
  }

  // ---------- HEALTH ----------
  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  // ---------- DEFAULT ----------
  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});