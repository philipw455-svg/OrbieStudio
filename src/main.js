// Orbie Studio: main process.
// Owns the terminals (one real PTY per agent), the status engine, the local hook + agent-messaging server,
// loops, hand-offs, git and the project files. The window only draws what this process tells it.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');

const IS_WIN = process.platform === 'win32';
const PRESETS = require('./presets');
const createRemote = require('./remote');
let remote = null;

let win = null;
let server = null;
let port = 0;
let quitting = false;

/* ------------------------------------------------------------------ files */

const userDir = () => app.getPath('userData');
const runDir = () => path.join(userDir(), 'run');
const settingsPath = () => path.join(userDir(), 'settings.json');

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}
function slug(s) {
  return String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
function norm(p) { return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase(); }
function keyFor(p) { return crypto.createHash('sha1').update(norm(p)).digest('hex').slice(0, 10); }
function within(base, target) {
  const b = norm(base) + path.sep.toLowerCase();
  const t = norm(target);
  return t === norm(base) || t.startsWith(b);
}

// First start only: copy the recent projects and folders from Agent Deck. Update sources and paired remote
// devices are not copied, so Orbie Studio starts with its own safe defaults.
function importOldSettings() {
  try {
    if (fs.existsSync(settingsPath())) return;
    const old = readJSON(path.join(app.getPath('appData'), 'Agent Deck', 'settings.json'), null);
    if (!old || typeof old !== 'object' || Array.isArray(old)) return;
    for (const k of ['updateRepo', 'updateFeedBase', 'updateSource', 'remote']) delete old[k];
    fs.mkdirSync(userDir(), { recursive: true });
    writeJSON(settingsPath(), old);
  } catch (e) {}
}

let settings = null;
function loadSettings() {
  settings = readJSON(settingsPath(), {});
  settings.recent = settings.recent || [];
  settings.projectMap = settings.projectMap || {};
  settings.openTabs = settings.openTabs || [];
  if (!settings.agentsRoot) {
    const guess = path.join(os.homedir(), 'Documents', 'Dev', 'agents');
    settings.agentsRoot = fs.existsSync(guess) ? guess : '';
  }
}
function saveSettings() { writeJSON(settingsPath(), settings); }

/* ------------------------------------------------------------------ tools on this PC */

function which(cmd) {
  try {
    const out = execFileSync(IS_WIN ? 'where.exe' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch (e) { return null; }
}
let claudePath = null, gitPath = null, curlPath = null;
function findTools() {
  claudePath = which('claude');
  if (IS_WIN) {
    const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
    if ((!claudePath || !/\.(exe|cmd)$/i.test(claudePath)) && fs.existsSync(local)) claudePath = local;
  }
  gitPath = which('git') || (IS_WIN && fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe') ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null);
  curlPath = which('curl');
}

/* ------------------------------------------------------------------ projects */

const projects = new Map(); // key -> project

function agentsDirFor(projectPath) {
  const n = norm(projectPath);
  if (settings.projectMap[n] && fs.existsSync(settings.projectMap[n])) return { dir: settings.projectMap[n], isNew: false };
  if (fs.existsSync(path.join(projectPath, '.agents', 'team.json'))) return { dir: path.join(projectPath, '.agents'), isNew: false };
  const roots = [];
  if (settings.agentsRoot) roots.push(settings.agentsRoot);
  roots.push(path.join(path.dirname(projectPath), 'agents'));
  const base = slug(path.basename(projectPath));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let subs = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); } catch (e) {}
    for (const sub of subs) {
      const t = readJSON(path.join(sub, 'team.json'), null);
      if (t && t.projectPath && norm(t.projectPath) === n) return { dir: sub, isNew: false };
    }
    for (const sub of subs) {
      if (slug(path.basename(sub)) === base && fs.existsSync(path.join(sub, 'team.json'))) return { dir: sub, isNew: false };
    }
  }
  const root = roots.find(r => fs.existsSync(r)) || path.join(projectPath, '.agents');
  return { dir: root === path.join(projectPath, '.agents') ? root : path.join(root, base), isNew: true };
}

function projectFiles(p) {
  return {
    team: path.join(p.agentsDir, 'team.json'),
    board: path.join(p.agentsDir, 'board.json'),
    loops: path.join(p.agentsDir, 'loops.json'),
    sessions: path.join(p.agentsDir, 'sessions.json'),
    feed: path.join(p.agentsDir, 'logs', 'feed.jsonl'),
    replies: path.join(p.agentsDir, 'logs', 'replies.jsonl'),
    handoffs: path.join(p.agentsDir, 'handoffs'),
  };
}

function openProject(projectPath) {
  projectPath = path.resolve(projectPath);
  if (!fs.existsSync(projectPath)) throw new Error('That folder no longer exists: ' + projectPath);
  const key = keyFor(projectPath);
  let p = projects.get(key);
  if (!p) {
    const found = agentsDirFor(projectPath);
    p = { key, path: projectPath, name: path.basename(projectPath), agentsDir: found.dir, team: null, board: null, loops: [], sessions: {}, feed: [], inbox: [], views: [], replies: [] };
    const f = projectFiles(p);
    p.team = readJSON(f.team, null);
    p.board = readJSON(f.board, null);
    p.loops = readJSON(f.loops, []);
    p.sessions = readJSON(f.sessions, {});
    try {
      const lines = fs.readFileSync(f.feed, 'utf8').trim().split('\n').slice(-120);
      p.feed = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) {}
    p.replies = readTail(f.replies, 600000).split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).slice(-80);
    if (p.team && p.team.name) p.name = p.team.projectName || p.name;
    projects.set(key, p);
    settings.projectMap[norm(projectPath)] = p.agentsDir;
  }
  settings.recent = [{ path: projectPath, name: p.name, openedAt: Date.now() }].concat(settings.recent.filter(r => norm(r.path) !== norm(projectPath))).slice(0, 12);
  if (!settings.openTabs.some(t => norm(t) === norm(projectPath))) settings.openTabs.push(projectPath);
  saveSettings();
  return publicProject(p);
}

function publicProject(p) {
  return {
    key: p.key, path: p.path, name: p.name, agentsDir: p.agentsDir, team: p.team, board: p.board, loops: p.loops,
    sessions: p.sessions, feed: p.feed.slice(-120), inbox: p.inbox, replies: p.replies.slice(-80),
    consoles: [...consoles.values()].filter(c => c.projectKey === p.key).map(publicConsole),
  };
}

function applyPreset(key, presetId) {
  const p = projects.get(key);
  if (!p) throw new Error('Project is not open.');
  const make = PRESETS.list.find(x => x.id === presetId);
  if (!make) throw new Error('Unknown preset.');
  const team = make.build({ projectPath: p.path, projectName: p.name });
  team.projectPath = p.path;
  p.team = team;
  writeJSON(projectFiles(p).team, team);
  if (!fs.existsSync(projectFiles(p).loops)) writeJSON(projectFiles(p).loops, []);
  addFeed(p, 'team', `Team set up from the "${make.name}" preset in ${p.agentsDir}`);
  return publicProject(p);
}

/* ------------------------------------------------------------------ feed + inbox */

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (remote) remote.emit(channel, payload);
}

function addFeed(p, kind, text, extra) {
  const item = Object.assign({ t: Date.now(), kind, text }, extra || {});
  p.feed.push(item);
  if (p.feed.length > 400) p.feed.splice(0, p.feed.length - 400);
  try {
    fs.mkdirSync(path.dirname(projectFiles(p).feed), { recursive: true });
    fs.appendFileSync(projectFiles(p).feed, JSON.stringify(item) + '\n');
  } catch (e) {}
  send('feed:add', { key: p.key, item });
}

function pushInbox(p, item) {
  item.id = item.id || crypto.randomUUID();
  item.at = Date.now();
  // one open permission item per console
  if (item.kind === 'permission') p.inbox = p.inbox.filter(i => !(i.kind === 'permission' && i.consoleId === item.consoleId));
  p.inbox.push(item);
  send('inbox:update', { key: p.key, inbox: p.inbox });
  notify(`${item.agentName} needs you`, item.text, item.consoleId);
}
function clearInbox(p, filter) {
  const before = p.inbox.length;
  p.inbox = p.inbox.filter(i => !filter(i));
  if (p.inbox.length !== before) send('inbox:update', { key: p.key, inbox: p.inbox });
}

function notify(title, body, consoleId) {
  try {
    if (win && !win.isFocused()) win.flashFrame(true);
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body: String(body || '').slice(0, 220), silent: false });
    n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); send('console:focus', { id: consoleId }); } });
    n.show();
  } catch (e) {}
}

/* ------------------------------------------------------------------ consoles */

const consoles = new Map(); // id -> console
const byToken = new Map();  // token -> console id

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
function strip(s) { return s.replace(ANSI, '').replace(/[\x00-\x08\x0b-\x1f]/g, ' '); }
const NEEDS_RE = /(Do you want to (proceed|make this edit|create|run)|Would you like to|\u276f\s*1\.\s*Yes|\(y\/n\)|\[Y\/n\]|Allow (this|once)|Press Enter to continue|requires approval)/i;

function agentOf(c) {
  const p = projects.get(c.projectKey);
  return p && p.team ? p.team.agents.find(a => a.id === c.agentId) : null;
}
function publicConsole(c) {
  const a = agentOf(c);
  return {
    id: c.id, projectKey: c.projectKey, agentId: c.agentId, name: a ? a.name : c.agentId, status: c.status,
    note: c.note, exitCode: c.exitCode, startedAt: c.startedAt, lastOutput: c.lastOutput, hooks: c.hooksSeen,
    sessionId: c.sessionId, isClaude: c.isClaude, cols: c.cols, rows: c.rows,
  };
}
function setStatus(c, status, why) {
  if (c.status === status) return;
  const prev = c.status;
  c.status = status;
  c.statusAt = Date.now();
  const p = projects.get(c.projectKey);
  const a = agentOf(c);
  send('console:status', publicConsole(c));
  if (!p) return;
  if (status === 'needs') {
    pushInbox(p, { kind: 'permission', consoleId: c.id, agentName: a ? a.name : c.agentId, text: why || 'is waiting for your approval in its console.' });
  } else if (prev === 'needs') {
    clearInbox(p, i => i.kind === 'permission' && i.consoleId === c.id);
  }
  if (status === 'working') { for (const l of p.loops) if (l.consoleAgent === c.agentId) l._idleFired = false; }
}

