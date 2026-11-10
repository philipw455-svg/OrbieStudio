// Orbie Studio: the window. Draws projects, the board of tiles, the terminals and the side rail.
// Everything that touches the PC (terminals, files, git, hooks) happens in the main process through window.deck.
'use strict';

const D = window.deck;
const S = { info: null, tabs: [], active: null, z: 10 };
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const STATUS_WORD = { off: 'Not started', starting: 'Starting', working: 'Working', resting: 'Ready', needs: 'Needs you', exited: 'Stopped' };
const MODELS = [['', 'Default'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5'], ['claude-fable-5-1', 'Fable 5.1']];
const MODES = [['default', 'Ask before acting'], ['acceptEdits', 'Accept file edits'], ['plan', 'Plan only (read only)'], ['bypassPermissions', 'Skip all approvals (risky)']];

/* ------------------------------------------------------------------ helpers */

function put(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false).map(k => (k.nodeType ? k : document.createTextNode(String(k))))); }
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only ever trusted constant strings (icons)
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const I = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7-4.5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
  restart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3"/><path d="M3.2 2.6v2.6h2.6"/></svg>',
  max: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>',
  min: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="7" height="7" rx="1.5"/><path d="M3 10V4a1 1 0 0 1 1-1h6"/></svg>',
  handoff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h9"/><path d="M8.5 4.5 12 8l-3.5 3.5"/><path d="M13.5 3v10"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12.5 8A4.5 4.5 0 1 1 11 4.6"/><path d="M12.8 2.6v2.8H10"/></svg>',
  comment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/></svg>',
  mic: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5.5" y="1.8" width="5" height="8" rx="2.5"/><path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2"/></svg>',
  speak: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6v4h2.6L8.5 13V3L5.1 6z"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.9a5.8 5.8 0 0 1 0 8.2"/></svg>',
  send: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5 14.5 8 2 13.5l1.6-5.5z"/></svg>',
  pen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.8l2.7 2.7-7.6 7.6-3.3.6.6-3.3z"/><path d="M9.3 4l2.7 2.7"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h7M3 7.5h5M3 11h3.5"/><path d="M11.8 7.2l1.9 1.9-4.2 4.2-2.2.4.4-2.2z"/></svg>',
  reply: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M5 6h6M5 8.2h4"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4"/><path d="M13 3 7.5 8.5"/><path d="M11 9.5V13H3V5h3.5"/></svg>',
};
function icon(name, title, onClick, cls) {
  return h('button', { class: 'icon-btn' + (cls ? ' ' + cls : ''), title, 'aria-label': title, html: I[name], on: { click: (e) => { e.stopPropagation(); onClick(e); } } });
}
function toast(msg, kind) {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), text: msg });
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6500 : 3500);
}
async function safely(fn) { try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); return undefined; } }
function slug(s) { return String(s || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'; }
function uid() { return Math.random().toString(36).slice(2, 10); }
function hhmm(t) { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function ago(t) { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000); if (s < 60) return s + 's'; const m = Math.round(s / 60); if (m < 60) return m + 'm'; return Math.round(m / 60) + 'h'; }
function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function wsByKey(key) { return S.tabs.find(w => w.key === key); }
function activeWs() { return S.tabs.find(w => w.key === S.active) || null; }
function agentById(ws, id) { return ws.team ? ws.team.agents.find(a => a.id === id) : null; }
function statusOf(ws, agentId) { const c = ws.status[agentId]; return c ? c.status : 'off'; }
function running(ws, agentId) { const s = statusOf(ws, agentId); return s !== 'off' && s !== 'exited'; }

/* ------------------------------------------------------------------ menus + modals */

let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function menu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(it => it.sep ? h('div', { class: 'm-sep', role: 'separator' }) : it.head ? h('div', { class: 'm-head-l', text: it.head }) :
    h('button', { role: 'menuitem', disabled: !!it.disabled, title: it.title || null, on: { click: () => { closeMenu(); it.run(); } } }, h('span', { class: 'ml' }, h('span', { text: it.label }), it.sub ? h('span', { class: 'ms', text: it.sub }) : null), it.k ? h('span', { class: 'k', text: it.k }) : null)));
  document.body.append(m);
  const w = m.offsetWidth;
  m.style.left = Math.min(r.left, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8)) + 'px';
  openMenuEl = m;
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off); } }), 0);
}

