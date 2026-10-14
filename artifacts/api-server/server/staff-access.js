// Keep all operational sessions as role "dj". GM/admin are additive staff
// privileges, not a new top-level role that could break existing DJ routes.
export function canManageStaff(session) {
  return session?.role === 'dj'
    && (!!session.is_master || session.staff_role === 'gm');
}

export function resolveDjIdentity(pin, { masterPin, legacyHash, verifyPin, findStaff }) {
  if (pin === masterPin) {
    return { staffName: 'ADMIN', staffRole: 'master', isMaster: true };
  }
  // The existing unit code always retains authority, even if an old staff
  // account accidentally used that same code. Never rewrite its stored hash.
  if (legacyHash && verifyPin(pin, legacyHash)) {
    return { staffName: 'GM', staffRole: 'gm', isMaster: false };
  }
  const staff = findStaff(pin);
  return staff
    ? { staffName: staff.name, staffRole: staff.role, isMaster: false }
    : null;
}

export function validateStaffInput(input, {
  masterPin, legacyHash, verifyPin, isTaken, editing = false,
}) {
  if (typeof input?.name !== 'string' || !input.name.trim() || input.name.trim().length > 60) {
    return 'Name must contain 1–60 characters';
  }
  if (!['dj', 'manager'].includes(input.role)) return 'Role must be dj or manager';
  const pin = input.pin;
  if (editing && (pin == null || pin === '')) return null;
  if (typeof pin !== 'string' || !/^\d{5}$/.test(pin)) return 'A 5-digit login code is required';
  if (pin === masterPin || (legacyHash && verifyPin(pin, legacyHash))) {
    return 'That code is reserved for the existing GM or ADMIN login';
  }
  if (isTaken(pin)) return 'Login code already in use by another staff member';
  return null;
}
