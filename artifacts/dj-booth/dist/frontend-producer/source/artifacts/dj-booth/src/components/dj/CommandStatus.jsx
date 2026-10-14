import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, X } from 'lucide-react';

/**
 * Command feedback for BOTH remote surfaces - one component, no divergence.
 *
 * Two operator complaints shaped this:
 *
 *  1. "Break song set updated" pushed the whole screen down and then pulled it back up.
 *     Everything here is ABSOLUTELY POSITIONED inside a relative parent, so nothing in
 *     the page ever moves when a notice appears or disappears. No button, row, song list
 *     or playback control shifts.
 *
 *  2. Red messages stayed until dismissed, and "plus one more" hid further messages
 *     behind repeated Dismiss clicks. Banners now clear themselves - routine successes
 *     after ~2.5 s, problems after ~6 s - and anything whose outcome was never confirmed
 *     is kept in a compact status chip with a details list instead of a queue of modal
 *     dismissals.
 *
 * Visual dismissal is NOT resolution: the chip count comes from entries the feedback
 * store still holds, so an unconfirmed action remains visible and acknowledgeable long
 * after its banner has gone.
 */
export default function CommandStatus({ view, onDismiss, onDismissAll, className = '' }) {
  const [open, setOpen] = useState(false);
  const unresolved = (view?.entries || []).filter(e => e.unresolved);
  const hasBanner = !!view?.kind;

  if (!hasBanner && unresolved.length === 0) return null;

  const tone = view?.kind === 'error'
    ? 'bg-red-950/95 border-red-500/40 text-red-200'
    : view?.kind === 'notice'
      ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200'
      : 'bg-amber-950/95 border-amber-500/40 text-amber-200';

  const Icon = view?.kind === 'error' ? AlertTriangle : view?.kind === 'notice' ? CheckCircle2 : Activity;

  return (
    // Absolute: reserves no space, so the layout underneath never reflows.
    <div className={`absolute left-0 right-0 top-0 z-30 pointer-events-none ${className}`}>
      <div className="flex items-start gap-2 p-2">
        {hasBanner && (
          <div
            data-testid="remote-command-banner"
            data-command-kind={view.kind}
            data-certainty={view.certainty || ''}
            className={`pointer-events-auto flex-1 min-w-0 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-sm flex items-start gap-2 ${tone}`}
          >
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            {/* Long messages wrap instead of being cut off mid-sentence. */}
            <span className="flex-1 leading-snug break-words">{view.message}</span>
            {view.extra ? (
              <span className="flex-shrink-0 opacity-80 whitespace-nowrap">{view.extra}</span>
            ) : null}
          </div>
        )}

        {unresolved.length > 0 && (
          <button
            type="button"
            data-testid="remote-command-status-chip"
            data-unresolved-count={unresolved.length}
            onClick={() => setOpen(v => !v)}
            title="Actions whose outcome could not be confirmed"
            className="pointer-events-auto flex-shrink-0 h-9 px-3 rounded-lg border border-amber-500/50 bg-amber-950/95 text-amber-200 text-xs font-semibold shadow-lg flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{unresolved.length} unconfirmed</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && unresolved.length > 0 && (
        <div className="pointer-events-auto mx-2 mb-2 rounded-lg border border-amber-500/40 bg-[#0a0a1a]/98 shadow-2xl max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20">
            <span className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
              Could not confirm the outcome
            </span>
            <button
              type="button"
              onClick={() => { onDismissAll?.(); setOpen(false); }}
              className="text-[11px] text-gray-400 hover:text-gray-200 underline underline-offset-2"
            >
              Acknowledge all
            </button>
          </div>
          {unresolved.map(entry => (
            <div key={entry.id} className="flex items-start gap-2 px-3 py-2 border-b border-white/5 last:border-b-0">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-200">{entry.label}</p>
                <p className="text-[11px] text-gray-400 leading-snug break-words">{entry.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss?.(entry.id)}
                title="Acknowledge"
                className="flex-shrink-0 w-7 h-7 rounded-md text-gray-500 hover:text-white hover:bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}