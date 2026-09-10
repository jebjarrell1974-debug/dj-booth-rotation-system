---
name: Remote audio authority
description: Fail-closed rule that prevents venue remote browsers from becoming playback executors.
---

Only browsers loading the DJ Booth through loopback (`localhost`, `127.0.0.1`, or `::1`) may be treated as the physical playback kiosk. Every LAN IP or hostname must be command-only remote regardless of session markers.

**Why:** A venue remote computer restored or directly opened the DJ Booth route without its temporary session marker. Session-only detection misclassified it as the kiosk and mounted the audio engine, causing music to play from the remote computer.

**How to apply:** Never make playback authority depend only on sessionStorage, a login path, or a query parameter. New audio paths must also remain behind the loopback-based remote-mode boundary.

Server physical privileges must check direct loopback Host and absence of forwarding indicators as well as the socket peer.

**Why:** The development reverse proxy connects to the backend over loopback even for public clients. Peer-only locality let a public browser obtain physical-kiosk privileges.