let modalStack = [];
function modal({ title, body, wide, actions, onClose }) {
  const close = () => { scrim.remove(); modalStack = modalStack.filter(x => x !== close); if (onClose) onClose(); };
  const foot = h('div', { class: 'm-foot' }, (actions || [{ label: 'Close' }]).map(a => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + (a.left ? ' left' : ''), text: a.label, disabled: a.disabled,
    on: { click: async (e) => {
      if (a.onClick) {
        const btn = e.currentTarget; btn.disabled = true;
        let keep;
        try { keep = await a.onClick(); } catch (err) { btn.disabled = false; toast(err.message || String(err), 'err'); return; }
        btn.disabled = false;
        if (keep === false) return;
      }
      close();
    } },
  })));
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'm-head' }, h('h2', { text: title }), icon('x', 'Close', close)),
    h('div', { class: 'm-body' }, body), foot);
  const scrim = h('div', { class: 'scrim', on: { mousedown: (e) => { if (e.target === scrim) close(); } } }, box);
  document.getElementById('modal-root').append(scrim);
  modalStack.push(close);
  setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]):not([type=radio]),textarea,select'); if (f) f.focus(); }, 30);
  return close;
}
function confirmBox(title, text, okLabel, danger) {
  return new Promise((res) => {
    modal({ title, body: h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text }), onClose: () => res(false),
      actions: [{ label: 'Cancel' }, { label: okLabel || 'OK', primary: !danger, danger, onClick: () => { res(true); } }] });
  });
}
function field(label, control, hint) { return h('div', { class: 'field' }, h('label', { text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null); }
function select(options, value) { const s = h('select', { class: 'select' }); for (const [v, l] of options) s.append(h('option', { value: v, text: l, selected: String(v) === String(value) })); return s; }

/* ------------------------------------------------------------------ title bar */

function renderTabs() {
  if (typeof pageDirty === 'function') pageDirty();
  const nav = document.getElementById('tabs');
  put(nav, ...S.tabs.map(ws => {
    const needs = ws.inbox.length;
    return h('div', { class: 'tab' + (ws.key === S.active ? ' on' : ''), role: 'tab', tabindex: 0, title: ws.path,
      on: { click: () => activate(ws.key), keydown: (e) => { if (e.key === 'Enter') activate(ws.key); } } },
      h('span', { class: 'tn', text: ws.name }),
      needs ? h('span', { class: 'badge', title: `${needs} waiting on you`, text: needs }) : null,
      h('button', { class: 'x', title: 'Close project', 'aria-label': 'Close project', text: '×', on: { click: (e) => { e.stopPropagation(); closeTab(ws); } } }));
  }));
}

function activate(key) {
  S.active = key;
  for (const ws of S.tabs) ws.el.hidden = ws.key !== key;
  document.getElementById('welcome').hidden = !!key;
  if (!key) renderWelcome();
  renderTabs();
  const ws = activeWs();
  if (ws) { positionTiles(ws); refitAll(ws); }
  // pages.js: opening or picking a game shows its Studio; with no game the Home screen shows
  if (typeof paintPage === 'function') { if (key && S.booted) S.page = 'studio'; if (!key && S.page === 'studio') S.page = 'home'; paintPage(); }
}

async function closeTab(ws) {
  const live = Object.keys(ws.status).filter(id => running(ws, id)).length;
  if (live && !(await confirmBox('Close project?', `${live} agent${live === 1 ? ' is' : 's are'} running in ${ws.name}. Closing the project stops them.`, 'Close and stop', true))) return;
  await safely(() => D.closeProject(ws.key));
  for (const t of Object.values(ws.terms)) t.term.dispose();
  ws.el.remove();
  S.tabs = S.tabs.filter(x => x !== ws);
  activate(S.tabs.length ? S.tabs[S.tabs.length - 1].key : null);
}

/* ------------------------------------------------------------------ welcome */

function renderWelcome() {
  const info = S.info;
  let el = document.getElementById('welcome');
  if (!el) { el = h('section', { id: 'welcome', class: 'screen welcome' }); document.getElementById('screens').append(el); }
  const recent = (info.settings.recent || []);
  const ok = (good, title, sub) => h('div', { class: 'check' }, h('span', { class: good ? 'ok' : 'no', text: good ? '✓' : '!' }), h('div', null, h('b', { text: title }), h('div', { class: 'sub' }, sub)));
  put(el, h('div', { class: 'welcome-in' },
    h('div', { class: 'hero' }, h('img', { src: 'logo.svg', alt: '' }), h('div', null, h('h1', { text: 'Orbie Studio' }), h('p', { class: 'tagline', text: 'Your team\'s AI game studio' }), h('p', { class: 'lede', text: 'Pick a project folder and its agents start up side by side: real Claude Code terminals on one board, talking to each other, with you in the loop.' }))),
    h('div', { class: 'w-actions' },
      h('button', { class: 'btn primary', on: { click: openProjectFlow } }, 'Open project folder', h('span', { class: 'k', text: 'Ctrl+O' })),
      S.tabs.length ? h('button', { class: 'btn', text: 'Back to ' + S.tabs[S.tabs.length - 1].name, on: { click: () => activate(S.tabs[S.tabs.length - 1].key) } }) : null),
    h('div', { class: 'w-grid' },
      h('div', { class: 'card' }, h('h2', { text: 'Recent projects' }),
        recent.length ? h('div', { class: 'recent' }, recent.map(r => h('button', { on: { click: () => openPath(r.path) } }, h('span', { class: 'rn', text: r.name }), h('span', { class: 'rp', text: r.path }))))
          : h('p', { class: 'empty-note', text: 'Nothing yet. Open a folder to start.' })),
      h('div', { class: 'card' }, h('h2', { text: 'This PC' }),
        h('div', { class: 'checks' },
          ok(!!info.claudePath, 'Claude Code', info.claudePath ? h('code', { text: info.claudePath }) : ['Not found. In PowerShell: ', h('code', { text: 'irm https://claude.ai/install.ps1 | iex' })]),
          ok(!!info.curlPath, 'Status lights', info.curlPath ? 'Agents report working / needs you through curl.' : 'curl not found, so status comes from terminal activity only.'),
          ok(!!info.gitPath, 'Git', info.gitPath ? h('code', { text: info.gitPath }) : ['Not found. In PowerShell: ', h('code', { text: 'winget install --id Git.Git -e' })]),
          ok(!!(info.updateGithub || info.updateSource), 'Updates', h('span', null, h('code', { text: [info.updateGithub, info.updateSource].filter(Boolean).join(' · ') || 'not connected' }), ' ',
            h('button', { class: 'btn sm ghost', text: 'Change', on: { click: async () => { const r = await safely(() => D.pickUpdateSource()); if (r) { S.info.updateSource = r; renderWelcome(); const u = await D.checkUpdate().catch(() => null); if (u) showUpdate(u); } } } }))),
          ok(true, 'Remote view', h('span', null, S.remote && S.remote.enabled ? (S.remote.listening ? `On. ${S.remote.devices.length} paired device${S.remote.devices.length === 1 ? '' : 's'}.` : 'On, but not running: ' + (S.remote.error || 'starting')) : 'Off. Turn it on to open this board from your Mac or phone.', ' ',
            h('button', { class: 'btn sm ghost', text: 'Set up', on: { click: remoteModal } }))),
          ok(!!info.settings.agentsRoot, 'Agents folder', h('span', null, info.settings.agentsRoot ? h('code', { text: info.settings.agentsRoot }) : 'Not set. Teams are saved in each project\'s .agents folder.', ' ',
            h('button', { class: 'btn sm ghost', text: 'Change', on: { click: async () => { const r = await safely(() => D.pickAgentsRoot()); if (r !== undefined) { S.info.settings.agentsRoot = r; renderWelcome(); } } } })))),
      )),
    h('p', { class: 'empty-note' }, `Orbie Studio ${info.version}, created and published by ${info.publisher || 'Cohesive'}. `,
      h('button', { class: 'btn sm ghost', text: 'Check for updates', on: { click: async () => { const u = await safely(() => D.checkUpdate()); if (u) { if (u.available) { showUpdate(u); updateModal(u); } else toast(`You have the newest version (${u.current}).`); } } } }),
      ' Agents run on your own Claude Code sign-in; nothing leaves this PC except what Claude Code itself sends.')));
}

async function openProjectFlow() {
  const p = await safely(() => D.pickProject());
  if (p) openPath(p);
}

async function openPath(p) {
  const existing = S.tabs.find(w => w.path.toLowerCase() === p.toLowerCase());
  if (existing) { activate(existing.key); return; }
  const proj = await safely(() => D.openProject(p));
  if (!proj) return;
  const ws = makeWs(proj);
  S.tabs.push(ws);
  activate(ws.key);
  if (!ws.team) choosePreset(ws);
}

/* ------------------------------------------------------------------ workspace */

function makeWs(p) {
  const ws = {
    key: p.key, path: p.path, name: p.name, agentsDir: p.agentsDir, team: p.team, board: p.board, loops: p.loops || [], sessions: p.sessions || {},
    feed: p.feed || [], inbox: p.inbox || [], replies: p.replies || [], status: {}, terms: {}, tiles: {}, focused: null, lastZoom: null,
  };
  for (const c of p.consoles || []) ws.status[c.agentId] = c;
  ws.save = debounce(() => D.saveBoard(ws.key, ws.board).catch(() => {}), 600);
  buildWsDom(ws);
  if (ws.team) setupBoard(ws);
  renderSide(ws);
  for (const c of p.consoles || []) replay(ws, c);
  loadLaunchers(ws);
  return ws;
}

async function replay(ws, c) {
  const t = ws.terms[c.agentId];
  if (!t) return;
  const buf = await D.buffer(c.id).catch(() => '');
  if (buf) t.term.write(buf);
}

function buildWsDom(ws) {
  const zoomLabel = h('span', { text: '100%' });
  ws.zoomLabel = zoomLabel;
  ws.boardEl = h('div', { class: 'board', tabindex: -1 });
  ws.layer = h('div', { class: 'layer' });
  ws.linkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ws.linkSvg.setAttribute('class', 'links');
  ws.layer.append(ws.linkSvg);
  ws.boardEl.append(ws.layer, buildComposer(ws));
  ws.mapEl = h('div', { class: 'map' });
  ws.inboxEl = h('div', { class: 'inbox' });
  ws.inboxCount = h('span', { class: 'count' });
  ws.feedEl = h('ul', { class: 'feed' });
  ws.repliesEl = h('div', { class: 'replies' });
  const tb = h('div', { class: 'toolbar' },
    h('button', { class: 'proj', title: 'Folder menu: switch folder, open in Explorer, recent projects', on: { click: (e) => menu(e.currentTarget, folderItems(ws)) } }, h('b', null, ws.name, h('span', { class: 'caret', text: ' ▾' })), h('span', { class: 'pp', text: ws.path })),
    h('button', { class: 'btn primary', title: 'Start the agents (Ctrl+Shift+L)', on: { click: () => launchTeam(ws) } }, 'Launch team'),
    h('button', { class: 'btn', title: 'Move a task to another agent (Ctrl+Shift+H)', text: 'Hand off', on: { click: () => handoffModal(ws) } }),
    h('button', { class: 'btn', title: 'Message several agents (Ctrl+Shift+B)', text: 'Broadcast', on: { click: () => broadcastModal(ws) } }),
    h('button', { class: 'btn', text: 'Loops', on: { click: () => loopsModal(ws) } }),
    h('button', { class: 'btn', text: 'Team', on: { click: () => teamModal(ws) } }),
    h('button', { class: 'btn', text: 'Usage', title: 'Token usage by agent and day', on: { click: () => usageModal(ws) } }),
    h('div', { class: 'tb-sep' }),
    h('button', { class: 'btn ghost', text: 'Add ▾', on: { click: (e) => menu(e.currentTarget, [
      { label: 'Sticky note', run: () => addTile(ws, { type: 'note', w: 300, h: 220, text: '' }) },
      { label: 'Task board (kanban)', run: () => addTile(ws, { type: 'kanban', w: 980, h: 420, cards: [] }) },
      { label: 'Checklist', run: () => addTile(ws, { type: 'checklist', w: 320, h: 300, items: [] }) },
      { label: 'Markdown file…', run: () => addMarkdown(ws) },
      { label: 'Image file…', run: () => addImage(ws) },
      { label: 'Web preview', run: () => addTile(ws, { type: 'web', w: 620, h: 440, url: 'http://localhost:3000' }) },
      { label: 'Git card', run: () => addTile(ws, { type: 'git', w: 360, h: 340 }) },
    ]) } }),
    h('button', { class: 'btn ghost', text: 'Layout ▾', on: { click: (e) => menu(e.currentTarget, [
      { label: 'Agents view (top to bottom)', run: () => arrange(ws, 'tree') },
      { label: 'Lead + stack', run: () => arrange(ws, 'lead') },
      { label: 'Grid', run: () => arrange(ws, 'grid') },
      { label: 'One row', run: () => arrange(ws, 'row') },
      { label: 'Fit everything', k: 'Ctrl+0', run: () => fitAll(ws) },
    ]) } }),
    h('div', { class: 'tb-spacer' }),
    (ws.launchEl = h('div', { class: 'launchers', 'aria-label': 'Apps this project needs' })),
    h('div', { class: 'zoom' }, h('button', { class: 'icon-btn', title: 'Zoom out (Ctrl+-)', 'aria-label': 'Zoom out', text: '−', on: { click: () => zoomBy(ws, 1 / 1.15) } }),
      h('button', { class: 'zoom-pct', title: 'Fit everything (Ctrl+0)', on: { click: () => fitAll(ws) } }, zoomLabel),
      h('button', { class: 'icon-btn', title: 'Zoom in (Ctrl+=)', 'aria-label': 'Zoom in', text: '+', on: { click: () => zoomBy(ws, 1.15) } })),
    h('button', { class: 'btn ghost sm', title: 'Show or hide the side panel (Ctrl+\\)', text: '⇥', 'aria-label': 'Toggle side panel', on: { click: () => toggleRail(ws) } }),
    remoteButton(),
    h('button', { class: 'btn ghost sm', text: '?', title: 'Shortcuts (F1)', on: { click: helpModal } }));
  const side = h('aside', { class: 'side' },
    h('section', null, h('div', { class: 'sec-h' }, h('h3', { text: 'Mission map' })), ws.mapEl),
    h('section', null, h('div', { class: 'sec-h' }, h('h3', { text: 'Needs you' }), ws.inboxCount), ws.inboxEl),
    h('section', { class: 'replies-sec' }, h('div', { class: 'sec-h' }, h('h3', { text: 'Replies' }), h('button', { class: 'btn sm ghost', text: 'All', title: 'Every reply, newest first', on: { click: () => repliesModal(ws) } })), ws.repliesEl),
    h('section', { class: 'grow' }, h('div', { class: 'sec-h' }, h('h3', { text: 'Feed' })), ws.feedEl));
  ws.el = h('section', { class: 'screen' }, tb, h('div', { class: 'ws-body' }, ws.boardEl, side));
  document.getElementById('screens').append(ws.el);
  wireBoard(ws);
  const relayout = debounce(() => { if (ws.board && ws.board.mode === 'tree' && ws.key === S.active) arrange(ws, 'tree', true); }, 150);
  new ResizeObserver(() => { positionTiles(ws); relayout(); }).observe(ws.boardEl);
  try { if (localStorage.getItem('deck.rail') === 'off') ws.el.classList.add('rail-off'); } catch (e) {}
}

/* ------------------------------------------------------------------ presets */

async function choosePreset(ws) {
  const fit = await D.presetsFor(ws.key).catch(() => null);
  const presets = fit ? fit.presets : S.info.presets;
  let pick = fit ? fit.best : presets[0].id;
  const found = fit ? fit.detected : null;
  const cards = h('div', { class: 'presets' });
  const draw = () => put(cards, ...presets.map(p => h('button', { class: 'preset' + (p.id === pick ? ' sel' : ''), on: { click: () => { pick = p.id; draw(); } } },
    h('em', { text: p.count + (p.count === 1 ? ' console' : ' consoles') }), h('b', { text: p.name }), h('span', { text: p.blurb }))));
  draw();
  modal({ title: `Set up agents for ${ws.name}`, wide: false,
    body: [h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)' }, 'No team was found for this folder. Pick a starting point; you can change every agent afterwards in Team. It is saved in ', h('code', { class: 'mono', text: ws.agentsDir }), '.'),
      found ? h('p', { class: 'detected' }, h('b', { text: found.empty ? 'New game: ' : 'Found: ' }), found.empty ? 'this folder is empty, so the designer starts by asking you about your idea and writing GAME_PLAN.md.' : `a ${found.label} project${found.blend ? ' with Blender files' : ''}. The builder and tests are set up for it.`) : null,
      cards],
    actions: [{ label: 'Suggest a team for this folder', left: true, onClick: () => { suggestTeamFlow(ws); } }, { label: 'Not now' }, { label: 'Use this team', primary: true, onClick: async () => {
      const p = await D.applyPreset(ws.key, pick);
      ws.team = p.team; ws.loops = p.loops || []; ws.name = p.name;
      setupBoard(ws); renderSide(ws); renderTabs(); fillComposerTargets(ws); loadLaunchers(ws);
      toast('Team saved. Press Launch team to start the agents.');
    } }] });
}

/* ------------------------------------------------------------------ board */

function defaultBoard(team) {
  const tiles = [];
  const agents = team.agents;
  const view = { x: 0, y: 0, z: 1 };
  if (agents.length >= 3) {
    tiles.push({ id: uid(), type: 'console', agentId: agents[0].id, x: 20, y: 20, w: 760, h: 640 });
    agents.slice(1).forEach((a, i) => tiles.push({ id: uid(), type: 'console', agentId: a.id, x: 800, y: 20 + i * 330, w: 640, h: 310 }));
  } else {
    agents.forEach((a, i) => tiles.push({ id: uid(), type: 'console', agentId: a.id, x: 20 + i * 740, y: 20, w: 720, h: 560 }));
  }
  const right = Math.max(...tiles.map(t => t.x + t.w)) + 20;
  tiles.push({ id: uid(), type: 'note', x: right, y: 20, w: 320, h: 230, text: '', title: 'Notes' });
  tiles.push({ id: uid(), type: 'git', x: right, y: 270, w: 320, h: 330 });
  const bottom = Math.max(...tiles.map(t => t.y + t.h)) + 30;
  tiles.push({ id: uid(), type: 'kanban', x: 20, y: bottom, w: 1100, h: 400, cards: [] });
  return { view, tiles };
}

function setupBoard(ws) {
  const fresh = !ws.board || !Array.isArray(ws.board.tiles);
  if (fresh) ws.board = defaultBoard(ws.team);
  ws.board.view = ws.board.view || { x: 0, y: 0, z: 1 };
  syncConsoleTiles(ws);
  renderTiles(ws);
  requestAnimationFrame(() => { if ((fresh && ws.team.agents.length >= 3) || ws.board.mode === 'tree') arrange(ws, 'tree', true); else fitAll(ws, true); });
}

function syncConsoleTiles(ws) {
  const ids = new Set(ws.team.agents.map(a => a.id));
  ws.board.tiles = ws.board.tiles.filter(t => t.type !== 'console' || ids.has(t.agentId));
  const have = new Set(ws.board.tiles.filter(t => t.type === 'console').map(t => t.agentId));
  let y = Math.max(20, ...ws.board.tiles.map(t => t.y + t.h + 20));
  for (const a of ws.team.agents) if (!have.has(a.id)) { ws.board.tiles.push({ id: uid(), type: 'console', agentId: a.id, x: 20, y, w: 640, h: 360 }); y += 380; }
  for (const [id, el] of Object.entries(ws.tiles)) if (!ws.board.tiles.some(t => t.id === id)) { el.remove(); delete ws.tiles[id]; }
  for (const agentId of Object.keys(ws.terms)) if (!ids.has(agentId)) { ws.terms[agentId].term.dispose(); delete ws.terms[agentId]; }
}

function tileColor(ws, t) {
  if (t.type === 'console' || t.owner) { const a = agentById(ws, t.agentId || t.owner); return a ? a.color : COLORS[0]; }
  return { note: '#c98500', checklist: '#199e70', markdown: '#3987e5', web: '#9085e9', git: '#d95926', kanban: '#d55181', image: '#3987e5', text: '#9085e9' }[t.type] || '#3987e5';
}

function renderTiles(ws) {
  for (const t of ws.board.tiles) if (!ws.tiles[t.id]) mountTile(ws, t);
  positionTiles(ws);
  renderSide(ws);
}

function positionTiles(ws) {
  if (!ws.board) return;
  const v = ws.board.view, z = v.z;
  for (const t of ws.board.tiles) {
    const el = ws.tiles[t.id];
    if (!el) continue;
    el.style.left = Math.round((t.x - v.x) * z) + 'px';
    el.style.top = Math.round((t.y - v.y) * z) + 'px';
    el.style.width = Math.round(t.w * z) + 'px';
    el.style.height = Math.round(t.h * z) + 'px';
  }
  ws.boardEl.style.backgroundSize = `${Math.round(22 * z)}px ${Math.round(22 * z)}px`;
  ws.boardEl.style.backgroundPosition = `${Math.round(-v.x * z)}px ${Math.round(-v.y * z)}px`;
  if (ws.zoomLabel) ws.zoomLabel.textContent = Math.round(z * 100) + '%';
  drawLinks(ws);
  if (ws.lastZoom !== z) {
    ws.lastZoom = z;
    const fs = clamp(Math.round(13 * z * 2) / 2, 8, 18);
    for (const t of Object.values(ws.terms)) if (t.term.options.fontSize !== fs) t.term.options.fontSize = fs;
  }
  refitAll(ws);
}

const refitAll = debounce((ws) => { for (const t of Object.values(ws.terms)) fitTerm(t); }, 70);
function fitTerm(t) { try { if (t.el.offsetParent && t.el.clientWidth > 30 && t.el.clientHeight > 20) t.fit.fit(); } catch (e) {} }

function mountTile(ws, t) {
  const color = tileColor(ws, t);
  const head = h('div', { class: 't-head' });
  const body = h('div', { class: 't-body' + (t.type === 'console' ? '' : ' paper') });
  const el = h('div', { class: 'tile', style: { '--c': color, zIndex: ++S.z }, dataset: { tile: t.id } }, head, body, h('div', { class: 'resize', title: 'Resize' }));
  ws.tiles[t.id] = el;
  ws.layer.append(el);
  el.addEventListener('mousedown', () => { el.style.zIndex = ++S.z; setFocus(ws, t); }, true);
  const maxBtn = () => icon('max', 'Maximize (double-click the title bar)', () => toggleMax(ws, t));
  if (t.type === 'console') mountConsole(ws, t, el, head, body, maxBtn);
  else {
    const owner = t.owner ? agentById(ws, t.owner) : null;
    const titles = { kanban: 'Task board', note: t.title || 'Notes', checklist: t.title || 'Checklist', markdown: t.title || t.path || 'Markdown', web: t.title || 'Web preview', git: 'Git', image: t.title || t.path || 'Image', text: t.title || 'Text' };
    put(head, h('span', { class: 't-dot' }), owner ? h('span', { class: 't-name', text: owner.name }) : null, h(owner ? 'span' : 'span', { class: owner ? 't-role' : 't-name', text: titles[t.type], title: titles[t.type] }), h('span', { class: 't-gap' }),
      h('span', { class: 't-acts' }, owner ? icon('comment', 'Comment on this view', () => setComposer(ws, { to: owner.id, comment: true, about: `your view "${t.title}"` })) : null,
        t.type === 'markdown' ? icon('edit', 'Suggest edits (the agent gets a diff)', () => suggestEditsModal(ws, t)) : null,
        t.type === 'image' ? icon('pen', 'Mark up: draw and write on it, then send', () => markupModal(ws, t)) : null,
        t.type === 'markdown' ? icon('refresh', 'Reload', () => loadMd(ws, t)) : null,
        t.type === 'image' ? icon('refresh', 'Reload', () => loadImg(ws, t)) : null,
        t.type === 'git' ? icon('refresh', 'Refresh', () => loadGit(ws, t)) : null, maxBtn(),
        icon('x', 'Remove from board', async () => { if (await confirmBox('Remove this tile?', 'It comes off the board. Files on disk are not touched.', 'Remove', true)) removeTile(ws, t); })));
    if (t.type === 'note') {
      const ta = h('textarea', { class: 'note', placeholder: 'Notes for this project. Saved automatically.', spellcheck: true });
      ta.value = t.text || '';
      ta.addEventListener('input', () => { t.text = ta.value; ws.save(); });
      body.append(ta);
    } else if (t.type === 'checklist') mountChecklist(ws, t, body);
    else if (t.type === 'markdown') { body.append(h('div', { class: 'md' })); loadMd(ws, t); }
    else if (t.type === 'web') mountWeb(ws, t, body);
    else if (t.type === 'git') { body.append(h('div', { class: 'gitc' })); loadGit(ws, t); }
    else if (t.type === 'kanban') mountKanban(ws, t, body);
    else if (t.type === 'image') { body.append(h('div', { class: 'imgv' }, h('img', { alt: t.title || t.path || '' }))); loadImg(ws, t); }
    else if (t.type === 'text') { const pre = h('pre', { class: 'textv' }); pre.textContent = t.text || ''; body.append(pre); }
  }
  head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(ws, t); });
  wireTileDrag(ws, t, el, head);
}

function setFocus(ws, t) {
  if (ws.focused === t.id) return;
  if (ws.focused && ws.tiles[ws.focused]) ws.tiles[ws.focused].classList.remove('focused');
  ws.focused = t.id;
  if (ws.tiles[t.id]) ws.tiles[t.id].classList.add('focused');
}

function toggleMax(ws, t) {
  const el = ws.tiles[t.id];
  const on = !el.classList.contains('max');
  for (const other of Object.values(ws.tiles)) other.classList.remove('max');
  if (on) el.classList.add('max');
  setTimeout(() => refitAll(ws), 20);
  if (t.type === 'console' && ws.terms[t.agentId]) ws.terms[t.agentId].term.focus();
}

function removeTile(ws, t) {
  ws.board.tiles = ws.board.tiles.filter(x => x !== t);
  if (ws.tiles[t.id]) { ws.tiles[t.id].remove(); delete ws.tiles[t.id]; }
  if (t._timer) clearInterval(t._timer);
  ws.save();
}

function addTile(ws, t) {
  if (!ws.board) return toast('Set up a team first.', 'err');
  const v = ws.board.view, r = ws.boardEl.getBoundingClientRect();
  t.id = uid();
  t.x = Math.round(v.x + (r.width / v.z - t.w) / 2);
  t.y = Math.round(v.y + (r.height / v.z - t.h) / 2);
  ws.board.tiles.push(t);
  mountTile(ws, t);
  positionTiles(ws);
  ws.save();
}

async function addImage(ws) {
  const rel = await safely(() => D.pickFile(ws.key, 'image'));
  if (rel) addTile(ws, { type: 'image', w: 560, h: 420, path: rel });
}
async function loadImg(ws, t) {
  const img = ws.tiles[t.id] && ws.tiles[t.id].querySelector('.imgv img');
  if (!img) return;
  try { img.src = await D.readImage(ws.key, t.path); } catch (e) { img.replaceWith(h('p', { class: 'hint', style: 'padding:12px', text: e.message })); }
}

/* views agents put on the board */
function showView(ws, v) {
  if (!ws.board) return;
  let t = ws.board.tiles.find(x => x.owner === v.owner && x.title === v.title);
  const fresh = !t;
  if (!t) {
    // Views go in a column to the right of everything else, newest at the bottom.
    const big = v.kind === 'image' || v.kind === 'web';
    const views = ws.board.tiles.filter(x => x.owner);
    const others = ws.board.tiles.filter(x => !x.owner);
    const colX = views.length ? Math.min(...views.map(x => x.x)) : Math.max(20, ...others.map(x => x.x + x.w)) + 30;
    const top = Math.min(...ws.board.tiles.map(x => x.y), 20);
    const y = views.length ? Math.max(...views.map(x => x.y + x.h)) + 20 : top;
    t = { id: uid(), owner: v.owner, title: v.title, w: big ? 560 : 480, h: big ? 400 : 320, x: colX, y };
    ws.board.tiles.push(t);
  } else if (ws.tiles[t.id]) { ws.tiles[t.id].remove(); delete ws.tiles[t.id]; }
  Object.assign(t, { type: v.kind, path: v.path, url: v.url, text: v.text });
  mountTile(ws, t);
  positionTiles(ws);
  ws.save();
  const el = ws.tiles[t.id];
  el.style.zIndex = ++S.z;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
  if (ws.key === S.active) {
    const r = ws.boardEl.getBoundingClientRect(), vw = ws.board.view;
    const sx = (t.x - vw.x) * vw.z, sy = (t.y - vw.y) * vw.z;
    if (sx < 0 || sy < 0 || sx + t.w * vw.z > r.width || sy + t.h * vw.z > r.height - 110) fitAll(ws);
  }
  if (fresh) toast(`${v.ownerName} shared a view: ${v.title}`);
}