function quoteWinArg(a) {
  if (a === '') return '""';
  if (!/[\s"]/.test(a)) return a;
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function buildClaudeArgs(p, a, c, opts) {
  const args = [];
  if (!opts.resume && a.prompt) args.push(renderPrompt(a.prompt, p, a));
  if (a.model) args.push('--model', a.model);
  if (a.permissionMode && a.permissionMode !== 'default') args.push('--permission-mode', a.permissionMode);
  // Status hooks + Orbie Studio tools come from a per-console settings + MCP file.
  fs.mkdirSync(runDir(), { recursive: true });
  // curl.exe (not the PowerShell alias), quoted "@-" so bash, cmd and PowerShell all pass stdin through.
  const hookCmd = (ev) => `${IS_WIN ? 'curl.exe' : 'curl'} -s -m 3 --noproxy 127.0.0.1 -X POST --data-binary "@-" http://127.0.0.1:${port}/hook/${c.token}/${ev}`;
  const hook = (ev, matcher) => [Object.assign(matcher !== undefined ? { matcher } : {}, { hooks: [{ type: 'command', command: hookCmd(ev), timeout: 5 }] })];
  const settingsFile = path.join(runDir(), `${c.token}.settings.json`);
  writeJSON(settingsFile, {
    hooks: {
      SessionStart: hook('start'),
      UserPromptSubmit: hook('prompt'),
      PreToolUse: hook('tool', '*'),
      Notification: hook('notify'),
      Stop: hook('stop'),
    },
    permissions: { allow: ['mcp__agent_deck'] },
  });
  args.push('--settings', settingsFile);
  const servers = { agent_deck: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${c.token}` } };
  const pool = (p.team && p.team.mcpServers) || {};
  const strict = Array.isArray(a.mcp);
  if (strict) for (const k of a.mcp) if (pool[k]) servers[k] = pool[k];
  const mcpFile = path.join(runDir(), `${c.token}.mcp.json`);
  writeJSON(mcpFile, { mcpServers: servers });
  args.push('--mcp-config', mcpFile);
  if (strict) args.push('--strict-mcp-config');
  args.push('--add-dir', p.agentsDir);
  if (opts.resume && opts.sessionId) args.push('--resume', opts.sessionId);
  if (a.extraArgs) args.push(...splitArgs(a.extraArgs));
  return args;
}

function splitArgs(s) {
  const out = []; let cur = ''; let q = null;
  for (const ch of String(s)) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function renderPrompt(t, p, a) {
  const names = (p.team.agents || []).map(x => `${x.name} (${x.role || 'agent'})`).join(', ');
  return String(t)
    .replace(/\{agent\}/g, a.name).replace(/\{role\}/g, a.role || '').replace(/\{team\}/g, names)
    .replace(/\{project\}/g, p.name).replace(/\{agentsDir\}/g, p.agentsDir).replace(/\s*\n\s*/g, ' ').trim();
}

function startConsole(key, agentId, opts) {
  opts = opts || {};
  const p = projects.get(key);
  if (!p || !p.team) throw new Error('Open a project with a team first.');
  const a = p.team.agents.find(x => x.id === agentId);
  if (!a) throw new Error('That agent is not in the team.');
  const id = key + ':' + agentId;
  const old = consoles.get(id);
  if (old && old.pty && old.status !== 'exited') return publicConsole(old);
  if (old) byToken.delete(old.token);
  const c = {
    id, projectKey: key, agentId, token: crypto.randomBytes(12).toString('hex'), status: 'starting', statusAt: Date.now(),
    note: '', buffer: '', window: '', lastOutput: 0, startedAt: Date.now(), hooksSeen: false, exitCode: null,
    sessionId: p.sessions[agentId] || null, isClaude: false, sendTimes: [], cols: opts.cols || 110, rows: opts.rows || 30,
  };
  const cmd = (a.command || 'claude').trim();
  let file, args;
  if (cmd === 'claude') {
    if (!claudePath) findTools();
    file = claudePath || 'claude';
    c.isClaude = true;
    const resume = !!opts.resume && !!c.sessionId;
    args = buildClaudeArgs(p, a, c, { resume, sessionId: c.sessionId });
  } else {
    const parts = splitArgs(cmd);
    file = parts[0]; args = parts.slice(1);
    if (a.extraArgs) args.push(...splitArgs(a.extraArgs));
  }
  const env = Object.assign({}, process.env, {
    TERM: 'xterm-256color', COLORTERM: 'truecolor', AGENT_DECK: '1', AGENT_DECK_AGENT: a.name, AGENT_DECK_ROLE: a.role || '',
  });
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    c.pty = pty.spawn(file, args, { name: 'xterm-256color', cols: opts.cols || 110, rows: opts.rows || 30, cwd: p.path, env, useConpty: true });
  } catch (e) {
    c.status = 'exited';
    c.buffer = `\r\n\x1b[31mCould not start "${file}": ${e.message}\x1b[0m\r\n` +
      (c.isClaude ? '\r\nInstall Claude Code in PowerShell with:  irm https://claude.ai/install.ps1 | iex\r\n' : '');
    consoles.set(id, c);
    byToken.set(c.token, id);
    send('console:data', { id, data: c.buffer });
    send('console:status', publicConsole(c));
    throw e;
  }
  consoles.set(id, c);
  byToken.set(c.token, id);
  c.pty.onData(data => onData(c, data));
  c.pty.onExit(({ exitCode }) => {
    c.exitCode = exitCode;
    c.pty = null;
    setStatus(c, 'exited');
    addFeed(p, 'exit', `${a.name} stopped (exit code ${exitCode}).`);
  });
  addFeed(p, 'start', `${a.name} started${opts.resume && c.sessionId ? ' and resumed its last conversation' : ''}.`);
  send('console:status', publicConsole(c));
  return publicConsole(c);
}

function onData(c, data) {
  c.buffer += data;
  if (c.buffer.length > 400000) c.buffer = c.buffer.slice(-300000);
  c.lastOutput = Date.now();
  c.seq = (c.seq || 0) + 1;
  send('console:data', { id: c.id, data, seq: c.seq });
  const text = strip(data);
  c.window = (c.window + text).slice(-6000);
  if (!c.hooksSeen) {
    if (NEEDS_RE.test(text)) setStatus(c, 'needs', 'is waiting for your answer in its console.');
    else if (c.status !== 'needs' && text.trim().length > 0) setStatus(c, 'working');
  }
  runOutputLoops(c, text);
}

function writeInput(c, data) {
  if (!c || !c.pty) return;
  c.pty.write(data);
  if (c.status === 'needs' && /[\r\n]|[0-9]/.test(data)) setStatus(c, 'working');
}

// Types a message into an agent's console and presses Enter.
function sendText(c, text, raw) {
  if (!c || !c.pty) return false;
  const clean = String(text).replace(/\r?\n+/g, ' ').trim();
  if (!clean) return false;
  // Slash commands are typed key by key (a paste would not open Claude Code's command picker).
  if (c.isClaude && !raw) c.pty.write('\x1b[200~' + clean + '\x1b[201~');
  else c.pty.write(clean);
  setTimeout(() => { if (c.pty) c.pty.write('\r'); }, raw ? 450 : 180);
  return true;
}
function runCommand(c, cmd) {
  const t = String(cmd || '').trim();
  if (!/^\/[\w:-]+/.test(t)) throw new Error('Commands start with a slash, like /model.');
  if (!c || !c.pty) throw new Error('That agent isn\'t running.');
  return sendText(c, t, true);
}

function killConsole(id) {
  const c = consoles.get(id);
  if (!c || !c.pty) return;
  try { c.pty.kill(); } catch (e) {}
}

// Fallback status for consoles without working hooks: quiet output = resting.
setInterval(() => {
  const now = Date.now();
  for (const c of consoles.values()) {
    if (!c.pty) continue;
    if (!c.hooksSeen && c.status === 'working' && now - c.lastOutput > 7000) setStatus(c, 'resting');
    if (c.status === 'starting' && now - c.startedAt > 15000 && now - c.lastOutput > 5000) setStatus(c, 'resting');
  }
}, 1500);

/* ------------------------------------------------------------------ hooks */

function onHook(token, event, body) {
  const id = byToken.get(token);
  const c = id && consoles.get(id);
  if (!c) return;
  c.hooksSeen = true;
  const p = projects.get(c.projectKey);
  const a = agentOf(c);
  if (body && body.session_id && body.session_id !== c.sessionId) {
    c.sessionId = body.session_id;
    if (p) {
      p.sessions[c.agentId] = c.sessionId; writeJSON(projectFiles(p).sessions, p.sessions);
      const histFile = path.join(p.agentsDir, 'session-history.json');
      const hist = readJSON(histFile, {});
      hist[c.sessionId] = c.agentId; writeJSON(histFile, hist);
    }
  }
  if (event === 'start') setStatus(c, 'resting');
  else if (event === 'prompt' || event === 'tool') setStatus(c, 'working');
  else if (event === 'stop') { setStatus(c, 'resting'); captureReply(c, body); }
  else if (event === 'notify') {
    const type = (body && body.notification_type) || '';
    const msg = (body && body.message) || '';
    if (type === 'permission_prompt' || /permission|approv/i.test(msg)) setStatus(c, 'needs', msg || 'is waiting for your approval.');
    else if (type === 'idle_prompt' || /waiting for your input/i.test(msg)) setStatus(c, 'resting');
    else if (msg && p) addFeed(p, 'notice', `${a ? a.name : 'Agent'}: ${msg}`);
  }
}

/* ------------------------------------------------------------------ agent replies: the last answer of every turn */

function readTail(f, bytes) {
  try {
    const st = fs.statSync(f);
    const len = Math.min(st.size, bytes);
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    let s = buf.toString('utf8');
    if (len < st.size) s = s.slice(s.indexOf('\n') + 1);
    return s;
  } catch (e) { return ''; }
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n\n');
}
// Everything the agent said to the owner since the last real prompt (tool results are not prompts).
function replyFromTranscript(file) {
  const lines = readTail(file, 4 * 1024 * 1024).split('\n');
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch (x) { continue; }
    if (!e || e.isSidechain) continue;
    const m = e.message || {};
    if (e.type === 'assistant') { const t = textOf(m.content).trim(); if (t) parts.unshift(t); }
    else if (e.type === 'user' && !e.isMeta) {
      const isPrompt = typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some(b => b && b.type === 'text'));
      if (isPrompt && !(Array.isArray(m.content) && m.content.every(b => b.type === 'tool_result'))) break;
    }
  }
  return parts.join('\n\n').trim();
}
function captureReply(c, body, tries) {
  const p = projects.get(c.projectKey);
  const a = agentOf(c);
  if (!p) return;
  let text = body && typeof body.last_assistant_message === 'string' ? body.last_assistant_message.trim() : '';
  const tp = body && body.transcript_path;
  if (!text && tp && /\.jsonl$/i.test(tp) && within(path.join(os.homedir(), '.claude'), tp)) text = replyFromTranscript(tp);
  if (!text) { if ((tries || 0) < 2 && tp) setTimeout(() => captureReply(c, body, (tries || 0) + 1), 700); return; }
  text = text.slice(0, 60000);
  const last = p.replies.filter(r => r.agentId === c.agentId).pop();
  if (last && last.text === text) return;
  const reply = { id: crypto.randomBytes(5).toString('hex'), agentId: c.agentId, agentName: a ? a.name : c.agentId, at: Date.now(), text };
  p.replies.push(reply);
  if (p.replies.length > 200) p.replies.splice(0, p.replies.length - 200);
  try { fs.mkdirSync(path.dirname(projectFiles(p).replies), { recursive: true }); fs.appendFileSync(projectFiles(p).replies, JSON.stringify(reply) + '\n'); } catch (e) {}
  send('console:reply', { key: p.key, reply });
  const first = text.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim();
  addFeed(p, 'reply', `${reply.agentName}: ${first.slice(0, 160)}${first.length > 160 ? '…' : ''}`, { replyId: reply.id });
  if (win && !win.isFocused()) notify(`${reply.agentName} replied`, first, c.id);
}

/* ------------------------------------------------------------------ agent_deck MCP (agents talk to each other) */

const MCP_TOOLS = [
  { name: 'list_agents', description: 'List the agents on this team with their role, whether they are running, and what each is doing.', inputSchema: { type: 'object', properties: {} } },
  { name: 'send_message', description: 'Send a message to another agent. It is typed into that agent\'s console as "[Message from <you>] ...". Use "all" to message every running agent.', inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Agent name, or "all".' }, message: { type: 'string', description: 'One clear message. Say what you need and what done looks like.' } }, required: ['to', 'message'] } },
  { name: 'handoff', description: 'Hand a task to another agent with a written brief. The brief is saved as a file in the team\'s handoffs folder and the agent is told to read it.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, summary: { type: 'string', description: 'What you finished, files changed, proof paths, open problems, the next step.' } }, required: ['to', 'summary'] } },
  { name: 'report_status', description: 'Tell the owner what you are doing right now. Shown next to your name on the mission map. Keep it under 120 characters.', inputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } },
  { name: 'show_view', description: 'Show the owner what you are working on: put a screenshot, a report, a web page or some text on their board next to your console. Calling it again with the same title updates that view. Use it whenever you finish something they should look at.', inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'Short name, e.g. "Spawn plaza, side view".' }, kind: { type: 'string', enum: ['image', 'markdown', 'web', 'text'], description: 'image = a PNG/JPG file, markdown = a .md file, web = a URL, text = the text you pass.' }, path: { type: 'string', description: 'File path for image or markdown, inside the project or agents folder.' }, url: { type: 'string', description: 'For web: an http(s) address, e.g. a localhost preview.' }, text: { type: 'string', description: 'For text: what to show (test output, a list, a diff).' } }, required: ['title', 'kind'] } },
  { name: 'task_board', description: 'The shared kanban board on the owner\'s screen. list shows every card; add creates a card; move changes its column (todo, doing, review, done); update changes text or owner. Keep it current: move your card to doing when you start and to review when you hand it to QA.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'move', 'update'] }, id: { type: 'string', description: 'Card id, for move and update.' }, text: { type: 'string' }, column: { type: 'string', enum: ['todo', 'doing', 'review', 'done'] }, agent: { type: 'string', description: 'Agent name who owns the card.' } }, required: ['action'] } },
  { name: 'ask_owner', description: 'Ask the owner (the human) a question. It appears in their inbox with a notification. Their answer arrives later in your console as "[Answer from the owner] ...". Put the recommended option first.', inputSchema: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: 'Optional short answer choices, recommended first.' } }, required: ['question'] } },
];

function findTarget(p, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!p.team) return null;
  return p.team.agents.find(a => a.id.toLowerCase() === n || a.name.toLowerCase() === n || (a.role || '').toLowerCase() === n) ||
    p.team.agents.find(a => a.name.toLowerCase().startsWith(n) || a.name.toLowerCase().includes(n));
}

function rateOk(c) {
  const now = Date.now();
  c.sendTimes = c.sendTimes.filter(t => now - t < 60000);
  if (c.sendTimes.length >= 10) return false;
  c.sendTimes.push(now);
  return true;
}

function callTool(c, name, args) {
  const p = projects.get(c.projectKey);
  const me = agentOf(c);
  const myName = me ? me.name : 'Agent';
  args = args || {};
  if (name === 'list_agents') {
    const lines = p.team.agents.map(a => {
      const cc = consoles.get(p.key + ':' + a.id);
      const st = cc ? (cc.status === 'needs' ? 'waiting on the owner' : cc.status) : 'not started';
      return `- ${a.name}${a.id === c.agentId ? ' (you)' : ''}: ${a.role || 'agent'}. Status: ${st}.${cc && cc.note ? ' Doing: ' + cc.note : ''}`;
    });
    lines.push(`- Owner (human): reach them with ask_owner.`);
    return lines.join('\n');
  }
  if (name === 'send_message') {
    const msg = String(args.message || '').trim();
    if (!msg) throw new Error('message is empty.');
    if (!rateOk(c)) throw new Error('Too many messages this minute. Wait, then send one combined message.');
    const targets = String(args.to).toLowerCase() === 'all'
      ? p.team.agents.filter(a => a.id !== c.agentId)
      : [findTarget(p, args.to)].filter(Boolean);
    if (!targets.length) throw new Error(`No agent called "${args.to}". Use list_agents.`);
    const sent = [], missed = [];
    for (const t of targets) {
      if (t.id === c.agentId) continue;
      const tc = consoles.get(p.key + ':' + t.id);
      if (tc && tc.pty && sendText(tc, `[Message from ${myName}] ${msg}`)) sent.push(t.name); else missed.push(t.name);
    }
    addFeed(p, 'message', `${myName} → ${sent.concat(missed).join(', ')}: ${msg}`, { from: c.agentId });
    if (!sent.length) throw new Error(`${missed.join(', ')} isn't running. Ask the owner to start it with ask_owner.`);
    return `Sent to ${sent.join(', ')}.` + (missed.length ? ` Not running: ${missed.join(', ')}.` : '');
  }
  if (name === 'handoff') {
    const t = findTarget(p, args.to);
    if (!t) throw new Error(`No agent called "${args.to}". Use list_agents.`);
    if (t.id === c.agentId) throw new Error('You cannot hand off to yourself.');
    if (!rateOk(c)) throw new Error('Too many messages this minute.');
    const file = writeHandoff(p, myName, t.name, String(args.summary || ''));
    const tc = consoles.get(p.key + ':' + t.id);
    const ok = tc && tc.pty && sendText(tc, `[Hand-off from ${myName}] Read ${file} and continue from there.`);
    addFeed(p, 'handoff', `${myName} handed off to ${t.name}.`, { file });
    return ok ? `Hand-off saved to ${file} and ${t.name} was told to read it.` : `Hand-off saved to ${file}, but ${t.name} isn't running. The owner will see it in the feed.`;
  }
  if (name === 'report_status') {
    c.note = String(args.status || '').slice(0, 140);
    send('console:status', publicConsole(c));
    addFeed(p, 'status', `${myName}: ${c.note}`);
    return 'Shown on the mission map.';
  }
  if (name === 'show_view') {
    const kind = String(args.kind || '');
    const title = String(args.title || 'View').slice(0, 80);
    const view = { title, kind, owner: c.agentId, ownerName: myName };
    if (kind === 'image' || kind === 'markdown') {
      if (!args.path) throw new Error('path is required for ' + kind + '.');
      const full = resolveFile(p, String(args.path));
      if (!fs.existsSync(full)) throw new Error('No file at ' + full);
      if (kind === 'image' && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(full)) throw new Error('Images must be PNG, JPG, GIF, WEBP or BMP.');
      view.path = within(p.path, full) ? path.relative(p.path, full) : full;
    } else if (kind === 'web') {
      if (!/^https?:\/\//i.test(String(args.url || ''))) throw new Error('url must start with http:// or https://');
      view.url = String(args.url);
    } else if (kind === 'text') {
      view.text = String(args.text || '').slice(0, 20000);
    } else throw new Error('kind must be image, markdown, web or text.');
    view.at = Date.now();
    p.views = (p.views || []).filter(v => !(v.title === view.title && v.owner === view.owner)).concat([view]).slice(-30);
    send('view:show', { key: p.key, view });
    addFeed(p, 'view', `${myName} shared a view: ${title}`);
    return 'It is on the owner\'s board next to your console.';
  }
  if (name === 'task_board') return taskBoard(p, c, myName, args);
  if (name === 'ask_owner') {
    const q = String(args.question || '').trim();
    if (!q) throw new Error('question is empty.');
    const options = Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : [];
    pushInbox(p, { kind: 'question', consoleId: c.id, agentName: myName, text: q, options });
    addFeed(p, 'question', `${myName} asked: ${q}`);
    return 'Sent to the owner. Their answer will arrive in this console as "[Answer from the owner] ...". Work on something that does not depend on it, or stop and wait.';
  }
  throw new Error('Unknown tool: ' + name);
}

function writeHandoff(p, fromName, toName, body) {
  const dir = projectFiles(p).handoffs;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `${stamp}_${slug(fromName)}-to-${slug(toName)}.md`);
  fs.writeFileSync(file, `# Hand-off: ${fromName} to ${toName}\n\n${new Date().toLocaleString()}\n\n${body}\n`, 'utf8');
  return file;
}

function handleMcp(token, req, res, raw) {
  const id = byToken.get(token);
  const c = id && consoles.get(id);
  if (!c) { res.writeHead(404); return res.end(); }
  let msg;
  try { msg = JSON.parse(raw || 'null'); } catch (e) { res.writeHead(400); return res.end(); }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out = [];
  for (const m of batch) {
    if (!m || typeof m !== 'object') continue;
    if (m.id === undefined || m.id === null) continue; // notification
    let result = null, error = null;
    try {
      if (m.method === 'initialize') {
        result = { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agent_deck', version: app.getVersion() },
          instructions: 'Orbie Studio connects you to the other agents on this team and to the owner. Use list_agents first. Message agents with send_message or handoff; ask the human owner with ask_owner; show the owner your work with show_view.' };
      } else if (m.method === 'tools/list') {
        result = { tools: MCP_TOOLS };
      } else if (m.method === 'tools/call') {
        try {
          const text = callTool(c, m.params && m.params.name, m.params && m.params.arguments);
          result = { content: [{ type: 'text', text: String(text) }] };
        } catch (e) {
          result = { content: [{ type: 'text', text: e.message }], isError: true };
        }
      } else if (m.method === 'ping') {
        result = {};
      } else {
        error = { code: -32601, message: 'Method not found' };
      }
    } catch (e) { error = { code: -32603, message: e.message }; }
    out.push(error ? { jsonrpc: '2.0', id: m.id, error } : { jsonrpc: '2.0', id: m.id, result });
  }
  if (!out.length) { res.writeHead(202); return res.end(); }
  const body = JSON.stringify(Array.isArray(msg) ? out : out[0]);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const parts = (req.url || '').split('?')[0].split('/').filter(Boolean);
      if (req.socket.remoteAddress && !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
      const host = String(req.headers.host || '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403); return res.end(); }
      let raw = '';
      req.on('data', ch => { raw += ch; if (raw.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try {
          if (parts[0] === 'hook' && req.method === 'POST' && parts.length === 3) {
            let body = null; try { body = JSON.parse(raw || '{}'); } catch (e) {}
            onHook(parts[1], parts[2], body);
            res.writeHead(204); return res.end();
          }
          if (parts[0] === 'mcp' && parts.length === 2) {
            if (req.method === 'POST') return handleMcp(parts[1], req, res, raw);
            if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
            res.writeHead(405, { Allow: 'POST' }); return res.end();
          }
          res.writeHead(404); res.end();
        } catch (e) { res.writeHead(500); res.end(); }
      });
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port); });
  });
}

/* ------------------------------------------------------------------ loops */

function saveLoops(p) { writeJSON(projectFiles(p).loops, p.loops.map(l => { const o = Object.assign({}, l); delete o._idleFired; delete o._lastFire; delete o._pending; return o; })); }

function fireLoop(p, l, c) {
  if (!sendText(c, l.message)) return;
  l.runs = (l.runs || 0) + 1;
  l.lastRun = Date.now();
  l._lastFire = Date.now();
  addFeed(p, 'loop', `Loop "${l.name}" sent to ${agentOf(c) ? agentOf(c).name : c.agentId}: ${l.message}`);
  if (l.maxRuns && l.runs >= l.maxRuns) { l.enabled = false; l.retired = `Stopped after ${l.runs} runs.`; addFeed(p, 'loop', `Loop "${l.name}" finished its ${l.runs} runs.`); }
  saveLoops(p);
  send('loops:update', { key: p.key, loops: p.loops });
}

setInterval(() => {
  const now = Date.now();
  for (const p of projects.values()) {
    for (const l of p.loops) {
      if (!l.enabled) continue;
      const c = consoles.get(p.key + ':' + l.consoleAgent);
      if (!c || !c.pty || c.status === 'needs') continue;
      if (l.trigger === 'schedule') {
        const every = Math.max(1, Number(l.everyMin) || 10) * 60000;
        if (!l.nextAt) { l.nextAt = now + every; continue; }
        if (now >= l.nextAt) {
          if (c.status === 'working') continue; // wait until it finishes, then fire
          l.nextAt = now + every;
          fireLoop(p, l, c);
        }
      } else if (l.trigger === 'idle') {
        const idle = Math.max(30, Number(l.idleSec) || 120) * 1000;
        if (c.status === 'resting' && !l._idleFired && now - Math.max(c.lastOutput, c.statusAt) >= idle) { l._idleFired = true; fireLoop(p, l, c); }
      }
    }
  }
}, 2000);

function runOutputLoops(c, text) {
  const p = projects.get(c.projectKey);
  if (!p) return;
  for (const l of p.loops) {
    if (!l.enabled || l.consoleAgent !== c.agentId) continue;
    if (l.goal) {
      try { if (new RegExp(l.goal, 'i').test(c.window)) { l.enabled = false; l.retired = 'Goal met.'; addFeed(p, 'loop', `Loop "${l.name}" retired: goal met.`); saveLoops(p); send('loops:update', { key: p.key, loops: p.loops }); continue; } } catch (e) {}
    }
    if (l.trigger === 'output' && l.pattern) {
      let re; try { re = new RegExp(l.pattern, 'i'); } catch (e) { continue; }
      if (re.test(text) && (!l._lastFire || Date.now() - l._lastFire > 30000) && c.status !== 'needs') setTimeout(() => fireLoop(p, l, c), 1200);
    }
  }
}

/* ------------------------------------------------------------------ hand-off from the window */

function uiHandoff(key, o) {
  const p = projects.get(key);
  const from = p.team.agents.find(a => a.id === o.from);
  const to = p.team.agents.find(a => a.id === o.to);
  if (!from || !to) throw new Error('Pick both agents.');
  const fc = consoles.get(key + ':' + from.id);
  const tc = consoles.get(key + ':' + to.id);
  if (!tc || !tc.pty) throw new Error(`${to.name} isn't running. Start it first.`);
  const note = String(o.note || '').replace(/\r?\n+/g, ' ').trim();
  if (o.summarize && fc && fc.pty) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.mkdirSync(projectFiles(p).handoffs, { recursive: true });
    const file = path.join(projectFiles(p).handoffs, `${stamp}_${slug(from.name)}-to-${slug(to.name)}.md`);
    sendText(fc, `Write a hand-off for ${to.name}: what you finished, the files you changed, proof paths, open problems and the next step. Save it as ${file} and then reply HANDOFF READY.`);
    addFeed(p, 'handoff', `${from.name} is writing a hand-off for ${to.name}.`);
    let lastSize = -1, waited = 0;
    const timer = setInterval(() => {
      waited += 1500;
      let size = -1; try { size = fs.statSync(file).size; } catch (e) {}
      if (size > 0 && size === lastSize) {
        clearInterval(timer);
        sendText(tc, `[Hand-off from ${from.name}] Read ${file} and continue from there.${note ? ' Note from the owner: ' + note : ''}`);
        addFeed(p, 'handoff', `${to.name} picked up the hand-off from ${from.name}.`, { file });
      } else if (waited > 15 * 60000) {
        clearInterval(timer);
        addFeed(p, 'handoff', `The hand-off from ${from.name} to ${to.name} timed out: no file after 15 minutes.`);
      }
      lastSize = size;
    }, 1500);
    return { pending: true, file };
  }
  const file = writeHandoff(p, from.name, to.name, note || '(no notes)');
  sendText(tc, `[Hand-off from ${from.name}] Read ${file} and continue from there.`);
  addFeed(p, 'handoff', `Handed off from ${from.name} to ${to.name}.`, { file });
  return { pending: false, file };
}

/* ------------------------------------------------------------------ kanban the agents can use */

const COLS = { todo: 'To do', doing: 'Doing', review: 'Review', done: 'Done' };
function kanbanTile(p, create) {
  p.board = p.board || { view: { x: 0, y: 0, z: 1 }, tiles: [] };
  let t = p.board.tiles.find(x => x.type === 'kanban');
  if (!t && create) {
    const bottom = Math.max(20, ...p.board.tiles.map(x => x.y + x.h)) + 30;
    t = { id: crypto.randomBytes(4).toString('hex'), type: 'kanban', x: 20, y: bottom, w: 980, h: 420, cards: [] };
    p.board.tiles.push(t);
  }
  if (t) t.cards = t.cards || [];
  return t;
}
function taskBoard(p, c, myName, a) {
  const action = String(a.action || 'list');
  const t = kanbanTile(p, action !== 'list');
  if (action === 'list') {
    if (!t || !t.cards.length) return 'The task board is empty.';
    return Object.keys(COLS).map(col => `${COLS[col]}:\n` + (t.cards.filter(k => k.col === col).map(k => `- [${k.id}] ${k.text}${k.agent ? ' (' + (findTarget(p, k.agent) || { name: k.agent }).name + ')' : ''}`).join('\n') || '- nothing')).join('\n');
  }
  let card;
  if (action === 'add') {
    if (!String(a.text || '').trim()) throw new Error('text is required.');
    const owner = a.agent ? findTarget(p, a.agent) : null;
    card = { id: 'T' + (t.cards.reduce((m, k) => Math.max(m, parseInt(String(k.id).slice(1), 10) || 0), 0) + 1), text: String(a.text).trim().slice(0, 300), col: COLS[a.column] ? a.column : 'todo', agent: owner ? owner.id : '' , by: myName };
    t.cards.push(card);
  } else {
    card = t.cards.find(k => String(k.id).toLowerCase() === String(a.id || '').toLowerCase());
    if (!card) throw new Error(`No card ${a.id}. Use action list.`);
    if (action === 'move') { if (!COLS[a.column]) throw new Error('column must be todo, doing, review or done.'); card.col = a.column; }
    if (a.text) card.text = String(a.text).slice(0, 300);
    if (a.agent) { const owner = findTarget(p, a.agent); card.agent = owner ? owner.id : ''; }
  }
  writeJSON(projectFiles(p).board, p.board);
  send('board:kanban', { key: p.key, tile: t });
  addFeed(p, 'task', `${myName}: ${action === 'add' ? 'added' : 'updated'} ${card.id} "${card.text}" → ${COLS[card.col]}`);
  return `${card.id} is in ${COLS[card.col]}.`;
}

/* ------------------------------------------------------------------ suggest a team for a folder */

function suggestTeam(key) {
  const p = projects.get(key);
  if (!claudePath) findTools();
  if (!claudePath) throw new Error('Claude Code is not installed on this PC.');
  const prompt = [
    'Look at this project folder and propose a team of AI coding agents to work on it. Read CLAUDE.md, README files, any plan or roadmap files, and look at the file types and engine files (Roblox: .rbxl, default.project.json, .luau; Unreal: .uproject; Unity: ProjectSettings; Godot: project.godot; web: package.json; Blender: .blend).',
    'This is a game studio tool, so think like a game team. If the folder is empty or has no game yet, it is a brand-new game: include a Game designer who interviews the owner and writes GAME_PLAN.md before anything is built, and let the builder ask the owner which engine to use.',
    'Rules: 2 to 6 agents. Always include one lead that plans, assigns and checks work (it never builds). Include a reviewer or QA agent that never checks its own work. Add specialists only when the project needs them (for example a Blender modeler only if there are custom 3D models).',
    'Models: claude-opus-5-5 for building and deciding, claude-sonnet-5-5 for routine work, claude-haiku-5-5 only for read-only scanning.',
    'MCP servers you may assign: roblox_studio (Roblox Studio), blender (Blender). Give an agent mcp: null to use the owner\'s usual servers, or a list of keys to limit it.',
    'Reply with only this, nothing before or after:',
    '<team>{"summary":"one sentence on what you found","agents":[{"name":"Supervisor","role":"short role","model":"claude-opus-5-5","mcp":[],"lead":true,"prompt":"start prompt for this agent, 2-4 sentences, says what it owns and to wait for the lead"}]}</team>',
  ].join(' ');
  const args = [prompt, '-p', '--output-format', 'text', '--strict-mcp-config', '--allowedTools', 'Read', 'Glob', 'Grep'];
  return new Promise((resolve, reject) => {
    execFile(claudePath, args, { cwd: p.path, windowsHide: true, timeout: 300000, maxBuffer: 8e6, env: Object.assign({}, process.env, { AGENT_DECK: '1' }) }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      const m = /<team>([\s\S]*?)<\/team>/.exec(out);
      if (!m) return reject(new Error(err ? `Claude Code couldn't finish: ${String(stderr || err.message).trim().slice(0, 300)}` : 'Claude Code replied without a team. Try again.'));
      let t; try { t = JSON.parse(m[1]); } catch (e) { return reject(new Error('The suggested team was not valid JSON. Try again.')); }
      const colors = PRESETS.COLORS;
      const used = new Set();
      const agents = (t.agents || []).slice(0, 8).map((a, i) => {
        let id = slug(a.name); while (used.has(id)) id += '-2'; used.add(id);
        return { id, name: String(a.name || 'Agent ' + (i + 1)), role: String(a.role || ''), color: colors[i % colors.length], command: 'claude', model: String(a.model || ''), permissionMode: 'default',
          mcp: Array.isArray(a.mcp) ? a.mcp.filter(k => ['roblox_studio', 'blender'].includes(k)) : null, autostart: true, lead: !!a.lead, prompt: String(a.prompt || '') };
      });
      if (!agents.length) return reject(new Error('The suggestion had no agents. Try again.'));
      if (!agents.some(a => a.lead)) agents[0].lead = true;
      const needs = new Set(agents.flatMap(a => a.mcp || []));
      const servers = {};
      for (const k of needs) servers[k] = PRESETS.MCP[k];
      resolve({ summary: String(t.summary || ''), team: { name: 'Suggested team', projectName: p.name, mcpServers: Object.assign({}, (p.team && p.team.mcpServers) || {}, servers), agents } });
    });
  });
}

/* ------------------------------------------------------------------ suggested edits + markups the agents can read */

function lineDiff(a, b) {
  const A = a.split(/\r?\n/), B = b.split(/\r?\n/);
  if (A.length * B.length > 4e6) return null;
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push([' ', A[i], i + 1]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i], i + 1]); i++; } else { ops.push(['+', B[j], i + 1]); j++; } }
  while (i < n) { ops.push(['-', A[i], i + 1]); i++; }
  while (j < m) { ops.push(['+', B[j], n + 1]); j++; }
  // keep 2 lines of context around changes
  const keep = new Set();
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d); });
  const out = []; let last = -10;
  ops.forEach((o, k) => { if (!keep.has(k)) return; if (k !== last + 1) out.push(`@@ near line ${o[2]} @@`); out.push(o[0] + ' ' + o[1]); last = k; });
  return out.join('\n');
}

