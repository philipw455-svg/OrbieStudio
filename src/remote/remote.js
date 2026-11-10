// Orbie Studio Remote view (browser side). Talks to the PC over /api/* and listens on /api/events.
'use strict';

const R = { projects: [], key: null, agent: null, terms: {}, es: null, connected: false, everConnected: false, slash: [] };
const SLASH = [['/model', 'Change model'], ['/compact', 'Compact the conversation'], ['/clear', 'Start a fresh conversation'], ['/cost', 'Usage so far'],
  ['/context', 'What fills the context'], ['/status', 'Account and model'], ['/mcp', 'MCP servers'], ['/permissions', 'Permission rules'],
  ['/review', 'Review changes'], ['/memory', 'Edit memory'], ['/agents', 'Subagents'], ['/help', 'Help']];
const WORD = { off: 'Not started', starting: 'Starting', working: 'Working', resting: 'Ready', needs: 'Needs you', exited: 'Stopped' };
const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']];

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function put(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false).map(k => (k.nodeType ? k : document.createTextNode(String(k))))); }
function toast(msg, kind) {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), text: msg });
  $('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}
function hhmm(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }

async function api(route, body) {
  const opt = body === undefined ? { method: 'GET', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Deck': '1' }, body: JSON.stringify(body) };
  let r;
  try { r = await fetch('/api/' + route, opt); } catch (e) { throw new Error('Can\'t reach the PC. Is Orbie Studio open and on the same network?'); }
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && data && data.error === 'pair') { showPair(); throw new Error('Pair this device first.'); }
  if (!r.ok) throw new Error((data && data.error) || 'The PC said no (' + r.status + ').');
  return data;
}
async function safely(fn) { try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); return undefined; } }

/* ------------------------------------------------------------------ pairing */

function showPair() {
  if (R.es) { R.es.close(); R.es = null; }
  $('app').hidden = true;
  $('pair').hidden = false;
  setTimeout(() => $('pair-code').focus(), 30);
}
$('pair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pair-err').textContent = '';
  const code = $('pair-code').value.replace(/\D/g, '');
  if (code.length !== 6) { $('pair-err').textContent = 'The code has 6 digits.'; return; }
  try {
    await api('pair', { code, name: $('pair-name').value.trim() });
    $('pair-code').value = '';
    boot();
  } catch (err) { $('pair-err').textContent = err.message; }
});

/* ------------------------------------------------------------------ state */

const proj = () => R.projects.find(p => p.key === R.key) || null;
const agents = () => ((proj() || {}).team || {}).agents || [];
const consoleOf = (agentId) => ((proj() || {}).consoles || []).find(c => c.agentId === agentId) || null;
const statusOf = (agentId) => { const c = consoleOf(agentId); return c ? c.status : 'off'; };
const running = (agentId) => { const c = consoleOf(agentId); return !!c && c.status !== 'exited'; };
const agentById = (id) => agents().find(a => a.id === id);

async function boot() {
  const st = await api('state').catch((e) => { if (!$('pair').hidden) return null; $('conn').className = 'conn bad'; $('conn').lastChild.textContent = 'PC not reachable'; setTimeout(boot, 4000); return null; });
  if (!st) return;
  $('pair').hidden = true;
  $('app').hidden = false;
  R.projects = st.projects || [];
  R.pc = st.pc;
  const saved = store('ad.key');
  if (!R.projects.find(p => p.key === R.key)) R.key = (R.projects.find(p => p.key === saved) || R.projects[0] || {}).key || null;
  renderProjects();
  selectProject(R.key, true);
  connect();
}

