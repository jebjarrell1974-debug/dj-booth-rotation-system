// This bridge is NOT the trust root. The verifier and pins must be separately
// approved/provisioned outside the replaceable application and never auto-updated.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VERIFIER = '/usr/local/lib/neon-installer/verify-release.mjs';
const STAGED = '/var/lib/neon-installer/releases/current';
export function installerRefusal(message) {
  const error = new Error(`Whole-release installer authentication refused: ${message}`);
  error.code = 'INSTALLER_AUTH_FAILED';
  return error;
}
function trustedFile(file) {
  if (realpathSync(file) !== file) throw installerRefusal('symlink verifier/staging path');
  for (let path = file;; path = dirname(path)) {
    const stat = lstatSync(path);
    if (stat.uid !== 0 || (stat.mode & 0o022) || stat.isSymbolicLink())
      throw installerRefusal('verifier/staging path must be root-owned and not writable by other users');
    if (path === dirname(path)) break;
  }
}
export function authenticateInstallerArchive(file, signature, layout, applicationRoot) {
  try {
    trustedFile(VERIFIER);
    const child = spawnSync(process.execPath, [VERIFIER, 'verify', file, signature, layout, applicationRoot],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 65536,
        env: { PATH: '/usr/bin:/bin' } });
    if (child.error || child.status !== 0) throw installerRefusal(child.stderr || child.error?.message || 'verifier rejected release');
    const result = JSON.parse(child.stdout);
    if (result.authenticated !== true || result.scope !== 'whole-release-archive' || result.layout !== layout)
      throw installerRefusal('invalid independent verifier receipt');
    return result;
  } catch (error) {
    if (error.code === 'INSTALLER_AUTH_FAILED') throw error;
    throw installerRefusal(error.message);
  }
}
export function readApprovedRelease(applicationRoot) {
  const file = join(STAGED, 'bundle.tar.gz'), signature = join(STAGED, 'signature.json');
  try {
    trustedFile(file); trustedFile(signature);
    const installer = authenticateInstallerArchive(file, signature, 'flat', applicationRoot);
    const archive = readFileSync(file), evidence = readFileSync(signature);
    if (createHash('sha256').update(archive).digest('hex') !== installer.archiveSha256)
      throw installerRefusal('staged release changed during verification');
    return { archive, evidence, installer };
  } catch (error) {
    if (error.code === 'INSTALLER_AUTH_FAILED') throw error;
    throw installerRefusal(error.message);
  }
}
export function approvedReleaseHandler(applicationRoot, signatureOnly = false) {
  return (_req, res) => {
    try {
      const release = readApprovedRelease(applicationRoot);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Neon-Authentication-Scope', release.installer.scope);
      // Preserve the legacy header shape, but never label the running server's
      // source SHA as the separately staged archive's source revision.
      res.setHeader('X-Djbooth-Sha', /^[a-f0-9]{40}$/.test(release.installer.releaseId)
        ? release.installer.releaseId : 'unknown');
      res.setHeader('Content-Type', signatureOnly ? 'application/json' : 'application/gzip');
      res.send(signatureOnly ? release.evidence : release.archive);
    } catch (error) {
      res.status(503).json({ error: error.message, code: 'INSTALLER_AUTH_FAILED' });
    }
  };
}
