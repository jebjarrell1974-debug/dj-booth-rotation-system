import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

const ROOT = '/home/runner/workspace';

async function getToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : null;
  const resp = await fetch('https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github', { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } });
  const data = await resp.json();
  const conn = data.items?.[0];
  return conn?.settings?.access_token || conn?.settings?.oauth?.credentials?.access_token;
}

function walk(dir, base = '') {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

const sourceFiles = [
  'artifacts/dj-booth/src/components/dj/RotationPlaylistManager.jsx',
];

const token = await getToken();
console.log('Token length:', token?.length);
const o = new Octokit({ auth: token });
const owner = 'jebjarrell1974-debug', repo = 'dj-booth-rotation-system';

const distFiles = walk(ROOT + '/artifacts/dj-booth/dist').map(f => ({
  ghPath: 'artifacts/dj-booth/dist/' + f.rel,
  abs: f.abs,
}));
const srcFileObjs = sourceFiles.map(p => ({ ghPath: p, abs: path.join(ROOT, p) }));
const allFiles = [...srcFileObjs, ...distFiles];
console.log('Will push', allFiles.length, 'files (' + srcFileObjs.length, 'source +', distFiles.length, 'dist)');

const { data: ref } = await o.git.getRef({ owner, repo, ref: 'heads/main' });
const baseSha = ref.object.sha;
const { data: baseCommit } = await o.git.getCommit({ owner, repo, commit_sha: baseSha });
console.log('Base SHA:', baseSha.substring(0, 8));

const { data: fullTree } = await o.git.getTree({ owner, repo, tree_sha: baseCommit.tree.sha, recursive: 'true' });
const existingDist = fullTree.tree
  .filter(t => t.type === 'blob' && t.path.startsWith('artifacts/dj-booth/dist/'))
  .map(t => t.path);
const localDistSet = new Set(distFiles.map(f => f.ghPath));
const orphans = existingDist.filter(p => !localDistSet.has(p));
console.log('Orphan dist files to delete:', orphans.length);

const tree = [];
for (const f of allFiles) {
  const c = fs.readFileSync(f.abs);
  const bin = c.some(b => b === 0) || /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp3|wav|ogg|mp4)$/i.test(f.abs);
  const { data: blob } = await o.git.createBlob({
    owner, repo,
    content: bin ? c.toString('base64') : c.toString('utf8'),
    encoding: bin ? 'base64' : 'utf-8'
  });
  tree.push({ path: f.ghPath, mode: '100644', type: 'blob', sha: blob.sha });
}
for (const p of orphans) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });

const { data: nt } = await o.git.createTree({ owner, repo, tree, base_tree: baseCommit.tree.sha });
const msg = 'fix(kiosk): rotation panel 50%->60%, library 50%->40% (locks Voice/Save/Start fully on-screen at 1440x900)';
const { data: nc } = await o.git.createCommit({ owner, repo, message: msg, tree: nt.sha, parents: [baseSha] });
await o.git.updateRef({ owner, repo, ref: 'heads/main', sha: nc.sha });
console.log('PUSHED', nc.sha.substring(0, 8));
