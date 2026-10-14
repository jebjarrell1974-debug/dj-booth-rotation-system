import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createStaffFixtureApp, fixtureCodes, database, closeStaffFixture } from './test-support/staff-fixture.js';
import { canManageStaff } from './staff-access.js';

const server = createStaffFixtureApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => { await new Promise(resolve => server.close(resolve)); closeStaffFixture(); });
let ip = 0;
// Use separate fixture IPs for independent requests; rate limiting is otherwise
// unchanged. The TCP peer remains actual loopback for the kiosk-only gate.
async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function login(pin) {
  // The limiter is per TCP client; wait rather than bypass its actual guard.
  if (ip++) await new Promise(resolve => setTimeout(resolve, 1020));
  return request('/api/auth/login', { method: 'POST', body: { role: 'dj', pin } });
}
const originalHash = database.getSetting('dj_pin');
const existingToken = database.createSession('dj', null, 'Pre-update Staff', 0, 'dj');
let gm, admin, named, account;

test('existing unit code logs in as GM with unchanged hash and existing session intact', async () => {
  const result = await login(fixtureCodes.gm);
  assert.equal(result.status, 200);
  assert.equal(result.data.role, 'dj');
  assert.equal(result.data.staffRole, 'gm');
  gm = result.data.token;
  assert.equal(database.getSetting('dj_pin'), originalHash);
  assert.equal((await request('/api/auth/session', { token: existingToken })).status, 200);
  assert.equal(canManageStaff(database.getSession(existingToken)), false);
});
test('unchanged admin and pre-existing named manager/DJ codes still work', async () => {
  const root = await login(fixtureCodes.admin);
  assert.equal(root.status, 200); assert.equal(root.data.isMaster, true); admin = root.data.token;
  for (const [pin, role] of [[fixtureCodes.dj, 'dj'], [fixtureCodes.manager, 'manager']]) {
    const result = await login(pin);
    assert.equal(result.status, 200); assert.equal(result.data.role, 'dj');
    assert.equal(result.data.staffRole, role);
    named = result.data.token;
  }
});
test('ordinary manager/DJ/automatic sessions cannot manage accounts or GM code', async () => {
  const automatic = database.createSession('dj', null, 'Auto', 0, 'dj');
  for (const token of [named, existingToken, automatic]) {
    assert.equal((await request('/api/staff', { token })).status, 403);
    assert.equal((await request('/api/staff', { token, method: 'POST', body: { name: 'Forbidden', role: 'dj', pin: '55555' } })).status, 403);
    assert.equal((await request('/api/staff/1', { token, method: 'PUT', body: { name: 'Forbidden', role: 'dj' } })).status, 403);
    assert.equal((await request('/api/staff/1', { token, method: 'DELETE' })).status, 403);
    assert.equal((await request('/api/settings/dj-pin', { token, method: 'POST', body: { pin: '55555' } })).status, 403);
  }
  assert.equal(database.getSetting('dj_pin'), originalHash);
});
test('GM creates named login and neither list nor audit exposes its code/hash', async () => {
  const result = await request('/api/staff', { token: gm, method: 'POST', body: { name: 'New Fixture', role: 'dj', pin: '35791' } });
  assert.equal(result.status, 200); account = result.data;
  const session = await login('35791');
  assert.equal(session.data.staffName, 'New Fixture'); named = session.data.token;
  const list = await request('/api/staff', { token: gm });
  const audit = await request('/api/audit/log', { token: gm });
  assert.ok(audit.data.some(entry => entry.staff_name === 'New Fixture' && entry.action === 'login'));
  for (const data of [result.data, list.data, audit.data]) {
    assert.equal(JSON.stringify(data).includes('35791'), false);
    assert.equal(JSON.stringify(data).includes('pin_hash'), false);
  }
});
test('reserved GM/admin and duplicate staff codes cannot be assigned, including edits', async () => {
  for (const pin of [fixtureCodes.gm, fixtureCodes.admin, fixtureCodes.dj]) {
    const body = { name: 'Conflict', role: 'manager', pin };
    assert.equal((await request('/api/staff', { token: gm, method: 'POST', body })).status, 400);
    assert.equal((await request(`/api/staff/${account.id}`, { token: gm, method: 'PUT', body })).status, 400);
  }
  assert.equal(database.getSetting('dj_pin'), originalHash);
});
test('ADMIN can rename/change a named code without revoking existing operator sessions', async () => {
  const unchanged = await request(`/api/staff/${account.id}`, { token: admin, method: 'PUT', body: { name: 'Renamed Fixture', role: 'manager' } });
  assert.equal(unchanged.status, 200);
  assert.equal((await login('35791')).status, 200);
  const update = await request(`/api/staff/${account.id}`, { token: gm, method: 'PUT', body: { name: 'Renamed Fixture', role: 'manager', pin: '46802' } });
  assert.equal(update.status, 200);
  assert.equal((await request('/api/auth/session', { token: named })).status, 200);
  assert.equal((await request('/api/auth/session', { token: existingToken })).status, 200);
  assert.equal((await login('46802')).data.staffName, 'Renamed Fixture');
  assert.equal(database.getSetting('dj_pin'), originalHash);
});
test('failed logins and malformed account edits do not revoke a valid GM session', async () => {
  assert.equal((await login('00000')).status, 401);
  assert.equal((await request('/api/auth/session', { token: gm })).data.staffRole, 'gm');
  assert.equal((await request(`/api/staff/${account.id}`, { token: gm, method: 'PUT', body: { name: {}, role: 'gm', pin: 12345 } })).status, 400);
  assert.equal((await request('/api/staff/1junk', { token: gm, method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/staff', { token: gm, headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 403);
});
test('removing a named login cannot remove or alter GM/admin unit codes', async () => {
  assert.equal((await request(`/api/staff/${account.id}`, { token: gm, method: 'DELETE' })).status, 200);
  assert.equal((await login(fixtureCodes.gm)).status, 200);
  assert.equal((await login(fixtureCodes.admin)).status, 200);
  assert.equal(database.getSetting('dj_pin'), originalHash);
});

test('existing-code setup path returns GM/ADMIN identity without changing the code', async () => {
  for (const [pin, staffRole] of [[fixtureCodes.gm, 'gm'], [fixtureCodes.admin, 'master']]) {
    const result = await request('/api/settings/dj-pin/init', { method: 'POST', body: { pin } });
    assert.equal(result.status, 200);
    assert.equal(result.data.staffRole, staffRole);
    assert.equal(database.getSession(result.data.token).staff_role, staffRole);
  }
  assert.equal(database.getSetting('dj_pin'), originalHash);
});
test('a pre-existing conflicting staff code cannot shadow the unit GM login', async () => {
  database.createStaffAccount('Old conflicting fixture', 'dj', fixtureCodes.gm);
  const result = await login(fixtureCodes.gm);
  assert.equal(result.status, 200);
  assert.equal(result.data.staffRole, 'gm');
  assert.equal(database.getSetting('dj_pin'), originalHash);
});