function suggestEdits(key, o) {
  const p = projects.get(key);
  const full = resolveFile(p, o.rel);
  const before = fs.readFileSync(full, 'utf8');
  const after = String(o.text || '');
  if (before === after) throw new Error('Nothing changed yet. Edit the text first.');
  const diff = lineDiff(before, after);
  const dir = path.join(p.agentsDir, 'suggestions');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(dir, `${stamp}_${slug(path.basename(full))}`);
  fs.writeFileSync(base + '.proposed' + (path.extname(full) || '.txt'), after, 'utf8');
  fs.writeFileSync(base + '.md', `# Suggested edits for ${full}\n\nFrom the owner, ${new Date().toLocaleString()}.\n\n${o.note ? 'Note: ' + o.note + '\n\n' : ''}Lines starting with - are the current text, + is what the owner wants.\nThe whole edited version is in ${base}.proposed${path.extname(full) || '.txt'}\n\n\`\`\`diff\n${diff || '(too long to diff: compare the files)'}\n\`\`\`\n`, 'utf8');
  const to = targetAgent(p, o.to);
  const c = consoles.get(key + ':' + to.id);
  const ok = c && c.pty && sendText(c, `[Suggested edits from the owner] for ${full}: read ${base}.md (a diff of what to change).${o.note ? ' Note: ' + o.note : ''} Apply what makes sense, then confirm with report_status.`);
  addFeed(p, 'edit', `You suggested edits to ${path.basename(full)} for ${to.name}.`, { file: base + '.md' });
  if (!ok) throw new Error(`Saved in ${base}.md, but ${to.name} isn't running.`);
  return { file: base + '.md', to: to.name };
}

