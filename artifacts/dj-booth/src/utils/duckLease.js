import {
  DUCK_COMMAND_TIMEOUT_MS,
  DUCK_HEARTBEAT_MS,
  DUCK_LEASE_MS,
} from './ducking.js';

const randomToken = prefix => (
  globalThis.crypto?.randomUUID?.() ||
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const defaultLeaseId = () => randomToken('duck');
const defaultClientId = () => randomToken('duckclient');

/**
 * Drives acquire → renew → release for a command-only remote.
 *
 * Letting go must never be held up by something that has not been sent yet. Two things
 * used to do exactly that:
 *   * the release waited for the acquire to be ACKNOWLEDGED by the kiosk;
 *   * once that was fixed, it waited on a rolling "last issued" promise, which a queued
 *     heartbeat overwrote - and that heartbeat was itself waiting for the acquire's
 *     acknowledgement, so a slow acquire still blocked the release indefinitely.
 *
 * Now the release is ordered behind ONE thing only: the acquire's own send() having been
 * called. Renewals are serialised among themselves, are cancelled the moment the hold
 * ends, and can never delay or outlive it.
 *
 * Ordering on the wire is not assumed. Two requests in flight at once can still reach the
 * server in either order, so the kiosk decides by identity rather than by arrival: every
 * hold carries {clientId, holdSeq}, and an acquire that is not newer than the last hold
 * released for that client is refused. See utils/duckHoldGuard.js.
 */
export function createRemoteDuckLease({
  send,
  leaseMs = DUCK_LEASE_MS,
  heartbeatMs = DUCK_HEARTBEAT_MS,
  commandTimeoutMs = DUCK_COMMAND_TIMEOUT_MS,
  leaseIdFactory = defaultLeaseId,
  clientIdFactory = defaultClientId,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer),
  onError = () => {},
} = {}) {
  if (typeof send !== 'function') throw new Error('A remote duck command sender is required');

  // Regenerated on every page load, so a reloaded remote starts a fresh sequence
  // instead of being locked out by the holds its previous session released.
  const clientId = String(clientIdFactory());

  let leaseId = null;
  let state = 'idle';
  let heartbeatTimer = null;
  let holdSeq = 0;        // monotonic within this client session
  let holdEpoch = 0;      // bumped when a hold ends; cancels that hold's queued renewals
  let acquireIssued = Promise.resolve();
  let acquirePromise = Promise.resolve(null);
  let renewChain = Promise.resolve();
  let stopPromise = null;

  const dispatch = (action, payload) => (
    Promise.resolve(send(action, payload, { timeoutMs: commandTimeoutMs }))
  );

  // Errors are reported for the hold that raised them only. onError tears the lease down
  // at both call sites, so letting a finished hold's failure through would kill the hold
  // the operator is pressing right now.
  const report = (promise, action, epoch) => {
    promise.catch(error => {
      if (epoch !== holdEpoch) return;
      try { onError(error, action); } catch {}
    });
    return promise;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer != null) clearTimer(heartbeatTimer);
    heartbeatTimer = null;
  };

  const heartbeat = () => {
    if (state !== 'held' || !leaseId) return;
    const epoch = holdEpoch;
    const id = leaseId;
    const seq = holdSeq;
    const queued = renewChain.then(() => {
      // Cancellation point. A renewal still queued when the hold ends is DROPPED, not
      // sent: re-asserting a finished hold would be a replay, and nothing the operator
      // has already let go of may produce another request.
      if (state !== 'held' || holdEpoch !== epoch || leaseId !== id) return null;
      return dispatch('renewDuck', { leaseId: id, clientId, holdSeq: seq, leaseMs });
    });
    renewChain = queued.catch(() => {});
    report(queued, 'renewDuck', epoch);
    return queued;
  };

  const start = () => {
    if (state !== 'idle') return acquirePromise;
    holdEpoch += 1;
    holdSeq += 1;
    const epoch = holdEpoch;
    const seq = holdSeq;
    const id = String(leaseIdFactory());
    leaseId = id;
    state = 'held';

    let markIssued;
    acquireIssued = new Promise(resolve => { markIssued = resolve; });
    let acquired;
    try {
      acquired = dispatch('acquireDuck', { leaseId: id, clientId, holdSeq: seq, leaseMs });
    } catch (error) {
      acquired = Promise.reject(error);
    } finally {
      // Issued = this hold's request is on its way. The release is ordered behind this
      // and nothing else.
      markIssued();
    }
    acquirePromise = acquired;
    // Renewals still follow the acquire, which is correct: a renew the kiosk sees before
    // the acquire has no owner to renew. Only the release is exempt.
    renewChain = acquired.catch(() => {});
    heartbeatTimer = setTimer(heartbeat, heartbeatMs);
    return report(acquired, 'acquireDuck', epoch);
  };

  const stop = async (reason = 'release') => {
    if (state === 'idle') return null;
    if (stopPromise) return stopPromise;
    state = 'releasing';
    stopHeartbeat();
    // Invalidate every renewal this hold still has queued, before anything can await.
    holdEpoch += 1;
    const id = leaseId;
    const seq = holdSeq;
    const issued = acquireIssued;
    leaseId = null;
    stopPromise = (async () => {
      try {
        if (!id) return null;
        await issued;
        try {
          return await dispatch('releaseDuck', { leaseId: id, clientId, holdSeq: seq, reason });
        } catch {
          // The kiosk's bounded lease expiry remains the final safety net when the
          // disconnect also prevents the release from reaching it.
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
    getClientId: () => clientId,
    getHoldSeq: () => holdSeq,
    heartbeat,
    // Disposal is still an ordered release. Dropping the token here would strand an
    // active kiosk owner until lease expiry.
    dispose: () => stop('dispose'),
  };
}