/* the "tell the team" bar */
function buildComposer(ws) {
  ws.composer = { to: 'lead', comment: false, about: '' };
  const sel = h('select', { class: 'select c-to', 'aria-label': 'Send to' });
  const chip = h('span', { class: 'c-chip', hidden: true });
  const ta = h('textarea', { class: 'c-text', rows: 1, placeholder: 'Tell the team… the Supervisor routes it. Start with / to run a command', 'aria-label': 'Message to the team' });
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; };
  ta.addEventListener('input', grow);
  const send = async () => {
    const text = ta.value.trim();
    if (!text) return;
    const c = ws.composer;
    const r = await safely(() => D.say(ws.key, { to: sel.value, text, comment: c.comment, about: c.about }));
    if (r && r.command) { ta.value = ''; grow(); const tgt = sel.value === 'lead' ? leadAgent(ws) : agentById(ws, sel.value); if (tgt && ws.terms[tgt.id]) setTimeout(() => ws.terms[tgt.id].term.focus(), 500); toast(`Ran in ${r.sent.join(', ')}`); return; }
    if (r) { ta.value = ''; grow(); setComposer(ws, c.comment ? { to: 'lead' } : { to: sel.value }); ta.blur(); toast(`Sent to ${r.sent.join(', ')}${r.missed.length ? '. Not running: ' + r.missed.join(', ') : ''}`); }
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  const speakOn = (() => { try { return localStorage.getItem('deck.speak') === '1'; } catch (e) { return false; } })();
  const speakBtn = icon('speak', 'Read questions from agents aloud', () => {
    const on = !speakBtn.classList.contains('on');
    speakBtn.classList.toggle('on', on);
    try { localStorage.setItem('deck.speak', on ? '1' : '0'); } catch (e) {}
    toast(on ? 'Questions from agents will be read aloud.' : 'Read aloud is off.');
  }, 'c-speak' + (speakOn ? ' on' : ''));
  const micBtn = icon('mic', 'Dictate (Ctrl+Shift+M): opens Windows voice typing', () => dictate(ws), 'c-mic');
  const bar = h('div', { class: 'composer', on: { mousedown: (e) => e.stopPropagation(), wheel: (e) => e.stopPropagation() } },
    h('div', { class: 'c-top' }, sel, chip), h('div', { class: 'c-row' }, ta, micBtn, speakBtn, h('button', { class: 'btn primary c-send', title: 'Send (Enter)', html: I.send, on: { click: send } })));
  ws.composerEls = { sel, chip, ta, bar };
  fillComposerTargets(ws);
  return bar;
}
function fillComposerTargets(ws) {
  const { sel } = ws.composerEls;
  const lead = ws.team ? (ws.team.agents.find(a => a.lead) || ws.team.agents[0]) : null;
  const opts = [['lead', lead ? `${lead.name} (routes it)` : 'Lead agent'], ...(ws.team ? ws.team.agents.map(a => [a.id, a.name]) : []), ['everyone', 'Everyone']];
  const cur = ws.composer.to;
  put(sel, ...opts.map(([v, l]) => h('option', { value: v, text: l, selected: v === cur })));
}
function setComposer(ws, o) {
  ws.composer = Object.assign({ to: 'lead', comment: false, about: '' }, o);
  fillComposerTargets(ws);
  const { chip, ta, sel } = ws.composerEls;
  sel.value = ws.composer.to;
  const a = agentById(ws, ws.composer.to);
  chip.hidden = !ws.composer.comment;
  if (ws.composer.comment) put(chip, `Comment to ${a ? a.name : 'agent'}${ws.composer.about ? ' about ' + ws.composer.about : ''}`, h('button', { class: 'x', title: 'Cancel comment', 'aria-label': 'Cancel comment', text: '×', on: { click: () => setComposer(ws, {}) } }));
  ta.placeholder = ws.composer.comment ? `Comment to ${a ? a.name : 'the agent'}…` : ws.composer.to === 'lead' ? 'Tell the team… the Supervisor routes it. Start with / to run a command' : ws.composer.to === 'everyone' ? 'Message every running agent… or /command for all of them' : `Message ${a ? a.name : 'the agent'}… or /command to run in it`;
  if (o && Object.keys(o).length) setTimeout(() => ta.focus(), 20);
}
async function dictate(ws) {
  ws.composerEls.ta.focus();
  await new Promise(r => setTimeout(r, 120));
  const ok = await safely(() => D.dictate());
  if (ok) toast('Voice typing is on. Speak, then press Enter to send.');
}
function speak(text) {
  try { if (localStorage.getItem('deck.speak') !== '1' || !window.speechSynthesis) return; } catch (e) { return; }
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

async function addMarkdown(ws) {
  const rel = await safely(() => D.pickFile(ws.key));
  if (rel) addTile(ws, { type: 'markdown', w: 560, h: 520, path: rel });
}

/* console tiles */

function mountConsole(ws, t, el, head, body, maxBtn) {
  const a = agentById(ws, t.agentId);
  const pill = h('span', { class: 'pill' }, h('span', { class: 'light' }), h('span', { class: 'pw' }));
  const acts = h('span', { class: 't-acts' });
  head.append(avatar(a, ws, 20), h('span', { class: 't-name', text: a.name }), h('span', { class: 't-role', text: a.role || '' }), h('span', { class: 't-gap' }), pill, acts);
  const termEl = h('div', { class: 'term' });
  const off = h('div', { class: 'off' });
  body.append(termEl, off);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace', fontSize: 13, lineHeight: 1.12,
    cursorBlink: true, scrollback: 8000, allowProposedApi: true, macOptionIsMeta: true,
    theme: {
      background: '#0d0f14', foreground: '#e3e6ee', cursor: a.color || '#8B9CFF', cursorAccent: '#0d0f14', selectionBackground: 'rgba(139,156,255,.35)',
      black: '#1b1e27', red: '#ff7d7d', green: '#5ee6c3', yellow: '#ffc46b', blue: '#8b9cff', magenta: '#f07cc8', cyan: '#6bc8ff', white: '#d9dce6',
      brightBlack: '#5d6272', brightRed: '#ff9c9c', brightGreen: '#8af0d6', brightYellow: '#ffd591', brightBlue: '#aab7ff', brightMagenta: '#f59ed7', brightCyan: '#95d8ff', brightWhite: '#ffffff',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => D.openExternal(uri))); } catch (e) {}
  term.open(termEl);
  const id = ws.key + ':' + t.agentId;
  term.onData(d => D.input(id, d));
  term.onResize(({ cols, rows }) => D.resize(id, cols, rows));
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const k = ev.key.toLowerCase();
    if (ev.ctrlKey && k === 'c' && term.hasSelection()) { D.clipWrite(term.getSelection()); term.clearSelection(); return false; }
    if (ev.ctrlKey && ev.shiftKey && k === 'v') { D.clipRead().then(txt => term.paste(txt)); return false; }
    if (isAppShortcut(ev)) return false;
    return true;
  });
  termEl.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) { await D.clipWrite(term.getSelection()); term.clearSelection(); toast('Copied'); }
    else { const txt = await D.clipRead(); if (txt) term.paste(txt); }
  });
  ws.terms[t.agentId] = { term, fit, el: termEl, pill, acts, off, tile: el };
  // a click anywhere in the window (not on a button) puts the cursor in this agent's terminal
  body.addEventListener('mouseup', (e) => { if (!e.target.closest('button,input,textarea,a') && !term.hasSelection()) term.focus(); });
  head.addEventListener('click', (e) => { if (!e.target.closest('button')) term.focus(); });
  new ResizeObserver(() => fitTerm(ws.terms[t.agentId])).observe(termEl);
  updateConsoleTile(ws, t.agentId);
  void maxBtn;
}

function updateConsoleTile(ws, agentId) {
  const t = ws.terms[agentId];
  if (!t) return;
  const a = agentById(ws, agentId);
  if (!a) return;
  const c = ws.status[agentId];
  const st = c ? c.status : 'off';
  t.pill.className = 'pill s-' + st;
  t.pill.querySelector('.pw').textContent = STATUS_WORD[st] || st;
  t.tile.classList.toggle('st-needs', st === 'needs');
  const tileObj = ws.board.tiles.find(x => x.type === 'console' && x.agentId === agentId);
  const live = st !== 'off' && st !== 'exited';
  put(t.acts, 
    live && a.command !== undefined && (!a.command || a.command === 'claude') ? h('button', { class: 'icon-btn slash', title: 'Run a / command in this agent', 'aria-label': 'Slash commands', text: '/', on: { click: (e) => { e.stopPropagation(); slashMenu(ws, agentId, e.currentTarget); } } }) : null,
    ws.replies.some(r => r.agentId === agentId) ? icon('reply', 'Latest reply from ' + a.name, () => repliesModal(ws, agentId), unseen(ws, agentId) ? 'new' : '') : null,
    icon('comment', 'Comment to this agent', () => setComposer(ws, { to: agentId, comment: true })),
    live ? icon('handoff', 'Hand off from this agent', () => handoffModal(ws, agentId)) : null,
    live ? icon('restart', 'Restart', () => restartAgent(ws, agentId)) : null,
    live ? icon('stop', 'Stop', () => stopAgent(ws, agentId)) : icon('play', 'Start', () => startAgent(ws, agentId)),
    tileObj ? icon('max', 'Maximize (double-click the title bar)', () => toggleMax(ws, tileObj)) : null);
  const hasSession = !!(ws.sessions[agentId] || (c && c.sessionId));
  t.off.hidden = live;
  t.off.classList.toggle('bar', st === 'exited');
  if (!live) {
    const isClaude = !a.command || a.command === 'claude';
    put(t.off, 
      h('p', { text: st === 'exited' ? `${a.name} stopped${c && c.exitCode !== null && c.exitCode !== undefined ? ` (exit code ${c.exitCode})` : ''}.` : `${a.name} isn't running.` }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', on: { click: () => startAgent(ws, agentId) } }, st === 'exited' ? 'Start again' : 'Start'),
        isClaude && hasSession ? h('button', { class: 'btn', text: 'Resume last conversation', on: { click: () => startAgent(ws, agentId, { resume: true }) } }) : null));
  }
}

const SLASH = [['/model', 'Change the model'], ['/compact', 'Shrink the conversation to save tokens'], ['/clear', 'Start the conversation over'], ['/status', 'Account, model and connection'],
  ['/mcp', 'MCP servers and their state'], ['/permissions', 'What it may do without asking'], ['/resume', 'Pick an older conversation'], ['/agents', 'Its subagents'], ['/help', 'Every command']];
function slashMenu(ws, agentId, anchor) {
  const id = ws.key + ':' + agentId;
  const run = async (cmd) => {
    if (cmd === '/clear' && !(await confirmBox('Clear this conversation?', 'The agent forgets everything said so far in this session.', 'Clear', true))) return;
    const ok = await safely(() => D.command(id, cmd));
    if (ok && ws.terms[agentId]) setTimeout(() => ws.terms[agentId].term.focus(), 500);
  };
  menu(anchor, SLASH.map(([c, label]) => ({ label: c, k: label, run: () => run(c) })).concat([{ label: 'Type a command…', run: () => {
    const inp = h('input', { class: 'input mono', placeholder: '/command arguments' });
    modal({ title: 'Run a command in ' + agentById(ws, agentId).name, body: [field('Command', inp, 'Runs exactly as if you typed it in the terminal.')], actions: [{ label: 'Cancel' }, { label: 'Run', primary: true, onClick: () => run(inp.value.trim()) }] });
  } }]));
}

async function startAgent(ws, agentId, opts) {
  const t = ws.terms[agentId];
  if (!t) return;
  fitTerm(t);
  if (statusOf(ws, agentId) === 'exited') t.term.write('\r\n\x1b[2m──── started again ────\x1b[0m\r\n');
  const r = await safely(() => D.start(ws.key, agentId, Object.assign({ cols: t.term.cols, rows: t.term.rows }, opts || {})));
  if (r) { ws.status[agentId] = r; updateConsoleTile(ws, agentId); renderMap(ws); setTimeout(() => t.term.focus(), 50); }
}
async function stopAgent(ws, agentId) {
  const a = agentById(ws, agentId);
  if (!(await confirmBox(`Stop ${a.name}?`, 'This ends its terminal. A Claude Code agent can resume the conversation later.', 'Stop', true))) return;
  await safely(() => D.kill(ws.key + ':' + agentId));
}
async function restartAgent(ws, agentId) {
  const a = agentById(ws, agentId);
  if (!(await confirmBox(`Restart ${a.name}?`, 'It stops and starts again with the current team settings, resuming its conversation if it has one.', 'Restart', true))) return;
  await safely(() => D.kill(ws.key + ':' + agentId));
  const t0 = Date.now();
  const wait = () => new Promise(r => { const iv = setInterval(() => { if (!running(ws, agentId) || Date.now() - t0 > 5000) { clearInterval(iv); r(); } }, 150); });
  await wait();
  startAgent(ws, agentId, { resume: true });
}

/* other tiles */

function mountChecklist(ws, t, body) {
  t.items = t.items || [];
  const ul = h('ul');
  const input = h('input', { class: 'input', placeholder: 'Add an item' });
  const draw = () => put(ul, ...t.items.map(it => h('li', { class: it.done ? 'done' : '' },
    h('input', { type: 'checkbox', checked: !!it.done, 'aria-label': it.text, on: { change: (e) => { it.done = e.target.checked; ws.save(); draw(); } } }),
    h('span', { text: it.text }),
    icon('x', 'Remove', () => { t.items = t.items.filter(x => x !== it); ws.save(); draw(); }))));
  const form = h('form', { on: { submit: (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; t.items.push({ id: uid(), text: v, done: false }); input.value = ''; ws.save(); draw(); } } }, input, h('button', { class: 'btn sm', text: 'Add' }));
  body.append(h('div', { class: 'chk' }, ul, form));
  draw();
}

async function loadMd(ws, t) {
  const el = ws.tiles[t.id] && ws.tiles[t.id].querySelector('.md');
  if (!el) return;
  try {
    const text = await D.readFile(ws.key, t.path);
    renderMd(el, text);
  } catch (e) { put(el, h('p', { class: 'hint', text: e.message })); }
}
function renderMd(el, text) {
  const html = DOMPurify.sanitize(marked.parse(String(text || ''), { gfm: true, breaks: false }));
  el.innerHTML = html;
  for (const a of el.querySelectorAll('a')) a.addEventListener('click', (e) => { e.preventDefault(); const href = a.getAttribute('href') || ''; if (/^https?:/.test(href)) D.openExternal(href); });
}