function sendMarkup(key, o) {
  const p = projects.get(key);
  const m = /^data:image\/png;base64,(.+)$/.exec(String(o.dataUrl || ''));
  if (!m) throw new Error('Nothing to send.');
  const dir = path.join(p.agentsDir, 'markups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `${stamp}_${slug(path.basename(o.source || 'image'))}.png`);
  fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
  const texts = (o.texts || []).map(t => `"${t}"`).join(', ');
  fs.writeFileSync(file.replace(/\.png$/, '.md'), `# Markup from the owner\n\nOn: ${o.source}\nMarked-up image: ${file}\n\n${o.note ? 'Note: ' + o.note + '\n' : ''}${texts ? 'Text written on the picture: ' + texts + '\n' : ''}`, 'utf8');
  const to = targetAgent(p, o.to);
  const c = consoles.get(key + ':' + to.id);
  const ok = c && c.pty && sendText(c, `[Markup from the owner] on ${o.source}: open the image ${file} (the owner drew and wrote on it).${texts ? ' Text on it: ' + texts + '.' : ''}${o.note ? ' Note: ' + o.note : ''} Read it and act on it, then confirm with report_status.`);
  addFeed(p, 'markup', `You marked up ${path.basename(o.source || 'an image')} for ${to.name}.`, { file });
  if (!ok) throw new Error(`Saved in ${file}, but ${to.name} isn't running.`);
  return { file, to: to.name };
}

function targetAgent(p, to) {
  const lead = p.team.agents.find(a => a.lead) || p.team.agents[0];
  return (to && to !== 'lead' && p.team.agents.find(a => a.id === to)) || lead;
}

/* ------------------------------------------------------------------ token usage from Claude Code's own logs */

async function usageReport(key, days) {
  const p = projects.get(key);
  days = Math.max(1, Math.min(3650, Number(days) || 14)); // 3650 = the whole life of a game (the rocket flight)
  const root = path.join(os.homedir(), '.claude', 'projects');
  const since = Date.now() - days * 86400000;
  const hist = readJSON(path.join(p.agentsDir, 'session-history.json'), {});
  for (const [a, sid] of Object.entries(p.sessions || {})) if (sid) hist[sid] = a;
  const byDay = {}, totals = {}, models = {};
  const seen = new Set();
  let files = 0, lines = 0;
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); } catch (e) {}
  const readline = require('readline');
  for (const dir of dirs) {
    let fl = [];
    try { fl = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f)); } catch (e) {}
    for (const f of fl) {
      let st; try { st = fs.statSync(f); } catch (e) { continue; }
      if (st.mtimeMs < since) continue;
      files++;
      const rl = readline.createInterface({ input: fs.createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.indexOf('"usage"') < 0) continue;
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        const u = o.message && o.message.usage;
        if (!u || !o.cwd || !within(p.path, o.cwd)) continue;
        const t = Date.parse(o.timestamp || '');
        if (!t || t < since) continue;
        const idk = (o.message.id || '') + '|' + (o.requestId || '');
        if (idk !== '|' && seen.has(idk)) continue;
        seen.add(idk); lines++;
        const agent = hist[o.sessionId] || 'other';
        const rec = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
        const tot = rec.input + rec.output + rec.cacheRead + rec.cacheWrite;
        const dk = dayKey(t);
        byDay[dk] = byDay[dk] || {}; byDay[dk][agent] = (byDay[dk][agent] || 0) + tot;
        const T = totals[agent] = totals[agent] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        T.input += rec.input; T.output += rec.output; T.cacheRead += rec.cacheRead; T.cacheWrite += rec.cacheWrite; T.total += tot;
        const model = o.message.model || 'unknown';
        models[model] = (models[model] || 0) + tot;
      }
    }
  }
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(dayKey(Date.now() - i * 86400000));
  return { days: dayList, byDay, totals, models, files, messages: lines, root };
}

