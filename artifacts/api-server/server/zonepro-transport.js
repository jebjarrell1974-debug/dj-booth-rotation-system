import net from 'net';
import { assertPrivateVenueHost } from './zonepro-core.js';

const queues = new Map();
const health = new Map();

function updateHealth(unitId, patch) {
  const previous = health.get(unitId) || { connected: false, consecutiveFailures: 0 };
  const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
  health.set(unitId, next);
  return next;
}

export function getTransportHealth(unitId) {
  return health.get(unitId) || { connected: false, consecutiveFailures: 0, updatedAt: null };
}

export function serializeForUnit(unitId, operation) {
  const prior = queues.get(unitId) || Promise.resolve();
  const current = prior.catch(() => {}).then(operation);
  queues.set(unitId, current);
  current.finally(() => { if (queues.get(unitId) === current) queues.delete(unitId); }).catch(() => {});
  return current;
}

export function testTcpConnection(unit) {
  assertPrivateVenueHost(unit.host);
  return serializeForUnit(unit.id, () => new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host: unit.host, port: unit.port });
    const timer = setTimeout(() => socket.destroy(new Error('Connection timeout')), unit.connectTimeoutMs);
    const finishError = (error) => {
      clearTimeout(timer);
      const old = getTransportHealth(unit.id);
      updateHealth(unit.id, { connected: false, lastError: error.message, lastFailureAt: new Date().toISOString(), consecutiveFailures: old.consecutiveFailures + 1 });
      reject(error);
    };
    socket.once('error', finishError);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeListener('error', finishError);
      const latencyMs = Date.now() - started;
      updateHealth(unit.id, { connected: true, identityConfirmed: false, latencyMs, lastConnectedAt: new Date().toISOString(), lastError: null, consecutiveFailures: 0 });
      socket.end();
      resolve({ reachable: true, latencyMs, identityConfirmed: false, warning: 'TCP reachability does not confirm a ZonePRO device or firmware.' });
    });
  }));
}

export async function discoverCandidates(candidates, port, timeoutMs = 1000) {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 64) throw new Error('Provide 1-64 explicit candidate hosts');
  const results = await Promise.all(candidates.map(async (host, index) => {
    const unit = { id: `discovery:${index}:${host}:${port}`, host, port, connectTimeoutMs: timeoutMs };
    try { return { host, port, ...(await testTcpConnection(unit)) }; }
    catch (error) { return { host, port, reachable: false, error: error.message, identityConfirmed: false }; }
  }));
  return results;
}