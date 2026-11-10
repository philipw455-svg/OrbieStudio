// Orbie Studio: the Studio canvas. Each agent is a card. Lines show who gives work and who checks it.
// Click a card to see the agent in the side panel. Double-click a card to open its terminal in the big view.
'use strict';

S.studioView = 'canvas';        // 'canvas' = agent cards, 'board' = the big view with the live terminals
S.sel = {};                     // game key -> the selected agent
S.cvTool = 'move';              // 'move', 'comment' or 'draw'
const NODE_W = 216, NODE_H = 104, GRID = 24;
const STICKY_COLORS = ['#ffe08a', '#b9e6ff', '#c8f2c2', '#ffc9de'];
const FLOW_HINT = { flow: 'Work flows from left to right', tree: 'Work flows from top to bottom', orbit: 'The lead sits in the center', lanes: 'One lane for each agent', timeline: 'One row for each agent' };
let cv = null;                  // the parts of the canvas that is on screen now
let cvDragging = false;

function canvasState(ws) {
  if (!ws.board && ws.team) setupBoard(ws);
  const b = ws.board || (ws.board = { tiles: [], view: { x: 0, y: 0, z: 1 } });
  const c = b.canvas = b.canvas || {};
  if (!['flow', 'tree', 'orbit', 'lanes', 'timeline'].includes(c.mode)) c.mode = 'flow';
  c.pos = c.pos && typeof c.pos === 'object' ? c.pos : {};
  c.notes = Array.isArray(c.notes) ? c.notes : [];
  for (const k of ['links', 'pins', 'ink']) c[k] = Array.isArray(c[k]) ? c[k] : [];
  return c;
}
function qaAgent(ws) { const lead = leadAgent(ws); return ws.team.agents.find(a => a !== lead && mascotOf(a, ws) === 'qa') || null; }
const snap = (v) => Math.round(v / GRID) * GRID;

