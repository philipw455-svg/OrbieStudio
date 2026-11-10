// Orbie Studio: the New game flow (folder, files, workflow quiz, start) and the Mockup approval screen.
'use strict';

const NG = { step: 0, key: null, q: 0, answers: {}, lists: null };
const SLOTS = [
  ['story', 'Story script or book', 'Text, Markdown, PDF, Word or EPUB'],
  ['art', 'Art board', 'Pictures or a PDF'],
  ['map', 'Map overview', 'One picture of the whole map'],
  ['characters', 'Main character designs', 'Pictures of each main character'],
];
// The workflow quiz. The Head Supervisor follows these answers when it decides for the owner.
const QUIZ = [
  ['What kind of Roblox game is it?', ['Simulator or tycoon', 'Obby or platformer', 'Role-play or social', 'Story or adventure', 'Fighting or PvP', 'Horror']],
  ['Who plays the game?', ['Kids under 13', 'Teens from 13 to 17', 'All ages']],
  ['How long is one play session?', ['About 5 minutes', 'About 15 minutes', '30 minutes or more']],
  ['Which devices come first?', ['Phone first', 'PC first', 'Phone, tablet, PC and console equally']],
  ['How does the game earn Robux?', ['Game passes', 'Developer products', 'Game passes and developer products', 'No sales at launch']],
  ['How many players share one server?', ['1 player', '2 to 8 players', '9 to 20 players', 'More than 20 players']],
  ['Which art style fits?', ['Bright cartoon', 'Low poly', 'Realistic', 'Match my art board exactly']],
  ['What may the Head Supervisor decide alone at night?', ['Small details only', 'Most things: code, art details and numbers', 'Everything except publishing and spending money']],
  ['When two goals clash, which goal wins?', ['Fun first', 'Looks first', 'Speed first', 'Safety and quality first']],
  ['How must an agent prove finished work?', ['A screenshot', 'A test result', 'A screenshot and a test result']],
  ['What is the first goal?', ['The 12-picture mockup only', 'A playable first level', 'A full first release']],
  ['Which other rule must the team always follow?', []],
];
const KICKOFF = 'New game kickoff. Read every file in source/ (story, art, map, characters) and read WORKFLOW.md. ' +
  'Then do three things. 1) Write GAME_DIRECTION.md: the idea, the core loop, the look, the map, the main characters and the first milestone. The game is a Roblox game, so leave out everything that does not fit Roblox. ' +
  '2) Write mockup/PROMPTS.md: 12 picture prompts for 12 screenshots of the game. Do not make pictures that cost money. The owner makes the pictures and saves them in mockup/. ' +
  '3) Ask the owner for approval with ask_owner. Do not start the build before the owner approves. ' +
  'Follow WORKFLOW.md and GAME_DIRECTION.md when you decide for the owner. Publishing and spending money always wait for the owner in person.';