/* ------------------------------------------------------------------ the owner talks to the team */

function ownerSay(key, o) {
  const p = projects.get(key);
  const text = String(o.text || '').replace(/\r?\n+/g, ' ').trim();
  if (!text) throw new Error('Write or dictate a message first.');
  const lead = p.team.agents.find(a => a.lead) || p.team.agents[0];
  const targets = o.to === 'everyone' ? p.team.agents : [o.to === 'lead' ? lead : p.team.agents.find(a => a.id === o.to)].filter(Boolean);
  if (!targets.length) throw new Error('Pick who it goes to.');
  const about = o.about ? ` (About: ${String(o.about).replace(/\r?\n+/g, ' ')})` : '';
  const kind = o.comment ? 'Comment from the owner' : 'From the owner';
  const sent = [], missed = [];
  if (text.startsWith('/') && !o.comment) {
    // a slash command: run it in the chosen agent(s) as if typed there
    for (const a of targets) { const c = consoles.get(key + ':' + a.id); if (c && c.pty && sendText(c, text, true)) sent.push(a.name); else missed.push(a.name); }
    addFeed(p, 'you', `You ran ${text.split(' ')[0]} in ${(sent.length ? sent : missed).join(', ')}`);
    if (!sent.length) throw new Error(`${missed.join(', ')} isn't running. Start it first.`);
    return { sent, missed, command: true };
  }
  for (const a of targets) {
    const c = consoles.get(key + ':' + a.id);
    let msg = `[${kind}] ${text}${about}`;
    if (o.to === 'lead') msg += ' Route this: send each part to the agent who needs it with send_message, then tell the owner what went where with report_status.';
    if (c && c.pty && sendText(c, msg)) sent.push(a.name); else missed.push(a.name);
  }
  addFeed(p, 'you', `You → ${(sent.length ? sent : missed).join(', ')}${o.comment ? ' (comment)' : ''}: ${text}`);
  if (!sent.length) throw new Error(`${missed.join(', ')} isn't running. Start it first.`);
  return { sent, missed };
}

// Opens Windows voice typing (Win+H) into whatever text box has focus.
function startDictation() {
  if (!IS_WIN) throw new Error('Voice typing uses Windows (Win+H). On this system use your own dictation tool.');
  const ps = 'Add-Type -Namespace W -Name K -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);\';' +
    '[W.K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero);[W.K]::keybd_event(0x48,0,0,[UIntPtr]::Zero);[W.K]::keybd_event(0x48,0,2,[UIntPtr]::Zero);[W.K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {});
  return true;
}