// Puts every agent card in its place for one of the five layouts.
function layoutNodes(ws, mode) {
  const c = canvasState(ws);
  const A = ws.team.agents, lead = leadAgent(ws), qa = qaAgent(ws);
  const mid = A.filter(a => a !== lead && a !== qa);
  const r = cv && cv.el.isConnected ? cv.el.getBoundingClientRect() : { width: 1100, height: 700 };
  const W = Math.max(760, r.width), H = Math.max(480, r.height - 84);
  const gap = 24, w = NODE_W, h = NODE_H;
  const at = (a, x, y) => { c.pos[a.id] = { x: Math.max(GRID, snap(x)), y: Math.max(GRID * 2, snap(y)) }; };
  if (mode === 'tree') {
    const cols = Math.max(1, Math.min(mid.length || 1, Math.floor((W - 48 + gap) / (w + gap))));
    const rows = Math.ceil(mid.length / cols);
    at(lead, (W - w) / 2, 56);
    mid.forEach((a, i) => { const row = Math.floor(i / cols), inRow = Math.min(cols, mid.length - row * cols); const rowW = inRow * w + (inRow - 1) * gap; at(a, (W - rowW) / 2 + (i % cols) * (w + gap), 56 + h + 72 + row * (h + gap)); });
    if (qa) at(qa, (W - w) / 2, 56 + h + 72 + rows * (h + gap) + 48);
  } else if (mode === 'orbit') {
    const ring = A.filter(a => a !== lead);
    const rx = Math.max(250, Math.min(W / 2 - w / 2 - 36, 460)), ry = Math.max(170, Math.min(H / 2 - h / 2 - 24, 260));
    const cx = W / 2, cy = Math.max(H / 2, ry + h / 2 + 48);
    at(lead, cx - w / 2, cy - h / 2);
    ring.forEach((a, i) => { const g = -Math.PI / 2 + (i / ring.length) * Math.PI * 2; at(a, cx + rx * Math.cos(g) - w / 2, cy + ry * Math.sin(g) - h / 2); });
  } else if (mode === 'lanes') {
    const cols = Math.max(1, Math.floor((W - 48 + gap) / (w + gap)));
    A.forEach((a, i) => at(a, 36 + (i % cols) * (w + gap), 72 + Math.floor(i / cols) * (h + 56)));
  } else if (mode === 'timeline') {
    A.forEach((a, i) => at(a, 36, 56 + i * (h + 16)));
  } else {
    const colH = mid.length * h + Math.max(0, mid.length - 1) * gap;
    const top = Math.max(56, (H - colH) / 2), midY = top + Math.max(0, colH - h) / 2;
    at(lead, 48, midY);
    mid.forEach((a, i) => at(a, Math.max(48 + w + 96, (W - w) / 2), top + i * (h + gap)));
    if (qa) at(qa, Math.max(48 + (w + 96) * 2, W - w - 48), midY);
  }
  c.mode = mode;
  ws.save();
}
function nodePos(ws, a) {
  const c = canvasState(ws);
  if (!c.pos[a.id]) layoutNodes(ws, c.mode);
  return c.pos[a.id] || { x: GRID, y: GRID * 2 };
}
function edgePath(p, q) {
  const ax = p.x + NODE_W / 2, ay = p.y + NODE_H / 2, bx = q.x + NODE_W / 2, by = q.y + NODE_H / 2;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy) * 1.15) {
    const x1 = ax + Math.sign(dx) * NODE_W / 2, x2 = bx - Math.sign(dx) * NODE_W / 2, k = Math.max(30, Math.abs(x2 - x1) * 0.5) * Math.sign(dx);
    return `M${x1} ${ay} C${x1 + k} ${ay} ${x2 - k} ${by} ${x2} ${by}`;
  }
  const s = Math.sign(dy) || 1, y1 = ay + s * NODE_H / 2, y2 = by - s * NODE_H / 2, k = Math.max(26, Math.abs(y2 - y1) * 0.5) * s;
  return `M${ax} ${y1} C${ax} ${y1 + k} ${bx} ${y2 - k} ${bx} ${y2}`;
}
function drawEdges(ws) {
  if (!cv) return;
  const lead = leadAgent(ws), qa = qaAgent(ws), NS = 'http://www.w3.org/2000/svg';
  const out = [];
  let maxX = 0, maxY = 0;
  for (const a of ws.team.agents) { const p = nodePos(ws, a); maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H); }
  for (const n of canvasState(ws).notes) { maxX = Math.max(maxX, n.x + 200); maxY = Math.max(maxY, n.y + 150); }
  const mk = (cls, d) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('class', cls); e.setAttribute('d', d); out.push(e); return e; };
  for (const a of ws.team.agents) {
    if (a === lead) continue;
    const d = edgePath(nodePos(ws, lead), nodePos(ws, a));
    mk('edge give', d);
    if (statusOf(ws, a.id) === 'working') mk('edge flowing', d);
    if (qa && a !== qa) mk('edge check', edgePath(nodePos(ws, a), nodePos(ws, qa)));
  }
  // links that the owner drew with the connect ball
  for (const l of canvasState(ws).links) {
    const a = agentById(ws, l.from), b = agentById(ws, l.to);
    if (!a || !b) continue;
    const d = edgePath(nodePos(ws, a), nodePos(ws, b));
    mk('edge user ' + (l.kind === 'check' ? 'check' : 'give'), d);
    mk('edge hit', d).addEventListener('click', (e) => linkMenu(ws, l, e));
  }
  cv.svg.replaceChildren(...out);
  cv.layer.style.width = (maxX + 24) + 'px'; cv.layer.style.height = (maxY + 96) + 'px';
}

/* ------------------------------------------------------------------ the canvas */

