import {
  DUCK_COMMAND_TIMEOUT_MS,
  DUCK_HEARTBEAT_MS,
  DUCK_LEASE_MS,
} from './ducking.js';

const defaultLeaseId = () => (
  globalThis.crypto?.randomUUID?.() ||
  `duck-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

/**
 * Serializes acquire → renew → release for a command-only remote. Release is
 * appended after every already-started heartbeat, so a late renewal can never
 * reassert a lease after the user lets go.
 */
export function createRemoteDuckLease({
  send,
  leaseMs = DUCK_LEASE_MS,
  heartbeatMs = DUCK_HEARTBEAT_MS,
  commandTimeoutMs = DUCK_COMMAND_TIMEOUT_MS,
  leaseIdFactory = defaultLeaseId,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer),
  onError = () => {},
} = {}) {
  if (typeof send !== 'function') throw new Error('A remote duck command sender is required');

  let leaseId = null;
  let state = 'idle';
  let heartbeatTimer = null;
  let commandChain = Promise.resolve();
  let stopPromise = null;

  const enqueue = (action, payload, { reportError = true } = {}) => {
    const command = () => Promise.resolve().then(() => send(
      action,
      payload,
      { timeoutMs: commandTimeoutMs },
    ));
    commandChain = commandChain.catch(() => {}).then(command);
    const result = commandChain;
    if (reportError) {
      result.catch(error => {
        try { onError(error, action); } catch {}
      });
    }
    return result;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer != null) clearTimer(heartbeatTimer);
    heartbeatTimer = null;
  };

  const heartbeat = () => {
    if (state !== 'held' || !leaseId) return;
    enqueue('renewDuck', { leaseId, leaseMs }, { reportError: true }).catch(() => {});
  };

  const start = () => {
    if (state !== 'idle') return commandChain;
    leaseId = String(leaseIdFactory());
    state = 'held';
    const id = leaseId;
    const acquired = enqueue('acquireDuck', { leaseId: id, leaseMs }, { reportError: true });
    heartbeatTimer = setTimer(heartbeat, heartbeatMs);
    return acquired;
  };

  const stop = async (reason = 'release') => {
    if (state === 'idle') return null;
    if (stopPromise) return stopPromise;
    state = 'releasing';
    stopHeartbeat();
    const id = leaseId;
    leaseId = null;
    stopPromise = (async () => {
      // commandChain includes acquire and every heartbeat that was already
      // scheduled. A failed acquire still permits the release no-op to be sent.
      await commandChain.catch(() => {});
      try {
        if (!id) return null;
        const released = enqueue('releaseDuck', { leaseId: id, reason }, { reportError: false });
        try {
          return await released;
        } catch {
          // The kiosk's lease expiry remains the final safety net when the
          // disconnect also prevents the release command from reaching it.
          return null;
        }
      } finally {
        state = 'idle';
        stopPromise = null;
      }
    })();
    return stopPromise;
  };

  return {
    start,
    stop,
    isHeld: () => state === 'held',
    getState: () => state,
    getLeaseId: () => leaseId,
    heartbeat,
    // Disposal is still an ordered release. Dropping the token here would
    // strand an active kiosk owner until lease expiry.
    dispose: () => stop('dispose'),
  };
}