import React, { useState } from 'react';
import { Lock, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { applyManualKey } from '@/lib/license';

export default function LicenseSuspended({ reason }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleActivate = async (e) => {
    e?.preventDefault();
    setError('');
    if (!key.trim()) {
      setError('Please enter your activation key.');
      return;
    }
    setSubmitting(true);
    const result = applyManualKey(key.trim());
    if (result.ok) {
      setSuccess(true);
      setTimeout(() => window.location.reload(), 1200);
    } else {
      setError(result.error || 'Activation failed.');
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[10000] bg-[#08081a] flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">Activated</h1>
          <p className="text-gray-400 mt-2">Restarting…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-[#08081a] overflow-auto">
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-[#0d0d1f] border border-red-500/30 rounded-2xl p-8 shadow-2xl">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <Lock className="w-8 h-8 text-red-400" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Service Suspended</h1>
            <p className="text-gray-400 text-center text-sm mb-6">
              Please contact your service provider to restore service.
            </p>

            <form onSubmit={handleActivate} className="space-y-3">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide">
                Activation Key
              </label>
              <textarea
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(''); }}
                placeholder="Paste activation key here…"
                rows={3}
                className="w-full bg-[#08081a] border border-[#1e293b] rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#00d4ff] resize-none"
                disabled={submitting}
              />
              {error && (
                <div className="flex items-start gap-2 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button
                type="submit"
                disabled={submitting || !key.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#00d4ff] hover:bg-[#00d4ff]/80 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-semibold py-3 rounded-lg transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                {submitting ? 'Activating…' : 'Activate'}
              </button>
            </form>

            <p className="text-center text-[10px] text-gray-600 mt-6">
              {reason === 'no_contact' && 'No contact with provider in 60+ days'}
              {reason === 'countdown_expired' && 'License countdown expired'}
              {reason === 'revoked' && 'License revoked by provider'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
