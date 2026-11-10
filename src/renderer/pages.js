// Orbie Studio pages: the tab bar and the Home, Previews, Status, Usage, Team and Questions screens.
// The Studio tab is the board with the live terminals (app.js). Every page here shows real data of the open game.
'use strict';

const PAGES = [['home', 'Home'], ['studio', 'Studio'], ['previews', 'Previews'], ['status', 'Status'], ['usage', 'Usage'], ['team', 'Team'], ['questions', 'Questions']];
const svg = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra || ''}<path d="${d}"></path></svg>`;
const NAV_ICON = {
  home: svg('M3 11l9-7 9 7v9h-6v-6H9v6H3z'),
  studio: svg('M3 4h7v5H3zM14 4h7v5h-7zM14 15h7v5h-7zM10 6.500h4M17.500 9v6'),
  previews: svg('M3 5h18v12H3zM8 21h8M12 17v4'),
  status: svg('M3 12h4l2-6 4 12 2-6h6'),
  usage: svg('M12 3c3 3 4 6 4 9l2 3-3 1-1 3h-4l-1-3-3-1 2-3c0-3 1-6 4-9z'),
  team: svg('M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 3-5 6-5s6 2 6 5M16 5.200a3 3 0 0 1 0 5.600M17.500 14.300c2 .700 3.500 2.300 3.500 4.700'),
  questions: svg('M4 5h16v11H9l-5 4z'),
  theme: svg('M12 3a9 9 0 1 0 9 9c0-.500 0-1-.100-1.500A6 6 0 0 1 12 3z'),
};
// The five Studio layouts. Each one arranges the live agent terminals on the board.
const LAYOUTS = [
  ['tree', 'Tree', svg('M12 7v4M6 15v-4h12v4M12 11v4', '<circle cx="12" cy="5" r="2"></circle><circle cx="6" cy="17" r="2"></circle><circle cx="12" cy="17" r="2"></circle><circle cx="18" cy="17" r="2"></circle>')],
  ['orbit', 'Orbit', svg('M0 0', '<circle cx="12" cy="12" r="2.500"></circle><ellipse cx="12" cy="12" rx="9.500" ry="5.500" transform="rotate(-20 12 12)"></ellipse>')],
  ['lanes', 'Lanes', svg('M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v12h-4z')],
  ['timeline', 'Timeline', svg('M4 7h9M9 12h11M6 17h8')],
  ['flow', 'Flow', svg('M6 12h3c4 0 3-6 7-6M9 12c4 0 3 6 7 6', '<circle cx="4.500" cy="12" r="1.800"></circle><circle cx="18" cy="6" r="1.800"></circle><circle cx="18" cy="18" r="1.800"></circle>')],
];

/* ------------------------------------------------------------------ agent pictures */

const MASCOTS = [['qa', /\bqa\b|test|security|review/], ['art', /\bart|blender|model|3d|anim/], ['aud', /audio|sound|music/], ['des', /design|writer|story|level/],
  ['eng', /engineer|server|backend|data|builder|studio/], ['prog', /program|gameplay|script|code|develop|luau/], ['mkt', /market/], ['pr', /\bpr\b|press|public/], ['com', /communit/], ['live', /live/], ['sup', /supervis|lead|manager|director/]];
function mascotOf(a, ws) {
  if (!a) return '';
  if (a.lead || (ws && leadAgent(ws) === a)) return 'sup';
  const s = `${a.name || ''} ${a.role || ''} ${a.id || ''}`.toLowerCase();
  for (const [k, re] of MASCOTS) if (re.test(s)) return k;
  return '';
}
function avatar(a, ws, size) {
  const m = mascotOf(a, ws);
  const el = h('span', { class: 'av', 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px', background: (a && a.color) || '#5b6475', fontSize: Math.max(9, Math.round(size * 0.34)) + 'px' } });
  if (m) el.append(h('img', { src: `av/${m}.svg`, alt: '' }));
  else el.textContent = String((a && a.name) || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return el;
}
function statusPill(st) { return h('span', { class: 'pill s-' + st }, h('span', { class: 'light' }), STATUS_WORD[st] || st); }
function agentNote(ws, a) {
  const c = ws.status[a.id]; const st = c ? c.status : 'off';
  return c && c.note ? c.note : (st === 'working' ? `Working · output ${ago(c.lastOutput)} ago` : st === 'needs' ? 'Waits for your approval' : st === 'resting' ? 'Ready for the next step' : st === 'exited' ? 'Stopped' : (a.role || ''));
}

/* ------------------------------------------------------------------ the tab bar */

S.page = 'home';
const navEl = document.getElementById('navbar');
const pageEl = document.getElementById('page');
function needsCount() { return S.tabs.reduce((n, w) => n + w.inbox.length, 0); }
function renderNav() {
  if (!navEl) return;
  const ws = activeWs();
  const n = needsCount();
  const tabs = h('nav', { class: 'ptabs glassbar', 'aria-label': 'Screens' }, PAGES.map(([id, name]) =>
    h('button', { class: S.page === id ? 'on' : '', 'aria-current': S.page === id ? 'page' : null, on: { click: () => goPage(id) } },
      h('span', { class: 'ni', html: NAV_ICON[id] }), name, id === 'questions' && n ? h('span', { class: 'n', text: n }) : null)));
  const right = h('div', { class: 'pright' });
  if (S.page === 'studio' && ws && ws.team) {
    right.append(h('nav', { class: 'lays glassbar', 'aria-label': 'Studio layout' }, LAYOUTS.map(([id, name, ic]) =>
      h('button', { class: curLayout(ws) === id ? 'on' : '', title: `${name} layout`, 'aria-label': `${name} layout`, html: ic, on: { click: () => setLayout(ws, id) } }))));
  } else {
    right.append(h('button', { class: 'btn primary big', title: 'Pick a folder for the game', text: 'New game', on: { click: openProjectFlow } }));
  }
  right.append(h('button', { class: 'btn round big', title: 'Choose a theme', 'aria-label': 'Choose a theme', html: NAV_ICON.theme,
    on: { click: (e) => menu(e.currentTarget, [{ head: 'Theme' }, ...THEMES.map(t => ({ label: t.name, sub: t.id === curTheme() ? 'On now' : t.sub, run: () => setTheme(t.id) }))]) } }));
  const left = h('div', { class: 'pleft' }, ws ? h('button', { class: 'game', title: 'Folder menu', on: { click: (e) => menu(e.currentTarget, folderItems(ws)) } }, h('b', { text: ws.name }), h('span', { text: ws.team ? `${ws.team.agents.length} agents` : 'No team yet' })) : h('span', { class: 'game none', text: 'No game is open' }));
  put(navEl, left, tabs, right);
}
function goPage(id) {
  if (!PAGES.some(p => p[0] === id)) return;
  S.page = id;
  paintPage();
}
function paintPage() {
  const ws = activeWs();
  // the Studio has two views: the canvas with the agent cards, and the big view (the board with the live terminals)
  const board = S.page === 'studio' && !!ws && !!ws.team && S.studioView === 'board';
  for (const w of S.tabs) w.el.hidden = !(board && w.key === S.active);
  const wel = document.getElementById('welcome'); if (wel) wel.hidden = true;
  pageEl.hidden = board;
  renderNav();
  if (board) { positionTiles(ws); refitAll(ws); return; }
  drawPage();
}
let dirtyTimer = null;
function pageDirty() {
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    renderNav();
    if (pageEl.hidden || S.page === 'usage') return;
    if (S.page === 'studio') { const w = activeWs(); if (w && w.team && typeof refreshCanvas === 'function') refreshCanvas(w); return; }
    const f = document.activeElement;
    if (f && pageEl.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) return pageDirty(); // never wipe text the owner is typing
    drawPage();
  }, 250);
}
function head(title, lede, ...right) { return h('header', { class: 'phead' }, h('div', null, h('h1', { text: title }), lede ? h('p', { class: 'lede', text: lede }) : null), h('div', { class: 'pacts' }, right)); }
function needGame(what) {
  return h('div', { class: 'gcard empty' }, h('img', { src: 'logo.svg', alt: '' }), h('h2', { text: 'Open a game first' }), h('p', { text: what }),
    h('button', { class: 'btn primary big', text: 'Open project folder', on: { click: openProjectFlow } }));
}
function drawPage() {
  const ws = activeWs();
  const P = { home: pageHome, studio: pageStudio, previews: pagePreviews, status: pageStatus, usage: pageUsage, team: pageTeam, questions: pageQuestions }[S.page] || pageHome;
  pageEl.className = 'screen page p-' + S.page;
  put(pageEl, h('div', { class: 'page-in' }, P(ws)));
}

/* ------------------------------------------------------------------ the rocket flight: the whole life of a game */

const STOPS = [
  ['Earth', 0, '#4aa3ff', '#1c5fb8'], ['Troposphere', 1e5, '#bfe3ff', '#6fb4f0'], ['Stratosphere', 5e5, '#9fd0ff', '#4d8fe0'], ['Mesosphere', 1e6, '#7fb0ff', '#3b62c8'],
  ['Thermosphere', 2.5e6, '#8f8cff', '#3b3aa8'], ['Exosphere', 5e6, '#6a66d8', '#22215f'], ['Moon', 1e7, '#f1f1f1', '#9a9a9a'], ['Mars', 5e7, '#ff8a5c', '#b3432a'],
  ['Jupiter', 2.5e8, '#f4c58d', '#b97a45'], ['Saturn', 1e9, '#f2dfa5', '#c2a25a'], ['Uranus', 2.5e9, '#a8f0ee', '#4fb6c2'], ['Neptune', 5e9, '#6f8cff', '#2a3fb8'],
  ['Pluto', 1e10, '#e3cdb8', '#8f7763'], ['Alpha Centauri', 2.5e10, '#fff6c8', '#ffc94d'], ['Sirius', 5e10, '#ffffff', '#9fd0ff'], ['Betelgeuse', 1e11, '#ffb199', '#e2493b'],
  ['Milky Way center', 2.5e11, '#f5e9ff', '#8a5aa8'], ['Large Magellanic Cloud', 5e11, '#d8e6ff', '#5f7fd0'], ['Andromeda Galaxy', 1e12, '#ffe9d6', '#a678d8'],
].map(([name, at, c1, c2], i) => ({ name, at, c1, c2, i, kind: i >= 16 ? 'gal' : i >= 13 ? 'star' : i >= 1 && i <= 5 ? 'air' : 'planet' }));
const WARN_AT = 1e9; // Saturn. The app warns here. It never pauses an agent.
const ROCKET = '<svg viewBox="-24 -14 42 28" aria-hidden="true"><path d="M-11 0h-11" stroke="#ffe08a" stroke-width="5.500" stroke-linecap="round"></path><path d="M-9-6l-6-5v22l6-5z" fill="#e2493b"></path><path d="M-10-6.500h12c6 0 10 3.500 12 6.500-2 3-6 6.500-12 6.500h-12z" fill="#fff" stroke="#3a2456" stroke-width="1.200" stroke-linejoin="round"></path><circle cx="3" cy="0" r="2.800" fill="#8a5aa8"></circle></svg>';
function flightPos(total) {
  let i = 0;
  while (i < STOPS.length - 1 && total >= STOPS[i + 1].at) i++;
  if (i >= STOPS.length - 1) return { i, frac: 0, pos: STOPS.length - 1, prev: STOPS[i], next: null };
  const frac = (total - STOPS[i].at) / (STOPS[i + 1].at - STOPS[i].at);
  return { i, frac, pos: i + frac, prev: STOPS[i], next: STOPS[i + 1] };
}
function orb(s, size) {
  return h('span', { class: 'orb ' + s.kind + (s.name === 'Saturn' ? ' ring' : ''), 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px', background: `radial-gradient(circle at 32% 30%, ${s.c1}, ${s.c2})`, color: s.c1 } });
}
const usageCache = {}; // key -> { at, total, today, byAgent }
async function loadUsage(ws) {
  const c = usageCache[ws.key];
  if (c && Date.now() - c.at < 60000) return c;
  const r = await D.usage(ws.key, 3650);
  const byAgent = {}; let total = 0;
  for (const [id, t] of Object.entries(r.totals || {})) { byAgent[id] = t.total || 0; total += t.total || 0; }
  const d = new Date(); const dk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = Object.values((r.byDay || {})[dk] || {}).reduce((a, b) => a + b, 0);
  return (usageCache[ws.key] = { at: Date.now(), total, today, byAgent });
}
function rocketStrip(ws) {
  const box = h('button', { class: 'gcard strip', title: 'Open the Usage screen', on: { click: () => goPage('usage') } }, h('p', { class: 'hint', text: 'Reading the token logs of this game…' }));
  loadUsage(ws).then((u) => {
    const f = flightPos(u.total);
    put(box, h('div', { class: 'strip-top' }, h('div', null, h('div', { class: 'lab', text: 'Rocket flight of ' + ws.name }), h('div', { class: 'big', text: fmtTok(u.total) + ' tokens' })),
      h('div', { class: 'strip-r' }, h('span', { class: 'chip', text: fmtTok(u.today) + ' today' }), f.next ? h('span', { class: 'chip', text: `${fmtTok(f.next.at - u.total)} to ${f.next.name}` }) : h('span', { class: 'chip', text: 'The flight reached Andromeda' }))),
      h('div', { class: 'space mini' }, h('div', { class: 'stars' }),
        h('div', { class: 'leg' }, h('div', { class: 'leg-end' }, orb(f.prev, 34), h('b', { text: f.prev.name })),
          h('div', { class: 'leg-line' }, h('span', { class: 'done', style: { width: (f.frac * 100).toFixed(1) + '%' } }), h('span', { class: 'rocket', style: { left: (f.frac * 100).toFixed(1) + '%' }, html: ROCKET })),
          f.next ? h('div', { class: 'leg-end' }, orb(f.next, 34), h('b', { text: f.next.name })) : null)));
  }).catch((e) => put(box, h('p', { class: 'hint', text: e.message })));
  return box;
}

/* ------------------------------------------------------------------ Home */

function pageHome(ws) {
  const info = S.info || { settings: {} };
  const recent = (info.settings.recent || []).slice(0, 6);
  const games = h('section', { class: 'gcard' }, h('h2', { text: 'Your games' }),
    recent.length ? h('div', { class: 'games' }, recent.map((r, i) => {
      const open = S.tabs.find(w => w.path.toLowerCase() === r.path.toLowerCase());
      return h('button', { class: 'game-row' + (open && open.key === S.active ? ' on' : ''), title: r.path, on: { click: () => { if (open) { activate(open.key); } else openPath(r.path); } } },
        h('span', { class: 'av', 'aria-hidden': 'true', style: { width: '42px', height: '42px', background: COLORS[i % COLORS.length], fontSize: '14px' } }, String(r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()),
        h('span', { class: 'gr-t' }, h('b', { text: r.name }), h('span', { text: r.path })), h('span', { class: 'chip', text: open ? (open.key === S.active ? 'Open now' : 'Open') : 'Recent' }));
    })) : h('p', { class: 'empty-note', text: 'No games yet. Press New game and pick a folder.' }));
  const agents = h('section', { class: 'gcard' }, h('div', { class: 'gc-head' }, h('h2', { text: 'Agents' }), ws && ws.team ? h('button', { class: 'btn sm', text: 'Status', on: { click: () => goPage('status') } }) : null),
    ws && ws.team ? h('div', { class: 'arow' }, ws.team.agents.map(a => h('button', { class: 'acard', title: a.role || a.name, on: { click: () => openBig(ws, a.id) } }, avatar(a, ws, 56), h('b', { text: a.name }), statusPill(statusOf(ws, a.id)))))
      : h('p', { class: 'empty-note', text: ws ? 'This game has no team yet. Open the Studio and pick a team.' : 'Open a game to see its agents.' }));
  const n = needsCount();
  const first = ws && ws.inbox.length ? ws.inbox[ws.inbox.length - 1] : null;
  const needs = h('section', { class: 'gcard' }, h('div', { class: 'gc-head' }, h('h2', { text: 'Needs you' }), h('span', { class: 'chip' + (n ? ' warn' : ''), text: n ? `${n} open` : 'Nothing open' })),
    first ? h('div', { class: 'q-first' }, h('b', { text: first.agentName + (first.kind === 'permission' ? ' needs an approval' : ' asks') }), h('p', { text: first.text })) : h('p', { class: 'empty-note', text: 'Agents put questions and approvals here.' }),
    h('button', { class: 'btn' + (n ? ' primary' : ''), text: 'Open Questions', on: { click: () => goPage('questions') } }));
  const ok = (good, text) => h('span', { class: 'chip ' + (good ? 'ok' : 'warn'), text: (good ? '✓ ' : '! ') + text });
  return [
    h('header', { class: 'hero' }, h('img', { src: 'logo.svg', alt: '' }), h('div', null, h('h1', { text: 'Orbie Studio' }), h('p', { class: 'tagline', text: 'Your team\'s AI game studio' })),
      h('div', { class: 'pacts' }, ws ? h('button', { class: 'btn big', text: 'Open the Studio', on: { click: () => studioView('canvas') } }) : null, h('button', { class: 'btn big' + (ws ? '' : ' primary'), text: 'Open project folder', on: { click: openProjectFlow } }))),
    ws ? rocketStrip(ws) : needGame('Pick the folder of a game. Its agents start side by side, and the rocket flight begins.'),
    h('div', { class: 'cols3' }, games, agents, needs),
    h('footer', { class: 'pc' }, ok(!!info.claudePath, 'Claude Code'), ok(!!info.gitPath, 'Git'), ok(!!info.curlPath, 'Status lights'),
      h('span', { class: 'chip', text: 'Orbie Studio ' + (info.version || '') }), h('span', { class: 'hint', text: 'Agents use your own Claude Code sign-in.' })),
  ];
}

/* ------------------------------------------------------------------ Status */

function pageStatus(ws) {
  if (!ws || !ws.team) return [head('Agent status', 'What each agent does now.'), needGame('The Status screen shows the agents of the open game.')];
  const live = ws.team.agents.filter(a => running(ws, a.id)).length;
  return [
    head('Agent status', `${ws.name} · ${live} of ${ws.team.agents.length} agents run now.`,
      h('button', { class: 'btn big primary', text: 'Launch team', on: { click: () => { goPage('studio'); launchTeam(ws); } } }), h('button', { class: 'btn big', text: 'Edit team', on: { click: () => teamModal(ws) } })),
    h('div', { class: 'agrid' }, ws.team.agents.map(a => {
      const st = statusOf(ws, a.id); const on = running(ws, a.id);
      const model = (MODELS.find(m => m[0] === (a.model || '')) || ['', a.model || 'Default'])[1];
      const mode = (MODES.find(m => m[0] === (a.permissionMode || 'default')) || ['', ''])[1];
      return h('section', { class: 'gcard agent-card' + (st === 'needs' ? ' needs' : '') },
        h('div', { class: 'ac-top' }, avatar(a, ws, 64), h('div', { class: 'ac-t' }, h('h2', { text: a.name }), h('p', { text: a.role || '' })), statusPill(st)),
        h('p', { class: 'ac-note', text: agentNote(ws, a) }),
        h('div', { class: 'ac-meta' }, a.command && a.command !== 'claude' ? h('span', { class: 'chip', text: 'Runs: ' + a.command }) : h('span', { class: 'chip', text: 'Model: ' + model }), mode ? h('span', { class: 'chip' + (a.permissionMode === 'bypassPermissions' ? ' warn' : ''), text: mode }) : null, h('span', { class: 'chip', text: 'Own context and brain' })),
        h('div', { class: 'ac-acts' }, h('button', { class: 'btn', text: 'Open console', on: { click: () => openBig(ws, a.id) } }),
          on ? h('button', { class: 'btn', text: 'Stop', on: { click: () => stopAgent(ws, a.id) } }) : h('button', { class: 'btn primary', text: 'Start', on: { click: () => startAgent(ws, a.id, { resume: true }) } }),
          h('button', { class: 'btn ghost', text: 'Replies', on: { click: () => repliesModal(ws, a.id) } })));
    })),
  ];
}

/* ------------------------------------------------------------------ Previews: the newest work of each agent */

function pagePreviews(ws) {
  if (!ws || !ws.team) return [head('Previews', 'The newest work of each agent.'), needGame('The Previews screen shows the newest answer and the views of each agent.')];
  const latest = {};
  for (const r of ws.replies) latest[r.agentId] = r;
  const views = ((ws.board && ws.board.tiles) || []).filter(t => t.owner && t.type !== 'console');
  return [
    head('Previews', `${ws.name} · the newest answer and the views of each agent.`),
    h('div', { class: 'agrid wide' }, ws.team.agents.map(a => {
      const r = latest[a.id];
      const mine = views.filter(v => v.owner === a.id);
      const md = h('div', { class: 'md pv-md' });
      if (r) renderMd(md, r.text);
      return h('section', { class: 'gcard pv' },
        h('div', { class: 'ac-top' }, avatar(a, ws, 44), h('div', { class: 'ac-t' }, h('h2', { text: a.name }), h('p', { text: r ? 'Answered at ' + hhmm(r.at) : 'No answer yet' })), statusPill(statusOf(ws, a.id))),
        r ? md : h('p', { class: 'empty-note', text: 'When this agent finishes a turn, its answer shows here.' }),
        mine.length ? h('div', { class: 'ac-meta' }, mine.map(v => h('button', { class: 'chip link', text: 'View: ' + (v.title || v.path || v.type), on: { click: () => { studioView('board'); setFocus(ws, v); fitAll(ws, true); } } }))) : null,
        h('div', { class: 'ac-acts' }, r ? h('button', { class: 'btn', text: 'Open all answers', on: { click: () => repliesModal(ws, a.id) } }) : null,
          h('button', { class: 'btn ghost', text: 'Open console', on: { click: () => openBig(ws, a.id) } })));
    })),
  ];
}

/* ------------------------------------------------------------------ Usage: the rocket flight */

function pageUsage(ws) {
  if (!ws) return [head('Usage', 'The rocket flight of a game.'), needGame('The rocket flies one stop for each token goal of the open game.')];
  const lede = h('p', { class: 'lede', text: 'Reading the token logs of this game…' });
  const chips = h('div', { class: 'pacts' });
  const space = h('div', { class: 'space full' }, h('div', { class: 'stars' }));
  const byAgent = h('section', { class: 'gcard' }, h('h2', { text: 'Tokens of each agent' }));
  const plan = h('section', { class: 'gcard' }, h('h2', { text: 'Flight plan' }));
  loadUsage(ws).then((u) => {
    const f = flightPos(u.total);
    lede.textContent = `${ws.name} used ${fmtTok(u.total)} tokens in its whole life. ${fmtTok(u.today)} tokens today.`;
    put(chips, f.next ? h('span', { class: 'chip', text: `Next stop: ${f.next.name} at ${fmtTok(f.next.at)}` }) : null,
      h('span', { class: 'chip' + (u.total >= WARN_AT ? ' warn' : ''), text: u.total >= WARN_AT ? 'Past the warning line (Saturn, 1.0B)' : 'Warning line: Saturn, 1.0B' }),
      h('button', { class: 'btn', text: 'Chart by day', on: { click: () => usageModal(ws) } }));
    const GAP = 170, PAD = 110;
    const track = h('div', { class: 'track', style: { width: (PAD * 2 + GAP * (STOPS.length - 1)) + 'px' } },
      h('span', { class: 'path' , style: { left: PAD + 'px', width: GAP * (STOPS.length - 1) + 'px' } }), h('span', { class: 'path done', style: { left: PAD + 'px', width: (GAP * f.pos).toFixed(0) + 'px' } }),
      STOPS.map(s => h('div', { class: 'stop' + (u.total >= s.at ? ' passed' : '') + (s.at === WARN_AT ? ' warnline' : ''), style: { left: (PAD + GAP * s.i) + 'px' } }, orb(s, s.kind === 'air' ? 22 : s.kind === 'gal' ? 54 : 40), h('b', { text: s.name }), h('span', { text: s.at ? fmtTok(s.at) : 'Start' }))),
      h('span', { class: 'rocket', style: { left: (PAD + GAP * f.pos).toFixed(0) + 'px' }, html: ROCKET }));
    space.append(track);
    requestAnimationFrame(() => { space.scrollLeft = Math.max(0, PAD + GAP * f.pos - space.clientWidth / 2); });
    const agents = (ws.team ? ws.team.agents : []).map(a => ({ a, n: u.byAgent[a.id] || 0 }));
    const other = Object.entries(u.byAgent).filter(([id]) => !agents.some(x => x.a.id === id)).reduce((s, [, n]) => s + n, 0);
    const max = Math.max(1, ...agents.map(x => x.n), other);
    byAgent.append(...[...agents.map(x => h('div', { class: 'urow' }, avatar(x.a, ws, 34), h('b', { text: x.a.name }), h('span', { class: 'ubar' }, h('span', { style: { width: (x.n / max * 100).toFixed(1) + '%', background: x.a.color || 'var(--accent)' } })), h('span', { class: 'un', text: fmtTok(x.n) }))),
      other ? h('div', { class: 'urow' }, h('span', { class: 'av', style: { width: '34px', height: '34px', background: '#5b6475' } }), h('b', { text: 'Other sessions' }), h('span', { class: 'ubar' }, h('span', { style: { width: (other / max * 100).toFixed(1) + '%' } })), h('span', { class: 'un', text: fmtTok(other) })) : null,
      !u.total ? h('p', { class: 'empty-note', text: 'No tokens yet. Start an agent, and the rocket lifts off.' }) : null].filter(Boolean));
    plan.append(h('div', { class: 'plan' }, STOPS.map(s => h('div', { class: 'prow' + (u.total >= s.at ? ' passed' : '') + (f.next === s ? ' next' : '') }, orb(s, 18), h('b', { text: s.name }), h('span', { text: s.at ? fmtTok(s.at) : 'Start' }), h('span', { class: 'pst', text: u.total >= s.at ? 'Passed' : f.next === s ? 'Next' : '' })))));
  }).catch((e) => { lede.textContent = e.message; });
  return [h('header', { class: 'phead' }, h('div', null, h('h1', { text: 'Usage' }), lede), chips), space, h('div', { class: 'cols2' }, byAgent, plan)];
}

/* ------------------------------------------------------------------ Questions */

function pageQuestions(ws) {
  if (!ws) return [head('Questions', 'Questions and approvals from the agents.'), needGame('Agents put questions and approvals on this screen.')];
  const items = ws.inbox.slice().reverse();
  const list = items.length ? items.map(it => {
    const agentId = it.consoleId.split(':').slice(1).join(':');
    const a = agentById(ws, agentId) || { name: it.agentName, color: '#5b6475' };
    const input = h('input', { class: 'input', placeholder: 'Type your own answer', 'aria-label': 'Your answer to ' + it.agentName });
    const answer = async (text) => { if (!String(text).trim()) return; await safely(() => D.answer(ws.key, it.id, text)); };
    const perm = it.kind === 'permission';
    return h('section', { class: 'gcard qcard' },
      h('div', { class: 'ac-top' }, avatar(a, ws, 48), h('div', { class: 'ac-t' }, h('h2', { text: it.agentName + (perm ? ' needs an approval' : ' asks') }), h('p', { text: hhmm(it.at) })), h('span', { class: 'chip warn', text: 'Waits for you' })),
      h('p', { class: 'qtext', text: it.text }),
      perm ? null : (it.options && it.options.length ? h('div', { class: 'qopts' }, it.options.map((o, i) => h('button', { class: 'opt', on: { click: () => answer(o) } }, h('span', { class: 'key', text: 'ABCDEFGH'[i] || '•' }), o))) : null),
      perm ? null : h('form', { class: 'qform', on: { submit: (e) => { e.preventDefault(); answer(input.value); } } }, input, h('button', { class: 'btn primary', text: 'Send' })),
      h('div', { class: 'ac-acts' }, h('button', { class: 'btn' + (perm ? ' primary' : ''), text: 'Open console', on: { click: () => openBig(ws, agentId) } }), h('button', { class: 'btn ghost', text: 'Dismiss', on: { click: () => D.dismiss(ws.key, it.id) } })));
  }) : [h('section', { class: 'gcard empty' }, h('h2', { text: 'Nothing waits for you' }), h('p', { text: 'Agents put questions and approvals here. You can also write to an agent on the right.' }))];
  // write to one agent
  const to = h('select', { class: 'select', 'aria-label': 'Agent' }, (ws.team ? ws.team.agents : []).map(a => h('option', { value: a.id, text: a.name + (running(ws, a.id) ? '' : ' (not running)') })));
  const ta = h('textarea', { class: 'textarea', rows: 5, placeholder: 'Write to this agent. Start with / to run a command.', 'aria-label': 'Message' });
  const send = async () => {
    const text = ta.value.trim(); if (!text || !to.value) return;
    const r = await safely(() => D.say(ws.key, { to: to.value, text }));
    if (r) { ta.value = ''; toast(r.sent && r.sent.length ? `Sent to ${r.sent.join(', ')}` : 'That agent is not running. Start it first.', r.sent && r.sent.length ? '' : 'err'); }
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  const write = h('section', { class: 'gcard write' }, h('h2', { text: 'Write to an agent' }), ws.team ? [to, ta, h('div', { class: 'ac-acts' }, h('button', { class: 'btn primary', text: 'Send', on: { click: send } }), h('span', { class: 'hint', text: 'Enter sends. Shift+Enter adds a line.' }))] : h('p', { class: 'empty-note', text: 'This game has no team yet.' }));
  return [head('Questions', `${ws.name} · ${items.length ? items.length + ' open' : 'nothing open'}.`), h('div', { class: 'qcols' }, h('div', { class: 'qlist' }, list), write)];
}

/* ------------------------------------------------------------------ Team: not built yet */

function pageTeam() {
  const item = (t, s) => h('div', { class: 'tm' }, h('b', { text: t }), h('span', { text: s }));
  return [head('Team', 'Team features are not built yet.'),
    h('section', { class: 'gcard' }, h('span', { class: 'chip warn', text: 'Planned: build step 5' }), h('h2', { text: 'What the Team screen will hold' }),
      h('p', { class: 'ac-note', text: 'The Team screen needs one shared online database. Orbie Studio does not have it yet, so this screen shows the plan only. Nothing on this screen sends or stores data.' }),
      h('div', { class: 'tmgrid' }, item('Members and hours', 'Active hours and background hours of each member.'), item('Join with a code', 'A 5-digit code. The team lead approves each member and sets a role.'),
        item('Questions to the team lead', 'A member sends a question about a game. The team lead answers.'), item('Team games', 'Members open a game as view only and add comments and sticky notes.'),
        item('Shared prompts', 'Groups of prompts with titles. One click copies a prompt.'), item('Money pool', 'Members pay the team lead by Cash App or Venmo with a QR code. The app tracks the budget.')))];
}

paintPage();