function connect() {
  if (R.es) R.es.close();
  const es = new EventSource('/api/events');
  R.es = es;
  es.onopen = () => {
    const wasDown = R.everConnected && !R.connected;
    R.connected = true; R.everConnected = true;
    setConn(true);
    if (wasDown) resync();
  };
  es.onerror = () => {
    R.connected = false; setConn(false);
    if (es.readyState === EventSource.CLOSED) { setTimeout(() => api('state').then(() => connect()).catch(() => setTimeout(connect, 5000)), 3000); }
  };
  const on = (ch, fn) => es.addEventListener(ch, (ev) => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } try { fn(d); } catch (e) { console.error(e); } });
  on('console:data', onData);
  on('console:status', onStatus);
  on('console:size', ({ id, cols, rows }) => { const t = termById(id); if (t) { t.cols = cols; t.rows = rows; sizeTerm(t); } });
  on('feed:add', ({ key, item }) => { const p = R.projects.find(x => x.key === key); if (!p) return resyncSoon(); p.feed.push(item); if (key === R.key) renderFeed(); });
  on('inbox:update', ({ key, inbox }) => { const p = R.projects.find(x => x.key === key); if (!p) return resyncSoon(); p.inbox = inbox; renderInbox(); });
  on('view:show', ({ key, view }) => { const p = R.projects.find(x => x.key === key); if (!p) return; view.at = view.at || Date.now(); p.views = (p.views || []).filter(v => !(v.title === view.title && v.owner === view.owner)).concat([view]); if (key === R.key) renderViews(); toast(`${view.ownerName || 'An agent'} shared: ${view.title}`); });
  on('console:reply', ({ key, reply }) => {
    const p = R.projects.find(x => x.key === key); if (!p) return;
    p.replies = (p.replies || []).concat([reply]).slice(-200);
    if (key === R.key) { renderReplies(); if (R.agent === reply.agentId) showAgent(R.agent); }
    toast(`${reply.agentName} replied`);
  });
  on('board:kanban', ({ key, tile }) => { const p = R.projects.find(x => x.key === key); if (!p) return; p.kanban = (tile && tile.cards) || []; if (key === R.key) renderKanban(); });
}
function setConn(ok) {
  const c = $('conn');
  c.className = 'conn ' + (ok ? 'ok' : 'bad');
  c.lastChild.textContent = ok ? (R.pc ? 'Live · ' + R.pc : 'Live') : 'Reconnecting';
}
let resyncTimer = null;
function resyncSoon() { clearTimeout(resyncTimer); resyncTimer = setTimeout(resync, 600); }
async function resync() {
  const st = await api('state').catch(() => null);
  if (!st) return;
  R.projects = st.projects || [];
  if (!R.projects.find(p => p.key === R.key)) R.key = (R.projects[0] || {}).key || null;
  renderProjects();
  selectProject(R.key, true);
}

function renderProjects() {
  const sel = $('proj');
  put(sel, R.projects.length ? R.projects.map(p => h('option', { value: p.key, text: p.name + (p.inbox && p.inbox.length ? ` (${p.inbox.length})` : '') })) : h('option', { text: 'No project open on the PC' }));
  if (R.key) sel.value = R.key;
}
$('proj').addEventListener('change', (e) => selectProject(e.target.value));

function selectProject(key, rebuild) {
  if (key !== R.key || rebuild) {
    for (const t of Object.values(R.terms)) { try { t.term.dispose(); } catch (e) {} t.wrap.remove(); }
    R.terms = {};
  }
  R.key = key;
  if (key) store('ad.key', key);
  const lead = agents().find(a => a.lead) || agents()[0];
  const keep = R.agent && agentById(R.agent) ? R.agent : null;
  R.agent = keep || (agents().find(a => running(a.id)) || lead || {}).id || null;
  renderChips(); renderSay(); renderInbox(); renderMap(); renderKanban(); renderViews(); renderFeed(); renderTaskAgents(); renderRepWho(); renderReplies();
  showAgent(R.agent);
}

/* ------------------------------------------------------------------ terminals */

const termById = (id) => Object.values(R.terms).find(t => t.id === id);