function goNewGame() { NG.step = 0; NG.q = 0; NG.answers = {}; NG.lists = null; const ws = activeWs(); NG.key = ws ? ws.key : null; S.page = 'newgame'; paintPage(); }
function ngWs() { return NG.key ? wsByKey(NG.key) : null; }
function ngGo(step) { NG.step = step; drawPage(); }
function stepper(now) {
  const names = ['Folder', 'Files', 'Workflow quiz', 'Start'];
  return h('ol', { class: 'steps' }, names.map((n, i) => h('li', { class: i === now ? 'on' : i < now ? 'done' : '' }, h('span', { text: i < now ? '✓' : String(i + 1) }), n)));
}
async function ngPickFolder() {
  const p = await safely(() => D.pickProject());
  if (!p) return;
  let ws = S.tabs.find(w => w.path.toLowerCase() === p.toLowerCase());
  if (!ws) { const proj = await safely(() => D.openProject(p)); if (!proj) return; ws = makeWs(proj); S.tabs.push(ws); }
  activate(ws.key);
  NG.key = ws.key; NG.lists = null; S.page = 'newgame'; NG.step = 1;
  paintPage();
}
async function ngAdd(ws, slot, paths) {
  const r = await safely(() => paths ? D.intakeAdd(ws.key, slot, paths) : D.intakePick(ws.key, slot));
  if (!r) return;
  NG.lists = r;
  if (r.skipped && r.skipped.length) toast(`Not added: ${r.skipped.join(', ')}. The file type does not fit, or the folder is full.`, 'err');
  drawPage();
}
function dropZone(ws, slot, el) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('over');
    const paths = [...(e.dataTransfer ? e.dataTransfer.files : [])].map(f => D.pathFor(f)).filter(Boolean);
    if (paths.length) ngAdd(ws, slot, paths); else toast('Drop files from a folder on this PC.', 'err');
  });
  return el;
}
function pageNewGame() {
  const ws = ngWs();
  if (NG.step > 0 && !ws) NG.step = 0;
  if (NG.step === 0) {
    const open = activeWs();
    return [head('New game', 'Step 1 of 4: pick the folder of the game.'), stepper(0),
      h('section', { class: 'gcard empty' }, h('img', { src: 'logo.svg', alt: '' }), h('h2', { text: 'Where does the game live?' }),
        h('p', { text: 'Pick a folder on this PC. An empty folder starts a new game. Orbie Studio copies your files into this folder.' }),
        h('div', { class: 'pacts' }, h('button', { class: 'btn primary big', text: 'Pick the game folder', on: { click: ngPickFolder } }),
          open ? h('button', { class: 'btn big', text: `Use the open game: ${open.name}`, on: { click: () => { NG.key = open.key; NG.lists = null; ngGo(1); } } }) : null))];
  }
  if (NG.step === 1) {
    if (!NG.lists) { D.intakeList(ws.key).then((r) => { NG.lists = r; if (S.page === 'newgame' && NG.step === 1) drawPage(); }).catch(() => {}); }
    const files = (NG.lists && NG.lists.files) || {};
    return [head('New game', `Step 2 of 4: drop the files of ${ws.name}.`, h('button', { class: 'btn big', text: 'Back', on: { click: () => ngGo(0) } }), h('button', { class: 'btn primary big', text: 'Next: workflow quiz', on: { click: () => ngGo(2) } })), stepper(1),
      h('div', { class: 'slots' }, SLOTS.map(([slot, title, kinds]) => dropZone(ws, slot, h('section', { class: 'gcard slot' },
        h('div', { class: 'gc-head' }, h('h2', { text: title }), h('span', { class: 'chip' + ((files[slot] || []).length ? ' ok' : ''), text: (files[slot] || []).length ? `${files[slot].length} added` : 'Empty' })),
        h('p', { class: 'ac-note', text: kinds + '. Drop files here.' }),
        (files[slot] || []).length ? h('ul', { class: 'flist' }, files[slot].map(f => h('li', { text: f.name }))) : null,
        h('button', { class: 'btn', text: 'Choose files', on: { click: () => ngAdd(ws, slot) } }))))),
      h('p', { class: 'hint', text: `Orbie Studio copies each file into ${ws.path}, in the folder "source". The Head Supervisor reads the files from there. You can skip a box.` })];
  }
  if (NG.step === 2) {
    const [q, opts] = QUIZ[NG.q];
    const cur = NG.answers[NG.q] || '';
    const input = h('input', { class: 'input', placeholder: opts.length ? 'Or type your own answer' : 'Type your answer. You can leave it empty.', 'aria-label': 'Your own answer', value: opts.includes(cur) ? '' : cur });
    const keep = () => { const v = input.value.trim(); if (v) NG.answers[NG.q] = v.slice(0, 600); };
    const next = () => { keep(); if (NG.q < QUIZ.length - 1) { NG.q++; drawPage(); } else ngGo(3); };
    const back = () => { keep(); if (NG.q > 0) { NG.q--; drawPage(); } else ngGo(1); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    return [head('New game', 'Step 3 of 4: the workflow quiz. The Head Supervisor follows your answers.'), stepper(2),
      h('section', { class: 'gcard quiz' }, h('div', { class: 'gc-head' }, h('span', { class: 'lab', text: `Question ${NG.q + 1} of ${QUIZ.length}` }), h('span', { class: 'ubar' }, h('span', { style: { width: ((NG.q + 1) / QUIZ.length * 100).toFixed(0) + '%' } }))),
        h('p', { class: 'qtext', text: q }),
        opts.length ? h('div', { class: 'qopts' }, opts.map((o, i) => h('button', { class: 'opt' + (cur === o ? ' sel' : ''), on: { click: () => { NG.answers[NG.q] = o; input.value = ''; if (NG.q < QUIZ.length - 1) { NG.q++; drawPage(); } else ngGo(3); } } }, h('span', { class: 'key', text: 'ABCDEFGH'[i] }), o))) : null,
        input,
        h('div', { class: 'ac-acts' }, h('button', { class: 'btn', text: 'Back', on: { click: back } }), h('button', { class: 'btn primary', text: NG.q < QUIZ.length - 1 ? 'Next' : 'Finish the quiz', on: { click: next } }), h('button', { class: 'btn ghost', text: 'Skip this question', on: { click: () => { delete NG.answers[NG.q]; input.value = ''; if (NG.q < QUIZ.length - 1) { NG.q++; drawPage(); } else ngGo(3); } } })))];
  }
  const done = QUIZ.map(([q], i) => ({ q, a: NG.answers[i] || '' }));
  return [head('New game', `Step 4 of 4: start ${ws.name}.`, h('button', { class: 'btn big', text: 'Back to the quiz', on: { click: () => { NG.q = 0; ngGo(2); } } }), h('button', { class: 'btn primary big', text: 'Save and open the Studio', on: { click: () => ngFinish(ws, done) } })), stepper(3),
    h('div', { class: 'cols2' },
      h('section', { class: 'gcard' }, h('h2', { text: 'Your workflow' }), h('div', { class: 'plan' }, done.map(d => h('div', { class: 'wrow' }, h('b', { text: d.q }), h('span', { class: d.a ? '' : 'none', text: d.a || 'No answer' }))))),
      h('section', { class: 'gcard' }, h('h2', { text: 'What happens next' }),
        h('ol', { class: 'next' }, h('li', { text: 'Orbie Studio saves your answers in WORKFLOW.md.' }), h('li', { text: ws.team ? 'The game keeps its team.' : 'The game gets a team of agents.' }), h('li', { text: 'You press Launch team in the Studio.' }),
          h('li', { text: 'You send the kickoff to the lead agent. The lead reads your files and writes GAME_DIRECTION.md.' }), h('li', { text: 'The lead writes 12 picture prompts. You make the pictures and approve the mockup.' })),
        h('p', { class: 'hint', text: 'Publishing and spending money always wait for you in person.' })))];
}
async function ngFinish(ws, done) {
  const ok = await safely(() => D.saveWorkflow(ws.key, { answers: done }));
  if (!ok) return;
  if (!ws.team) {
    const fit = await D.presetsFor(ws.key).catch(() => null);
    const proj = await safely(() => D.applyPreset(ws.key, fit ? fit.best : 'studio'));
    if (!proj) return;
    ws.team = proj.team; ws.loops = proj.loops || []; ws.name = proj.name;
    setupBoard(ws); renderSide(ws); renderTabs(); fillComposerTargets(ws); loadLaunchers(ws);
  }
  canvasState(ws).kickoff = KICKOFF;
  ws.save();
  toast('Workflow saved. Launch the team, then send the kickoff.');
  studioView('canvas');
}
async function sendKickoff(ws) {
  const lead = leadAgent(ws), c = canvasState(ws);
  if (!c.kickoff) return;
  if (!running(ws, lead.id)) { toast(`${lead.name} is not running. Press Launch team first.`, 'err'); return; }
  const r = await safely(() => D.say(ws.key, { to: lead.id, text: c.kickoff }));
  if (r && r.sent && r.sent.length) { delete c.kickoff; ws.save(); toast(`Kickoff sent to ${lead.name}.`); drawPage(); }
}

/* ------------------------------------------------------------------ Mockup approval: 12 pictures and the game direction */

function pageApproval(ws) {
  if (!ws || !ws.team) return [head('Mockup approval', '12 pictures and the game direction.'), needGame('The mockup belongs to the open game.')];
  const lead = leadAgent(ws);
  const dir = h('div', { class: 'md pv-md tall' }, h('p', { class: 'empty-note', text: 'Reading GAME_DIRECTION.md…' }));
  const grid = h('div', { class: 'shots' });
  const count = h('span', { class: 'chip', text: '0 of 12 pictures' });
  D.readFile(ws.key, 'GAME_DIRECTION.md').then((t) => renderMd(dir, t)).catch(() => put(dir, h('p', { class: 'empty-note', text: `${lead.name} did not write GAME_DIRECTION.md yet. Send the kickoff first.` })));
  const fill = (r) => {
    const pics = ((r.files && r.files.mockup) || []).slice(0, 12);
    count.textContent = `${pics.length} of 12 pictures`; count.className = 'chip' + (pics.length >= 12 ? ' ok' : '');
    put(grid, Array.from({ length: 12 }, (_, i) => {
      const f = pics[i];
      const cell = h('div', { class: 'shot' + (f ? '' : ' none') }, h('span', { class: 'sn', text: String(i + 1) }), f ? null : h('span', { text: 'Picture ' + (i + 1) }));
      if (f) D.readImage(ws.key, f.rel).then((src) => { if (typeof src === 'string') cell.append(h('img', { src, alt: 'Mockup picture ' + (i + 1) + ': ' + f.name })); }).catch(() => {});
      return cell;
    }));
  };
  D.intakeList(ws.key).then(fill).catch(() => {});
  const add = async (paths) => { const r = await safely(() => paths ? D.intakeAdd(ws.key, 'mockup', paths) : D.intakePick(ws.key, 'mockup')); if (r) { fill(r); if (r.skipped && r.skipped.length) toast(`Not added: ${r.skipped.join(', ')}`, 'err'); } };
  const change = h('input', { class: 'input', placeholder: 'What must change?', 'aria-label': 'Changes you want' });
  const tell = async (text, okMsg) => { const r = await safely(() => D.say(ws.key, { to: lead.id, text })); if (r) toast(r.sent && r.sent.length ? okMsg : `${lead.name} is not running. Start it first.`, r.sent && r.sent.length ? '' : 'err'); return r && r.sent && r.sent.length; };
  const picsCard = h('section', { class: 'gcard' }, h('div', { class: 'gc-head' }, h('h2', { text: 'Mockup pictures' }), count, h('button', { class: 'btn', text: 'Add pictures', on: { click: () => add() } })),
    grid, h('p', { class: 'hint', text: 'Drop pictures here. Orbie Studio does not make pictures yet. Make them with the prompts in mockup/PROMPTS.md, because paid pictures cost money.' }));
  picsCard.addEventListener('dragover', (e) => { e.preventDefault(); });
  picsCard.addEventListener('drop', (e) => { e.preventDefault(); const paths = [...(e.dataTransfer ? e.dataTransfer.files : [])].map(f => D.pathFor(f)).filter(Boolean); if (paths.length) add(paths); });
  return [head('Mockup approval', `${ws.name} · the build starts after your approval.`,
      h('button', { class: 'btn primary big', text: 'Approve the mockup', on: { click: async () => { if (await confirmBox('Approve the mockup?', `${lead.name} starts the build with the game direction and the pictures.`, 'Approve')) tell('The owner approves the mockup and GAME_DIRECTION.md. Start the build. Follow WORKFLOW.md. Publishing and spending money still wait for the owner in person.', `Approval sent to ${lead.name}.`); } } })),
    h('div', { class: 'cols2 appr' }, picsCard,
      h('section', { class: 'gcard' }, h('h2', { text: 'Game direction' }), dir,
        h('form', { class: 'qform', on: { submit: async (e) => { e.preventDefault(); const t = change.value.trim(); if (t && await tell('The owner does not approve the mockup yet. Change this, then ask again: ' + t, `Changes sent to ${lead.name}.`)) change.value = ''; } } }, change, h('button', { class: 'btn', text: 'Ask for changes' }))))];
}
