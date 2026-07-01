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
      ADMIN_SECRET: 'test-admin-secret',
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

test('GET /api/requests requires the admin secret header', async () => {
  resetDataFile();
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const deniedResponse = await fetch(`http://127.0.0.1:${child.port}/api/requests`);
    assert.equal(deniedResponse.status, 403);

    const allowedResponse = await fetch(`http://127.0.0.1:${child.port}/api/requests`, {
      headers: { 'x-admin-secret': 'test-admin-secret' }
    });
    assert.equal(allowedResponse.status, 200);
  } finally {
    child.kill('SIGTERM');
  }
});

test('GET / exposes no signup or login links on the homepage', async () => {
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const response = await fetch(`http://127.0.0.1:${child.port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /href="\/signup"/i);
    assert.doesNotMatch(html, /href="\/login"/i);
  } finally {
    child.kill('SIGTERM');
  }
});

test('GET /signup and /login are disabled', async () => {
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const signupResponse = await fetch(`http://127.0.0.1:${child.port}/signup`);
    assert.equal(signupResponse.status, 404);

    const loginResponse = await fetch(`http://127.0.0.1:${child.port}/login`);
    assert.equal(loginResponse.status, 404);
  } finally {
    child.kill('SIGTERM');
  }
});

test('GET /admin requires the admin secret header', async () => {
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const unauthorized = await fetch(`http://127.0.0.1:${child.port}/admin`);
    assert.equal(unauthorized.status, 403);

    const authorized = await fetch(`http://127.0.0.1:${child.port}/admin`, {
      headers: { 'x-admin-secret': 'test-admin-secret' }
    });
    assert.equal(authorized.status, 200);
  } finally {
    child.kill('SIGTERM');
  }
});

test('POST /api/submit-form stores submissions and /api/submissions requires auth', async () => {
  resetDataFile();
  const child = startServer();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const submitResponse = await fetch(`http://127.0.0.1:${child.port}/api/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@example.com',
        message: 'Hello from the test suite'
      })
    });

    assert.equal(submitResponse.status, 200);
    const submitPayload = await submitResponse.json();
    assert.equal(submitPayload.ok, true);

    const db = new DatabaseSync(dataFile);
    const stored = db.prepare('SELECT name, email, message FROM submissions').all();
    db.close();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, 'Jane Doe');

    const unauthenticatedResponse = await fetch(`http://127.0.0.1:${child.port}/api/submissions`);
    assert.equal(unauthenticatedResponse.status, 403);

    const authenticatedResponse = await fetch(`http://127.0.0.1:${child.port}/api/submissions`, {
      headers: { 'x-admin-secret': 'test-admin-secret' }
    });
    assert.equal(authenticatedResponse.status, 200);
    const payload = await authenticatedResponse.json();
    assert.equal(payload.submissions.length, 1);
  } finally {
    child.kill('SIGTERM');
  }
});