function pageStudio(ws) {
  if (!ws) return [head('Studio', 'The agents of a game on one canvas.'), needGame('The Studio shows the agents of the open game.')];
  if (!ws.team) return [head('Studio', ws.name + ' has no team yet.'), h('div', { class: 'gcard empty' }, h('img', { src: 'logo.svg', alt: '' }), h('h2', { text: 'Pick a team' }), h('p', { text: 'A team is a set of agents. Each agent has its own context and brain.' }), h('button', { class: 'btn primary big', text: 'Pick a team', on: { click: () => choosePreset(ws) } }))];
  const c = canvasState(ws);
  const sel = agentById(ws, S.sel[ws.key]) || leadAgent(ws);
  S.sel[ws.key] = sel.id;
  const layer = h('div', { class: 'cv-layer' });
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('class', 'cv-links'); svgEl.setAttribute('aria-hidden', 'true');
  const inkEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  inkEl.setAttribute('class', 'cv-ink'); inkEl.setAttribute('aria-hidden', 'true');
  layer.append(inkEl, svgEl);
  layer.addEventListener('pointerdown', (e) => canvasDown(ws, e));
  const el = h('div', { class: 'cv tool-' + S.cvTool }, layer);
  const side = h('aside', { class: 'gcard inspector', 'aria-label': 'Selected agent' });
  cv = { el, layer, svg: svgEl, ink: inkEl, side, key: ws.key };
  const live = ws.team.agents.filter(a => running(ws, a.id)).length;
  const wrap = h('div', { class: 'studio' },
    h('div', { class: 'cv-wrap' }, el,
      h('div', { class: 'cv-chips' }, h('span', { class: 'chip' + (live ? ' ok' : '') }, live ? h('span', { class: 'light on' }) : null, `${live} of ${ws.team.agents.length} agents run`), h('span', { class: 'chip', text: FLOW_HINT[c.mode] }),
        h('span', { class: 'chip legend' }, h('i', { class: 'lg give' }), 'gives work', h('i', { class: 'lg check' }), 'QA checks')),
      h('div', { class: 'cv-tools glassbar', role: 'toolbar', 'aria-label': 'Canvas tools' },
        h('button', { class: 'tool primary', title: 'Start the agents', text: 'Launch team', on: { click: () => launchTeam(ws) } }),
        [['move', 'Move', 'Drag a card. Drag the ball on a card to connect two agents.'], ['comment', 'Comment', 'Click the canvas or a card to pin a comment.'], ['draw', 'Draw', 'Draw on the canvas.']].map(([id, name, tip]) =>
          h('button', { class: 'tool' + (S.cvTool === id ? ' on' : ''), title: tip, 'aria-pressed': S.cvTool === id ? 'true' : 'false', text: name, on: { click: () => { S.cvTool = id; drawPage(); } } })),
        h('button', { class: 'tool', title: 'Add a sticky note to the canvas', text: 'Sticky note', on: { click: () => addSticky(ws) } }),
        h('button', { class: 'tool', title: 'Put every card back in its place', text: 'Tidy up', on: { click: () => { layoutNodes(ws, c.mode); drawPage(); } } }),
        c.ink.length ? h('button', { class: 'tool', title: 'Remove every drawing', text: 'Clear drawing', on: { click: () => { c.ink = []; ws.save(); drawPage(); } } }) : null,
        h('span', { class: 'tsep' }),
        h('button', { class: 'tool', title: 'Edit the agents of this team', text: 'Edit team', on: { click: () => teamModal(ws) } }),
        h('button', { class: 'tool', title: 'The 12 pictures and the game direction', text: 'Mockup', on: { click: () => { S.page = 'approval'; paintPage(); } } }),
        h('button', { class: 'tool', title: 'Open the board with every live terminal', text: 'All terminals', on: { click: () => studioView('board') } })),
      c.kickoff ? h('div', { class: 'kick glassbar' }, h('b', { text: 'The new game kickoff is ready.' }), h('span', { text: `Launch the team, then send the kickoff to ${leadAgent(ws).name}.` }),
        h('button', { class: 'tool primary', text: 'Send kickoff', on: { click: () => sendKickoff(ws) } }), h('button', { class: 'tool', text: 'Dismiss', on: { click: () => { delete c.kickoff; ws.save(); drawPage(); } } })) : null),
    side);
  // cards and notes go in after the canvas has a size, so a first layout fits the window
  requestAnimationFrame(() => {
    if (!cv || cv.el !== el) return;
    for (const a of ws.team.agents) layer.append(nodeEl(ws, a));
    for (const n of c.notes) layer.append(stickyEl(ws, n));
    for (const pin of c.pins) layer.append(pinEl(ws, pin, false));
    drawInk(ws);
    drawEdges(ws);
    renderInspector(ws);
  });
  return [wrap];
}
function nodeEl(ws, a) {
  const p = nodePos(ws, a), st = statusOf(ws, a.id);
  const el = h('div', { class: 'node' + (S.sel[ws.key] === a.id ? ' sel' : '') + (st === 'needs' ? ' needs' : ''), tabindex: 0, role: 'button', 'aria-label': `${a.name}, ${STATUS_WORD[st] || st}. Press Enter to open the big view.`,
    title: 'Click to select. Double-click to open the big view.', style: { left: p.x + 'px', top: p.y + 'px', width: NODE_W + 'px', height: NODE_H + 'px' }, dataset: { id: a.id } },
    h('span', { class: 'ball', title: 'Drag to another card to connect the two agents', 'aria-hidden': 'true' }),
    h('div', { class: 'n-top' }, avatar(a, ws, 36), h('b', { text: a.name })),
    h('div', { class: 'n-role', text: a.role || '' }),
    h('div', { class: 'n-st' }, statusPill(st), h('span', { class: 'n-note', text: st === 'off' ? '' : agentNote(ws, a) })));
  let start = null;
  el.querySelector('.ball').addEventListener('pointerdown', (e) => { if (e.button !== 0 || S.cvTool !== 'move') return; e.stopPropagation(); e.preventDefault(); startLink(ws, a, e); });
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0 || S.cvTool !== 'move' || e.target.closest('.ball')) return; start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, moved: false }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true; cvDragging = true; el.classList.add('drag');
    p.x = Math.max(0, start.px + dx); p.y = Math.max(0, start.py + dy);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    drawEdges(ws);
  });
  const end = () => {
    if (!start) return;
    const moved = start.moved; start = null; cvDragging = false; el.classList.remove('drag');
    if (moved) { p.x = snap(p.x); p.y = snap(p.y); el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; drawEdges(ws); ws.save(); }
    else selectAgent(ws, a.id);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => openBig(ws, a.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openBig(ws, a.id); else if (e.key === ' ') { e.preventDefault(); selectAgent(ws, a.id); } });
  return el;
}
function selectAgent(ws, id) {
  S.sel[ws.key] = id;
  if (!cv) return;
  for (const n of cv.layer.querySelectorAll('.node')) n.classList.toggle('sel', n.dataset.id === id);
  renderInspector(ws);
}