function makeTerm(agentId) {
  const p = proj();
  const a = agentById(agentId);
  const c = consoleOf(agentId);
  const wrap = h('div', { class: 'tw' });
  $('terms').append(wrap);
  const term = new Terminal({
    fontFamily: '"SF Mono",Menlo,"Cascadia Mono",Consolas,monospace', fontSize: 13, lineHeight: 1.12,
    cursorBlink: true, scrollback: 6000, macOptionIsMeta: true, cols: (c && c.cols) || 110, rows: (c && c.rows) || 30,
    theme: {
      background: '#0d0f14', foreground: '#e3e6ee', cursor: (a && a.color) || '#8B9CFF', cursorAccent: '#0d0f14', selectionBackground: 'rgba(139,156,255,.35)',
      black: '#1b1e27', red: '#ff7d7d', green: '#5ee6c3', yellow: '#ffc46b', blue: '#8b9cff', magenta: '#f07cc8', cyan: '#6bc8ff', white: '#d9dce6',
      brightBlack: '#5d6272', brightRed: '#ff9c9c', brightGreen: '#8af0d6', brightYellow: '#ffd591', brightBlue: '#aab7ff', brightMagenta: '#f59ed7', brightCyan: '#95d8ff', brightWhite: '#ffffff',
    },
  });
  term.open(wrap);
  const t = { id: p.key + ':' + agentId, agentId, term, wrap, cols: (c && c.cols) || 110, rows: (c && c.rows) || 30, seq: -1, pending: [], loading: true, q: '', busy: false };
  R.terms[agentId] = t;
  term.onData((d) => queueInput(t, d));
  wrap.addEventListener('mouseup', () => { if (!term.hasSelection()) term.focus(); });
  loadBuffer(t);
  return t;
}
async function loadBuffer(t) {
  t.loading = true; t.pending = [];
  const b = await api('buffer?id=' + encodeURIComponent(t.id)).catch(() => ({ data: '', seq: 0 }));
  t.term.reset();
  t.term.write(b.data || '');
  t.seq = b.seq || 0;
  for (const m of t.pending) if (m.seq === undefined || m.seq > t.seq) { t.term.write(m.data); if (m.seq) t.seq = m.seq; }
  t.pending = []; t.loading = false;
  sizeTerm(t);
}
function onData({ id, data, seq }) {
  const t = termById(id);
  if (!t) return;
  if (t.loading) { t.pending.push({ data, seq }); return; }
  if (seq !== undefined && seq <= t.seq) return;
  if (seq !== undefined) t.seq = seq;
  t.term.write(data);
}
// Match the PC's terminal size, then pick a font size so the width fits this screen.
function sizeTerm(t) {
  if (!t) return;
  if (t.term.cols !== t.cols || t.term.rows !== t.rows) t.term.resize(t.cols, t.rows);
  const w = $('terms').clientWidth - 18;
  if (w <= 0) return;
  const fs = Math.max(7, Math.min(14, Math.floor((w / (t.cols * 0.602)) * 10) / 10));
  if (Math.abs((t.term.options.fontSize || 13) - fs) > 0.05) t.term.options.fontSize = fs;
}
window.addEventListener('resize', () => { const t = R.terms[R.agent]; if (t) sizeTerm(t); });

// Keystrokes from this browser, sent in order and batched while a send is in flight.
function queueInput(t, d) {
  t.q += d;
  if (t.busy) return;
  const flush = async () => {
    if (!t.q) { t.busy = false; return; }
    t.busy = true;
    const data = t.q; t.q = '';
    await api('input', { id: t.id, data }).catch((e) => toast(e.message, 'err'));
    flush();
  };
  flush();
}

function showAgent(agentId) {
  R.agent = agentId;
  for (const t of Object.values(R.terms)) t.wrap.classList.toggle('on', t.agentId === agentId);
  const a = agentById(agentId);
  const c = consoleOf(agentId);
  $('term-empty').hidden = !!c;
  $('term-empty').textContent = a ? `${a.name} isn't running on the PC.` : (R.projects.length ? 'No agents in this project yet.' : 'Open a project in Orbie Studio on the PC.');
  if (c && !R.terms[agentId]) makeTerm(agentId);
  const t = R.terms[agentId];
  if (t) { t.wrap.classList.add('on'); requestAnimationFrame(() => sizeTerm(t)); }
  $('th-name').textContent = a ? a.name : '';
  $('th-note').textContent = c && c.note ? c.note : (a ? a.role || '' : '');
  const live = !!c && c.status !== 'exited';
  $('th-start').hidden = !a || live;
  $('th-start').textContent = c && c.sessionId ? 'Start (resume)' : 'Start';
  $('th-stop').hidden = !live;
  $('th-fit').hidden = !live;
  $('th-reply').hidden = !(((proj() || {}).replies) || []).some(r => r.agentId === agentId);
  $('type-text').placeholder = a ? `Type to ${a.name} (/ for commands)` : 'Type to this agent';
  for (const b of $('chips').children) b.classList.toggle('on', b.dataset.id === agentId);
}

