const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.join(__dirname, '..');
const dataFile = path.join(projectRoot, 'data', 'requests.sqlite');

function resetDataFile() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  if (fs.existsSync(dataFile)) {
    try {
      fs.rmSync(dataFile);
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
  }
}

function readStoredRows() {
  const db = new DatabaseSync(dataFile);
  const rows = db.prepare('SELECT type, brand FROM requests ORDER BY created_at').all();
  db.close();
  return rows;
}

function startServer() {
  const port = 3100 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: 'test-session-secret',
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.port = port;
  return child;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[server:error] ${chunk}`);
  });

  return child;
}

test('POST /api/validate saves a validation request', async () => {
  resetDataFile();
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const response = await fetch(`http://127.0.0.1:${child.port}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'Amazon',
        currency: 'USD',
        amount: '100',
        code: 'ABC123',
        pin: '1111'
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.type, 'validate');

    const stored = readStoredRows();
    assert.equal(stored.filter((row) => row.type === 'validate').length, 1);
    assert.equal(stored.find((row) => row.type === 'validate').brand, 'Amazon');
  } finally {
    child.kill('SIGTERM');
  }
});

test('POST /api/purchase saves a purchase request', async () => {
  resetDataFile();
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const response = await fetch(`http://127.0.0.1:${child.port}/api/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'Apple',
        amount: 100,
        quantity: 1,
        sendAsGift: false
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.type, 'purchase');

    const stored = readStoredRows();
    assert.equal(stored.filter((row) => row.type === 'purchase').length, 1);
    assert.equal(stored.find((row) => row.type === 'purchase').brand, 'Apple');
  } finally {
    child.kill('SIGTERM');
  }
});

test('POST /api/login authenticates the admin user and protects /api/requests', async () => {
  resetDataFile();
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const loginResponse = await fetch(`http://127.0.0.1:${child.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' })
    });

    assert.equal(loginResponse.status, 200);
    const loginPayload = await loginResponse.json();
    assert.equal(loginPayload.ok, true);

    const cookie = loginResponse.headers.get('set-cookie') || '';
    assert.match(cookie, /admin_session=/);

    const requestsResponse = await fetch(`http://127.0.0.1:${child.port}/api/requests`, {
      headers: { Cookie: cookie }
    });

    assert.equal(requestsResponse.status, 200);
  } finally {
    child.kill('SIGTERM');
  }
});
