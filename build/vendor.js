// Copies the browser builds of the UI libraries into src/renderer/vendor so the app runs offline.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor');
fs.mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  ['node_modules/@xterm/addon-web-links/lib/addon-web-links.js', 'addon-web-links.js'],
  ['node_modules/marked/lib/marked.umd.js', 'marked.umd.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'],
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(out, to));
}
console.log('vendor: copied', files.length, 'files');
