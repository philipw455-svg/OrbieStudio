// Agent Deck: the narrow bridge between the window and the main process.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(name, ...args) {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
  return r.value;
}

const listeners = {};
for (const ch of ['update:available', 'board:kanban', 'launcher:terminal', 'view:show', 'console:data', 'console:status', 'console:focus', 'feed:add', 'inbox:update', 'loops:update', 'file:changed', 'remote:update', 'console:remoteSize', 'console:reply']) {
  listeners[ch] = new Set();
  ipcRenderer.on(ch, (e, payload) => { for (const fn of listeners[ch]) { try { fn(payload); } catch (err) { console.error(err); } } });
}

contextBridge.exposeInMainWorld('deck', {
  init: () => call('app:init'),
  pickProject: () => call('project:pick'),
  pickAgentsRoot: () => call('agentsRoot:pick'),
  pickUpdateSource: () => call('updateSource:pick'),
  pickFile: (key, kind) => call('file:pick', key, kind),
  say: (key, o) => call('owner:say', key, o),
  checkUpdate: () => call('update:check'),
  applyUpdate: () => call('update:apply'),
  downloadInstaller: () => call('update:installer'),
  suggestTeam: (key) => call('team:suggest', key),
  suggestEdits: (key, o) => call('suggest:edits', key, o),
  sendMarkup: (key, o) => call('markup:send', key, o),
  usage: (key, days) => call('usage', key, days),
  launchers: (key) => call('launchers:list', key),
  runLauncher: (key, id) => call('launchers:run', key, id),
  saveLaunchers: (key, list) => call('launchers:save', key, list),
  dictate: () => call('dictate'),
  readImage: (key, rel) => call('file:image', key, rel),
  openProject: (p) => call('project:open', p),
  closeProject: (key) => call('project:close', key),
  applyPreset: (key, id) => call('project:preset', key, id),
  presetsFor: (key) => call('presets:for', key),
  saveTeam: (key, team) => call('team:save', key, team),
  saveBoard: (key, board) => call('board:save', key, board),
  saveLoops: (key, loops) => call('loops:save', key, loops),
  start: (key, agentId, opts) => call('console:start', key, agentId, opts),
  kill: (id) => call('console:kill', id),
  buffer: (id) => call('console:buffer', id),
  input: (id, data) => ipcRenderer.send('console:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('console:resize', id, cols, rows),
  sendText: (id, text) => call('console:send', id, text),
  command: (id, cmd) => call('console:command', id, cmd),
  broadcast: (key, ids, text) => call('broadcast', key, ids, text),
  handoff: (key, o) => call('handoff', key, o),
  answer: (key, itemId, text) => call('inbox:answer', key, itemId, text),
  dismiss: (key, itemId) => call('inbox:dismiss', key, itemId),
  gitInfo: (key) => call('git:info', key),
  gitRun: (key, action, message) => call('git:run', key, action, message),
  readFile: (key, rel) => call('file:read', key, rel),
  openPath: (p) => call('open:path', p),
  openExternal: (u) => call('open:external', u),
  clipRead: () => call('clipboard:read'),
  clipWrite: (t) => call('clipboard:write', t),
  saveSettings: (patch) => call('settings:save', patch),
  quickGuide: () => call('docs:quickGuide'),
  replies: (key) => call('replies:list', key),
  remoteInfo: () => call('remote:info'),
  remoteSet: (patch) => call('remote:set', patch),
  remoteNewCode: () => call('remote:newCode'),
  remoteSignOut: (id) => call('remote:signout', id),
  on: (ch, fn) => { if (listeners[ch]) listeners[ch].add(fn); return () => listeners[ch] && listeners[ch].delete(fn); },
});