/* ------------------------------------------------------------------ sticky notes */

function addSticky(ws) {
  const c = canvasState(ws);
  const n = { id: uid(), x: snap(72 + (c.notes.length % 6) * 36), y: snap(96 + (c.notes.length % 6) * 36), text: '', color: STICKY_COLORS[c.notes.length % STICKY_COLORS.length] };
  c.notes.push(n); ws.save();
  if (cv) { const el = stickyEl(ws, n); cv.layer.append(el); drawEdges(ws); const ta = el.querySelector('textarea'); if (ta) ta.focus(); }
}
function stickyEl(ws, n) {
  const c = canvasState(ws);
  const ta = h('textarea', { 'aria-label': 'Sticky note text', placeholder: 'Write a note' });
  ta.value = n.text || '';
  const saveText = debounce(() => ws.save(), 500);
  ta.addEventListener('input', () => { n.text = ta.value.slice(0, 2000); saveText(); });
  const grip = h('div', { class: 'sk-grip', title: 'Drag to move' }, h('button', { class: 'sk-x', title: 'Delete this note', 'aria-label': 'Delete this note', text: '×', on: { click: () => { c.notes = c.notes.filter(x => x !== n); ws.board.canvas.notes = c.notes; ws.save(); el.remove(); } } }));
  const el = h('div', { class: 'sticky', style: { left: n.x + 'px', top: n.y + 'px', background: n.color || STICKY_COLORS[0] } }, grip, ta);
  let start = null;
  grip.addEventListener('pointerdown', (e) => { if (e.target.closest('.sk-x') || e.button !== 0) return; start = { x: e.clientX, y: e.clientY, px: n.x, py: n.y }; grip.setPointerCapture(e.pointerId); cvDragging = true; });
  grip.addEventListener('pointermove', (e) => { if (!start) return; n.x = Math.max(0, start.px + e.clientX - start.x); n.y = Math.max(0, start.py + e.clientY - start.y); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; });
  const end = () => { if (!start) return; start = null; cvDragging = false; n.x = snap(n.x); n.y = snap(n.y); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; ws.save(); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  return el;
}

/* ------------------------------------------------------------------ the side panel of the selected agent */

function renderInspector(ws) {
  if (!cv || !cv.side.isConnected) return;
  const a = agentById(ws, S.sel[ws.key]) || leadAgent(ws);
  const st = statusOf(ws, a.id), on = running(ws, a.id);
  const model = (MODELS.find(m => m[0] === (a.model || '')) || ['', a.model || 'Default'])[1];
  const mode = (MODES.find(m => m[0] === (a.permissionMode || 'default')) || ['', ''])[1];
  const replies = ws.replies.filter(r => r.agentId === a.id).slice(-3);
  const input = h('input', { class: 'input', placeholder: 'Message ' + a.name, 'aria-label': 'Message ' + a.name });
  const send = async () => {
    const text = input.value.trim(); if (!text) return;
    const r = await safely(() => D.say(ws.key, { to: a.id, text }));
    if (r) { input.value = ''; toast(r.sent && r.sent.length ? `Sent to ${r.sent.join(', ')}` : `${a.name} is not running. Start it first.`, r.sent && r.sent.length ? '' : 'err'); }
  };
  put(cv.side,
    h('div', { class: 'ac-top' }, avatar(a, ws, 52), h('div', { class: 'ac-t' }, h('h2', { text: a.name }), h('p', { text: a.role || '' }))),
    h('div', { class: 'ac-meta' }, statusPill(st), a.command && a.command !== 'claude' ? h('span', { class: 'chip', text: 'Runs: ' + a.command }) : h('span', { class: 'chip', text: model }), mode ? h('span', { class: 'chip' + (a.permissionMode === 'bypassPermissions' ? ' warn' : ''), text: mode }) : null),
    h('div', null, h('div', { class: 'lab', text: 'Now' }), h('p', { class: 'ac-note', text: agentNote(ws, a) || 'Not started.' })),
    h('button', { class: 'btn primary big wide', text: 'Open the big view', title: 'Open the live terminal of this agent', on: { click: () => openBig(ws, a.id) } }),
    h('div', { class: 'ac-acts' }, on ? h('button', { class: 'btn', text: 'Stop', on: { click: () => stopAgent(ws, a.id) } }) : h('button', { class: 'btn', text: 'Start', on: { click: () => startAgent(ws, a.id, { resume: true }) } }),
      on ? h('button', { class: 'btn', text: 'Restart', on: { click: () => restartAgent(ws, a.id) } }) : null, h('button', { class: 'btn ghost', text: 'All answers', on: { click: () => repliesModal(ws, a.id) } })),
    h('div', { class: 'chat' }, h('div', { class: 'lab', text: 'Newest answers' }),
      replies.length ? replies.map(r => h('div', { class: 'msg them' }, h('time', { text: hhmm(r.at) }), String(r.text || '').trim().slice(0, 420) + (String(r.text || '').length > 420 ? '…' : ''))) : h('p', { class: 'empty-note', text: 'When this agent finishes a turn, its answer shows here.' })),
    h('form', { class: 'qform', on: { submit: (e) => { e.preventDefault(); send(); } } }, input, h('button', { class: 'btn primary round', title: 'Send', 'aria-label': 'Send message', html: svg('M5 12h14M13 6l6 6-6 6') })));
}

/* ------------------------------------------------------------------ the big view: the live terminal of one agent */

function studioView(v) {
  S.studioView = v === 'board' ? 'board' : 'canvas';
  const ws = activeWs();
  if (ws && S.studioView === 'canvas') for (const t of Object.values(ws.tiles)) t.classList.remove('max');
  S.page = 'studio';
  paintPage();
}
function openBig(ws, agentId) {
  if (ws.key !== S.active) activate(ws.key);
  S.page = 'studio'; S.studioView = 'board';
  paintPage();
  focusConsole(ws, agentId);
  const t = ws.board && ws.board.tiles.find(x => x.type === 'console' && x.agentId === agentId);
  if (t && ws.tiles[t.id] && !ws.tiles[t.id].classList.contains('max')) toggleMax(ws, t);
}
// One layout button works for both views: the cards on the canvas, or the terminals on the board.
function setLayout(ws, id) {
  if (S.studioView === 'board') { arrange(ws, id); renderNav(); return; }
  layoutNodes(ws, id); paintPage();
}
function curLayout(ws) { return S.studioView === 'board' ? (ws.board && ws.board.mode) : canvasState(ws).mode; }

// Status changes repaint the cards and the side panel, but never a note or a message the owner is typing.
function refreshCanvas(ws) {
  if (!cv || cv.key !== ws.key || !cv.el.isConnected || cvDragging) return;
  for (const n of [...cv.layer.querySelectorAll('.node')]) n.remove();
  for (const a of ws.team.agents) cv.layer.append(nodeEl(ws, a));
  drawEdges(ws);
  const f = document.activeElement;
  if (!(f && cv.side.contains(f) && /^(INPUT|TEXTAREA)$/.test(f.tagName))) renderInspector(ws);
}

/* ------------------------------------------------------------------ connect ball, comment pins, drawing */

function layerXY(e) { const r = cv.layer.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function svgPath(cls) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', cls); return p; }
function startLink(ws, a, e) {
  const line = svgPath('edge temp'); cv.svg.append(line); cvDragging = true;
  const p = nodePos(ws, a), sx = p.x + NODE_W, sy = p.y + NODE_H / 2;
  const move = (ev) => { const q = layerXY(ev), k = Math.max(30, Math.abs(q.x - sx) * 0.5); line.setAttribute('d', `M${sx} ${sy} C${sx + k} ${sy} ${q.x - k} ${q.y} ${q.x} ${q.y}`); };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    line.remove(); cvDragging = false;
    const t = document.elementFromPoint(ev.clientX, ev.clientY), n = t && t.closest ? t.closest('.node') : null;
    if (n && n.dataset.id !== a.id) addLink(ws, a.id, n.dataset.id);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function addLink(ws, from, to, kind) {
  const c = canvasState(ws);
  if (from === to || !agentById(ws, from) || !agentById(ws, to)) return;
  if (c.links.some(l => l.from === from && l.to === to)) { toast('These two agents have a link already. Click the line to change it.'); return; }
  c.links.push({ from, to, kind: kind === 'check' ? 'check' : 'give' });
  if (c.links.length > 40) c.links.shift();
  ws.save(); drawEdges(ws);
  toast('Link saved. Each agent learns the link at its next start. Click the line to change it.');
}
function linkMenu(ws, l, e) {
  const c = canvasState(ws), A = agentById(ws, l.from), B = agentById(ws, l.to);
  const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
  const set = (kind) => { l.kind = kind; ws.save(); drawEdges(ws); };
  menu(anchor, [{ head: `${A.name} to ${B.name}` },
    { label: 'Gives work', sub: l.kind !== 'check' ? 'On now' : `${A.name} gives work to ${B.name}`, run: () => set('give') },
    { label: 'Checks the work', sub: l.kind === 'check' ? 'On now' : `${B.name} checks the work of ${A.name}`, run: () => set('check') },
    { sep: true }, { label: 'Remove this link', run: () => { c.links = c.links.filter(x => x !== l); ws.save(); drawEdges(ws); } }]);
}
const inkD = (pts) => 'M' + pts.map(p => `${Math.round(p.x)} ${Math.round(p.y)}`).join('L');
function drawInk(ws) {
  if (!cv) return;
  cv.ink.replaceChildren(...canvasState(ws).ink.slice(-200).map(s => { const p = svgPath('ink'); p.setAttribute('d', String((s && s.d) || '').replace(/[^ML0-9 .-]/g, '').slice(0, 20000)); return p; }));
}
function canvasDown(ws, e) {
  if (e.button !== 0 || e.target.closest('.sticky, .pin, .ball')) return;
  const c = canvasState(ws);
  if (S.cvTool === 'comment') {
    const node = e.target.closest('.node'), p = layerXY(e);
    const pin = { id: uid(), x: Math.round(p.x), y: Math.round(p.y), text: '', agentId: node ? node.dataset.id : '' };
    c.pins.push(pin); if (c.pins.length > 60) c.pins.shift();
    ws.save(); cv.layer.append(pinEl(ws, pin, true)); e.preventDefault();
  } else if (S.cvTool === 'draw') {
    const pts = [layerXY(e)], line = svgPath('ink'); cv.ink.append(line); cvDragging = true;
    const move = (ev) => { const q = layerXY(ev), l = pts[pts.length - 1]; if (Math.hypot(q.x - l.x, q.y - l.y) < 3 || pts.length > 1500) return; pts.push(q); line.setAttribute('d', inkD(pts)); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cvDragging = false;
      if (pts.length > 1) { const first = !c.ink.length; c.ink.push({ d: inkD(pts) }); if (c.ink.length > 200) c.ink.shift(); ws.save(); if (first) drawPage(); } else line.remove();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); e.preventDefault();
  }
}
function pinEl(ws, pin, open) {
  const c = canvasState(ws), a = pin.agentId ? agentById(ws, pin.agentId) : null;
  const ta = h('textarea', { rows: 3, placeholder: a ? `Comment for ${a.name}` : 'Comment', 'aria-label': 'Comment text' });
  ta.value = pin.text || '';
  const saveText = debounce(() => ws.save(), 500);
  ta.addEventListener('input', () => { pin.text = ta.value.slice(0, 1000); saveText(); });
  const pop = h('div', { class: 'pinpop', hidden: !open }, ta, h('div', { class: 'ac-acts' },
    a ? h('button', { class: 'btn sm primary', text: `Send to ${a.name}`, on: { click: async () => {
      const text = ta.value.trim(); if (!text) return;
      const r = await safely(() => D.say(ws.key, { to: a.id, text, comment: true, about: 'the Studio canvas' }));
      if (r) toast(r.sent && r.sent.length ? `Sent to ${a.name}` : `${a.name} is not running. Start it first.`, r.sent && r.sent.length ? '' : 'err');
    } } }) : null,
    h('button', { class: 'btn sm', text: 'Close', on: { click: () => { pop.hidden = true; } } }),
    h('button', { class: 'btn sm ghost', text: 'Delete', on: { click: () => { c.pins = c.pins.filter(x => x !== pin); ws.save(); el.remove(); } } })));
  const dot = h('button', { class: 'pin-dot', title: 'Open this comment', 'aria-label': a ? `Comment for ${a.name}` : 'Comment', html: svg('M4 5h16v11H9l-5 4z'), on: { click: () => { pop.hidden = !pop.hidden; if (!pop.hidden) ta.focus(); } } });
  const el = h('div', { class: 'pin', style: { left: pin.x + 'px', top: pin.y + 'px' } }, dot, pop);
  if (open) setTimeout(() => ta.focus(), 30);
  return el;
}