function mountWeb(ws, t, body) {
  const input = h('input', { class: 'input', value: t.url || '', placeholder: 'http://localhost:3000', 'aria-label': 'Address' });
  const view = document.createElement('webview');
  view.setAttribute('src', /^https?:\/\//.test(t.url || '') ? t.url : 'about:blank');
  view.setAttribute('partition', 'persist:web-tiles');
  const go = (e) => { if (e) e.preventDefault(); let u = input.value.trim(); if (u && !/^https?:\/\//.test(u)) u = 'http://' + u; t.url = u; input.value = u; view.setAttribute('src', u || 'about:blank'); ws.save(); };
  body.append(h('div', { class: 'web' }, h('form', { on: { submit: go } }, input, h('button', { class: 'btn sm', text: 'Go' }), h('button', { class: 'btn sm ghost', type: 'button', text: 'Reload', on: { click: () => { try { view.reload(); } catch (e) {} } } })), view));
}

async function loadGit(ws, t) {
  const el = ws.tiles[t.id] && ws.tiles[t.id].querySelector('.gitc');
  if (!el) return;
  const g = await D.gitInfo(ws.key).catch(e => ({ ok: false, error: e.message }));
  if (!t._timer) t._timer = setInterval(() => { if (ws.tiles[t.id] && ws.key === S.active) loadGit(ws, t); }, 20000);
  if (!g.ok) { put(el, h('p', { class: 'hint', text: g.error })); return; }
  const out = h('div', { class: 'git-out', hidden: true });
  const run = async (action, msg) => {
    if (action === 'push' && !(await confirmBox('Push to the remote?', `This sends ${g.ahead || 'your'} commit${g.ahead === 1 ? '' : 's'} on ${g.branch} to ${g.upstream || 'its remote'}.`, 'Push'))) return;
    out.hidden = false; out.textContent = `git ${action}…`;
    const r = await safely(() => D.gitRun(ws.key, action, msg));
    if (r) { out.textContent = r.out.trim() || (r.ok ? 'Done.' : 'Failed.'); toast(`git ${action}: ${r.ok ? 'done' : 'failed'}`, r.ok ? '' : 'err'); }
    setTimeout(() => loadGit(ws, t), 400);
  };
  const commit = () => {
    const msg = h('input', { class: 'input', placeholder: 'What changed' });
    modal({ title: 'Commit all changes', body: [field('Commit message', msg, `${g.changed} changed file${g.changed === 1 ? '' : 's'} will be committed on ${g.branch}.`)],
      actions: [{ label: 'Cancel' }, { label: 'Commit', primary: true, onClick: () => run('commit', msg.value) }] });
  };
  put(el, 
    h('div', { class: 'git-top' }, h('span', { class: 'branch', text: g.branch }), h('span', { class: 'git-stat', text: [g.changed ? `${g.changed} changed` : 'clean', g.ahead ? `${g.ahead} to push` : '', g.behind ? `${g.behind} to pull` : ''].filter(Boolean).join(' · ') })),
    g.files.length ? h('ul', { class: 'git-files' }, g.files.map(f => h('li', { text: f }))) : null,
    h('div', { class: 'git-acts' }, h('button', { class: 'btn sm', text: 'Pull', on: { click: () => run('pull') } }), h('button', { class: 'btn sm', text: 'Commit…', disabled: !g.changed, on: { click: commit } }), h('button', { class: 'btn sm', text: 'Push', disabled: !g.ahead, on: { click: () => run('push') } })),
    out,
    h('div', { class: 'lbl', text: 'Recent commits' }),
    h('ul', { class: 'git-log' }, g.commits.map(c => h('li', null, h('span', { class: 'h', text: c.h }), h('span', { class: 's', text: c.s, title: c.s }), h('span', { class: 'w', text: c.w })))));
}

/* board interaction */

function wireBoard(ws) {
  const b = ws.boardEl;
  b.addEventListener('mousedown', (e) => {
    const bg = e.target === b || e.target === ws.layer;
    if (!(e.button === 1 || (e.button === 0 && bg))) return;
    e.preventDefault();
    const v = ws.board ? ws.board.view : null;
    if (!v) return;
    const sx = e.clientX, sy = e.clientY, ox = v.x, oy = v.y;
    b.classList.add('panning');
    const move = (ev) => { v.x = ox - (ev.clientX - sx) / v.z; v.y = oy - (ev.clientY - sy) / v.z; positionTiles(ws); };
    const up = () => { b.classList.remove('panning'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); ws.save(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  b.addEventListener('wheel', (e) => {
    if (!ws.board) return;
    const v = ws.board.view;
    if (e.ctrlKey) {
      e.preventDefault();
      const r = b.getBoundingClientRect();
      zoomAt(ws, v.z * Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    } else if (!e.target.closest('.tile')) {
      e.preventDefault();
      v.x += e.deltaX / v.z; v.y += e.deltaY / v.z; positionTiles(ws); ws.save();
    }
  }, { passive: false });
}

function zoomAt(ws, z, px, py) {
  const v = ws.board.view;
  const nz = clamp(z, 0.3, 1.6);
  const wx = v.x + px / v.z, wy = v.y + py / v.z;
  v.z = nz; v.x = wx - px / nz; v.y = wy - py / nz;
  positionTiles(ws); ws.save();
}
function zoomBy(ws, f) { if (!ws.board) return; const r = ws.boardEl.getBoundingClientRect(); zoomAt(ws, ws.board.view.z * f, r.width / 2, r.height / 2); }

function fitAll(ws, quiet) {
  if (!ws.board || !ws.board.tiles.length) return;
  const r = ws.boardEl.getBoundingClientRect();
  if (r.width < 50) return;
  const minX = Math.min(...ws.board.tiles.map(t => t.x)), minY = Math.min(...ws.board.tiles.map(t => t.y));
  const maxX = Math.max(...ws.board.tiles.map(t => t.x + t.w)), maxY = Math.max(...ws.board.tiles.map(t => t.y + t.h));
  const bottom = 120; // room for the Tell the team bar
  const z = clamp(Math.min((r.width - 40) / (maxX - minX), (r.height - 30 - bottom) / (maxY - minY)), 0.3, 1);
  const v = ws.board.view;
  v.z = z; v.x = minX - ((r.width / z) - (maxX - minX)) / 2; v.y = minY - 20 / z;
  positionTiles(ws);
  if (!quiet) ws.save();
}

function wireTileDrag(ws, t, el, head) {
  head.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || el.classList.contains('max')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = t.x, oy = t.y, z = ws.board.view.z;
    const move = (ev) => { ws.board.mode = 'free'; t.x = Math.round((ox + (ev.clientX - sx) / z) / 10) * 10; t.y = Math.round((oy + (ev.clientY - sy) / z) / 10) * 10; positionTiles(ws); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); ws.save(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  el.querySelector('.resize').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = t.w, oh = t.h, z = ws.board.view.z;
    const move = (ev) => { ws.board.mode = 'free'; t.w = Math.max(240, Math.round((ow + (ev.clientX - sx) / z) / 10) * 10); t.h = Math.max(160, Math.round((oh + (ev.clientY - sy) / z) / 10) * 10); positionTiles(ws); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); ws.save(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
}

function leadAgent(ws) { return ws.team ? (ws.team.agents.find(a => a.lead) || ws.team.agents[0]) : null; }

// Agents view: the lead across the top, every other agent in a row underneath, sized to fill the board at 100%.
function arrangeTree(ws, quiet) {
  const r = ws.boardEl.getBoundingClientRect();
  const W = Math.max(700, r.width), H = Math.max(500, r.height - 112); // keep the Tell the team bar clear
  const lead = leadAgent(ws);
  const tileOf = (a) => ws.board.tiles.find(t => t.type === 'console' && t.agentId === a.id);
  const lt = lead && tileOf(lead);
  const rest = ws.team.agents.filter(a => a !== lead).map(tileOf).filter(Boolean);
  const pad = 14, gx = 14, gy = 54;
  const n = Math.max(1, rest.length);
  const cols = Math.max(1, Math.min(n, Math.floor((W - pad * 2 + gx) / (340 + gx)) || 1));
  const rows = Math.ceil(n / cols);
  const leadH = Math.round(Math.max(170, H * (rows > 1 ? 0.22 : 0.3)));
  const agentW = Math.floor((W - pad * 2 - gx * (cols - 1)) / cols);
  const agentH = Math.floor((H - pad * 2 - leadH - gy - (rows - 1) * gx) / rows);
  if (lt) Object.assign(lt, { w: Math.round(Math.min(W - pad * 2, Math.max(640, W * 0.62))), h: leadH, y: pad }), lt.x = Math.round((W - lt.w) / 2);
  rest.forEach((t, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const rowW = inRow * agentW + (inRow - 1) * gx;
    const ah = Math.max(180, agentH);
    Object.assign(t, { w: agentW, h: ah, x: Math.round((W - rowW) / 2 + col * (agentW + gx)), y: pad + leadH + gy + row * (ah + gx) });
  });
  // everything else (notes, git, task board, views) goes below, out of the way
  const others = ws.board.tiles.filter(t => t.type !== 'console');
  let x = pad, y = Math.max(...ws.board.tiles.filter(t => t.type === 'console').map(t => t.y + t.h)) + 150, rowH = 0;
  for (const t of others) { if (x + t.w > W * 1.6) { x = pad; y += rowH + 20; rowH = 0; } t.x = x; t.y = y; x += t.w + 20; rowH = Math.max(rowH, t.h); }
  ws.board.mode = 'tree';
  ws.board.showLinks = true;
  ws.board.view = { x: 0, y: 0, z: 1 };
  positionTiles(ws);
  if (!quiet) ws.save(); else ws.save();
}

function drawLinks(ws) {
  const svg = ws.linkSvg;
  if (!svg) return;
  while (svg.firstChild) svg.firstChild.remove();
  if (!ws.board || !ws.board.showLinks || !ws.team) return;
  const lead = leadAgent(ws);
  const v = ws.board.view, z = v.z;
  const lt = ws.board.tiles.find(t => t.type === 'console' && t.agentId === lead.id);
  if (!lt) return;
  const NS = 'http://www.w3.org/2000/svg';
  const sx = (lt.x + lt.w / 2 - v.x) * z, sy = (lt.y + lt.h - v.y) * z;
  for (const a of ws.team.agents) {
    if (a === lead) continue;
    const t = ws.board.tiles.find(x => x.type === 'console' && x.agentId === a.id);
    if (!t) continue;
    const ex = (t.x + t.w / 2 - v.x) * z, ey = (t.y - v.y) * z;
    const my = ey > sy ? sy + Math.max(14, (ey - sy) / 2) : sy + 20;
    const rr = Math.min(10, Math.abs(ex - sx) / 2, Math.abs(ey - my));
    const dir = ex >= sx ? 1 : -1;
    const d = Math.abs(ex - sx) < 1 ? `M${sx},${sy} V${ey}` : `M${sx},${sy} V${my - rr} Q${sx},${my} ${sx + dir * rr},${my} H${ex - dir * rr} Q${ex},${my} ${ex},${my + rr} V${ey}`;
    const st = statusOf(ws, a.id);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'link' + (st === 'working' ? ' live' : st === 'needs' ? ' needs' : st === 'off' || st === 'exited' ? ' idle' : ''));
    path.style.setProperty('--c', a.color);
    svg.append(path);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', ex); dot.setAttribute('cy', ey); dot.setAttribute('r', 3.5);
    dot.setAttribute('class', 'link-end'); dot.style.setProperty('--c', a.color);
    svg.append(dot);
  }
  const start = document.createElementNS(NS, 'circle');
  start.setAttribute('cx', sx); start.setAttribute('cy', sy); start.setAttribute('r', 3.5);
  start.setAttribute('class', 'link-end'); start.style.setProperty('--c', lead.color);
  svg.append(start);
}

function toggleRail(ws) {
  const off = !ws.el.classList.contains('rail-off');
  for (const w of S.tabs) w.el.classList.toggle('rail-off', off);
  try { localStorage.setItem('deck.rail', off ? 'off' : 'on'); } catch (e) {}
}

function arrange(ws, mode, quiet) {
  if (!ws.board) return;
  if (mode === 'tree') return arrangeTree(ws, quiet);
  ws.board.mode = mode; ws.board.showLinks = false;
  const cons = ws.team.agents.map(a => ws.board.tiles.find(t => t.type === 'console' && t.agentId === a.id)).filter(Boolean);
  const others = ws.board.tiles.filter(t => t.type !== 'console');
  const n = cons.length;
  if (mode === 'grid') {
    const cols = Math.ceil(Math.sqrt(n));
    cons.forEach((t, i) => Object.assign(t, { x: 20 + (i % cols) * 680, y: 20 + Math.floor(i / cols) * 440, w: 660, h: 420 }));
  } else if (mode === 'row') {
    cons.forEach((t, i) => Object.assign(t, { x: 20 + i * 600, y: 20, w: 580, h: 640 }));
  } else if (mode === 'lanes') {
    // one tall lane for each agent, side by side
    cons.forEach((t, i) => Object.assign(t, { x: 20 + i * 520, y: 20, w: 500, h: 680 }));
  } else if (mode === 'timeline') {
    // one wide row for each agent, top to bottom
    cons.forEach((t, i) => Object.assign(t, { x: 20, y: 20 + i * 250, w: 1500, h: 232 }));
  } else if (mode === 'orbit') {
    // the lead in the center, the other agents on a ring around it
    const rx = 880, ry = 520, cx = rx + 260, cy = ry + 180;
    if (n) Object.assign(cons[0], { w: 620, h: 400, x: cx - 310, y: cy - 200 });
    cons.slice(1).forEach((t, i) => { const a = -Math.PI / 2 + (i / Math.max(1, n - 1)) * Math.PI * 2; Object.assign(t, { w: 480, h: 320, x: Math.round(cx + rx * Math.cos(a) - 240), y: Math.round(cy + ry * Math.sin(a) - 160) }); });
  } else if (mode === 'flow') {
    // work flows from left to right: the lead, then the builders in a column, then the checker
    const lead = cons[0], last = n > 2 ? cons[n - 1] : null, mid = cons.slice(1, last ? n - 1 : n);
    const colH = Math.max(560, mid.length * 300 - 20);
    if (lead) Object.assign(lead, { x: 20, y: 20 + Math.round((colH - 520) / 2), w: 560, h: 520 });
    mid.forEach((t, i) => Object.assign(t, { x: 640, y: 20 + i * 300, w: 560, h: 280 }));
    if (last) Object.assign(last, { x: 1260, y: 20 + Math.round((colH - 520) / 2), w: 520, h: 520 });
  } else {
    if (n) Object.assign(cons[0], { x: 20, y: 20, w: 760, h: Math.max(640, (n - 1) * 330 - 20) });
    cons.slice(1).forEach((t, i) => Object.assign(t, { x: 800, y: 20 + i * 330, w: 640, h: 310 }));
  }
  const right = Math.max(20, ...cons.map(t => t.x + t.w)) + 20;
  let y = 20;
  for (const t of others) { t.x = right; t.y = y; y += t.h + 20; }
  positionTiles(ws); fitAll(ws);
}

function focusConsole(ws, agentId) {
  if (ws.key !== S.active) activate(ws.key);
  const t = ws.board && ws.board.tiles.find(x => x.type === 'console' && x.agentId === agentId);
  if (!t) return;
  const r = ws.boardEl.getBoundingClientRect(), v = ws.board.view;
  const sx = (t.x - v.x) * v.z, sy = (t.y - v.y) * v.z;
  if (sx < 0 || sy < 0 || sx + t.w * v.z > r.width || sy + t.h * v.z > r.height) {
    v.x = t.x + t.w / 2 - r.width / (2 * v.z); v.y = t.y + t.h / 2 - r.height / (2 * v.z);
    positionTiles(ws); ws.save();
  }
  const el = ws.tiles[t.id];
  el.style.zIndex = ++S.z;
  setFocus(ws, t);
  if (ws.terms[agentId]) setTimeout(() => ws.terms[agentId].term.focus(), 30);
}

/* ------------------------------------------------------------------ suggest a team */

async function suggestTeamFlow(ws) {
  const status = h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text: 'Claude Code is reading the folder (CLAUDE.md, plans, file types, engine files). This takes about a minute and uses your Claude account.' });
  const close = modal({ title: 'Suggest a team', body: [status, h('div', { class: 'spinner', 'aria-hidden': 'true' })], actions: [{ label: 'Cancel' }] });
  let r;
  try { r = await D.suggestTeam(ws.key); } catch (e) { close(); toast(e.message, 'err'); return; }
  close();
  const team = r.team;
  const rows = team.agents.map(a => h('div', { class: 'loop', style: { '--c': a.color } },
    h('span', { class: 'sw-dot', style: { background: a.color } }),
    h('span', { class: 'ln' }, a.name, a.lead ? h('span', { class: 'pill', style: 'margin-left:8px', text: 'lead' }) : null),
    h('span', { class: 'mono', style: 'color:var(--muted);font-size:11.5px', text: (MODELS.find(m => m[0] === a.model) || [0, a.model || 'Default'])[1] + (Array.isArray(a.mcp) && a.mcp.length ? ' · ' + a.mcp.join(', ') : '') }),
    h('span', { class: 'ld', text: a.role + (a.prompt ? ' — ' + a.prompt : '') })));
  modal({ title: 'Suggested team', wide: true, body: [
    h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text: r.summary || 'Here is what Claude Code suggests for this folder.' }),
    h('div', { class: 'loop-list' }, rows),
    ws.team ? h('p', { class: 'hint', text: 'Using it replaces the current team. Running agents keep running until you restart them.' }) : null],
    actions: [{ label: 'Cancel' }, { label: 'Use this team', primary: true, onClick: async () => {
      const p = await D.saveTeam(ws.key, team);
      ws.team = p.team;
      if (!ws.board) setupBoard(ws); else { syncConsoleTiles(ws); renderTiles(ws); arrange(ws, 'lead'); }
      for (const a of ws.team.agents) updateConsoleTile(ws, a.id);
      renderSide(ws); fillComposerTargets(ws); loadLaunchers(ws);
      toast('Team saved. Edit anything in Team, then press Launch team.');
    } }] });
}

/* ------------------------------------------------------------------ suggested edits */

async function suggestEditsModal(ws, t) {
  let text;
  try { text = await D.readFile(ws.key, t.path); } catch (e) { toast(e.message, 'err'); return; }
  const ta = h('textarea', { class: 'textarea mono', rows: 18, spellcheck: true, style: 'font-size:12px;min-height:320px' });
  ta.value = text;
  const to = select([['lead', 'Lead (routes it)'], ...ws.team.agents.map(a => [a.id, a.name])], t.owner || 'lead');
  const note = h('input', { class: 'input', placeholder: 'Why, or anything to add (optional)' });
  modal({ title: 'Suggest edits: ' + t.path, wide: true, body: [
    h('p', { class: 'hint', text: 'Change the text the way you want it. The file itself is not touched: the agent gets a diff of your changes and decides how to apply them. Voice typing works here too (Win+H).' }),
    ta, h('div', { class: 'two' }, field('Send to', to), field('Note', note))],
    actions: [{ label: 'Cancel' }, { label: 'Send suggestions', primary: true, onClick: async () => {
      const r = await D.suggestEdits(ws.key, { rel: t.path, text: ta.value, to: to.value, note: note.value });
      toast(`Sent to ${r.to}.`);
    } }] });
}

/* ------------------------------------------------------------------ markup: draw and write on a picture */

async function markupModal(ws, t) {
  let src;
  try { src = await D.readImage(ws.key, t.path); } catch (e) { toast(e.message, 'err'); return; }
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; }).catch(() => {});
  if (!img.naturalWidth) { toast('That image could not be opened.', 'err'); return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = h('canvas', { class: 'mk-canvas', width: W, height: H });
  const ctx = canvas.getContext('2d');
  const marks = [];
  let tool = 'pen', color = '#ff3b3b', drawing = null;
  const lw = Math.max(3, Math.round(Math.max(W, H) / 320));
  const fontPx = Math.max(16, Math.round(Math.max(W, H) / 40));
  const redraw = () => {
    ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0);
    for (const m of marks.concat(drawing ? [drawing] : [])) {
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (m.tool === 'pen') { ctx.beginPath(); m.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); }
      else if (m.tool === 'rect') { ctx.strokeRect(Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.abs(m.x2 - m.x1), Math.abs(m.y2 - m.y1)); }
      else if (m.tool === 'arrow') {
        ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke();
        const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1), hl = lw * 5;
        ctx.beginPath(); ctx.moveTo(m.x2, m.y2); ctx.lineTo(m.x2 - hl * Math.cos(ang - 0.45), m.y2 - hl * Math.sin(ang - 0.45)); ctx.lineTo(m.x2 - hl * Math.cos(ang + 0.45), m.y2 - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      } else if (m.tool === 'text') {
        ctx.font = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`; ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(3, fontPx / 6); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(m.text, m.x, m.y); ctx.fillText(m.text, m.x, m.y);
      }
    }
  };
  redraw();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const wrapEl = h('div', { class: 'mk-wrap' }, canvas);
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    if (tool === 'text') {
      const r = canvas.getBoundingClientRect(), wr = wrapEl.getBoundingClientRect();
      const inp = h('input', { class: 'mk-text', style: { left: (e.clientX - wr.left + wrapEl.scrollLeft) + 'px', top: (e.clientY - wr.top + wrapEl.scrollTop) + 'px', color }, placeholder: 'Type, then Enter' });
      wrapEl.append(inp); setTimeout(() => inp.focus(), 0);
      const commit = () => { if (inp.value.trim()) { marks.push({ tool: 'text', x, y, text: inp.value.trim(), color }); redraw(); } inp.remove(); };
      inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') inp.remove(); });
      inp.addEventListener('blur', commit);
      void r;
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drawing = tool === 'pen' ? { tool, color, pts: [[x, y]] } : { tool, color, x1: x, y1: y, x2: x, y2: y };
  });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); if (drawing.tool === 'pen') drawing.pts.push([x, y]); else { drawing.x2 = x; drawing.y2 = y; } redraw(); });
  canvas.addEventListener('pointerup', () => { if (drawing) { marks.push(drawing); drawing = null; redraw(); } });
  const tools = [['pen', 'Draw'], ['arrow', 'Arrow'], ['rect', 'Box'], ['text', 'Text']];
  const swatches = ['#ff3b3b', '#ffd23f', '#2ee6a6', '#4db3ff', '#ffffff'];
  const toolbar = h('div', { class: 'mk-bar' });
  const drawBar = () => put(toolbar,
    ...tools.map(([id, label]) => h('button', { class: 'btn sm' + (tool === id ? ' primary' : ''), text: label, on: { click: () => { tool = id; drawBar(); } } })),
    h('span', { class: 'tb-sep' }),
    ...swatches.map(c => h('button', { class: 'mk-sw' + (c === color ? ' on' : ''), style: { background: c }, title: 'Color', 'aria-label': 'Color ' + c, on: { click: () => { color = c; drawBar(); } } })),
    h('span', { class: 'tb-gap', style: 'flex:1' }),
    h('button', { class: 'btn sm ghost', text: 'Undo', on: { click: () => { marks.pop(); redraw(); } } }),
    h('button', { class: 'btn sm ghost', text: 'Clear', on: { click: () => { marks.length = 0; redraw(); } } }));
  drawBar();
  const to = select([['lead', 'Lead (routes it)'], ...ws.team.agents.map(a => [a.id, a.name])], t.owner || 'lead');
  const note = h('input', { class: 'input', placeholder: 'What should change? (optional, Win+H to dictate)' });
  modal({ title: 'Mark up: ' + (t.title || t.path), wide: true, body: [toolbar, wrapEl, h('div', { class: 'two' }, field('Send to', to), field('Note', note))],
    actions: [{ label: 'Cancel' }, { label: 'Send markup', primary: true, onClick: async () => {
      if (!marks.length && !note.value.trim()) throw new Error('Draw or write something first.');
      const r = await D.sendMarkup(ws.key, { dataUrl: canvas.toDataURL('image/png'), source: t.path, note: note.value, to: to.value, texts: marks.filter(m => m.tool === 'text').map(m => m.text) });
      toast(`Sent to ${r.to}. Saved in the agents folder under markups.`);
    } }] });
}

/* ------------------------------------------------------------------ kanban */

const KCOLS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']];
function mountKanban(ws, t, body) {
  t.cards = t.cards || [];
  body.append(h('div', { class: 'kb' }));
  drawKanban(ws, t);
}
function drawKanban(ws, t) {
  const el = ws.tiles[t.id] && ws.tiles[t.id].querySelector('.kb');
  if (!el) return;
  const nextId = () => 'T' + (t.cards.reduce((m, k) => Math.max(m, parseInt(String(k.id).slice(1), 10) || 0), 0) + 1);
  put(el, ...KCOLS.map(([col, label]) => {
    const cards = t.cards.filter(k => k.col === col);
    const list = h('div', { class: 'kb-list' }, cards.map(k => {
      const a = k.agent ? agentById(ws, k.agent) : null;
      return h('div', { class: 'kb-card', draggable: 'true', style: a ? { '--c': a.color } : null,
        on: { dragstart: (e) => { e.dataTransfer.setData('text/x-card', k.id); e.dataTransfer.effectAllowed = 'move'; }, click: () => editCard(ws, t, k) } },
        h('span', { class: 'kb-id', text: k.id }), h('span', { class: 'kb-tx', text: k.text }), a ? h('span', { class: 'kb-who' }, h('span', { class: 'sw-dot', style: { background: a.color } }), a.name) : null);
    }));
    const input = h('input', { class: 'input kb-add', placeholder: '+ Add a card' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { t.cards.push({ id: nextId(), text: input.value.trim(), col, agent: '', by: 'You' }); ws.save(); drawKanban(ws, t); } });
    const colEl = h('div', { class: 'kb-col', on: {
      dragover: (e) => { e.preventDefault(); colEl.classList.add('over'); }, dragleave: () => colEl.classList.remove('over'),
      drop: (e) => { e.preventDefault(); colEl.classList.remove('over'); const id = e.dataTransfer.getData('text/x-card'); const k = t.cards.find(x => x.id === id); if (k && k.col !== col) { k.col = col; ws.save(); drawKanban(ws, t); } },
    } }, h('div', { class: 'kb-h' }, h('span', { text: label }), h('span', { class: 'count', text: cards.length })), list, input);
    return colEl;
  }));
}
function editCard(ws, t, k) {
  const text = h('textarea', { class: 'textarea', rows: 3 }); text.value = k.text;
  const who = select([['', 'Nobody yet'], ...ws.team.agents.map(a => [a.id, a.name])], k.agent || '');
  const col = select(KCOLS, k.col);
  const apply = () => { k.text = text.value.trim() || k.text; k.agent = who.value; k.col = col.value; ws.save(); drawKanban(ws, t); };
  modal({ title: 'Card ' + k.id, body: [field('Task', text), h('div', { class: 'two' }, field('Owner', who), field('Column', col)), k.by ? h('p', { class: 'hint', text: 'Added by ' + k.by }) : null],
    actions: [{ label: 'Delete', danger: true, left: true, onClick: () => { t.cards = t.cards.filter(x => x !== k); ws.save(); drawKanban(ws, t); } },
      { label: 'Send to owner', onClick: async () => {
        apply();
        if (!k.agent) throw new Error('Pick an owner first.');
        await D.say(ws.key, { to: k.agent, text: `Task ${k.id} on the task board: ${k.text}. Move it with task_board when you start and when you finish.` });
        if (k.col === 'todo') { k.col = 'doing'; ws.save(); drawKanban(ws, t); }
        toast('Sent.');
      } },
      { label: 'Save', primary: true, onClick: apply }] });
}

/* ------------------------------------------------------------------ token usage */

function fmtTok(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }
async function usageModal(ws) {
  const holder = h('div', { class: 'usage' }, h('p', { class: 'hint', text: 'Reading Claude Code\'s logs on this PC…' }));
  let days = 14;
  const range = h('div', { class: 'seg' });
  const drawRange = () => put(range, ...[7, 14, 30].map(d => h('button', { class: 'btn sm' + (d === days ? ' primary' : ''), text: d + ' days', on: { click: () => { days = d; drawRange(); load(); } } })));
  drawRange();
  const load = async () => {
    const r = await D.usage(ws.key, days).catch(e => ({ error: e.message }));
    if (r.error) { put(holder, h('p', { class: 'hint', text: r.error })); return; }
    put(holder, ...renderUsage(ws, r));
  };
  modal({ title: 'Token usage', wide: true, body: [h('div', { class: 'git-top' }, range), holder] });
  load();
}
function renderUsage(ws, r) {
  const agents = (ws.team ? ws.team.agents : []).map(a => ({ id: a.id, name: a.name, color: a.color }));
  if (Object.values(r.byDay).some(d => d.other)) agents.push({ id: 'other', name: 'Other sessions', color: '#6f7480' });
  const series = agents.filter(a => r.totals[a.id]);
  if (!series.length) return [h('p', { class: 'hint', style: 'font-size:13px', text: `No Claude Code usage for this project in the last ${r.days.length} days. Usage is read from ${r.root} once agents have run here.` })];
  const W = 860, Hh = 260, padL = 52, padB = 26, padT = 10, plotW = W - padL - 10, plotH = Hh - padB - padT;
  const totalsByDay = r.days.map(d => series.reduce((s, a) => s + ((r.byDay[d] || {})[a.id] || 0), 0));
  const max = Math.max(1, ...totalsByDay);
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p; return 10 * p; })();
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const bw = (plotW / r.days.length) * 0.62, step = plotW / r.days.length;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.setAttribute('class', 'u-chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Tokens per day by agent');
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
  for (let i = 0; i <= 4; i++) { const v = nice * i / 4, yy = y(v); el('line', { x1: padL, x2: W - 10, y1: yy, y2: yy, class: 'u-grid' }); el('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end', class: 'u-ax' }, fmtTok(v)); }
  const tip = h('div', { class: 'u-tip', hidden: true });
  r.days.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    let acc = 0;
    const segs = series.map(a => ({ a, v: (r.byDay[d] || {})[a.id] || 0 })).filter(s => s.v > 0);
    segs.forEach((sg, k) => {
      const y0 = y(acc), y1 = y(acc + sg.v); acc += sg.v;
      const top = k === segs.length - 1;
      const yy = Math.min(y0 - 1, y1 + (top ? 0 : 2)); // 2px surface gap under the next segment
      const hgt = Math.max(1, y0 - yy);
      const rr = top ? Math.min(4, hgt / 2, bw / 2) : 0;
      el('path', { d: `M${x},${yy + hgt} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${yy + hgt} Z`, fill: sg.a.color });
    });
    const md = d.slice(5).replace('-', '/');
    if (r.days.length <= 14 || i % 3 === 0) el('text', { x: x + bw / 2, y: Hh - 8, 'text-anchor': 'middle', class: 'u-ax' }, md);
    const hit = el('rect', { x: padL + i * step, y: padT, width: step, height: plotH, fill: 'transparent', class: 'u-hit' });
    hit.addEventListener('mouseenter', () => {
      put(tip, h('b', { text: d }), ...segs.slice().reverse().map(sg => h('div', { class: 'u-row' }, h('span', { class: 'sw-dot', style: { background: sg.a.color } }), h('span', { text: sg.a.name }), h('span', { class: 'mono', text: fmtTok(sg.v) }))), h('div', { class: 'u-row tot' }, h('span'), h('span', { text: 'Total' }), h('span', { class: 'mono', text: fmtTok(totalsByDay[i]) })));
      tip.hidden = !segs.length;
      const box = svg.getBoundingClientRect();
      const cx = (padL + i * step + step / 2) / W * box.width;
      tip.style.left = Math.max(0, Math.min(box.width - 200, cx + 12)) + 'px';
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
  el('line', { x1: padL, x2: W - 10, y1: y(0), y2: y(0), class: 'u-base' });
  const legend = h('div', { class: 'u-legend' }, series.map(a => h('span', null, h('span', { class: 'sw-dot', style: { background: a.color } }), a.name)));
  const sum = (k) => series.reduce((s, a) => s + r.totals[a.id][k], 0);
  const table = h('table', { class: 'u-table' },
    h('thead', null, h('tr', null, ['Agent', 'Input', 'Output', 'Cache read', 'Cache write', 'Total'].map(c => h('th', { text: c })))),
    h('tbody', null, series.map(a => { const T = r.totals[a.id]; return h('tr', null, h('td', null, h('span', { class: 'sw-dot', style: { background: a.color } }), a.name), ...['input', 'output', 'cacheRead', 'cacheWrite', 'total'].map(k => h('td', { class: 'mono', text: fmtTok(T[k]) }))); }),
      h('tr', { class: 'tot' }, h('td', { text: 'All agents' }), ...['input', 'output', 'cacheRead', 'cacheWrite', 'total'].map(k => h('td', { class: 'mono', text: fmtTok(sum(k)) })))));
  const models = Object.entries(r.models).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${fmtTok(v)}`).join(' · ');
  return [h('div', { class: 'u-head' }, h('div', null, h('div', { class: 'u-big', text: fmtTok(sum('total')) }), h('div', { class: 'hint', text: `tokens in the last ${r.days.length} days, ${r.messages} replies` })), legend),
    h('div', { class: 'u-plot' }, svg, tip), table,
    h('p', { class: 'hint', text: `By model: ${models}. Read from Claude Code's own logs (${r.root}); cache reads are cheap and most of the total. Plan limits are not shown here.` })];
}

/* ------------------------------------------------------------------ app shortcuts (Roblox Studio, Blender, VS Code…) */

async function loadLaunchers(ws) {
  if (!ws.team) { put(ws.launchEl); return; }
  const list = await D.launchers(ws.key).catch(() => null);
  if (!list) return;
  ws.launchers = list;
  put(ws.launchEl, ...list.filter(l => l.enabled !== false).map(l => h('button', {
    class: 'lchip' + (l.running ? ' on' : '') + (l.run && l.run.type === 'missing' ? ' miss' : ''),
    title: `${l.name}${l.running ? ' is open' : l.running === false ? ' is not open' : ''}. ${l.why || ''}${l.check ? ' ' + l.check : ''}${l.run && l.run.type === 'missing' ? ' ' + l.run.target : ' Click to open.'}`,
    on: { click: async () => { const ok = await safely(() => D.runLauncher(ws.key, l.id)); if (ok) { toast(`Opening ${l.name}…${l.check ? ' ' + l.check : ''}`); setTimeout(() => loadLaunchers(ws), 3500); } } },
  }, l.process ? h('span', { class: 'light' }) : null, l.name)), icon('open', 'Shortcuts: which apps this project opens', () => launchersModal(ws)));
}
setInterval(() => { const ws = activeWs(); if (ws && ws.team) loadLaunchers(ws); }, 9000);

function launchersModal(ws) {
  let list = JSON.parse(JSON.stringify(ws.launchers || []));
  const box = h('div', { class: 'loop-list' });
  const kinds = [['exe', 'Program (.exe)'], ['open', 'File or folder'], ['url', 'Web or app link'], ['command', 'Command in a new window']];
  const draw = () => put(box, ...(list.length ? list.map(l => h('div', { class: 'loop' },
    h('input', { type: 'checkbox', checked: l.enabled !== false, title: 'Show on the toolbar', 'aria-label': 'Show ' + l.name, on: { change: (e) => { l.enabled = e.target.checked; } } }),
    h('span', { class: 'ln' }, l.name, l.isNew ? h('span', { class: 'pill', style: 'margin-left:8px', text: 'new' }) : null),
    h('span', { style: 'display:flex;gap:10px;align-items:center' },
      h('label', { class: 'chkrow', title: 'Open it before the agents start' }, h('input', { type: 'checkbox', checked: l.auto !== false, on: { change: (e) => { l.auto = e.target.checked; } } }), 'With Launch team'),
      l.source === 'custom' ? h('button', { class: 'btn sm ghost danger', text: 'Delete', on: { click: () => { list = list.filter(x => x !== l); draw(); } } }) : null),
    h('span', { class: 'ld' }, (l.why ? l.why + ' ' : ''), h('code', { class: 'mono', text: l.run ? `${l.run.type}: ${l.run.target}${l.run.args && l.run.args.length ? ' ' + l.run.args.join(' ') : ''}` : '' })))) : [h('p', { class: 'hint', text: 'Nothing detected yet.' })]));
  draw();
  const name = h('input', { class: 'input', placeholder: 'e.g. Unreal Engine' });
  const kind = select(kinds, 'exe');
  const target = h('input', { class: 'input mono', placeholder: 'C:\\Program Files\\Epic Games\\UE_5.4\\Engine\\Binaries\\Win64\\UnrealEditor.exe' });
  const args = h('input', { class: 'input mono', placeholder: 'Arguments (optional)' });
  const proc = h('input', { class: 'input mono', placeholder: 'Process name to show it as open, e.g. UnrealEditor.exe' });
  const add = () => {
    if (!name.value.trim() || !target.value.trim()) throw new Error('Give the shortcut a name and a target.');
    list.push({ id: slug(name.value) + '-' + uid().slice(0, 3), name: name.value.trim(), run: { type: kind.value, target: target.value.trim(), args: args.value.trim() ? args.value.trim().split(/\s+/) : [] }, process: proc.value.trim(), enabled: true, auto: false, source: 'custom', why: 'Added by you.' });
    name.value = target.value = args.value = proc.value = '';
    draw();
  };
  modal({ title: 'Shortcuts', wide: true, body: [
    h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text: 'Orbie Studio reads the team and the project folder and lists the apps the agents need open: Roblox Studio and Blender for their MCP servers, Unreal for a .uproject, VS Code for the code. A green light means it is open now. Click a chip on the toolbar to open it.' }),
    box,
    h('div', { class: 'lbl', text: 'Add your own' }),
    h('div', { class: 'two' }, field('Name', name), field('Type', kind)), field('Target', target), h('div', { class: 'two' }, field('Arguments', args), field('Process name', proc)),
    h('button', { class: 'btn sm', style: 'align-self:flex-start', text: '+ Add shortcut', on: { click: () => safely(add) } })],
    actions: [{ label: 'Cancel' }, { label: 'Save shortcuts', primary: true, onClick: async () => { ws.launchers = await D.saveLaunchers(ws.key, list); loadLaunchers(ws); toast('Shortcuts saved.'); } }] });
}

/* ------------------------------------------------------------------ side rail */

function renderSide(ws) { renderMap(ws); renderInbox(ws); renderReplies(ws); renderFeed(ws); }

function renderMap(ws) {
  if (!ws.team) { put(ws.mapEl, h('p', { class: 'empty-note', style: 'padding:4px 8px', text: 'No team yet.' })); return; }
  put(ws.mapEl, ...ws.team.agents.map(a => {
    const c = ws.status[a.id];
    const st = c ? c.status : 'off';
    const sub = c && c.note ? c.note : (st === 'working' ? `Working · output ${ago(c.lastOutput)} ago` : st === 'needs' ? 'Waiting for your approval' : st === 'resting' ? 'Ready for the next step' : st === 'exited' ? 'Stopped' : (a.role || ''));
    return h('button', { class: 'agent', style: { '--c': a.color }, title: `${a.name}: ${STATUS_WORD[st]}`, on: { click: () => focusConsole(ws, a.id) } },
      avatar(a, ws, 26), h('span', { class: 'an', text: a.name }), h('span', { class: 'pill s-' + st }, h('span', { class: 'light' }), STATUS_WORD[st]), h('span', { class: 'as', text: sub }));
  }), h('div', { class: 'owner' }, h('span', { class: 'sw' }), 'You: answers, approvals and every publish.'));
  if (typeof pageDirty === 'function') pageDirty();
}

function renderInbox(ws) {
  ws.inboxCount.textContent = ws.inbox.length ? String(ws.inbox.length) : '';
  if (!ws.inbox.length) { put(ws.inboxEl, h('p', { class: 'empty-note', text: 'Nothing waiting on you.' })); renderTabs(); return; }
  put(ws.inboxEl, ...ws.inbox.slice().reverse().map(it => {
    const agentId = it.consoleId.split(':').slice(1).join(':');
    if (it.kind === 'permission') {
      return h('div', { class: 'ibx perm' }, h('div', { class: 'who' }, h('span', { text: it.agentName }), h('time', { text: hhmm(it.at) })),
        h('div', { class: 'q', text: it.text }),
        h('div', { class: 'row' }, h('button', { class: 'btn sm primary', text: 'Open console', on: { click: () => focusConsole(ws, agentId) } }), h('button', { class: 'btn sm ghost', text: 'Dismiss', on: { click: () => D.dismiss(ws.key, it.id) } })));
    }
    const input = h('input', { class: 'input', placeholder: 'Your answer' });
    const answer = async (text) => { if (!String(text).trim()) return; await safely(() => D.answer(ws.key, it.id, text)); };
    return h('div', { class: 'ibx' }, h('div', { class: 'who' }, h('span', { text: it.agentName + ' asks' }), h('time', { text: hhmm(it.at) })),
      h('div', { class: 'q', text: it.text }),
      it.options && it.options.length ? h('div', { class: 'opts' }, it.options.map((o, i) => h('button', { class: 'btn sm' + (i === 0 ? ' primary' : ''), text: o, on: { click: () => answer(o) } }))) : null,
      h('form', { on: { submit: (e) => { e.preventDefault(); answer(input.value); } } }, input, h('button', { class: 'btn sm', text: 'Send' })),
      h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', text: 'Open console', on: { click: () => focusConsole(ws, agentId) } }), h('button', { class: 'btn sm ghost', text: 'Dismiss', on: { click: () => D.dismiss(ws.key, it.id) } })));
  }));
  renderTabs();
}

/* replies: what each agent said at the end of its turn */

function unseen(ws, agentId) { const r = ws.replies.filter(x => x.agentId === agentId).pop(); return !!r && !(ws.seen && ws.seen[agentId] >= r.at); }
function markSeen(ws, agentId) { ws.seen = ws.seen || {}; const r = ws.replies.filter(x => x.agentId === agentId).pop(); if (r) ws.seen[agentId] = r.at; updateConsoleTile(ws, agentId); renderReplies(ws); }
function replyCard(ws, r, full) {
  const a = agentById(ws, r.agentId) || { name: r.agentName, color: '#8b9cff' };
  const md = h('div', { class: 'md rmd' + (full ? ' full' : '') });
  renderMd(md, r.text);
  const card = h('div', { class: 'reply' + (full ? ' full' : '') + (!full && unseen(ws, r.agentId) ? ' new' : ''), style: { '--c': a.color } },
    h('div', { class: 'who' }, h('span', { class: 'sw' }), h('b', { text: a.name }), h('time', { text: hhmm(r.at) })), md,
    h('div', { class: 'row' },
      full ? null : h('button', { class: 'btn sm ghost', text: 'Open', on: { click: () => repliesModal(ws, r.agentId) } }),
      h('button', { class: 'btn sm ghost', text: 'Copy', on: { click: () => { D.clipWrite(r.text); toast('Copied'); } } }),
      h('button', { class: 'btn sm ghost', text: 'Read aloud', on: { click: () => readAloud(r.text) } }),
      h('button', { class: 'btn sm ghost', text: 'Reply', on: { click: () => { closeAllModals(); setComposer(ws, { to: r.agentId }); } } }),
      h('button', { class: 'btn sm ghost', text: 'Console', on: { click: () => { closeAllModals(); focusConsole(ws, r.agentId); } } })));
  if (!full) card.addEventListener('dblclick', () => repliesModal(ws, r.agentId));
  return card;
}
function renderReplies(ws) {
  if (!ws.repliesEl) return;
  const latest = {};
  for (const r of ws.replies) latest[r.agentId] = r;
  const list = Object.values(latest).sort((x, y) => y.at - x.at);
  if (!list.length) { put(ws.repliesEl, h('p', { class: 'empty-note', text: 'When an agent finishes a turn, its answer shows here, so you don\'t have to scroll its terminal.' })); return; }
  put(ws.repliesEl, list.map(r => replyCard(ws, r, false)));
  if (typeof pageDirty === 'function') pageDirty();
}
function readAloud(text) {
  if (!window.speechSynthesis) return toast('Read aloud is not available on this PC.', 'err');
  window.speechSynthesis.cancel();
  const clean = String(text).replace(/```[\s\S]*?```/g, ' code block. ').replace(/[#*`>_|]/g, '').slice(0, 4000);
  const u = new SpeechSynthesisUtterance(clean); u.rate = 1.03; window.speechSynthesis.speak(u);
}
function closeAllModals() { while (modalStack.length) modalStack[modalStack.length - 1](); }
function repliesModal(ws, agentId) {
  let who = agentId || 'all';
  const sel = select([['all', 'Every agent']].concat((ws.team ? ws.team.agents : []).map(a => [a.id, a.name])), who);
  const list = h('div', { class: 'reply-list' });
  const draw = () => {
    const items = ws.replies.filter(r => who === 'all' || r.agentId === who).slice().reverse().slice(0, 40);
    put(list, items.length ? items.map((r, i) => replyCard(ws, r, true)) : h('p', { class: 'empty-note', text: 'No replies yet.' }));
    if (who !== 'all') markSeen(ws, who); else for (const a of (ws.team ? ws.team.agents : [])) markSeen(ws, a.id);
  };
  sel.addEventListener('change', () => { who = sel.value; draw(); });
  draw();
  modal({ title: 'Replies', wide: true, body: [h('div', { class: 'two', style: 'margin-bottom:8px' }, field('Show', sel), h('p', { class: 'hint', style: 'align-self:end', text: 'Each card is an agent\'s full answer at the end of a turn. Saved in the agents folder under logs\\replies.jsonl.' })), list] });
}

/* themes + the light that follows the mouse */

const THEMES = [
  { id: 'dark', name: 'Dusk', sub: 'Warm and dark' },
  { id: 'light', name: 'Daylight', sub: 'Bright panels, dark terminals' },
  { id: 'aurora', name: 'Aurora', sub: 'Green and blue' },
  { id: 'midnight', name: 'Midnight', sub: 'Deep blue' },
];
function curTheme() { const t = S.info && S.info.settings && S.info.settings.theme; return THEMES.some(x => x.id === t) ? t : 'dark'; }
function applyTheme(id) { document.documentElement.dataset.theme = THEMES.some(x => x.id === id) ? id : 'dark'; }
function setTheme(id) {
  if (!THEMES.some(x => x.id === id)) return;
  applyTheme(id);
  if (S.info && S.info.settings) S.info.settings.theme = id;
  D.saveSettings({ theme: id }).catch(() => {});
}
(function mouseLight() {
  let x = 0, y = 0, queued = false;
  const paint = () => { queued = false; const r = document.documentElement.style; r.setProperty('--mx', x + 'px'); r.setProperty('--my', y + 'px'); document.body.classList.add('lit'); };
  window.addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => document.body.classList.remove('lit'));
  window.addEventListener('blur', () => document.body.classList.remove('lit'));
})();

/* main menu + folder menu */

function folderItems(ws) {
  const recent = ((S.info && S.info.settings.recent) || []).filter(r => !ws || r.path.toLowerCase() !== ws.path.toLowerCase()).slice(0, 6);
  return [
    ws ? { head: ws.name } : null,
    ws ? { label: 'Switch this tab to another folder…', sub: 'Pick a folder; its agents load here', run: () => switchFolder(ws) } : null,
    ws ? { label: 'Show project folder', sub: ws.path, run: () => D.openPath(ws.path) } : null,
    ws ? { label: 'Show agents folder', sub: ws.agentsDir, run: () => D.openPath(ws.agentsDir) } : null,
    ws ? { sep: true } : null,
    { label: 'Open another project folder…', k: 'Ctrl+O', run: openProjectFlow },
    recent.length ? { head: 'Recent' } : null,
    ...recent.map(r => ({ label: r.name, sub: r.path, run: () => openPath(r.path) })),
  ];
}
function mainMenu(anchor) {
  const ws = activeWs();
  menu(anchor, [
    { label: 'Home', sub: 'Your games, the rocket and the agents', run: () => goPage('home') },
    ...folderItems(ws),
    { sep: true },
    { head: 'Settings' },
    { label: 'Change agents folder…', sub: (S.info && S.info.settings.agentsRoot) || 'Not set', run: async () => { const r = await safely(() => D.pickAgentsRoot()); if (r !== undefined) { S.info.settings.agentsRoot = r; toast('Agents folder: ' + (r || 'not set')); if (!S.active) renderWelcome(); } } },
    { label: 'Change update folder…', sub: (S.info && S.info.updateSource) || '', run: async () => { const r = await safely(() => D.pickUpdateSource()); if (r) { S.info.updateSource = r; toast('Updates from ' + r); const u = await D.checkUpdate().catch(() => null); if (u) showUpdate(u); } } },
    { label: 'Remote view…', sub: S.remote && S.remote.enabled ? 'On' : 'Off', run: remoteModal },
    { sep: true },
    { head: 'Theme' },
    ...THEMES.map(t => ({ label: t.name, sub: t.id === curTheme() ? 'On now' : t.sub, run: () => setTheme(t.id) })),
    { sep: true },
    { label: 'Shortcuts', k: 'F1', run: helpModal },
    { label: 'Check for updates', sub: 'You have ' + (S.info ? S.info.version : ''), run: async () => { const u = await safely(() => D.checkUpdate()); if (u) { if (u.available) { showUpdate(u); updateModal(u); } else toast(`You have the newest version (${u.current}).`); } } },
  ]);
}
async function switchFolder(ws) {
  const p = await safely(() => D.pickProject());
  if (!p || p.toLowerCase() === ws.path.toLowerCase()) return;
  const live = Object.keys(ws.status).filter(id => running(ws, id)).length;
  if (live && !(await confirmBox('Switch folder?', `${live} agent${live === 1 ? ' is' : 's are'} running in ${ws.name}. Switching stops them (each can resume its conversation later).`, 'Stop and switch', true))) return;
  await safely(() => D.closeProject(ws.key));
  for (const t of Object.values(ws.terms)) t.term.dispose();
  ws.el.remove();
  S.tabs = S.tabs.filter(x => x !== ws);
  await openPath(p);
}

function renderFeed(ws) {
  const items = ws.feed.slice(-80).reverse();
  if (!items.length) { put(ws.feedEl, h('li', null, h('span'), h('span', { class: 'empty-note', text: 'Messages, hand-offs and loops show up here.' }))); return; }
  put(ws.feedEl, ...items.map(it => h('li', null, h('time', { text: hhmm(it.t) }), h('span', { class: 'tx' }, h('span', { class: 'kd k-' + it.kind, text: it.kind }), it.text))));
}

setInterval(() => { const ws = activeWs(); if (ws) renderMap(ws); }, 5000);

/* ------------------------------------------------------------------ team actions */

function launchTeam(ws) {
  if (!ws.team) return choosePreset(ws);
  const rows = ws.team.agents.map(a => {
    const live = running(ws, a.id);
    const cb = h('input', { type: 'checkbox', checked: !live && a.autostart !== false, disabled: live });
    return { a, cb, el: h('label', { style: { '--c': a.color } }, cb, h('span', { class: 'sw' }), h('span', null, h('b', { text: a.name }), ' ', h('span', { class: 'role', text: a.role || '' })), h('span', { class: 'pill s-' + statusOf(ws, a.id) }, h('span', { class: 'light' }), STATUS_WORD[statusOf(ws, a.id)])) };
  });
  const anySession = ws.team.agents.some(a => ws.sessions[a.id]);
  const resume = h('input', { type: 'checkbox', checked: anySession });
  const needed = (ws.launchers || []).filter(l => l.enabled !== false && l.auto !== false && l.process && l.running === false && l.run && l.run.type !== 'missing');
  const openFirst = h('input', { type: 'checkbox', checked: needed.length > 0 });
  modal({ title: 'Launch team', body: [
    h('div', { class: 'launch-list' }, rows.map(r => r.el)),
    anySession ? h('label', { class: 'chkrow' }, resume, 'Resume where each agent left off') : h('p', { class: 'hint', text: 'Each agent starts with its start prompt from Team. Next time you can resume their conversations.' }),
    needed.length ? h('label', { class: 'chkrow' }, openFirst, `Open ${needed.map(l => l.name).join(', ')} first`) : null,
    h('p', { class: 'hint', text: 'Agents start one after another a second apart. Approve their first tool use in each console, or set a permission mode in Team.' })],
    actions: [{ label: 'Cancel' }, { label: 'Launch', primary: true, onClick: async () => {
      const pick = rows.filter(r => r.cb.checked && !r.cb.disabled).map(r => r.a.id);
      if (!pick.length && !(needed.length && openFirst.checked)) { toast('Nothing to launch.'); return; }
      let delay = 0;
      if (needed.length && openFirst.checked) {
        for (const l of needed) await safely(() => D.runLauncher(ws.key, l.id));
        const checks = needed.map(l => l.check).filter(Boolean);
        toast(`Opening ${needed.map(l => l.name).join(', ')}. ${checks.join(' ')}`);
        delay = 5000;
        setTimeout(() => loadLaunchers(ws), 6000);
      }
      for (let i = 0; i < pick.length; i++) setTimeout(() => startAgent(ws, pick[i], { resume: resume.checked }), delay + i * 1100);
    } }] });
}

function handoffModal(ws, fromId) {
  if (!ws.team) return;
  const live = ws.team.agents.filter(a => running(ws, a.id));
  if (live.length < 1) return toast('Start at least one agent first.', 'err');
  const from = select(ws.team.agents.map(a => [a.id, a.name]), fromId || (live[0] && live[0].id));
  const to = select(ws.team.agents.map(a => [a.id, a.name + (running(ws, a.id) ? '' : ' (not running)')]), (ws.team.agents.find(a => a.id !== (fromId || live[0].id)) || {}).id);
  const sum = h('input', { type: 'checkbox', checked: true });
  const note = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Anything to add for the next agent (optional)' });
  modal({ title: 'Hand off a task', body: [
    h('div', { class: 'two' }, field('From', from), field('To', to)),
    h('label', { class: 'chkrow' }, sum, 'Ask the first agent to write a hand-off summary first'),
    field('Note from you', note),
    h('p', { class: 'hint', text: 'The summary is saved in the agents folder under handoffs, then the second agent is told to read it and continue.' })],
    actions: [{ label: 'Cancel' }, { label: 'Hand off', primary: true, onClick: async () => {
      if (from.value === to.value) throw new Error('Pick two different agents.');
      const r = await D.handoff(ws.key, { from: from.value, to: to.value, note: note.value, summarize: sum.checked });
      toast(r.pending ? 'Waiting for the summary, then it goes to the next agent.' : 'Handed off.');
    } }] });
}

function broadcastModal(ws) {
  if (!ws.team) return;
  const live = ws.team.agents.filter(a => running(ws, a.id));
  if (!live.length) return toast('No agents are running.', 'err');
  const boxes = live.map(a => ({ a, cb: h('input', { type: 'checkbox', checked: true }) }));
  const text = h('textarea', { class: 'textarea', rows: 4, placeholder: 'Typed into each console and sent' });
  modal({ title: 'Broadcast', body: [field('Message', text), h('div', { class: 'launch-list' }, boxes.map(b => h('label', { style: { '--c': b.a.color } }, b.cb, h('span', { class: 'sw' }), h('b', { text: b.a.name }), h('span')))) ],
    actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async () => {
      const ids = boxes.filter(b => b.cb.checked).map(b => ws.key + ':' + b.a.id);
      if (!text.value.trim() || !ids.length) throw new Error('Write a message and pick at least one agent.');
      const n = await D.broadcast(ws.key, ids, text.value);
      toast(`Sent to ${n} agent${n === 1 ? '' : 's'}.`);
    } }] });
}

/* team editor */

function teamModal(ws) {
  if (!ws.team) return choosePreset(ws);
  const team = JSON.parse(JSON.stringify(ws.team));
  team.mcpServers = team.mcpServers || {};
  let sel = team.agents[0] ? team.agents[0].id : null;
  const list = h('div', { class: 'team-list' });
  const form = h('div', { class: 'team-form' });
  const mcpJson = h('textarea', { class: 'textarea mono', rows: 6, spellcheck: false });
  mcpJson.value = JSON.stringify(team.mcpServers, null, 2);
  const drawList = () => put(list, ...team.agents.map(a => h('button', { class: a.id === sel ? 'on' : '', style: { '--c': a.color }, on: { click: () => { sel = a.id; drawList(); drawForm(); } } }, h('span', { class: 'sw' }), h('span', { text: a.name }))),
    h('button', { class: 'btn sm', style: 'margin-top:6px', text: '+ Add agent', on: { click: () => {
      const a = { id: 'agent-' + uid().slice(0, 4), name: 'New agent', role: '', color: COLORS[team.agents.length % COLORS.length], command: 'claude', model: '', permissionMode: 'default', mcp: null, autostart: true, prompt: '' };
      team.agents.push(a); sel = a.id; drawList(); drawForm();
    } } }));
  const drawForm = () => {
    const a = team.agents.find(x => x.id === sel);
    if (!a) { put(form, h('p', { class: 'hint', text: 'Add an agent to get started.' })); return; }
    const name = h('input', { class: 'input', value: a.name, on: { input: (e) => { a.name = e.target.value; drawList(); } } });
    const role = h('input', { class: 'input', value: a.role || '', placeholder: 'What this agent does', on: { input: (e) => { a.role = e.target.value; } } });
    const sw = h('div', { class: 'swatches' }, COLORS.map(c => h('button', { class: c === a.color ? 'on' : '', style: { '--c': c }, title: c, 'aria-label': 'Color ' + c, on: { click: () => { a.color = c; drawList(); drawForm(); } } })));
    const cmdKind = a.command === 'claude' || !a.command ? 'claude' : /^powershell/i.test(a.command) ? 'powershell' : /^cmd/i.test(a.command) ? 'cmd' : 'custom';
    const cmdSel = select([['claude', 'Claude Code'], ['powershell', 'PowerShell'], ['cmd', 'Command Prompt'], ['custom', 'Custom command']], cmdKind);
    const cmdIn = h('input', { class: 'input mono', value: cmdKind === 'custom' ? a.command : '', placeholder: 'e.g. codex  or  python tool.py', hidden: cmdKind !== 'custom', on: { input: (e) => { a.command = e.target.value; } } });
    cmdSel.addEventListener('change', () => { const v = cmdSel.value; a.command = v === 'claude' ? 'claude' : v === 'powershell' ? 'powershell.exe -NoLogo' : v === 'cmd' ? 'cmd.exe' : (cmdIn.value || ''); drawForm(); });
    const isClaude = (a.command || 'claude') === 'claude';
    const model = select(MODELS.concat(MODELS.some(m => m[0] === a.model) ? [] : [[a.model, a.model]]), a.model || '');
    model.addEventListener('change', () => { a.model = model.value; });
    const mode = select(MODES, a.permissionMode || 'default');
    mode.addEventListener('change', () => { a.permissionMode = mode.value; });
    const keys = Object.keys(safeJSON(mcpJson.value) || team.mcpServers);
    const strict = Array.isArray(a.mcp);
    const rInherit = h('input', { type: 'radio', name: 'mcpm', checked: !strict, on: { change: () => { a.mcp = null; drawForm(); } } });
    const rStrict = h('input', { type: 'radio', name: 'mcpm', checked: strict, on: { change: () => { a.mcp = []; drawForm(); } } });
    const prompt = h('textarea', { class: 'textarea', rows: 6, placeholder: 'Sent as the first message when the agent starts fresh. {team}, {project}, {agentsDir} and {agent} are filled in.', on: { input: (e) => { a.prompt = e.target.value; } } });
    prompt.value = a.prompt || '';
    const extra = h('input', { class: 'input mono', value: a.extraArgs || '', placeholder: 'Extra command-line arguments (optional)', on: { input: (e) => { a.extraArgs = e.target.value; } } });
    const auto = h('input', { type: 'checkbox', checked: a.autostart !== false, on: { change: (e) => { a.autostart = e.target.checked; } } });
    const leadCb = h('input', { type: 'checkbox', checked: !!a.lead || (!team.agents.some(x => x.lead) && team.agents[0] === a), on: { change: (e) => { for (const x of team.agents) x.lead = false; a.lead = e.target.checked; } } });
    put(form, 
      h('div', { class: 'two' }, field('Name', name), field('Role', role)),
      field('Color', sw),
      h('div', { class: 'two' }, field('Runs', cmdSel), isClaude ? field('Model', model) : h('div')), cmdIn,
      isClaude ? field('Permissions', mode, mode.value === 'bypassPermissions' ? 'The agent acts without asking. Only for work you can undo.' : 'What the agent may do without asking you first.') : null,
      isClaude ? field('Tools it can reach', h('div', { class: 'mcp-pick' },
        h('label', { class: 'chkrow' }, rInherit, 'Your usual MCP servers, plus Orbie Studio'),
        h('label', { class: 'chkrow' }, rStrict, 'Only these, plus Orbie Studio:'),
        strict ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;padding-left:22px' }, keys.length ? keys.map(k => h('label', { class: 'chkrow' }, h('input', { type: 'checkbox', checked: a.mcp.includes(k), on: { change: (e) => { a.mcp = e.target.checked ? a.mcp.concat(k) : a.mcp.filter(x => x !== k); } } }), h('span', { class: 'mono', text: k }))) : h('span', { class: 'hint', text: 'No servers in the team list below yet.' })) : null),
        'Orbie Studio is how agents message each other and you. Limit Roblox Studio to the agents that should touch it.') : null,
      isClaude ? field('Start prompt', prompt) : null,
      field('Extra arguments', extra),
      h('label', { class: 'chkrow' }, auto, 'Start with Launch team'),
      h('label', { class: 'chkrow' }, leadCb, 'Lead: gets your general messages from the Tell the team bar and routes them'),
      h('div', { class: 'row', style: 'display:flex;gap:8px' },
        h('button', { class: 'btn sm', text: 'Duplicate', on: { click: () => { const c = JSON.parse(JSON.stringify(a)); c.id = slug(a.name) + '-' + uid().slice(0, 3); c.name = a.name + ' 2'; team.agents.push(c); sel = c.id; drawList(); drawForm(); } } }),
        h('button', { class: 'btn sm danger', text: 'Remove agent', disabled: running(ws, a.id), title: running(ws, a.id) ? 'Stop it first' : '', on: { click: () => { team.agents = team.agents.filter(x => x !== a); sel = team.agents[0] ? team.agents[0].id : null; drawList(); drawForm(); } } })));
  };
  drawList(); drawForm();
  mcpJson.addEventListener('change', drawForm);
  modal({ title: 'Team', wide: true, body: [
    h('div', { class: 'team-ed' }, list, form),
    field('MCP servers this team can use (JSON)', mcpJson, 'Same format as a Claude Code mcpServers block. Saved in team.json in the agents folder.')],
    actions: [{ label: 'Open agents folder', left: true, onClick: () => { D.openPath(ws.agentsDir); return false; } }, { label: 'Suggest a team', onClick: () => { suggestTeamFlow(ws); } }, { label: 'Cancel' }, { label: 'Save team', primary: true, onClick: async () => {
      const servers = safeJSON(mcpJson.value);
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('The MCP servers box must be a JSON object, like { "name": { "command": "...", "args": [] } }.');
      team.mcpServers = servers;
      const seen = new Set();
      for (const a of team.agents) { if (!a.name.trim()) throw new Error('Every agent needs a name.'); if (seen.has(a.id)) a.id = slug(a.name) + '-' + uid().slice(0, 3); seen.add(a.id); }
      const p = await D.saveTeam(ws.key, team);
      ws.team = p.team;
      syncConsoleTiles(ws); renderTiles(ws); fillComposerTargets(ws); loadLaunchers(ws);
      for (const a of ws.team.agents) updateConsoleTile(ws, a.id);
      toast('Team saved. Changes apply the next time each agent starts.');
    } }] });
}
function safeJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/* loops */

function loopsModal(ws) {
  if (!ws.team) return;
  let loops = JSON.parse(JSON.stringify(ws.loops || []));
  const listEl = h('div', { class: 'loop-list' });
  const describe = (l) => {
    const a = agentById(ws, l.consoleAgent);
    const when = l.trigger === 'schedule' ? `every ${l.everyMin} min` : l.trigger === 'idle' ? `when idle ${l.idleSec}s` : `when output matches /${l.pattern}/`;
    return `${a ? a.name : '?'} · ${when} · sends "${l.message}"${l.goal ? ` · stops when /${l.goal}/ appears` : ''}${l.maxRuns ? ` · max ${l.maxRuns}` : ''} · ran ${l.runs || 0}×${l.retired ? ' · ' + l.retired : ''}`;
  };
  const draw = () => put(listEl, ...(loops.length ? loops.map(l => h('div', { class: 'loop' },
    h('input', { type: 'checkbox', checked: !!l.enabled, title: 'On', 'aria-label': 'Loop on', on: { change: (e) => { l.enabled = e.target.checked; if (l.enabled) l.retired = ''; } } }),
    h('span', { class: 'ln', text: l.name }),
    h('span', { style: 'display:flex;gap:4px' }, h('button', { class: 'btn sm ghost', text: 'Edit', on: { click: () => edit(l) } }), h('button', { class: 'btn sm ghost danger', text: 'Delete', on: { click: () => { loops = loops.filter(x => x !== l); draw(); } } })),
    h('span', { class: 'ld', text: describe(l) }))) : [h('p', { class: 'hint', text: 'No loops yet. A loop types a message into an agent on a schedule, when it goes idle, or when its output matches a pattern. It never fires while an agent is waiting on you.' })]));
  const edit = (l) => {
    const isNew = !l;
    l = l || { id: uid(), name: 'Keep going', consoleAgent: ws.team.agents[0].id, trigger: 'idle', everyMin: 15, idleSec: 120, pattern: '', message: 'Continue with the next step in your list. Report progress with report_status.', goal: '', maxRuns: 10, enabled: true, runs: 0 };
    const name = h('input', { class: 'input', value: l.name });
    const agent = select(ws.team.agents.map(a => [a.id, a.name]), l.consoleAgent);
    const trig = select([['idle', 'When it goes idle'], ['schedule', 'On a schedule'], ['output', 'When its output matches']], l.trigger);
    const num = h('input', { class: 'input', type: 'number', min: 1 });
    const pat = h('input', { class: 'input mono', value: l.pattern || '', placeholder: 'e.g. tests? failed' });
    const msg = h('textarea', { class: 'textarea', rows: 3 }); msg.value = l.message || '';
    const goal = h('input', { class: 'input mono', value: l.goal || '', placeholder: 'e.g. ALL DONE  (optional)' });
    const max = h('input', { class: 'input', type: 'number', min: 0, value: l.maxRuns || 0 });
    const numField = field('', num);
    const syncTrig = () => {
      const t = trig.value;
      numField.querySelector('label').textContent = t === 'schedule' ? 'Every (minutes)' : 'Idle for (seconds, 30 or more)';
      num.value = t === 'schedule' ? (l.everyMin || 15) : (l.idleSec || 120);
      numField.hidden = t === 'output'; pat.closest('.field').hidden = t !== 'output';
    };
    const body = [h('div', { class: 'two' }, field('Name', name), field('Agent', agent)), h('div', { class: 'two' }, field('Trigger', trig), numField), field('Pattern (regular expression)', pat), field('Message to send', msg),
      h('div', { class: 'two' }, field('Goal: stop when output shows', goal), field('Stop after this many runs (0 = no limit)', max))];
    trig.addEventListener('change', syncTrig);
    setTimeout(syncTrig, 0);
    modal({ title: isNew ? 'New loop' : 'Edit loop', body, actions: [{ label: 'Cancel' }, { label: isNew ? 'Add loop' : 'Done', primary: true, onClick: () => {
      if (!msg.value.trim()) throw new Error('Write the message the loop sends.');
      if (trig.value === 'output') { if (!pat.value.trim()) throw new Error('Write a pattern to watch for.'); new RegExp(pat.value); }
      if (goal.value.trim()) new RegExp(goal.value);
      Object.assign(l, { name: name.value.trim() || 'Loop', consoleAgent: agent.value, trigger: trig.value, message: msg.value.trim(), pattern: pat.value.trim(), goal: goal.value.trim(), maxRuns: Number(max.value) || 0 });
      if (trig.value === 'schedule') l.everyMin = Math.max(1, Number(num.value) || 15); else if (trig.value === 'idle') l.idleSec = Math.max(30, Number(num.value) || 120);
      if (isNew) loops.push(l);
      draw();
    } }] });
  };
  draw();
  modal({ title: 'Loops', body: [listEl, h('button', { class: 'btn sm', style: 'align-self:flex-start', text: '+ New loop', on: { click: () => edit(null) } })],
    actions: [{ label: 'Cancel' }, { label: 'Save loops', primary: true, onClick: async () => { ws.loops = await D.saveLoops(ws.key, loops); toast('Loops saved.'); } }] });
}

function helpModal() {
  const rows = [['Run a / command in an agent', 'Click its window and type, or its / button'], ['Tell the team (type)', 'Ctrl+Shift+K'], ['Dictate (Windows voice typing)', 'Ctrl+Shift+M  or  Win+H'], ['Send the message', 'Enter (Shift+Enter for a new line)'], ['Open a project folder', 'Ctrl+O'], ['Launch team', 'Ctrl+Shift+L'], ['Hand off', 'Ctrl+Shift+H'], ['Broadcast', 'Ctrl+Shift+B'], ['Jump to agent 1–9', 'Ctrl+1 … 9'],
    ['Fit everything', 'Ctrl+0'], ['Show / hide the side panel', 'Ctrl+\\'], ['Zoom in / out', 'Ctrl+= / Ctrl+-'], ['Zoom at the pointer', 'Ctrl+scroll'], ['Pan the board', 'Drag empty space or middle mouse'],
    ['Maximize a tile', 'Double-click its title'], ['Copy in a terminal', 'Select, then Ctrl+C or right-click'], ['Paste in a terminal', 'Ctrl+V or right-click'], ['Next project', 'Ctrl+Tab'], ['Close a dialog / restore', 'Esc']];
  modal({ title: 'Shortcuts', body: [h('div', { class: 'kbd' }, rows.flatMap(([a, k]) => [h('span', { text: a }), h('kbd', { text: k })])),
    h('p', { class: 'hint', text: `Orbie Studio ${S.info ? S.info.version : ''}. Created and published by ${(S.info && S.info.publisher) || 'Cohesive'}.` })],
    actions: [{ label: 'Close' }] });
}

/* ------------------------------------------------------------------ keyboard */

function isAppShortcut(e) {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && ['l', 'h', 'b', 'm', 'k'].includes(k)) return true;
  if (e.ctrlKey && !e.shiftKey && (/^[0-9]$/.test(k) || k === '=' || k === '+' || k === '-' || k === '\\')) return true;
  if (e.ctrlKey && k === 'tab') return true;
  if (k === 'f1') return true;
  return false;
}

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (openMenuEl) { closeMenu(); return; }
    if (modalStack.length) { modalStack[modalStack.length - 1](); return; }
    const ws = activeWs(); if (ws) for (const el of Object.values(ws.tiles)) if (el.classList.contains('max')) { el.classList.remove('max'); refitAll(ws); }
    return;
  }
  const inTerm = !!(e.target.closest && e.target.closest('.xterm'));
  if (e.ctrlKey && !e.shiftKey && k === 'o' && !inTerm) { e.preventDefault(); openProjectFlow(); return; }
  if (k === 'f1') { e.preventDefault(); helpModal(); return; }
  if (e.ctrlKey && k === 'tab' && S.tabs.length > 1) { e.preventDefault(); const i = S.tabs.findIndex(w => w.key === S.active); activate(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length].key); return; }
  const ws = activeWs();
  if (!ws || modalStack.length) return;
  if (e.ctrlKey && e.shiftKey && k === 'l') { e.preventDefault(); launchTeam(ws); }
  else if (e.ctrlKey && e.shiftKey && k === 'h') { e.preventDefault(); handoffModal(ws); }
  else if (e.ctrlKey && e.shiftKey && k === 'b') { e.preventDefault(); broadcastModal(ws); }
  else if (e.ctrlKey && e.shiftKey && k === 'k') { e.preventDefault(); setComposer(ws, { to: 'lead' }); }
  else if (e.ctrlKey && e.shiftKey && k === 'm') { e.preventDefault(); dictate(ws); }
  else if (e.ctrlKey && !e.shiftKey && k === '0') { e.preventDefault(); fitAll(ws); }
  else if (e.ctrlKey && !e.shiftKey && k === '\\') { e.preventDefault(); toggleRail(ws); }
  else if (e.ctrlKey && !e.shiftKey && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(ws, 1.15); }
  else if (e.ctrlKey && !e.shiftKey && k === '-') { e.preventDefault(); zoomBy(ws, 1 / 1.15); }
  else if (e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(k) && ws.team) { e.preventDefault(); const a = ws.team.agents[Number(k) - 1]; if (a) focusConsole(ws, a.id); }
});