function imageData(f) {
  const st = fs.statSync(f);
  if (st.size > 12 * 1024 * 1024) throw new Error('That image is over 12 MB.');
  const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,` + fs.readFileSync(f).toString('base64');
}

/* ------------------------------------------------------------------ launchers: the apps a project needs open */

function newest(paths) {
  let best = null, t = 0;
  for (const p of paths) { try { const m = fs.statSync(p).mtimeMs; if (m > t) { t = m; best = p; } } catch (e) {} }
  return best;
}
function globDirs(base, test) { try { return fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && (!test || test(d.name))).map(d => path.join(base, d.name)); } catch (e) { return []; } }
function filesIn(dir, re) { try { return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)); } catch (e) { return []; } }

// Reads the team and the project folder and suggests what should be open: editors, game engines, the tools MCP servers talk to.
function detectLaunchers(p) {
  const out = [];
  const LAD = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const PF = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
  const team = p.team || {};
  const mcpKeys = Object.keys(team.mcpServers || {}).join(' ').toLowerCase();
  const usedMcp = (team.agents || []).some(a => Array.isArray(a.mcp) ? a.mcp.length : true);
  const top = (() => { try { return fs.readdirSync(p.path); } catch (e) { return []; } })();
  const has = (re) => top.some(f => re.test(f));
  // Roblox Studio
  const placeFile = top.find(f => /\.rbxlx?$/i.test(f));
  if (/roblox/.test(mcpKeys) || placeFile || has(/^default\.project\.json$/i) || has(/^(wally|rokit|aftman)\.toml$/i)) {
    const exe = IS_WIN ? newest(globDirs(path.join(LAD, 'Roblox', 'Versions')).map(d => path.join(d, 'RobloxStudioBeta.exe'))) : null;
    out.push({ id: 'roblox-studio', name: 'Roblox Studio', why: /roblox/.test(mcpKeys) ? 'An agent uses the Roblox Studio MCP server.' : 'This folder has Roblox project files.',
      run: placeFile ? { type: 'open', target: path.join(p.path, placeFile) } : exe ? { type: 'exe', target: exe, args: [] } : { type: 'url', target: 'roblox-studio:' },
      process: 'RobloxStudioBeta.exe', check: 'Turn on Assistant > Manage MCP Servers > Enable Studio as MCP server.' });
  }
  // Blender
  if (/blender/.test(mcpKeys) || has(/\.blend$/i)) {
    let exe = IS_WIN ? newest(PF.flatMap(pf => globDirs(path.join(pf, 'Blender Foundation')).map(d => path.join(d, 'blender.exe')))) : which('blender');
    if (!exe && IS_WIN) { const steam = path.join(PF[1], 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'); if (fs.existsSync(steam)) exe = steam; }
    const desk = path.join(os.homedir(), 'Desktop', 'Blender.url');
    const blend = top.find(f => /\.blend$/i.test(f));
    out.push({ id: 'blender', name: 'Blender', why: /blender/.test(mcpKeys) ? 'An agent uses the Blender MCP server.' : 'This folder has .blend files.',
      run: exe ? { type: 'exe', target: exe, args: blend ? [path.join(p.path, blend)] : [] } : fs.existsSync(desk) ? { type: 'open', target: desk } : { type: 'missing', target: 'Install Blender from blender.org' },
      process: 'blender.exe', check: 'In Blender press N, open the BlenderMCP tab, click Connect to Claude.' });
  }
  // Unreal Engine
  const uproject = top.find(f => /\.uproject$/i.test(f));
  if (uproject) out.push({ id: 'unreal', name: 'Unreal Engine', why: 'This folder has ' + uproject + '.', run: { type: 'open', target: path.join(p.path, uproject) }, process: 'UnrealEditor.exe' });
  // Unity
  if (fs.existsSync(path.join(p.path, 'ProjectSettings', 'ProjectVersion.txt'))) {
    const hub = IS_WIN ? newest(PF.map(pf => path.join(pf, 'Unity Hub', 'Unity Hub.exe'))) : null;
    out.push({ id: 'unity', name: 'Unity Hub', why: 'This folder is a Unity project.', run: hub ? { type: 'exe', target: hub, args: [] } : { type: 'missing', target: 'Install Unity Hub' }, process: 'Unity Hub.exe' });
  }
  // Godot
  if (has(/^project\.godot$/i)) out.push({ id: 'godot', name: 'Godot', why: 'This folder is a Godot project.', run: { type: 'open', target: path.join(p.path, 'project.godot') }, process: 'Godot' });
  // VS Code (always useful for a code folder)
  const code = IS_WIN ? newest([path.join(LAD, 'Programs', 'Microsoft VS Code', 'Code.exe'), ...PF.map(pf => path.join(pf, 'Microsoft VS Code', 'Code.exe'))]) : which('code');
  out.push({ id: 'vscode', name: 'VS Code', why: 'Opens this project folder.', run: code ? { type: 'exe', target: code, args: [p.path] } : { type: 'missing', target: 'Install VS Code from code.visualstudio.com' }, process: 'Code.exe' });
  // Rojo sync server, if the project uses Rojo
  if (has(/^default\.project\.json$/i)) out.push({ id: 'rojo', name: 'Rojo serve', why: 'default.project.json found: syncs code into Studio.', run: { type: 'command', target: 'rojo serve' }, process: 'rojo.exe' });
  // The project folder itself
  out.push({ id: 'folder', name: 'Project folder', why: 'Opens it in File Explorer.', run: { type: 'open', target: p.path } });
  void usedMcp;
  return out;
}

function launchersFor(p) {
  const detected = detectLaunchers(p);
  const saved = (p.team && Array.isArray(p.team.launchers)) ? p.team.launchers : null;
  if (!saved) return detected.map(l => Object.assign({ enabled: true, auto: true, source: 'detected' }, l));
  const byId = new Map(detected.map(d => [d.id, d]));
  const list = saved.map(s => {
    const d = byId.get(s.id);
    // keep the user's choices, but refresh paths for detected apps (new Studio versions move the exe)
    return d && s.source === 'detected' ? Object.assign({}, d, { enabled: s.enabled !== false, auto: s.auto !== false, source: 'detected' }) : Object.assign({ source: 'custom' }, s);
  });
  for (const d of detected) if (!saved.some(s => s.id === d.id)) list.push(Object.assign({ enabled: true, auto: true, source: 'detected', isNew: true }, d));
  return list;
}

let procCache = { at: 0, names: new Set() };
function runningProcesses() {
  return new Promise((resolve) => {
    if (Date.now() - procCache.at < 4000) return resolve(procCache.names);
    const done = (txt) => {
      const names = new Set();
      for (const line of String(txt || '').split(/\r?\n/)) {
        const m = IS_WIN ? /^"([^"]+)"/.exec(line) : [null, path.basename(line.trim())];
        if (m && m[1]) names.add(m[1].toLowerCase());
      }
      procCache = { at: Date.now(), names };
      resolve(names);
    };
    if (IS_WIN) execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8e6 }, (e, out) => done(out));
    else execFile('ps', ['-A', '-o', 'comm='], { maxBuffer: 8e6 }, (e, out) => done(out));
  });
}

async function listLaunchers(key) {
  const p = projects.get(key);
  const list = launchersFor(p);
  const names = await runningProcesses();
  for (const l of list) l.running = l.process ? names.has(String(l.process).toLowerCase()) || names.has(String(l.process).toLowerCase().replace(/\.exe$/, '')) : null;
  return list;
}

function runLauncher(key, id) {
  const p = projects.get(key);
  const l = launchersFor(p).find(x => x.id === id);
  if (!l) throw new Error('That shortcut is gone. Open Shortcuts to check.');
  const r = l.run || {};
  if (r.type === 'missing') throw new Error(`${l.name} isn't installed: ${r.target}.`);
  if (r.type === 'url') shell.openExternal(r.target);
  else if (r.type === 'open') { shell.openPath(r.target).then(err => { if (err) addFeed(p, 'notice', `Couldn't open ${l.name}: ${err}`); }); }
  else if (r.type === 'exe') {
    const child = require('child_process').spawn(r.target, r.args || [], { cwd: p.path, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => addFeed(p, 'notice', `Couldn't start ${l.name}: ${e.message}`));
    child.unref();
  } else if (r.type === 'command') {
    const child = require('child_process').spawn(IS_WIN ? 'cmd.exe' : 'bash', IS_WIN ? ['/c', 'start', '""', '/D', p.path, 'cmd.exe', '/k', r.target] : ['-lc', r.target], { cwd: p.path, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => addFeed(p, 'notice', `Couldn't run ${l.name}: ${e.message}`));
    child.unref();
  } else throw new Error('Unknown shortcut type.');
  procCache.at = 0;
  addFeed(p, 'open', `Opened ${l.name}.`);
  return true;
}

/* ------------------------------------------------------------------ updates: GitHub first, then a shared folder */
// Every copy checks github.com/<repo> (public) on its own: update/orbie-studio.json on the main branch says the newest
// version and lists every file with its SHA-256. Files are downloaded from that version's git tag and checked before
// anything is replaced. A folder that the owner picked still works as a fallback.

const UPDATE_REPO = 'ki11phil0405-bit/agent-deck';
const PRODUCT = 'orbie-studio';              // an update must carry this name, so an update for another app can never install over Orbie Studio
const UPDATE_LIST = 'update/orbie-studio.json';
const TESTING = !!process.env.AGENT_DECK_SELFTEST && !app.isPackaged;
function updateRepo() {
  const r = settings.updateRepo === undefined ? UPDATE_REPO : settings.updateRepo;
  if (r === '') return '';
  return /^[\w.-]{1,60}\/[\w.-]{1,100}$/.test(String(r)) ? String(r) : UPDATE_REPO;
}
function feed() {
  const base = !app.isPackaged && settings.updateFeedBase; // self-test only
  const repo = updateRepo();
  if (!base && !repo) return null;
  return {
    label: base ? 'test feed' : 'GitHub (' + repo + ')',
    manifest: base ? `${base}/raw/main/${UPDATE_LIST}` : `https://raw.githubusercontent.com/${repo}/main/${UPDATE_LIST}`,
    file: (ref, rel) => (base ? `${base}/raw/${ref}/` : `https://raw.githubusercontent.com/${repo}/${ref}/`) + rel.split('/').map(encodeURIComponent).join('/'),
  };
}
async function getBuf(url, max) {
  const { net } = require('electron');
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Orbie-Studio/' + app.getVersion(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (max && buf.length > max) throw new Error('Download is too big.');
  return buf;
}

// An update folder: the one the owner picked, or the owner's own source folder. Other drives and cloud folders are
// not searched any more: anybody who can write to a shared folder could otherwise offer code to every copy.
function isOurs(d) {
  try { const pkg = readJSON(path.join(d, 'package.json'), null); return !!pkg && pkg.name === PRODUCT && fs.existsSync(path.join(d, 'src', 'main.js')); } catch (e) { return false; }
}
function folderCandidates() {
  return [settings.updateSource, path.join(os.homedir(), 'Documents', 'Orbie')].filter(Boolean);
}
function updateSource() {
  for (const d of folderCandidates()) if (isOurs(d)) return d;
  return '';
}
function newer(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
function sortObj(o) { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; }
function needsInstallerFor(deps, electronV) {
  const mine = readJSON(path.join(app.getAppPath(), 'package.json'), {});
  const sameDeps = JSON.stringify(sortObj(deps)) === JSON.stringify(sortObj(mine.dependencies));
  const want = String(electronV || '').replace(/^[^\d]*/, '');
  return !(sameDeps && (!want || want === process.versions.electron));
}
function notesFrom(text) {
  try { const n = String(text).split(/\n## /)[1] || ''; return n.split('\n').slice(1).join('\n').trim().slice(0, 900); } catch (e) { return ''; }
}

function checkFolder() {
  const src = updateSource();
  const pkg = src ? readJSON(path.join(src, 'package.json'), null) : null;
  if (!pkg || pkg.name !== PRODUCT || !/^\d+\.\d+\.\d+$/.test(String(pkg.version || ''))) return null;
  const available = newer(pkg.version, app.getVersion());
  let notes = ''; try { notes = notesFrom(fs.readFileSync(path.join(src, 'CHANGES.md'), 'utf8')); } catch (e) {}
  return { via: 'folder', available, version: pkg.version, needsInstaller: available && needsInstallerFor(pkg.dependencies, (pkg.agentDeck && pkg.agentDeck.electron) || (pkg.devDependencies || {}).electron), notes, source: src };
}
let lastManifest = null;
async function checkGithub() {
  const f = feed();
  if (!f) return null;
  const m = JSON.parse((await getBuf(f.manifest, 2e6)).toString('utf8'));
  if (!m || !m.version || !Array.isArray(m.files) || !m.ref) throw new Error('The update list on GitHub is not valid.');
  if (m.product !== PRODUCT) throw new Error('The update list on GitHub is for another app.');
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version)) || !/^[\w.-]{1,64}$/.test(String(m.ref)) || String(m.ref).includes('..')) throw new Error('The update list on GitHub is not valid.');
  lastManifest = m;
  const available = newer(m.version, app.getVersion());
  return { via: 'github', available, version: m.version, needsInstaller: available && needsInstallerFor(m.dependencies, m.electron), notes: String(m.notes || '').slice(0, 900), source: f.label, installer: m.installer || '' };
}
async function checkUpdate() {
  let gh = null, ghError = '';
  try { gh = await checkGithub(); } catch (e) { ghError = e.message; }
  let fo = null;
  try { fo = checkFolder(); } catch (e) {}
  // Take whichever offers the newer version; GitHub wins a tie.
  let u = gh && fo ? (newer(fo.version, gh.version) ? fo : gh) : (gh || fo);
  const connected = !!(gh || fo);
  if (!u) u = { available: false };
  return Object.assign({}, u, { current: app.getVersion(), connected, githubError: ghError, github: feed() ? feed().label : '', folder: updateSource() });
}

// Downloads every file of a GitHub version into a staging folder and checks each SHA-256.
async function stageGithub(m) {
  const f = feed();
  const stage = path.join(userDir(), 'update-stage', m.version);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const it of m.files) {
    const rel = String(it.path || '');
    if (!/^src\/[\w .\/-]+$/.test(rel) || rel.includes('..')) throw new Error('Bad file in the update list: ' + rel);
    const buf = await getBuf(f.file(m.ref, rel), 40e6);
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== it.sha256) throw new Error(`${rel} did not match its checksum. Nothing was changed.`);
    const out = path.join(stage, ...rel.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
  }
  return stage;
}
function installFrom(srcRoot, version) {
  const dest = app.getAppPath();
  const backup = path.join(userDir(), 'update-backup', app.getVersion());
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(backup, { recursive: true });
  fs.cpSync(path.join(dest, 'src'), path.join(backup, 'src'), { recursive: true });
  fs.copyFileSync(path.join(dest, 'package.json'), path.join(backup, 'package.json'));
  const vendorMissing = !fs.existsSync(path.join(srcRoot, 'src', 'renderer', 'vendor'));
  fs.cpSync(path.join(srcRoot, 'src'), path.join(dest, 'src'), { recursive: true, force: true,
    filter: (f) => !/selftest\.js$/.test(f) && !(vendorMissing && /[\\/]renderer[\\/]vendor([\\/]|$)/.test(f)) });
  const mine = readJSON(path.join(dest, 'package.json'), {});
  mine.version = version;
  writeJSON(path.join(dest, 'package.json'), mine);
}
async function applyUpdate() {
  const u = await checkUpdate();
  if (!u.available) throw new Error('You already have the newest version.');
  if (u.needsInstaller) throw new Error(`Version ${u.version} changes the app's libraries, so it needs the full installer this one time.`);
  if (!app.isPackaged) throw new Error('This copy runs from source; update it with git or by editing the files.');
  if (u.via === 'github') installFrom(path.dirname(path.join(await stageGithub(lastManifest), 'src')), u.version);
  else installFrom(u.source, u.version);
  quitting = true;
  for (const c of consoles.values()) if (c.pty) { try { c.pty.kill(); } catch (e) {} }
  setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
  return true;
}
// For updates that change the app's libraries: download the installer from GitHub and run it.
async function downloadInstaller() {
  const u = await checkUpdate();
  if (!u.installer) throw new Error('No installer is listed for this version. Ask Cohesive for the newest Orbie-Studio-Setup file.');
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.%-]+\/[\w.%-]+\.exe$/.test(u.installer)) throw new Error('The installer link is not a GitHub release link, so it was not downloaded.');
  const buf = await getBuf(u.installer, 400e6);
  const out = path.join(app.getPath('downloads'), decodeURIComponent(u.installer.split('/').pop()));
  fs.writeFileSync(out, buf);
  if (lastManifest && lastManifest.installerSha256) {
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== lastManifest.installerSha256) { fs.rmSync(out, { force: true }); throw new Error('The installer did not match its checksum, so it was deleted.'); }
  }
  shell.openPath(out);
  setTimeout(() => { quitting = true; for (const c of consoles.values()) if (c.pty) { try { c.pty.kill(); } catch (e) {} } app.quit(); }, 1500);
  return out;
}
let lastOffered = '';
async function pollUpdates() {
  try { const u = await checkUpdate(); if (u.available && u.version !== lastOffered) { lastOffered = u.version; send('update:available', u); } else if (!u.connected) send('update:available', u); } catch (e) {}
}