function onStatus(c) {
  const p = R.projects.find(x => x.key === c.projectKey);
  if (!p) return resyncSoon();
  p.consoles = (p.consoles || []).filter(x => x.agentId !== c.agentId).concat([c]);
  if (p.key !== R.key) { renderProjects(); return; }
  const t = R.terms[c.agentId];
  if (t && c.cols && (c.cols !== t.cols || c.rows !== t.rows)) { t.cols = c.cols; t.rows = c.rows; sizeTerm(t); }
  if (t && c.status === 'starting' && t.seq > 0 && !t.loading) { t.term.reset(); t.seq = 0; } // a fresh start
  renderChips(); renderMap();
  if (c.agentId === R.agent) showAgent(R.agent);
}

function renderChips() {
  put($('chips'), agents().map(a => {
    const st = statusOf(a.id);
    const c = consoleOf(a.id);
    return h('button', { class: 'chip s-' + st + (a.id === R.agent ? ' on' : ''), role: 'tab', dataset: undefined, style: { '--c': a.color || '#8b9cff' }, title: `${a.name}: ${WORD[st]}${c && c.note ? ' · ' + c.note : ''}`,
      on: { click: () => { showAgent(a.id); } } }, h('span', { class: 'sw' }), h('span', { class: 'cn', text: a.name }), h('span', { class: 'light' }));
  }));
  [...$('chips').children].forEach((b, i) => { b.dataset.id = agents()[i].id; });
}

$('th-start').addEventListener('click', () => safely(async () => { await api('start', { key: R.key, agentId: R.agent, resume: true }); toast('Starting on the PC…'); }));
$('th-stop').addEventListener('click', () => {
  const a = agentById(R.agent);
  if (!confirm(`Stop ${a ? a.name : 'this agent'} on the PC?`)) return;
  safely(() => api('stop', { id: R.key + ':' + R.agent }));
});
$('th-reply').addEventListener('click', () => { $('rep-who').value = R.agent; go('replies'); });
$('th-fit').addEventListener('click', () => {
  const t = R.terms[R.agent];
  if (!t) return;
  const box = $('terms');
  const fs = 13, cw = fs * 0.602, ch = Math.round(fs * 1.12 * 1.0 + 2);
  const cols = Math.max(40, Math.min(220, Math.floor((box.clientWidth - 18) / cw)));
  const rows = Math.max(12, Math.min(80, Math.floor((box.clientHeight - 14) / ch)));
  safely(async () => { await api('resize', { id: t.id, cols, rows }); t.cols = cols; t.rows = rows; sizeTerm(t); toast(`Terminal is now ${cols}×${rows}.`); });
});

/* typing box + keys */

$('type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('type-text').value.trim();
  if (!text || !R.agent) return;
  const id = R.key + ':' + R.agent;
  safely(async () => {
    if (text.startsWith('/')) await api('command', { id, cmd: text });
    else await api('send', { id, text });
    $('type-text').value = ''; autoGrow($('type-text'));
  });
});
$('type-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('type-form').requestSubmit(); } });
function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(120, el.scrollHeight + 2) + 'px'; }
$('type-text').addEventListener('input', (e) => autoGrow(e.target));

const decode = (s) => s.replace(/\\x([0-9a-f]{2})/gi, (m, x) => String.fromCharCode(parseInt(x, 16))).replace(/\\r/g, '\r').replace(/\\t/g, '\t');
for (const b of $('keys').querySelectorAll('button[data-k]')) {
  b.addEventListener('click', () => { const t = R.terms[R.agent]; if (!t) return toast('That agent isn\'t running.', 'err'); queueInput(t, decode(b.dataset.k)); });
}
$('slash-btn').addEventListener('click', (e) => {
  if (!R.terms[R.agent]) return toast('That agent isn\'t running.', 'err');
  pop(e.currentTarget, SLASH.map(([cmd, label]) => ({ label, k: cmd, run: () => safely(() => api('command', { id: R.key + ':' + R.agent, cmd })) })));
});