/* ------------------------------------------------------------------ events from the main process */

D.on('console:data', ({ id, data }) => {
  const [key, ...rest] = id.split(':');
  const ws = wsByKey(key);
  const t = ws && ws.terms[rest.join(':')];
  if (t) t.term.write(data);
});
D.on('console:status', (c) => {
  const ws = wsByKey(c.projectKey);
  if (!ws) return;
  ws.status[c.agentId] = c;
  if (c.sessionId) ws.sessions[c.agentId] = c.sessionId;
  updateConsoleTile(ws, c.agentId);
  renderMap(ws);
  drawLinks(ws);
});
D.on('console:focus', ({ id }) => { if (!id) return; const [key, ...rest] = id.split(':'); const ws = wsByKey(key); if (ws) focusConsole(ws, rest.join(':')); });
D.on('feed:add', ({ key, item }) => { const ws = wsByKey(key); if (!ws) return; ws.feed.push(item); if (ws.feed.length > 300) ws.feed.splice(0, ws.feed.length - 300); renderFeed(ws); });
D.on('inbox:update', ({ key, inbox }) => {
  const ws = wsByKey(key); if (!ws) return;
  const seen = new Set(ws.inbox.map(i => i.id));
  for (const it of inbox) if (!seen.has(it.id) && it.kind === 'question') speak(`${it.agentName} asks: ${it.text}`);
  ws.inbox = inbox; renderInbox(ws);
});
D.on('view:show', ({ key, view }) => { const ws = wsByKey(key); if (ws) showView(ws, view); });
D.on('board:kanban', ({ key, tile }) => {
  const ws = wsByKey(key); if (!ws || !ws.board) return;
  let t = ws.board.tiles.find(x => x.id === tile.id) || ws.board.tiles.find(x => x.type === 'kanban');
  if (!t) { t = Object.assign({}, tile); ws.board.tiles.push(t); mountTile(ws, t); positionTiles(ws); }
  else { t.cards = tile.cards; drawKanban(ws, t); }
  ws.save();
});
D.on('console:remoteSize', ({ id, cols, rows }) => {
  const [key, ...rest] = id.split(':'); const ws = wsByKey(key); const t = ws && ws.terms[rest.join(':')];
  if (t) { try { t.term.resize(cols, rows); } catch (e) {} }
});
D.on('console:reply', ({ key, reply }) => {
  const ws = wsByKey(key); if (!ws) return;
  ws.replies.push(reply); if (ws.replies.length > 200) ws.replies.splice(0, ws.replies.length - 200);
  renderReplies(ws); updateConsoleTile(ws, reply.agentId);
  if (ws.key !== S.active || document.hidden) return;
  const card = h('div', { class: 'toast reply-toast' }, h('b', { text: reply.agentName + ' replied' }), ' ', h('button', { class: 'btn sm ghost', text: 'Read', on: { click: () => { card.remove(); repliesModal(ws, reply.agentId); } } }));
  document.getElementById('toasts').append(card); setTimeout(() => card.remove(), 6000);
});
D.on('remote:update', (info) => { S.remote = info; refreshRemoteButtons(); if (S.remoteRender) S.remoteRender(); });
D.on('loops:update', ({ key, loops }) => { const ws = wsByKey(key); if (ws) ws.loops = loops; });
D.on('file:changed', ({ key, rel, text }) => {
  const ws = wsByKey(key);
  if (!ws || !ws.board) return;
  for (const t of ws.board.tiles) {
    if (t.type === 'markdown' && t.path === rel) { const el = ws.tiles[t.id] && ws.tiles[t.id].querySelector('.md'); if (el) renderMd(el, text); }
    if (t.type === 'image' && t.path === rel) loadImg(ws, t);
  }
});

