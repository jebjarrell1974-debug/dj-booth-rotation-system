---
name: DJ remote authority
description: Role and capability boundary for the mirrored DJ remote versus the physical kiosk.
---

DJ and manager are the same role and must not have separate function-level permissions. The DJ remote mirrors normal DJ operation and includes basic volume control.

DJ Login must reuse the full kiosk workspace on every device. Keep the streamlined interface as the separate Phone Remote login, never as the default tablet/desktop DJ workspace.

**Why:** The operator explicitly approved full kiosk parity and preserving the existing simplified remote as a third login choice. A separate approximation repeatedly omitted normal DJ tools.

Multiple sessions have equal operational authority: kiosk locality grants audio execution, not permission to overwrite newer remote edits. Applied commands awaiting publication must retry publication rather than execute again or report failure.

**Why:** Publication can fail after an action has already changed playback. Treating that as execution failure invites duplicate actions; queue acceptance is not proof of application.

Dangerous controls are available only from the physical kiosk. This includes system-level or recovery actions such as shutdown, restart, configuration restore, and similarly high-risk operations; they must not be exposed through the remote.

**Why:** The remote should be a complete day-to-day DJ controller without allowing a remote browser to perform destructive or recovery operations. Role distinctions must not complicate normal DJ/manager use.

**How to apply:** Enforce the kiosk-only boundary server-side using trusted kiosk execution/session identity, not by merely hiding buttons. Keep normal operational controls identical for DJ and manager sessions, and let remote volume commands flow through the unit’s authoritative command service.