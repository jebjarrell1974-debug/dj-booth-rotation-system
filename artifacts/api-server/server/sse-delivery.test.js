import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import compression from 'compression';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import vm from 'node:vm';

// Supplemental: execute the exact product SSE handler/broadcaster under the
// actual compression middleware. Fixture sessions are not full-server auth proof.
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const start = source.indexOf('const sseClients = new Set();');
const end = source.indexOf('// Live booth state endpoints', start);
assert.ok(start >= 0 && end > start, 'missing product SSE handler');
const app = express();
app.use(compression());
const context = vm.createContext({
  app, setInterval, clearInterval,
  getSession: token => token === 'synthetic-session' ? { role: 'dancer' } : null,
  isPhysicalKioskRequest: () => false,
});
vm.runInContext(source.slice(start, end), context);
app.get('/ordinary', (_req, res) => res.json({ text: 'ordinary content '.repeat(200) }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('gzip-capable SSE clients immediately receive connected and small music events without compression', async () => {
  const response = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/booth/events?token=synthetic-session`, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
    }, resolve);
    req.setTimeout(1000, () => req.destroy(new Error('SSE headers/first frame did not arrive within 1 second')));
    req.once('error', reject);
    req.end();
  });
  try {
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/event-stream/);
    assert.match(response.headers['cache-control'], /no-transform/);
    assert.equal(response.headers['content-encoding'], undefined);
    let bytes = '';
    response.on('data', chunk => { bytes += chunk.toString(); });
    async function until(predicate) {
      const deadline = Date.now() + 1000;
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      assert.ok(predicate(), `small SSE frame not received promptly: ${bytes}`);
    }
    await until(() => bytes.includes('"connected"'));
    context.broadcastSSE('musicBlocked', { trackName: 'synthetic.wav' });
    await until(() => bytes.includes('"musicBlocked"'));
    context.broadcastSSE('musicUnblocked', { trackName: 'synthetic.wav' });
    await until(() => bytes.includes('"musicUnblocked"'));
    assert.equal(bytes.match(/"musicBlocked"/g).length, 1);
    assert.equal(bytes.match(/"musicUnblocked"/g).length, 1);
  } finally { response.destroy(); }
});

test('SSE authorization remains enforced and ordinary responses still compress', async () => {
  assert.equal((await fetch(`${base}/api/booth/events`)).status, 401);
  assert.equal((await fetch(`${base}/api/booth/events?token=invalid`)).status, 401);
  const ordinary = await fetch(`${base}/ordinary`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(ordinary.headers.get('content-encoding'), 'gzip');
  assert.equal((await ordinary.json()).text, 'ordinary content '.repeat(200));
});