function pop(anchor, items) {
  const el = $('pop');
  put(el, items.map(it => h('button', { on: { click: () => { el.hidden = true; it.run(); } } }, it.label, it.k ? h('span', { class: 'k', text: it.k }) : null)));
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.max(220, el.offsetWidth);
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  const below = r.bottom + 6, hgt = el.offsetHeight;
  el.style.top = (below + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 6) : below) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!$('pop').hidden && !e.target.closest('#pop')) $('pop').hidden = true; });

$('menu-btn').addEventListener('click', (e) => pop(e.currentTarget, [
  { label: 'Refresh everything', run: () => resync() },
  { label: 'Sign out this device', run: () => { if (confirm('Sign out this device? You will need a new code from the PC to come back.')) safely(async () => { await api('signout', {}); showPair(); }); } },
]));

/* ------------------------------------------------------------------ talk, needs you, team */

function renderSay() {
  const sel = $('say-to');
  const lead = agents().find(a => a.lead) || agents()[0];
  const prev = sel.value;
  put(sel, lead ? h('option', { value: 'lead', text: `${lead.name} (routes it)` }) : null, h('option', { value: 'everyone', text: 'Everyone' }),
    agents().filter(a => a !== lead).map(a => h('option', { value: a.id, text: a.name })));
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
$('say-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('say-text').value.trim();
  if (!text) return;
  safely(async () => {
    const r = await api('say', { key: R.key, to: $('say-to').value, text, comment: $('say-comment').checked });
    $('say-text').value = '';
    toast(r && r.sent ? `Sent to ${r.sent.join(', ')}${r.missed && r.missed.length ? ` (not running: ${r.missed.join(', ')})` : ''}.` : 'Sent.');
  });
});
$('say-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('say-form').requestSubmit(); } });

function renderInbox() {
  const p = proj();
  const items = (p && p.inbox) || [];
  const n = items.length;
  for (const id of ['needs-count', 'needs-count-b']) { $(id).hidden = !n; $(id).textContent = n; }
  document.title = (n ? `(${n}) ` : '') + 'Orbie Studio';
  renderProjects();
  put($('inbox'), n ? items.slice().reverse().map(it => {
    const agentId = String(it.consoleId || '').split(':').pop();
    const a = agentById(agentId) || {};
    const card = h('div', { class: 'card needs' },
      h('div', { class: 'who' }, h('span', { class: 'light', style: { background: a.color || 'var(--needs)' } }), it.agentName, h('span', { class: 't', text: hhmm(it.at || Date.now()) })),
      h('div', { class: 'txt', text: it.text }));
    if (it.kind === 'question') {
      const inp = h('input', { placeholder: 'Your answer', 'aria-label': 'Answer' });
      const send = (text) => safely(async () => { await api('answer', { key: R.key, itemId: it.id, text }); toast('Answer sent.'); });
      if (it.options && it.options.length) card.append(h('div', { class: 'row' }, it.options.map(o => h('button', { class: 'btn sm', text: o, on: { click: () => send(o) } }))));
      card.append(h('form', { class: 'row', on: { submit: (e) => { e.preventDefault(); if (inp.value.trim()) send(inp.value.trim()); } } }, inp, h('button', { class: 'btn sm primary', type: 'submit', text: 'Answer' })));
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', text: 'Dismiss', on: { click: () => safely(() => api('dismiss', { key: R.key, itemId: it.id })) } })));
    } else {
      const t = () => R.terms[agentId] || (consoleOf(agentId) ? makeTerm(agentId) : null);
      card.append(h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', text: 'Open console', on: { click: () => { go('agents'); showAgent(agentId); } } }),
        h('button', { class: 'btn sm', text: '1 · Yes', title: 'Presses 1 in its console', on: { click: () => { const x = t(); if (x) queueInput(x, '1'); } } }),
        h('button', { class: 'btn sm', text: '2', title: 'Presses 2 (usually "Yes, and don\'t ask again")', on: { click: () => { const x = t(); if (x) queueInput(x, '2'); } } }),
        h('button', { class: 'btn sm ghost', text: 'Esc · No', title: 'Presses Esc', on: { click: () => { const x = t(); if (x) queueInput(x, '\x1b'); } } })));
    }
    return card;
  }) : h('div', { class: 'none', text: 'Nothing is waiting on you.' }));
}

