/**
 * Shared command feedback for BOTH remote surfaces.
 *
 * `RemoteView` - the PHONE remote - grew a confirmed-success / visible-error /
 * unknown-outcome banner. The DESKTOP remote is not RemoteView: it is DJBooth.jsx
 * itself rendered with `remoteMode` true, and it never had any of that. Its controls
 * call `boothApi.sendCommand(...)` and discard the promise, so a rejected command
 * vanished, an unknown outcome vanished, and a working button was indistinguishable
 * from a dead one. That is the surface the operator reported broken.
 *
 * The behaviour therefore lives here ONCE and both surfaces call it.
 *
 * ## Why this is an entry store and not three strings
 *
 * The first version kept one `notice`, one `error` and one `unknown` string shared by
 * every command, so outcomes trampled each other:
 *
 *   VIP timeout -> "checking the kiosk..."
 *   an unrelated Add succeeds -> its success banner HIDES the VIP check
 *   the VIP lookup returns no-record -> uncertainty warning appears
 *   an unrelated setVolume succeeds -> clears the VIP warning entirely
 *
 * An operator could be left with no trace that a VIP command was never confirmed.
 * Every call now owns an entry keyed by its own id and tagged with its action and
 * originating requestId. Nothing - no success, no failure, no expiry timer, no
 * reconciliation completion - may touch an entry that is not its own. Unresolved
 * outcomes are sticky until the operator dismisses them, and the view always reports
 * how many remain so none can be silently lost.
 *
 * ## Colour is not certainty
 *
 * `kind` is what the banner looks like. `certainty` is whether the outcome was ever
 * established. They are NOT the same axis, and treating them as one cost us a second
 * defect: `no-record`, `pending` and `unreachable` are stored red, next to confirmed
 * kiosk refusals, so the entry cap happily evicted genuine uncertainties. Only entries
 * whose outcome is KNOWN - success notices and confirmed failures - may ever be pruned.
 * An unresolved entry survives until it is positively resolved or explicitly dismissed,
 * even if that means exceeding `maxEntries`.
 *
 * ## The banner is temporary; the record is not
 *
 * Every entry carries `bannerUntil`. The banner shows the most important entry that is
 * still within its window - routine successes for `noticeMs`, problems for `errorMs` -
 * and then stops showing it WITHOUT destroying it. Notices and confirmed failures are
 * dropped on expiry because their outcome is known; an UNRESOLVED entry is retained and
 * stays counted, so the operator can still find it after the banner has gone. That is
 * what makes auto-expiring error banners safe.
 */

export const COMMAND_NOTICES = {
  // structural / rotation
  addDancerToRotation: 'Added to rotation.',
  removeDancerFromRotation: 'Removed from rotation.',
  moveInRotation: 'Rotation reordered.',
  updateRotation: 'Rotation updated.',
  saveRotation: 'Rotation saved.',
  updateSongAssignments: 'Songs updated.',
  saveRotationWorkspace: 'Rotation saved.',
  updateInterstitialSongs: 'Break songs updated.',
  placeFeature: 'Feature placed.',
  cancelFeaturePlacement: 'Feature placement cancelled.',
  // playback
  // Deliberately NOT "Rotation started." - the kiosk may queue the start behind the
  // song that is playing, and the receipt is `ok` either way. The Start control itself
  // shows the real state ("Starting after this song" / "Stop Rotation"); this line only
  // confirms the command reached the booth.
  startRotation: 'Start sent to the kiosk.',
  stopRotation: 'Rotation stopped.',
  skip: 'Skipped.',
  playLibraryTrack: 'Track queued at the kiosk.',
  deactivateTrack: 'Track deactivated.',
  // VIP
  sendToVip: 'Sent to VIP.',
  releaseFromVip: 'Released from VIP.',
  // commercials / promos
  swapPromo: 'Commercial swapped.',
  skipCommercial: 'Commercial skipped.',
  setCommercialFreq: 'Commercial frequency updated.',
  // announcements / audio
  toggleAnnouncements: 'Announcements toggled.',
  playHouseAnnouncement: 'Announcement played at the kiosk.',
  playFeatureAudio: 'Feature audio played at the kiosk.',
  playSound: 'Sound played at the kiosk.',
  resetDancerVoiceovers: 'Voiceovers reset.',
  // options
  setSongsPerSet: 'Songs per set updated.',
  setBreakSongsPerSet: 'Break songs per set updated.',
  setAutoplayAutoFill: 'Autoplay auto-fill updated.',
  setAutoplayQueue: 'Autoplay queue updated.',
};