/* ------------------------------------------------------------------ git */

function git(cwd, args) {
  return new Promise((resolve) => {
    if (!gitPath) return resolve({ ok: false, out: 'Git is not installed. In PowerShell: winget install --id Git.Git -e' });
    execFile(gitPath, args, { cwd, windowsHide: true, maxBuffer: 4e6, timeout: 120000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '') + (stderr || '') });
    });
  });
}
async function gitInfo(key) {
  const p = projects.get(key);
  const st = await git(p.path, ['status', '--porcelain=v1', '-b']);
  if (!st.ok) return { ok: false, error: /not a git repository/i.test(st.out) ? 'This folder is not a git repository.' : st.out.trim() };
  const lines = st.out.split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() || '').replace(/^## /, '');
  const m = /^([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(head) || [];
  const ab = m[3] || '';
  const lg = await git(p.path, ['log', '-6', '--pretty=format:%h\x1f%s\x1f%cr']);
  return {
    ok: true, branch: m[1] || head, upstream: m[2] || '', ahead: +((/ahead (\d+)/.exec(ab) || [])[1] || 0), behind: +((/behind (\d+)/.exec(ab) || [])[1] || 0),
    changed: lines.length, files: lines.slice(0, 12),
    commits: lg.ok ? lg.out.split(/\r?\n/).filter(Boolean).map(l => { const [h, s, w] = l.split('\x1f'); return { h, s, w }; }) : [],
  };
}

/* ------------------------------------------------------------------ files for markdown tiles */

const watchers = new Map();
function resolveFile(p, rel) {
  const full = path.isAbsolute(rel) ? rel : path.join(p.path, rel);
  if (!within(p.path, full) && !within(p.agentsDir, full)) throw new Error('Only files inside the project or its agents folder can be shown.');
  return full;
}
function watchFile(p, rel, binary) {
  const full = resolveFile(p, rel);
  const k = p.key + '|' + full;
  if (watchers.has(k)) return;
  watchers.set(k, true);
  fs.watchFile(full, { interval: 2000 }, () => {
    let text = '';
    if (!binary) { try { text = fs.readFileSync(full, 'utf8'); } catch (e) {} }
    send('file:changed', { key: p.key, rel, text, binary: !!binary });
  });
}

/* ------------------------------------------------------------------ window */

// Window colors for each theme (the strip behind the minimize and close buttons on Windows).
const THEME_BAR = {
  dark: { color: '#14110e', symbolColor: '#e9e4de' },
  light: { color: '#dde5ef', symbolColor: '#12151c' },
  aurora: { color: '#06130f', symbolColor: '#d7efe6' },
  midnight: { color: '#05060c', symbolColor: '#d6dcf5' },
};
function themeBar() { return Object.prototype.hasOwnProperty.call(THEME_BAR, settings.theme) ? THEME_BAR[settings.theme] : THEME_BAR.dark; }
function applyThemeBar() {
  if (!win || win.isDestroyed()) return;
  try { win.setBackgroundColor(themeBar().color); } catch (e) {}
  if (IS_WIN) { try { win.setTitleBarOverlay(Object.assign({ height: 38 }, themeBar())); } catch (e) {} }
}

function createWindow() {
  const b = settings.bounds || { width: 1500, height: 920 };
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 980, minHeight: 620,
    backgroundColor: themeBar().color, show: false, title: 'Orbie Studio',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    titleBarStyle: IS_WIN ? 'hidden' : 'default',
    titleBarOverlay: IS_WIN ? Object.assign({ height: 38 }, themeBar()) : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (settings.maximized) win.maximize(); win.show(); });
  win.webContents.once('did-finish-load', () => { setTimeout(pollUpdates, 4000); setInterval(pollUpdates, 10 * 60000); });
  win.on('focus', () => win.flashFrame(false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Web tiles: an embedded page never gets a preload script, Node, or anything but a web address.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload; delete prefs.preloadURL;
    prefs.nodeIntegration = false; prefs.nodeIntegrationInSubFrames = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true;
    if (!/^(https?:\/\/|about:blank$)/i.test(String(params.src || ''))) e.preventDefault();
  });
  win.on('close', (e) => {
    if (quitting) return;
    const running = [...consoles.values()].filter(c => c.pty).length;
    if (running) {
      const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Close and stop agents', 'Cancel'], defaultId: 1, cancelId: 1,
        title: 'Orbie Studio', message: `${running} agent${running === 1 ? ' is' : 's are'} still running.`, detail: 'Closing Orbie Studio stops them. Each Claude Code agent can resume its conversation next time.' });
      if (r !== 0) { e.preventDefault(); return; }
    }
    settings.maximized = win.isMaximized();
    if (!win.isMaximized()) settings.bounds = win.getBounds();
    saveSettings();
    quitting = true;
    for (const c of consoles.values()) if (c.pty) { try { c.pty.kill(); } catch (x) {} }
  });
}

/* ------------------------------------------------------------------ inbox answers (window and remote) */

function answerInbox(key, itemId, text) {
  const p = projects.get(key);
  if (!p) throw new Error('Project is not open.');
  const it = p.inbox.find(i => i.id === itemId);
  if (!it) return false;
  const c = consoles.get(it.consoleId);
  if (it.kind === 'question') {
    if (!String(text || '').trim()) throw new Error('Write an answer first.');
    if (!sendText(c, `[Answer from the owner] ${text}`)) throw new Error(`${it.agentName} isn't running any more.`);
    addFeed(p, 'answer', `You answered ${it.agentName}: ${text}`);
  }
  clearInbox(p, i => i.id === itemId);
  return true;
}

/* ------------------------------------------------------------------ remote view: what other devices may do */