/* ------------------------------------------------------------------ remote view */

function remoteButton() {
  const b = h('button', { class: 'btn ghost sm remote-btn', title: 'Remote view: open this board from your Mac or phone', on: { click: remoteModal } });
  paintRemoteButton(b);
  return b;
}
function paintRemoteButton(b) {
  const r = S.remote;
  const on = r && r.enabled && r.listening;
  b.classList.toggle('on', !!on);
  put(b, h('span', { class: 'rdot' + (on ? (r.connected ? ' live' : ' ready') : '') }), on && r.connected ? `Remote · ${r.connected}` : 'Remote');
}
function refreshRemoteButtons() {
  for (const b of document.querySelectorAll('.remote-btn')) paintRemoteButton(b);
  if (document.getElementById('welcome') && !S.active) renderWelcome();
}

async function remoteModal() {
  S.remote = await safely(() => D.remoteInfo()) || S.remote;
  if (!S.remote) return;
  const body = h('div', { class: 'remote-m' });
  const portIn = h('input', { class: 'input', type: 'number', min: 1024, max: 65535, value: S.remote.port, style: 'width:110px' });
  const render = () => {
    const r = S.remote;
    const toggle = h('input', { type: 'checkbox', checked: r.enabled, on: { change: async (e) => {
      e.target.disabled = true;
      const i = await safely(() => D.remoteSet({ enabled: e.target.checked, port: portIn.value }));
      if (i) { S.remote = i; refreshRemoteButtons(); }
      render();
    } } });
    const status = !r.enabled ? h('p', { class: 'hint', text: 'Off. Nothing on this PC can be reached from other devices.' })
      : !r.listening ? h('p', { class: 'hint err-t', text: r.error || 'Starting…' })
      : h('p', { class: 'hint ok-t', text: r.connected ? `Running. ${r.connected} device window${r.connected === 1 ? ' is' : 's are'} open right now.` : 'Running. Waiting for a device to connect.' });
    const addrs = r.enabled && r.listening ? (r.addresses.length ? r.addresses.map(a => h('div', { class: 'raddr' },
      h('code', { text: a.url }), h('span', { class: 'rl', text: a.label }),
      h('button', { class: 'btn sm ghost', text: 'Copy', on: { click: () => { D.clipWrite(a.url); toast('Copied ' + a.url); } } })))
      : [h('p', { class: 'hint', text: 'This PC has no home-network address right now. Connect it to Wi-Fi or Ethernet, or install Tailscale.' })]) : [];
    put(body,
      h('label', { class: 'chkrow big' }, toggle, h('span', null, h('b', { text: 'Let my other devices open this board' }), h('br'), h('span', { class: 'hint', text: 'Your Mac, iPhone or iPad opens Orbie Studio in Safari or Chrome: live agent terminals (type and run / commands), Tell the team, Needs you, tasks, views and the feed.' }))),
      status,
      r.enabled && r.listening ? h('div', { class: 'rsec' }, h('h3', { text: '1. On your Mac or phone, open' }), addrs) : null,
      r.enabled && r.listening ? h('div', { class: 'rsec' }, h('h3', { text: '2. Type this pairing code' }),
        h('div', { class: 'rcode' }, h('span', { text: r.code.slice(0, 3) + ' ' + r.code.slice(3) }),
          h('button', { class: 'btn sm ghost', text: 'New code', on: { click: async () => { const i = await safely(() => D.remoteNewCode()); if (i) { S.remote = i; render(); } } } })),
        h('p', { class: 'hint', text: 'Each code works once. The device then stays signed in until you sign it out below.' })) : null,
      h('div', { class: 'rsec' }, h('h3', { text: 'Paired devices' }),
        r.devices.length ? r.devices.map(d => h('div', { class: 'rdev' }, h('span', { class: 'rdot' + (d.online ? ' live' : '') }), h('b', { text: d.name }),
          h('span', { class: 'rl', text: d.online ? 'open now' : 'last seen ' + new Date(d.lastSeen || d.pairedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
          h('button', { class: 'btn sm ghost danger', text: 'Sign out', on: { click: async () => { const i = await safely(() => D.remoteSignOut(d.id)); if (i) { S.remote = i; render(); refreshRemoteButtons(); } } } })))
          : h('p', { class: 'hint', text: 'None yet.' }),
        r.devices.length > 1 ? h('button', { class: 'btn sm ghost danger', text: 'Sign out every device', on: { click: async () => { const i = await safely(() => D.remoteSignOut('all')); if (i) { S.remote = i; render(); refreshRemoteButtons(); } } } }) : null),
      h('details', { class: 'rsec' }, h('summary', { text: 'Away from home, port and safety' }),
        h('p', { class: 'hint', text: 'Away from home: install Tailscale (free) on this PC and on your Mac or phone and sign in to both with the same account. A "Tailscale (anywhere)" address then appears above and works from anywhere, encrypted, without opening anything to the internet.' }),
        h('p', { class: 'hint', text: 'The first time you turn this on, Windows asks whether Orbie Studio may use the network. Allow it on Private networks only.' }),
        h('p', { class: 'hint', text: 'Only devices on your home network or your Tailscale network can connect, and only after pairing. Anyone with a paired device can type into your agents, which can run programs on this PC, so pair only your own devices. On home Wi-Fi the connection is not encrypted; over Tailscale it is.' }),
        h('div', { class: 'row', style: 'display:flex;gap:8px;align-items:center' }, h('span', { class: 'hint', text: 'Port' }), portIn,
          h('button', { class: 'btn sm', text: 'Use this port', on: { click: async () => { const i = await safely(() => D.remoteSet({ port: portIn.value })); if (i) { S.remote = i; render(); } } } }))),
    );
  };
  render();
  S.remoteRender = render;
  modal({ title: 'Remote view', body, onClose: () => { S.remoteRender = null; } });
}

/* ------------------------------------------------------------------ updates */

function showUpdate(u) {
  const bar = document.getElementById('update-bar');
  if (u && !u.available && u.connected === false) {
    put(bar, h('span', { class: 'light off' }), h('span', { text: 'Updates not connected' }), h('button', { class: 'btn sm', text: 'Fix', on: { click: () => updateHelpModal(u) } }));
    bar.title = 'This copy could not reach GitHub or a shared update folder.'; bar.hidden = false; return;
  }
  if (!u || !u.available) { bar.hidden = true; return; }
  put(bar, h('span', { class: 'light' }), h('span', { text: `Update ${u.version} ready` }),
    h('button', { class: 'btn sm primary', text: u.needsInstaller ? 'How to update' : 'Restart to update', on: { click: () => updateModal(u) } }));
  bar.title = u.notes || '';
  bar.hidden = false;
}
function updateModal(u) {
  const live = S.tabs.reduce((n, ws) => n + Object.keys(ws.status).filter(id => running(ws, id)).length, 0);
  modal({ title: `Orbie Studio ${u.version}`, body: [
    h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text: `You have ${u.current}. ${u.needsInstaller ? (u.installer ? 'This version changes the app\'s libraries, so it needs the full installer once. Orbie Studio can download it from GitHub and start it; your teams, boards and settings stay.' : 'This version changes the app\'s libraries, so it needs the full installer once: get the newest Agent-Deck-Setup from Cohesive.') : 'Orbie Studio downloads the new version from ' + u.source + ', checks every file, and restarts.'}` }),
    u.notes ? h('div', { class: 'md', style: 'position:static;padding:0' }, ...(() => { const d = h('div'); renderMd(d, u.notes); return [d]; })()) : null,
    !u.needsInstaller && live ? h('p', { class: 'hint', text: `${live} agent${live === 1 ? '' : 's'} will stop. Use Launch team with "Resume where each agent left off" after the restart.` }) : null],
    actions: u.needsInstaller ? (u.installer ? [{ label: 'Later' }, { label: 'Download and install', primary: true, onClick: async () => { toast('Downloading the installer…'); const f = await D.downloadInstaller(); toast('Starting ' + f); } }] : [{ label: 'Close' }]) : [{ label: 'Later' }, { label: 'Restart to update', primary: true, onClick: async () => { await D.applyUpdate(); toast('Updating…'); } }] });
}
D.on('update:available', showUpdate);
function updateHelpModal(u) {
  modal({ title: 'Updates not connected', body: [
    h('p', { class: 'hint', style: 'font-size:13px;color:var(--fg-2)', text: 'Orbie Studio checks GitHub for new versions on its own every 10 minutes. This copy could not reach it' + (u && u.githubError ? ` (${u.githubError})` : '') + '.' }),
    h('ol', { class: 'hint', style: 'font-size:13px;color:var(--fg-2);padding-left:18px;margin:6px 0' },
      h('li', { text: 'Check this PC is online, then click Check again.' }),
      h('li', { text: 'If your network blocks GitHub, click Choose folder and pick a folder that holds the Orbie Studio code. Pick only a folder that you trust.' })),
  ], actions: [{ label: 'Choose folder', left: true, onClick: async () => { const r = await safely(() => D.pickUpdateSource()); if (r) { S.info.updateSource = r; const x = await D.checkUpdate().catch(() => null); if (x) { showUpdate(x); if (x.available) updateModal(x); else toast(`Connected. You have the newest version (${x.current}).`); } } } },
    { label: 'Close' }, { label: 'Check again', primary: true, onClick: async () => { const x = await safely(() => D.checkUpdate()); if (x) { showUpdate(x); if (x.available) updateModal(x); else if (x.connected) toast(`Connected. You have the newest version (${x.current}).`); else { toast('Still not connected.', 'err'); return false; } } } }] });
}

/* ------------------------------------------------------------------ boot */

(async function boot() {
  document.getElementById('tab-add').addEventListener('click', openProjectFlow);
  document.getElementById('main-menu').addEventListener('click', (e) => mainMenu(e.currentTarget));
  try { S.info = await D.init(); applyTheme(curTheme()); document.body.classList.add(S.info.platform); S.remote = await D.remoteInfo().catch(() => null); } catch (e) { document.body.append(h('p', { style: 'padding:40px', text: 'Orbie Studio could not start: ' + e.message })); return; }
  renderWelcome();
  D.checkUpdate().then(showUpdate).catch(() => {});
  const reopen = (S.info.settings.openTabs || []).slice();
  for (const p of reopen) {
    const proj = await D.openProject(p).catch(() => null);
    if (proj) S.tabs.push(makeWs(proj));
  }
  activate(S.tabs.length ? S.tabs[S.tabs.length - 1].key : null);
  S.booted = true;
  for (const ws of S.tabs) if (!ws.team) { activate(ws.key); choosePreset(ws); break; }
})();