/**
 * Operator-facing name for an action. An unresolved outcome is reported with this in
 * front of it, so "which action is uncertain?" is answerable from the banner alone.
 */
export const COMMAND_LABELS = {
  addDancerToRotation: 'Add to rotation',
  removeDancerFromRotation: 'Remove from rotation',
  moveInRotation: 'Reorder rotation',
  updateRotation: 'Update rotation',
  saveRotation: 'Save rotation',
  updateSongAssignments: 'Song change',
  saveRotationWorkspace: 'Save All',
  updateInterstitialSongs: 'Break songs',
  placeFeature: 'Place feature',
  cancelFeaturePlacement: 'Cancel feature',
  startRotation: 'Start rotation',
  stopRotation: 'Stop rotation',
  skip: 'Skip',
  playLibraryTrack: 'Play track',
  deactivateTrack: 'Deactivate track',
  sendToVip: 'Send to VIP',
  releaseFromVip: 'Release from VIP',
  swapPromo: 'Swap commercial',
  skipCommercial: 'Skip commercial',
  setCommercialFreq: 'Commercial frequency',
  toggleAnnouncements: 'Toggle announcements',
  playHouseAnnouncement: 'House announcement',
  playFeatureAudio: 'Feature audio',
  playSound: 'Play sound',
  resetDancerVoiceovers: 'Reset voiceovers',
  setSongsPerSet: 'Songs per set',
  setBreakSongsPerSet: 'Break songs per set',
  setAutoplayAutoFill: 'Autoplay auto-fill',
  setAutoplayQueue: 'Autoplay queue',
  setVolume: 'Volume',
  setVoiceGain: 'Voice level',
};

