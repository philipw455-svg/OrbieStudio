// electron-builder afterPack: add the Windows terminal binary, drop the Linux one, and brand the exe.
const fs = require('fs');
const path = require('path');
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const appDir = path.join(ctx.appOutDir, 'resources', 'app');
  const src = path.join(__dirname, '..', 'node_modules', '@lydell', 'node-pty-win32-x64');
  const dst = path.join(appDir, 'node_modules', '@lydell', 'node-pty-win32-x64');
  fs.cpSync(src, dst, { recursive: true });
  fs.rmSync(path.join(appDir, 'node_modules', '@lydell', 'node-pty-linux-x64'), { recursive: true, force: true });
  for (const f of fs.readdirSync(dst, { recursive: true })) if (/\.pdb$/i.test(f)) fs.rmSync(path.join(dst, f), { force: true });
  const ResEdit = await require('resedit/cjs').load();
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0);
    vi.setProductVersion(v[0], v[1], v[2], 0);
    const lang = vi.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
    vi.setStringValues(lang, { ProductName: 'Agent Deck', FileDescription: 'Agent Deck', CompanyName: 'Cohesive', OriginalFilename: 'Agent Deck.exe', InternalName: 'Agent Deck', LegalCopyright: '' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • afterPack: Windows terminal binary added, exe icon and version set');
};