function renderMap() {
  put($('map'), agents().map(a => {
    const st = statusOf(a.id);
    const c = consoleOf(a.id);
    return h('button', { class: 'ag s-' + st, style: { '--c': a.color || '#8b9cff' }, on: { click: () => { go('agents'); showAgent(a.id); } } },
      h('span', { class: 'sw' }), h('span', { class: 'an', text: a.name + (a.lead ? ' · lead' : '') }), h('span', { class: 'st' }, h('span', { class: 'light', style: { display: 'inline-block', marginRight: '5px' } }), WORD[st]),
      h('span', { class: 'nt', text: (c && c.note) || a.role || '' }));
  }));
}

/* ------------------------------------------------------------------ tasks */

function renderTaskAgents() {
  put($('task-agent'), h('option', { value: '', text: 'Anyone' }), agents().map(a => h('option', { value: a.name, text: a.name })));
}
function renderKanban() {
  const cards = ((proj() || {}).kanban) || [];
  put($('kanban'), COLS.map(([col, label]) => {
    const list = cards.filter(k => k.col === col);
    return h('div', { class: 'col' }, h('h4', { text: `${label} · ${list.length}` }),
      list.length ? list.map(k => {
        const a = agentById(k.agent);
        const mv = h('select', { 'aria-label': 'Move ' + k.id, on: { change: (e) => safely(() => api('task', { key: R.key, action: 'move', id: k.id, column: e.target.value })) } },
          COLS.map(([v, l]) => h('option', { value: v, text: l, selected: v === col })));
        return h('div', { class: 'kc', style: { '--c': (a && a.color) || 'var(--line-2)' } }, h('div', { class: 'kt', text: k.text }),
          h('div', { class: 'km' }, h('span', { text: k.id }), a ? h('span', { text: a.name }) : null, mv));
      }) : h('div', { class: 'none', text: '—' }));
  }));
}
$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('task-text').value.trim();
  if (!text) return;
  safely(async () => { await api('task', { key: R.key, action: 'add', text, agent: $('task-agent').value || undefined, column: 'todo' }); $('task-text').value = ''; });
});

/* ------------------------------------------------------------------ views */