function remoteApi() {
  const proj = (key) => { const p = projects.get(key); if (!p) throw new Error('That project is not open on the PC.'); return p; };
  const live = (id) => { const c = consoles.get(id); if (!c) throw new Error('That agent has not been started.'); return c; };
  return {
    state: () => ({
      version: app.getVersion(), publisher: 'Cohesive', pc: os.hostname(),
      projects: [...projects.values()].map(p => Object.assign(publicProject(p), { views: p.views || [], board: undefined,
        kanban: (kanbanTile(p, false) || { cards: [] }).cards })),
    }),
    buffer: (id) => { const c = consoles.get(id); return c ? { data: c.buffer.slice(-200000), seq: c.seq || 0 } : { data: '', seq: 0 }; },
    input: (id, data) => writeInput(consoles.get(id), data),
    send: (id, text) => { const c = live(id); if (!sendText(c, text)) throw new Error('That agent isn\'t running.'); const p = projects.get(c.projectKey); const a = agentOf(c); if (p) addFeed(p, 'you', `You (remote) → ${a ? a.name : c.agentId}: ${String(text).slice(0, 300)}`); return true; },
    command: (id, cmd) => runCommand(live(id), cmd),
    say: (key, o) => ownerSay(proj(key).key, o),
    answer: (key, itemId, text) => answerInbox(proj(key).key, itemId, text),
    dismiss: (key, itemId) => { clearInbox(proj(key), i => i.id === itemId); return true; },
    start: (key, agentId, o) => startConsole(proj(key).key, agentId, o),
    stop: (id) => { killConsole(id); return true; },
    resize: (id, cols, rows) => {
      const c = live(id);
      if (!c.pty) throw new Error('That agent isn\'t running.');
      if (!(cols >= 30 && cols <= 400 && rows >= 8 && rows <= 200)) throw new Error('That size does not fit a terminal.');
      try { c.pty.resize(cols, rows); } catch (e) {}
      c.cols = cols; c.rows = rows;
      remote.emit('console:size', { id, cols, rows });
      send('console:remoteSize', { id, cols, rows });
      return true;
    },
    task: (key, a) => {
      const p = proj(key);
      if (!['add', 'move', 'update'].includes(a.action)) throw new Error('Unknown task action.');
      return taskBoard(p, null, 'You', { action: a.action, id: a.id, text: a.text, column: a.column, agent: a.agent });
    },
    image: (key, rel) => { const f = resolveFile(proj(key), String(rel || '')); if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(f)) throw new Error('Not an image.'); return imageData(f); },
    markdown: (key, rel) => { const f = resolveFile(proj(key), String(rel || '')); if (!/\.(md|markdown|txt)$/i.test(f)) throw new Error('Not a markdown file.'); if (fs.statSync(f).size > 2e6) throw new Error('That file is too big to show.'); return fs.readFileSync(f, 'utf8'); },
  };
}

/* ------------------------------------------------------------------ IPC */

function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });
}

function wireIpc() {
  handle('app:init', () => {
    findTools();
    return { settings, updateSource: updateSource(), updateGithub: feed() ? feed().label : '', publisher: 'Cohesive', platform: process.platform, version: app.getVersion(), claudePath, gitPath, curlPath, presets: PRESETS.list.map(x => ({ id: x.id, name: x.name, blurb: x.blurb, count: x.count })) };
  });
  handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a project folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('updateSource:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the Orbie Studio update folder', defaultPath: updateSource() || app.getPath('home'), properties: ['openDirectory'] });
    if (r.canceled) return updateSource();
    let d = r.filePaths[0];
    if (!isOurs(d)) throw new Error('That folder has no Orbie Studio update in it. Pick the folder that holds the Orbie Studio code.');
    settings.updateSource = d; saveSettings(); return settings.updateSource;
  });
  handle('agentsRoot:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose your agents folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return settings.agentsRoot;
    settings.agentsRoot = r.filePaths[0]; saveSettings(); return settings.agentsRoot;
  });
  handle('file:pick', async (key, kind) => {
    const p = projects.get(key);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a file', defaultPath: p.path, properties: ['openFile'], filters: kind === 'image' ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] : [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
    if (r.canceled) return null;
    const f = r.filePaths[0];
    resolveFile(p, f);
    return within(p.path, f) ? path.relative(p.path, f) : f;
  });
  handle('project:open', (p) => openProject(p));
  handle('project:close', (key) => {
    const p = projects.get(key);
    if (!p) return true;
    for (const c of consoles.values()) if (c.projectKey === key && c.pty) { try { c.pty.kill(); } catch (e) {} }
    settings.openTabs = settings.openTabs.filter(t => norm(t) !== norm(p.path));
    saveSettings();
    projects.delete(key);
    return true;
  });
  handle('project:preset', (key, id) => applyPreset(key, id));
  handle('presets:for', (key) => { const p = projects.get(key); return PRESETS.forFolder(p ? p.path : ''); });
  handle('team:save', (key, team) => { const p = projects.get(key); team.projectPath = p.path; p.team = team; writeJSON(projectFiles(p).team, team); addFeed(p, 'team', 'Team saved. Changes apply the next time each agent starts.'); return publicProject(p); });
  handle('board:save', (key, board) => { const p = projects.get(key); if (!p) return false; p.board = board; writeJSON(projectFiles(p).board, board); return true; });
  handle('loops:save', (key, loops) => { const p = projects.get(key); p.loops = loops.map(l => Object.assign({}, l, { nextAt: 0 })); saveLoops(p); return p.loops; });
  handle('console:start', (key, agentId, opts) => startConsole(key, agentId, opts));
  handle('console:kill', (id) => { killConsole(id); return true; });
  handle('console:buffer', (id) => { const c = consoles.get(id); return c ? c.buffer : ''; });
  ipcMain.on('console:input', (e, id, data) => writeInput(consoles.get(id), data));
  ipcMain.on('console:resize', (e, id, cols, rows) => {
    const c = consoles.get(id);
    if (c && c.pty && cols > 2 && rows > 1) {
      try { c.pty.resize(cols, rows); } catch (x) {}
      if (c.cols !== cols || c.rows !== rows) { c.cols = cols; c.rows = rows; if (remote) remote.emit('console:size', { id, cols, rows }); }
    }
  });
  handle('console:send', (id, text) => sendText(consoles.get(id), text));
  handle('console:command', (id, cmd) => runCommand(consoles.get(id), cmd));
  handle('broadcast', (key, ids, text) => {
    const p = projects.get(key);
    const names = [];
    for (const id of ids) { const c = consoles.get(id); if (c && sendText(c, text)) names.push(agentOf(c).name); }
    addFeed(p, 'message', `You → ${names.join(', ') || 'nobody'}: ${text}`);
    return names.length;
  });
  handle('handoff', (key, o) => uiHandoff(key, o));
  handle('owner:say', (key, o) => ownerSay(key, o));
  handle('update:check', async () => { const u = await checkUpdate(); if (u.available) lastOffered = u.version; return u; });
  handle('update:installer', () => downloadInstaller());
  handle('update:apply', () => applyUpdate());
  handle('team:suggest', (key) => suggestTeam(key));
  handle('suggest:edits', (key, o) => suggestEdits(key, o));
  handle('markup:send', (key, o) => sendMarkup(key, o));
  handle('usage', (key, days) => usageReport(key, days));
  handle('launchers:list', (key) => listLaunchers(key));
  handle('launchers:run', (key, id) => runLauncher(key, id));
  handle('launchers:save', (key, list) => {
    const p = projects.get(key);
    p.team.launchers = list.map(l => ({ id: l.id, name: l.name, why: l.why, run: l.run, process: l.process, check: l.check, enabled: l.enabled !== false, auto: l.auto !== false, source: l.source || 'custom' }));
    writeJSON(projectFiles(p).team, p.team);
    return listLaunchers(key);
  });
  handle('dictate', () => startDictation());
  handle('file:image', (key, rel) => { const p = projects.get(key); const f = resolveFile(p, rel); watchFile(p, rel, true); return imageData(f); });
  handle('inbox:answer', (key, itemId, text) => answerInbox(key, itemId, text));
  handle('inbox:dismiss', (key, itemId) => { const p = projects.get(key); clearInbox(p, i => i.id === itemId); return true; });
  handle('replies:list', (key) => { const p = projects.get(key); return p ? p.replies : []; });
  handle('remote:info', () => remote.info());
  handle('remote:set', (patch) => remote.set(patch));
  handle('remote:newCode', () => remote.newCode());
  handle('remote:signout', (id) => remote.signOut(id));
  handle('git:info', (key) => gitInfo(key));
  handle('git:run', async (key, action, message) => {
    const p = projects.get(key);
    let r;
    if (action === 'pull') r = await git(p.path, ['pull', '--ff-only']);
    else if (action === 'push') r = await git(p.path, ['push']);
    else if (action === 'commit') {
      if (!String(message || '').trim()) throw new Error('Write a commit message first.');
      const a = await git(p.path, ['add', '-A']);
      r = a.ok ? await git(p.path, ['commit', '-m', message]) : a;
    } else throw new Error('Unknown git action.');
    addFeed(p, 'git', `git ${action}: ${r.ok ? 'done' : 'failed'}`);
    return r;
  });
  handle('file:read', (key, rel) => { const p = projects.get(key); const f = resolveFile(p, rel); watchFile(p, rel); return fs.readFileSync(f, 'utf8'); });
  // Folders only: the window can show a folder, but it can never ask the PC to run a file.
  handle('open:path', (target) => {
    const t = String(target || '');
    let dir = false; try { dir = path.isAbsolute(t) && fs.statSync(t).isDirectory(); } catch (e) {}
    if (!dir) throw new Error('Only folders can be opened this way.');
    return shell.openPath(t);
  });
  handle('open:external', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (t) => { clipboard.writeText(String(t)); return true; });
  // The window may change only these settings. Where updates come from is never one of them.
  handle('settings:save', (patch) => {
    const ok = {};
    if (patch && typeof patch.theme === 'string' && Object.prototype.hasOwnProperty.call(THEME_BAR, patch.theme)) ok.theme = patch.theme;
    if (TESTING && patch) for (const k of ['updateFeedBase', 'updateSource']) if (typeof patch[k] === 'string') ok[k] = patch[k];
    Object.assign(settings, ok); saveSettings(); applyThemeBar();
    return settings;
  });
}

/* ------------------------------------------------------------------ boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    if (IS_WIN) app.setAppUserModelId('com.cohesive.orbiestudio');
    const st = process.env.AGENT_DECK_SELFTEST && !app.isPackaged ? require('./selftest') : null;
    if (st) st.before(app); else importOldSettings();
    loadSettings();
    await startServer();
    remote = createRemote({
      settings: () => settings, saveSettings, api: remoteApi(),
      notify: (t, b) => notify(t, b),
      onChange: (i) => { if (win && !win.isDestroyed()) win.webContents.send('remote:update', i); },
    });
    remote.start();
    wireIpc();
    if (st) st.prepare({ settings, saveSettings });
    createWindow();
    if (st) st.after(win, { projects, consoles, updater: { check: checkUpdate, stage: stageGithub, manifest: () => lastManifest }, port: () => port, quit: () => { quitting = true; app.quit(); } });
  });
  app.on('window-all-closed', () => { if (remote) remote.stop(); app.quit(); });
  // Embedded pages (web tiles): links open in the real browser, and a page gets no camera, microphone or other permission.
  app.on('web-contents-created', (e, wc) => {
    if (wc.getType() !== 'webview') return;
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (ev, url) => { if (!/^https?:\/\//i.test(url)) ev.preventDefault(); });
    try { const { session } = require('electron'); if (wc.session !== session.defaultSession) { wc.session.setPermissionRequestHandler((w, perm, cb) => cb(false)); wc.session.setPermissionCheckHandler(() => false); } } catch (x) {}
  });
}