export function labelForAction(action) {
  if (COMMAND_LABELS[action]) return COMMAND_LABELS[action];
  const spaced = String(action || 'Command').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Controls whose own reading is the confirmation: the number beside them is rendered
 * from the kiosk's published state, so it only moves when the command applied. A
 * toast for each press of a +/- button would be noise. Failures and unconfirmed
 * outcomes are STILL surfaced - only the success notice is suppressed.
 */
export const SILENT_SUCCESS_ACTIONS = new Set(['setVolume', 'setVoiceGain']);

export function noticeForAction(action) {
  return COMMAND_NOTICES[action] || 'Applied by the kiosk.';
}

/**
 * A resolved promise is NOT proof of anything. The phone remote's raw sender RESOLVES
 * null on failure, and the server marks a receipt `ok: command.status === 'applied'`.
 * Success may only be claimed on a receipt the kiosk actually confirmed.
 */
export function isConfirmedApplication(result) {
  return !!result && result.ok === true;
}

/**
 * Turn a reconciliation result into what the operator should be told.
 *
 * `kind` drives the banner COLOUR. `certainty` is a different question - did we ever
 * establish what happened? - and it is what decides whether an entry may be evicted.
 * Conflating the two is how an unresolved outcome got pruned away: `no-record`,
 * `pending` and `unreachable` are all red, but none of them is a settled answer.
 *
 *   certainty 'confirmed'  - a settled receipt said applied, or said failed
 *   certainty 'unresolved' - we could not establish the outcome
 */
export function describeReconciledOutcome(result, action) {
  if (result?.outcome === 'applied') {
    return { kind: 'notice', certainty: 'confirmed', message: noticeForAction(action) };
  }
  if (result?.outcome === 'failed') {
    return { kind: 'error', certainty: 'confirmed', message: result.error || 'The kiosk did not apply that action.' };
  }
  if (result?.outcome === 'pending') {
    // Checking is bounded. The command WAS seen queued, so this is the one unconfirmed
    // case where something definite is known - it had not been applied yet when checking
    // stopped. Still no claim about the final outcome.
    return {
      kind: 'error',
      certainty: 'unresolved',
      message: 'Still queued at the kiosk when checking stopped. Could not confirm whether this action was applied. Check the current booth state before trying again.',
    };
  }
  // Everything below is an outcome that could NOT be confirmed. The reason is reported
  // because it helps the operator judge what to look at, but none of these may claim
  // that the command did or did not apply.
  //
  // In particular a missing record is NOT proof that the command never arrived: the
  // de-duplication entry can have expired, the server can have restarted and lost it, or
  // the lookup can be answering for a different server instance. Saying "nothing was
  // applied, safe to try again" on that basis invites a DUPLICATE of a command that may
  // already have run.
  const UNCONFIRMED = 'Could not confirm whether this action was applied. Check the current booth state before trying again.';
  const unresolved = (message) => ({ kind: 'error', certainty: 'unresolved', message });
  switch (result?.reason) {
    case 'server-restarted':
      return unresolved(`The booth server restarted. ${UNCONFIRMED}`);
    case 'no-record':
      return unresolved(`The kiosk has no record of that request. ${UNCONFIRMED}`);
    case 'identity-mismatch':
      return unresolved(`The kiosk returned a different command. ${UNCONFIRMED}`);
    case 'dedupe-expired':
      return unresolved(`The kiosk no longer holds a record of that request. ${UNCONFIRMED}`);
    default:
      return unresolved(`Could not reach the kiosk to check. ${UNCONFIRMED}`);
  }
}

export const EMPTY_COMMAND_VIEW = Object.freeze({
  // the transient banner - null when nothing is currently worth showing
  kind: null,
  certainty: null,
  id: null,
  action: null,
  requestId: null,
  message: '',
  extra: '',
  // retained state, independent of whether a banner is on screen
  noticeCount: 0,
  pendingCount: 0,
  errorCount: 0,
  unresolvedCount: 0,
  entries: Object.freeze([]),
});

/**
 * Build the command feedback store. Returns `{ surface, dismiss, dismissAll, snapshot }`.
 *
 * `surface(action, promise)` wraps one command. `onChange(view)` is called with the
 * banner view whenever anything changes.
 *
 * `reconcile(context)` must be READ ONLY - discovering an outcome may never create a
 * second command. Callers pass boothApi.reconcileCommand, which looks the command up by
 * its original requestId, scoped to the authenticated actor. Nothing here ever resends.
 */
/**
 * An entry is unresolved when nothing ever established what the kiosk did with it.
 * In-flight checks count, and so do the red "could not confirm" outcomes - `no-record`,
 * `pending`, `unreachable`, a restarted server, an expired de-duplication record. A
 * confirmed refusal does not: the kiosk told us it did not apply.
 */
export function isUnresolved(entry) {
  if (!entry) return false;
  if (entry.kind === 'unknown') return true;
  return entry.certainty === 'unresolved';
}

export function createCommandFeedback({
  onChange,
  reconcile,
  noticeMs = 2500,
  // Problems get a longer read than a routine success, then clear themselves. No
  // permanent red bar, and no mandatory series of Dismiss clicks.
  errorMs = 6000,
  schedule = (fn, ms) => setTimeout(fn, ms),
  now = () => Date.now(),
  maxEntries = 24,
} = {}) {
  let seq = 0;
  /** @type {Map<number, {id:number, action:string, requestId:string|null, kind:'notice'|'unknown'|'error', message:string, at:number}>} */
  const entries = new Map();

  function buildView() {
    const t = now();
    const all = [...entries.values()];
    const errors = all.filter(e => e.kind === 'error');
    const pending = all.filter(e => e.kind === 'unknown');
    const notices = all.filter(e => e.kind === 'notice');
    // Certainty, NOT colour. An in-flight check and a red "could not confirm" are both
    // unresolved; a kiosk refusal is red but perfectly resolved.
    const unresolved = all.filter(isUnresolved);
    const unresolvedCount = unresolved.length;

    // The retained list is what the operator can always open, whether or not a banner
    // is currently on screen.
    const retained = all.map(e => ({
      id: e.id,
      action: e.action,
      label: labelForAction(e.action),
      kind: e.kind,
      certainty: e.certainty || 'confirmed',
      unresolved: isUnresolved(e),
      message: e.message,
      at: e.at,
    })).sort((a, b) => b.at - a.at);

    // Only entries still inside their banner window may be shown. Expiry hides; it
    // never destroys an unresolved record.
    const showable = e => (e.bannerUntil == null || e.bannerUntil > t);
    const bErrors = errors.filter(showable);
    const bPending = pending.filter(showable);
    const bNotices = notices.filter(showable);

    // A terminal problem outranks an in-flight check, which outranks a success notice.
    // A success can therefore never hide an unresolved outcome - the defect this store
    // exists to prevent.
    let shown = null;
    if (bErrors.length) shown = bErrors[bErrors.length - 1];
    else if (bPending.length) shown = bPending[0];
    else if (bNotices.length) shown = bNotices[bNotices.length - 1];
    if (!shown) {
      return {
        ...EMPTY_COMMAND_VIEW,
        noticeCount: notices.length,
        pendingCount: pending.length,
        errorCount: errors.length,
        unresolvedCount,
        entries: retained,
      };
    }

    // What is hidden behind the shown entry, and how to describe it. An uncertain
    // action that is not currently on screen must still be nameable, or "which action
    // is uncertain?" becomes unanswerable without clicking through.
    const hiddenUnresolved = unresolved.filter(e => e.id !== shown.id);
    const hiddenOther = all.filter(e => e.id !== shown.id && e.kind !== 'notice' && !isUnresolved(e));
    let extra = '';
    if (hiddenUnresolved.length === 1) {
      extra = `+1 more unconfirmed: ${labelForAction(hiddenUnresolved[0].action)}`;
    } else if (hiddenUnresolved.length > 1) {
      extra = `+${hiddenUnresolved.length} more unconfirmed`;
    } else if (hiddenOther.length > 0) {
      extra = `+${hiddenOther.length} more`;
    }

    return {
      kind: shown.kind,
      certainty: shown.certainty || 'confirmed',
      id: shown.id,
      action: shown.action,
      requestId: shown.requestId ?? null,
      message: shown.message,
      extra,
      noticeCount: notices.length,
      pendingCount: pending.length,
      errorCount: errors.length,
      unresolvedCount,
      entries: retained,
    };
  }

  function publish() {
    onChange?.(buildView());
  }

  function prune() {
    if (entries.size <= maxEntries) return;
    // An UNRESOLVED outcome is never evicted - not while its lookup runs, and not after
    // it ends without an answer. Earlier this shed by `kind`, and because no-record /
    // pending / unreachable are all stored as red errors alongside confirmed refusals,
    // a real uncertainty could be silently dropped once the cap was reached. Only
    // entries whose outcome is KNOWN may be shed: success notices first, then the
    // oldest confirmed failures.
    //
    // If every entry is unresolved the cap is deliberately exceeded. Losing the record
    // that a command's fate is unknown is worse than holding a few extra rows, and the
    // operator can dismiss them.
    const order = [...entries.values()];
    const shedable = order.filter(e => e.kind === 'notice' && !isUnresolved(e))
      .concat(order.filter(e => e.kind === 'error' && !isUnresolved(e)));
    for (const e of shedable) {
      if (entries.size <= maxEntries) break;
      entries.delete(e.id);
    }
  }

  /** Write an entry. Only ever touches `id` - never another command's state. */
  function set(id, patch) {
    const existing = entries.get(id);
    // An entry the operator dismissed is gone for good; a late completion must not
    // resurrect it.
    if (existing === undefined && patch.__createIfMissing !== true) return;
    const next = {
      id,
      at: existing?.at ?? Date.now(),
      requestId: existing?.requestId ?? null,
      ...existing,
      ...patch,
    };
    delete next.__createIfMissing;
    entries.set(id, next);
    prune();
    publish();
  }

  function create(id, patch) {
    set(id, { ...patch, __createIfMissing: true });
  }

  const bannerWindowFor = kind => (kind === 'notice' ? noticeMs : errorMs);

  /**
   * Write an entry AND give it a banner window. The window governs only what is on
   * screen; see bannerExpired for what happens when it ends.
   */
  function show(writer, id, patch) {
    const ms = bannerWindowFor(patch.kind);
    writer(id, { ...patch, bannerUntil: now() + ms });
    schedule(() => bannerExpired(id), ms);
  }

  /**
   * The banner window ended. A notice or a CONFIRMED failure is a known outcome with
   * nothing left to say, so it goes. An UNRESOLVED entry is kept - it stops being the
   * banner but stays counted and stays in the details list, because the operator still
   * needs to know that action was never confirmed. Auto-expiring error banners are only
   * safe because of this distinction.
   */
  function bannerExpired(id) {
    const existing = entries.get(id);
    if (!existing) return;
    // A newer state re-armed the window; that write owns the entry now.
    if (existing.bannerUntil != null && existing.bannerUntil > now()) return;
    if (existing.kind === 'unknown') { publish(); return; }   // still checking
    if (isUnresolved(existing)) { publish(); return; }        // retained, no longer shown
    entries.delete(id);
    publish();
  }

  function dismiss(id) {
    if (id == null) return;
    if (!entries.delete(id)) return;
    publish();
  }

  function dismissAll() {
    if (entries.size === 0) return;
    entries.clear();
    publish();
  }

  function surface(action, promise) {
    const id = ++seq;

    const showNotice = (message) => {
      if (SILENT_SUCCESS_ACTIONS.has(action)) {
        // Nothing to show for this control - and, critically, nothing to clear either.
        // The old code cleared the shared error string here, which is how a successful
        // volume nudge erased an unrelated VIP uncertainty.
        return;
      }
      show(create, id, { action, kind: 'notice', certainty: 'confirmed', message });
    };

    const settled = Promise.resolve(promise).then((result) => {
      if (isConfirmedApplication(result)) {
        showNotice(noticeForAction(action));
      } else {
        // Never claim success. This command's own entry records the doubt; no other
        // command's message is touched.
        // Resolved, but with no confirmation that it applied - that is an UNKNOWN
        // outcome wearing an error colour, and it must not be prunable.
        show(create, id, {
          action,
          kind: 'error',
          certainty: 'unresolved',
          message: `${labelForAction(action)}: the kiosk did not confirm that the command was applied.`,
        });
      }
      return result;
    }, (err) => {
      if (err?.resultUnknown) {
        // Outcome genuinely unknown: the command may already be queued, claimed or
        // applied. Say so, then find out - without ever resubmitting a new requestId.
        create(id, {
          action,
          kind: 'unknown',
          certainty: 'unresolved',
          requestId: err.requestId ?? null,
          bannerUntil: null,   // stays on screen until the lookup resolves it
          message: `${labelForAction(action)}: outcome unknown - checking the kiosk...`,
        });
        // Everything here was captured when the command was SENT.
        Promise.resolve(reconcile?.({
          requestId: err.requestId,
          commandId: err.commandId,
          serverEpochAtSend: err.serverEpochAtSend,
          submittedAt: err.submittedAt,
        })).then((result) => {
          const described = describeReconciledOutcome(result, action);
          if (described.kind === 'notice') {
            // Resolve THIS entry into a notice; another command's banner is untouched.
            show(set, id, { kind: 'notice', certainty: described.certainty, message: described.message });
          } else {
            // The lookup ENDING is not the same as the outcome being known. A
            // `no-record` / `pending` / `unreachable` result stays unresolved, so it
            // survives pruning until the operator dismisses it.
            show(set, id, {
              kind: 'error',
              certainty: described.certainty,
              message: `${labelForAction(action)}: ${described.message}`,
            });
          }
        }).catch(() => {
          show(set, id, {
            kind: 'error',
            certainty: 'unresolved',
            message: `${labelForAction(action)}: Could not confirm whether this action was applied. Check the current booth state before trying again.`,
          });
        });
      } else {
        // A refusal the kiosk or server actually reported: the outcome IS known, so
        // this entry is prunable once the cap is reached.
        show(create, id, {
          action,
          kind: 'error',
          certainty: 'confirmed',
          message: `${labelForAction(action)}: ${err?.message || 'The kiosk rejected that action.'}`,
        });
      }
      throw err;
    });
    // Both surfaces call this fire-and-forget from onClick/onChange handlers, which
    // discard the promise. Re-throwing for the benefit of awaiting callers would raise
    // an unhandled rejection at every one of those sites, so terminate a separate
    // branch of the chain. `settled` itself still rejects for callers that await it.
    settled.catch(() => {});
    return settled;
  }

  return { surface, dismiss, dismissAll, snapshot: buildView };
}