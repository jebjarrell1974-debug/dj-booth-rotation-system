import React, { useState, useEffect, useCallback } from 'react';
import { Users, KeyRound, Plus, Pencil, Trash2, History, ShieldCheck } from 'lucide-react';
import { staffApi, isRemoteMode } from '@/api/serverApi';
import { useAuth } from '@/lib/AuthContext';

const ROLE_LABELS = { dj: 'DJ', manager: 'Manager' };
const inputCls = 'w-full min-h-[48px] bg-[#151528] border border-[#2e2e5a] rounded-lg px-4 text-base text-white focus:outline-none focus:border-[#00d4ff]';
const btnCls = 'min-h-[48px] px-5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const pinOk = (p) => /^\d{5}$/.test(p);
const cleanPin = (v) => v.replace(/\D/g, '').slice(0, 5);

function privilegeLabel({ isMaster, staffRole, staffName }) {
  if (isMaster) return 'ADMIN';
  const n = String(staffName || '').toLowerCase();
  if (n === 'auto' || n === 'fleet' || n.includes('automatic')) return 'Automatic (not a person)';
  if (staffRole === 'gm') return 'GM';
  if (staffRole === 'manager') return 'Manager';
  return 'DJ';
}

function fmtTime(t) {
  if (!t) return '';
  const text = String(t);
  const utc = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text)
    ? `${text.replace(' ', 'T')}Z` : text;
  const d = new Date(typeof t === 'number' ? t : utc);
  return isNaN(d) ? String(t) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function RoleSelect({ value, onChange, disabled, testId }) {
  return (
    <div className="flex gap-2">
      {['dj', 'manager'].map(r => (
        <button key={r} type="button" disabled={disabled} data-testid={`${testId}-${r}`}
          onClick={() => onChange(r)}
          className={`${btnCls} flex-1 border ${value === r ? 'bg-[#00d4ff]/15 border-[#00d4ff]/50 text-[#00d4ff]' : 'bg-[#151528] border-[#1e293b] text-gray-400'}`}>
          {ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}

export default function StaffLoginManager() {
  const { staffName, staffRole, isMaster, login } = useAuth();
  const canManage = isMaster || staffRole === 'gm';

  const [switchPin, setSwitchPin] = useState('');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [switchOk, setSwitchOk] = useState('');

  const [accounts, setAccounts] = useState([]);
  const [audit, setAudit] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');

  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState('dj');

  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('dj');
  const [editPin, setEditPin] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const [list, log] = await Promise.all([staffApi.list(), staffApi.audit().catch(() => [])]);
      setAccounts(Array.isArray(list) ? list : []);
      setAudit(Array.isArray(log) ? log.slice(0, 12) : []);
    } catch (e) {
      setListError(e?.message || 'Could not load staff accounts');
    }
    setListLoading(false);
  }, []);

  useEffect(() => {
    if (canManage && !isRemoteMode()) refresh();
    else { setAccounts([]); setAudit([]); setEditId(null); setConfirmRemoveId(null); }
  }, [canManage, staffName, staffRole, refresh]);

  if (isRemoteMode()) return null;

  const doSwitch = async (e) => {
    e.preventDefault();
    if (!pinOk(switchPin) || switching) return;
    setSwitching(true); setSwitchError(''); setSwitchOk('');
    try {
      const data = await login('dj', switchPin);
      setSwitchOk(`Signed in as ${data?.staffName || 'staff'}`);
      setActionError('');
      setEditId(null);
      setEditPin('');
      setNewPin('');
      setConfirmRemoveId(null);
    } catch (err) {
      setSwitchError(err?.message || 'Code not recognised');
    }
    setSwitchPin('');
    setSwitching(false);
  };

  const run = async (fn) => {
    setPending(true); setActionError('');
    try { await fn(); await refresh(); return true; }
    catch (e) { setActionError(e?.message || 'Action failed'); return false; }
    finally { setPending(false); }
  };

  const doCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setActionError('Name is required');
    if (!pinOk(newPin)) return setActionError('Code must be exactly 5 digits');
    const ok = await run(() => staffApi.create({ name, role: newRole, pin: newPin }));
    if (ok) { setNewName(''); setNewPin(''); setNewRole('dj'); }
  };

  const startEdit = (a) => {
    setEditId(a.id); setEditName(a.name || ''); setEditRole(a.role === 'manager' ? 'manager' : 'dj'); setEditPin('');
    setConfirmRemoveId(null); setActionError('');
  };

  const doSave = async () => {
    const name = editName.trim();
    if (!name) return setActionError('Name is required');
    if (editPin && !pinOk(editPin)) return setActionError('New code must be exactly 5 digits (or leave blank)');
    const body = { name, role: editRole };
    if (editPin) body.pin = editPin;
    const ok = await run(() => staffApi.update(editId, body));
    if (ok) { setEditId(null); setEditPin(''); }
  };

  const doRemove = async (id) => {
    const ok = await run(() => staffApi.remove(id));
    if (ok) setConfirmRemoveId(null);
  };

  const label = privilegeLabel({ isMaster, staffRole, staffName });

  return (
    <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-5 space-y-5" data-testid="section-staff-logins">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-[#00d4ff]" />
        <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Staff Logins</h3>
      </div>

      <div className="flex items-center justify-between gap-3 bg-[#151528] border border-[#1e293b] rounded-lg px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Signed in as</p>
          <p className="text-base text-white font-semibold truncate" data-testid="text-current-staff">{staffName || 'Staff'}</p>
        </div>
        <span data-testid="text-current-privilege" className="px-3 py-1 rounded-full text-xs font-bold bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 flex-shrink-0">{label}</span>
      </div>

      <form onSubmit={doSwitch} className="space-y-2">
        <label className="text-xs text-gray-400 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Switch login — enter your 5-digit code</label>
        <div className="flex gap-2">
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={5} value={switchPin}
            onChange={(e) => { setSwitchPin(cleanPin(e.target.value)); setSwitchOk(''); }}
            placeholder="•••••" data-testid="input-switch-pin" className={`${inputCls} tracking-[0.5em] font-mono`} disabled={switching} />
          <button type="submit" disabled={!pinOk(switchPin) || switching} data-testid="button-switch-login"
            className={`${btnCls} bg-[#2563eb] text-white flex-shrink-0`}>{switching ? 'Checking…' : 'Switch'}</button>
        </div>
        {switchError && <p className="text-sm text-red-400" data-testid="text-switch-error">{switchError}</p>}
        {switchOk && <p className="text-sm text-green-400" data-testid="text-switch-ok">{switchOk}</p>}
        <p className="text-xs text-gray-600">Music keeps playing while you switch.</p>
      </form>

      {canManage && (
        <div className="space-y-5 border-t border-[#1e293b] pt-5">
          <div className="flex gap-2 items-start bg-[#fbbf24]/10 border border-[#fbbf24]/30 rounded-lg px-4 py-3">
            <ShieldCheck className="w-4 h-4 text-[#fbbf24] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#fbbf24]">All existing unit codes (GM and Admin) remain unchanged. They are not managed here.</p>
          </div>

          <form onSubmit={doCreate} className="space-y-3">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Add staff account</p>
            <input type="text" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value.slice(0, 60))}
              placeholder="Name" data-testid="input-new-staff-name" className={inputCls} disabled={pending} />
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={5} value={newPin}
              onChange={(e) => setNewPin(cleanPin(e.target.value))} placeholder="5-digit code"
              data-testid="input-new-staff-pin" className={`${inputCls} font-mono tracking-[0.3em]`} disabled={pending} />
            <RoleSelect value={newRole} onChange={setNewRole} disabled={pending} testId="button-new-role" />
            <button type="submit" disabled={pending || !newName.trim() || !pinOk(newPin)} data-testid="button-create-staff"
              className={`${btnCls} w-full bg-[#00d4ff] text-black flex items-center justify-center gap-2`}>
              <Plus className="w-4 h-4" /> {pending ? 'Saving…' : 'Add account'}
            </button>
          </form>

          {actionError && <p className="text-sm text-red-400" data-testid="text-staff-error">{actionError}</p>}

          <div className="space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Accounts</p>
            {listLoading && accounts.length === 0 && <div className="h-14 rounded-lg bg-[#151528] animate-pulse" />}
            {listError && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-red-400">{listError}</p>
                <button onClick={refresh} className={`${btnCls} bg-[#151528] text-gray-300 border border-[#1e293b]`} data-testid="button-retry-staff">Retry</button>
              </div>
            )}
            {!listLoading && !listError && accounts.length === 0 && <p className="text-sm text-gray-500">No named staff accounts yet.</p>}
            {accounts.map(a => (
              <div key={a.id} className="bg-[#151528] border border-[#1e293b] rounded-lg p-3" data-testid={`row-staff-${a.id}`}>
                {editId === a.id ? (
                  <div className="space-y-2">
                    <input type="text" maxLength={60} value={editName} onChange={(e) => setEditName(e.target.value.slice(0, 60))}
                      className={inputCls} disabled={pending} data-testid={`input-edit-name-${a.id}`} />
                    <RoleSelect value={editRole} onChange={setEditRole} disabled={pending} testId={`button-edit-role-${a.id}`} />
                    <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={5} value={editPin}
                      onChange={(e) => setEditPin(cleanPin(e.target.value))} placeholder="New code (blank = unchanged)"
                      className={`${inputCls} font-mono`} disabled={pending} data-testid={`input-edit-pin-${a.id}`} />
                    <div className="flex gap-2">
                      <button onClick={doSave} disabled={pending} className={`${btnCls} flex-1 bg-[#00d4ff] text-black`} data-testid={`button-save-staff-${a.id}`}>{pending ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setEditId(null)} disabled={pending} className={`${btnCls} flex-1 bg-[#0d0d1f] text-gray-300 border border-[#1e293b]`}>Cancel</button>
                    </div>
                  </div>
                ) : confirmRemoveId === a.id ? (
                  <div className="space-y-2">
                    <p className="text-sm text-white">Remove <b>{a.name}</b>? Their code will stop working.</p>
                    <div className="flex gap-2">
                      <button onClick={() => doRemove(a.id)} disabled={pending} className={`${btnCls} flex-1 bg-red-600 text-white`} data-testid={`button-confirm-remove-${a.id}`}>{pending ? 'Removing…' : 'Remove'}</button>
                      <button onClick={() => setConfirmRemoveId(null)} disabled={pending} className={`${btnCls} flex-1 bg-[#0d0d1f] text-gray-300 border border-[#1e293b]`}>Keep</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-white truncate">{a.name}</p>
                      <p className="text-xs text-gray-500">{ROLE_LABELS[a.role] || 'DJ'}</p>
                    </div>
                    <button onClick={() => startEdit(a)} disabled={pending} aria-label="Edit" data-testid={`button-edit-staff-${a.id}`}
                      className={`${btnCls} px-4 bg-[#0d0d1f] border border-[#1e293b] text-gray-300`}><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => { setConfirmRemoveId(a.id); setEditId(null); }} disabled={pending} aria-label="Remove" data-testid={`button-remove-staff-${a.id}`}
                      className={`${btnCls} px-4 bg-[#0d0d1f] border border-[#1e293b] text-red-400`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Recent activity</p>
            {audit.length === 0 ? <p className="text-sm text-gray-600">No recent activity.</p> : (
              <div className="divide-y divide-[#1e293b] border border-[#1e293b] rounded-lg">
                {audit.map((e, i) => (
                  <div key={e.id ?? i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-white truncate flex-1">{e.staff_name || e.name || e.actor || 'Staff'}</span>
                    <span className="text-gray-400 truncate">{String(e.action || e.event || '').replace(/_/g, ' ')}</span>
                    <span className="text-xs text-gray-600 font-mono flex-shrink-0">{fmtTime(e.created_at || e.at || e.time)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
