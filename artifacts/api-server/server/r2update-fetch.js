#!/usr/bin/env node
// CLI used by djbooth-update-github.sh to pull fleet updates from R2.
// Requires R2_* env vars (the updater sources ~/djbooth/.env before invoking).
//
//   node r2update-fetch.js manifest              -> prints manifest JSON
//   node r2update-fetch.js bundle /tmp/x.tar.gz  -> downloads + sha256-verifies, prints result JSON
//
// Exits non-zero on any failure so the shell can fall back to GitHub.
import { fetchUpdateManifest, downloadUpdateBundle } from './r2update.js';

const [cmd, arg] = process.argv.slice(2);

async function main() {
  if (cmd === 'manifest') {
    const m = await fetchUpdateManifest();
    if (!m) throw new Error('No update manifest in R2 (or R2 not configured)');
    process.stdout.write(JSON.stringify(m) + '\n');
    return;
  }
  if (cmd === 'bundle') {
    if (!arg) throw new Error('usage: r2update-fetch.js bundle <dest.tar.gz>');
    const result = await downloadUpdateBundle(arg);
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  throw new Error('usage: r2update-fetch.js manifest | bundle <dest.tar.gz>');
}

main().catch(err => {
  process.stderr.write(`r2update-fetch: ${err.message}\n`);
  process.exit(1);
});