const viewCache = new Map();
function renderViews() {
  const list = (((proj() || {}).views) || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  put($('views'), list.length ? list.map(v => {
    const a = agentById(v.owner) || {};
    const body = h('div', { class: 'vb' });
    const card = h('div', { class: 'card view' }, h('div', { class: 'who' }, h('span', { class: 'light', style: { background: a.color || 'var(--accent)' } }), v.title,
      h('span', { class: 't', text: (v.ownerName || '') + (v.at ? ' · ' + hhmm(v.at) : '') })), body);
    fillView(v, body);
    return card;
  }) : h('div', { class: 'none', text: 'When an agent shares a screenshot, report or test output, it shows up here.' }));
}
async function fillView(v, body) {
  const ck = R.key + '|' + v.kind + '|' + (v.path || v.url || v.title) + '|' + (v.at || '');
  if (v.kind === 'text') return put(body, h('pre', { text: v.text || '' }));
  if (v.kind === 'web') return put(body, h('div', { class: 'txt' }, 'A web preview on the PC: ', h('code', { text: v.url })), h('div', { class: 'none', text: 'Addresses like localhost only open on the PC itself.' }));
  if (viewCache.has(ck)) return put(body, viewCache.get(ck).cloneNode(true));
  put(body, h('div', { class: 'none', text: 'Loading…' }));
  try {
    let el;
    if (v.kind === 'image') {
      const r = await api('image?key=' + encodeURIComponent(R.key) + '&path=' + encodeURIComponent(v.path));
      el = h('img', { src: r.data, alt: v.title, loading: 'lazy' });
    } else {
      const r = await api('markdown?key=' + encodeURIComponent(R.key) + '&path=' + encodeURIComponent(v.path));
      el = h('div', { class: 'md' });
      el.innerHTML = DOMPurify.sanitize(marked.parse(r.text || ''), { USE_PROFILES: { html: true } });
      for (const link of el.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    }
    viewCache.set(ck, el);
    put(body, el.cloneNode(true));
  } catch (e) { put(body, h('div', { class: 'none', text: e.message })); }
}

/* ------------------------------------------------------------------ replies */

function renderRepWho() {
  const sel = $('rep-who'); const prev = sel.value;
  put(sel, h('option', { value: 'all', text: 'Every agent' }), agents().map(a => h('option', { value: a.id, text: a.name })));
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
$('rep-who').addEventListener('change', () => renderReplies());
function renderReplies() {
  const who = $('rep-who').value || 'all';
  const items = (((proj() || {}).replies) || []).filter(r => who === 'all' || r.agentId === who).slice().reverse().slice(0, 40);
  put($('replies'), items.length ? items.map(r => {
    const a = agentById(r.agentId) || { name: r.agentName, color: '#8b9cff' };
    const md = h('div', { class: 'md' });
    md.innerHTML = DOMPurify.sanitize(marked.parse(r.text || ''), { USE_PROFILES: { html: true } });
    for (const link of md.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    const card = h('div', { class: 'reply', style: { '--c': a.color || '#8b9cff' } }, h('div', { class: 'who' }, h('span', { class: 'sw' }), a.name, h('time', { text: hhmm(r.at) })), md);
    const more = h('button', { class: 'btn sm ghost', text: 'Show all', on: { click: () => { card.classList.toggle('open'); more.textContent = card.classList.contains('open') ? 'Show less' : 'Show all'; } } });
    card.append(h('div', { class: 'row' }, more,
      h('button', { class: 'btn sm ghost', text: 'Copy', on: { click: () => { navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(r.text).then(() => toast('Copied'), () => toast('Select the text to copy it.', 'err')) : toast('Select the text to copy it.', 'err'); } } }),
      h('button', { class: 'btn sm ghost', text: 'Answer', on: { click: () => { go('talk'); $('say-to').value = [...$('say-to').options].some(o => o.value === r.agentId) ? r.agentId : 'lead'; $('say-text').focus(); } } }),
      h('button', { class: 'btn sm ghost', text: 'Console', on: { click: () => { go('agents'); showAgent(r.agentId); } } })));
    return card;
  }) : h('div', { class: 'none', text: 'When an agent finishes a turn, its full answer shows up here.' }));
}

/* ------------------------------------------------------------------ feed */

function renderFeed() {
  const items = (((proj() || {}).feed) || []).slice(-150).reverse();
  put($('feed'), items.length ? items.map(it => h('li', null, h('span', { class: 'tm', text: hhmm(it.t) }), h('span', { class: 'tx', text: it.text }))) : h('li', null, h('span'), h('span', { class: 'none', text: 'Nothing yet.' })));
}

/* ------------------------------------------------------------------ sections */

function go(name) {
  const narrow = window.matchMedia('(max-width:900px)').matches;
  for (const b of document.querySelectorAll('.bottom button')) b.classList.toggle('on', b.dataset.go === name);
  if (name === 'agents') {
    document.querySelector('.pane-agents').classList.add('on');
    if (narrow) document.querySelector('.side').classList.remove('on');
    const t = R.terms[R.agent]; if (t) requestAnimationFrame(() => sizeTerm(t));
    return;
  }
  if (narrow) { document.querySelector('.pane-agents').classList.remove('on'); document.querySelector('.side').classList.add('on'); }
  for (const b of document.querySelectorAll('.side-tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.side .pane')) s.classList.toggle('on', s.dataset.pane === name);
}
for (const b of document.querySelectorAll('.bottom button')) b.addEventListener('click', () => go(b.dataset.go));
for (const b of document.querySelectorAll('.side-tabs button')) b.addEventListener('click', () => go(b.dataset.tab));
window.matchMedia('(max-width:900px)').addEventListener('change', (m) => {
  if (!m.matches) { document.querySelector('.pane-agents').classList.add('on'); document.querySelector('.side').classList.remove('on'); }
  else go('agents');
});

boot();
