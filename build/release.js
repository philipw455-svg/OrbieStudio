// Writes update/orbie-studio.json: the newest version, the git tag to download from, every app file with its SHA-256,
// and the installer link. Orbie Studio reads it from the main branch on GitHub every 10 minutes.
// Run after `npm run dist` and after committing the code:  node build/release.js
// The files are downloaded from the commit that is checked out now (its SHA), so commit the code first,
// then run this and commit update/orbie-studio.json on top.
// update/manifest.json is the old Agent Deck list. Leave it alone: Agent Deck 1.7.0 copies still read it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const REPO = 'ki11phil0405-bit/agent-deck';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (!/selftest\.js$/.test(e.name)) files.push({ path: path.relative(root, f).split(path.sep).join('/'), sha256: sha(f), size: fs.statSync(f).size });
  }
})(path.join(root, 'src'));
const changes = fs.readFileSync(path.join(root, 'CHANGES.md'), 'utf8');
const notes = ((changes.split(/\n## /)[1] || '').split('\n').slice(1).join('\n')).trim();
const exeName = `Orbie-Studio-Setup-${pkg.version}.exe`;
const exe = path.join(root, 'dist', exeName);
const m = {
  product: pkg.name, version: pkg.version, ref: execSync('git rev-parse HEAD', { cwd: root }).toString().trim(), published: new Date().toISOString().slice(0, 10), publisher: 'Cohesive',
  electron: pkg.agentDeck.electron, dependencies: pkg.dependencies, notes,
  installer: `https://github.com/${REPO}/releases/download/v${pkg.version}/${exeName}`,
  installerSha256: fs.existsSync(exe) ? sha(exe) : undefined,
  files,
};
fs.mkdirSync(path.join(root, 'update'), { recursive: true });
fs.writeFileSync(path.join(root, 'update', 'orbie-studio.json'), JSON.stringify(m, null, 2) + '\n');
console.log(`update/orbie-studio.json: ${pkg.version}, ${files.length} files, installer ${m.installerSha256 ? 'hashed' : 'NOT BUILT YET'}`);
