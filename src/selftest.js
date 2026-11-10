// Self-test used only when AGENT_DECK_SELFTEST is set (development). Not reachable in normal use.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = process.env.AGENT_DECK_SELFTEST;
const out = path.join(ROOT, 'shots');
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let settings = null;

function post(port, p, body) {
  return new Promise((resolve) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.end(data);
  });
}

module.exports = {
  before(app) {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    app.setPath('userData', path.join(ROOT, 'userdata'));
  },
  prepare({ settings: s0, saveSettings }) {
    settings = s0;
    const proj = path.join(ROOT, 'Dev', 'demo-game');
    const agents = path.join(ROOT, 'Dev', 'agents');
    fs.mkdirSync(path.join(agents, 'demo-game'), { recursive: true });
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'README.md'), '# Demo game\n\nA test project.\n');
    try { execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: proj, shell: '/bin/bash' }); } catch (e) {}
    const team = {
      name: 'Test crew', projectName: 'Demo Game', projectPath: proj, mcpServers: { roblox_studio: { command: 'cmd.exe', args: ['/c', 'x'] } },
      agents: [
        { id: 'supervisor', name: 'Supervisor', role: 'Plans and checks', color: '#8B9CFF', command: 'bash --norc', autostart: true },
        { id: 'studio', name: 'Studio builder', role: 'Roblox Studio + Luau', color: '#5EE6C3', command: 'bash --norc', autostart: true },
        { id: 'blender', name: 'Blender modeler', role: 'Custom models', color: '#F07CC8', command: 'bash --norc', autostart: true },
        { id: 'qa', name: 'Security + QA', role: 'Scans and tests', color: '#FFC46B', command: 'claude', model: 'claude-opus-5-5', mcp: ['roblox_studio'], autostart: false, prompt: 'You are {agent}. Team: {team}.' },
      ],
    };
    fs.writeFileSync(path.join(agents, 'demo-game', 'team.json'), JSON.stringify(team, null, 2));
    settings.updateRepo = ''; // never reach the real GitHub during the self-test
    settings.agentsRoot = agents;
    settings.openTabs = [proj];
    settings.recent = [{ path: proj, name: 'Demo Game', openedAt: Date.now() }];
    saveSettings();
  },
  async after(win, ctx) {
    const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
    const js = (code) => win.webContents.executeJavaScript(code, true);
    win.webContents.on('console-message', (e, lv, msg) => { const level = e.level !== undefined ? e.level : lv; const message = e.message !== undefined ? e.message : msg; if (level === 'error' || level === 'warning' || level >= 2) results.push({ name: 'renderer console', ok: false, detail: String(message) }); });
    try {
      await new Promise(r => win.webContents.once('did-finish-load', r));
      await sleep(2500);
      log('the app starts on Home', (await js(`S.page`)) === 'home' && (await js(`document.getElementById('page').hidden`)) === false && (await js(`document.querySelectorAll('#navbar .ptabs button').length`)) === 7);
      await sleep(1200); await shot('00_home');
      await js(`goPage('studio')`); await sleep(700);
      log('the Studio tab shows one card for each agent', (await js(`document.querySelectorAll('#page .cv .node').length`)) === 4 && (await js(`document.querySelectorAll('#page .cv .node .av img').length`)) === 4 && (await js(`S.tabs[0].el.hidden`)) === true);
      log('the side panel shows the selected agent', (await js(`document.querySelector('#page .inspector h2').textContent`)) === 'Supervisor');
      await shot('00_studio_canvas');
      await js(`document.querySelector('#page .cv .node[data-id="studio"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await sleep(600);
      log('a double-click opens the big view of that agent', (await js(`S.studioView`)) === 'board' && (await js(`S.tabs[0].el.hidden`)) === false && (await js(`!!document.querySelector('.tile.max')`)) === true && (await js(`document.querySelector('.tile.max .t-name').textContent`)) === 'Studio builder');
      await shot('00_big_view');
      await js(`studioView('canvas')`); await sleep(300);
      log('the Canvas button goes back to the cards', (await js(`document.querySelectorAll('#page .cv .node').length`)) === 4 && (await js(`document.querySelectorAll('.tile.max').length`)) === 0);
      await js(`studioView('board')`); await sleep(500);
      log('the big view shows the board', (await js(`S.tabs[0].el.hidden`)) === false && (await js(`document.getElementById('page').hidden`)) === true);
      log('project tab opened', (await js(`document.querySelectorAll('.tab').length`)) === 1);
      log('4 console tiles', (await js(`document.querySelectorAll('.tile .term').length`)) === 4);
      await shot('01_board');
      await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.startsWith('Launch team')).click()`);
      await sleep(400);
      await shot('02_launch_modal');
      log('launch offers to open Roblox Studio first', (await js(`document.querySelector('.modal').textContent.includes('Open Roblox Studio first')`)) === true);
      await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent==='Launch').click()`);
      await sleep(10000);
      const p = [...ctx.projects.values()][0];
      const cons = [...ctx.consoles.values()];
      log('3 shell consoles running', cons.filter(c => c.pty).length === 3, cons.map(c => c.agentId + ':' + c.status).join(','));
      const sup = ctx.consoles.get(p.key + ':supervisor');
      const port = ctx.port();
      for (const c of ctx.consoles.values()) if (c.pty) c.pty.resize(240, 40); // wide terminals so text checks don't hit line wraps
      // typing straight into an agent: real mouse click + key presses
      const rect = await js(`(()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.textContent.includes('Blender modeler')&&x.querySelector('.term'));const r=t.querySelector('.term').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      await sleep(300);
      const focusInfo = await js(`(document.activeElement && (document.activeElement.className + ' in ' + (document.activeElement.closest('.tile')||{textContent:''}).textContent.slice(0,30)))`);
      for (const ch of '/help') { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
      await sleep(600);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await sleep(300);
      const bl = ctx.consoles.get(p.key + ':blender');
      log('typing into an agent reaches its terminal', /\/help/.test(bl.buffer), 'focus=' + focusInfo + ' tail=' + JSON.stringify(bl.buffer.slice(-120)));
      // a /command from the Tell the team bar runs as typed (no wrapper)
      await js(`(()=>{const sel=document.querySelector('.c-to');sel.value='blender';sel.dispatchEvent(new Event('change'));const ta=document.querySelector('.c-text');ta.value='/compact';ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
      await sleep(1200);
      log('/command from the bar runs as typed', /bash-5\.2# \/compact/.test(bl.buffer) && !/\[From the owner\] \/compact/.test(bl.buffer), JSON.stringify(bl.buffer.slice(-90)));
      await js(`(()=>{const sel=document.querySelector('.c-to');sel.value='lead';sel.dispatchEvent(new Event('change'));})()`);
      // MCP: initialize, list tools, call tools
      let r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      log('mcp initialize', r.status === 200 && /agent_deck/.test(r.body), r.body.slice(0, 120));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', method: 'notifications/initialized' });
      log('mcp notification 202', r.status === 202);
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      log('mcp tools/list has 7 tools', r.status === 200 && JSON.parse(r.body).result.tools.length === 7);
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } });
      log('list_agents', /Studio builder/.test(r.body), JSON.parse(r.body).result.content[0].text.split('\n')[0]);
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'studio builder', message: 'echo HELLO_FROM_SUPERVISOR' } } });
      log('send_message', /Sent to Studio builder/.test(r.body), r.body.slice(0, 140));
      await sleep(1200);
      const studio = ctx.consoles.get(p.key + ':studio');
      log('message typed into Studio builder', /HELLO_FROM_SUPERVIS/.test(studio.buffer.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\r\n]/g, '')), JSON.stringify(studio.buffer.slice(-300)));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'Security + QA', message: 'hi' } } });
      log('send_message to stopped agent is an error', /isError":true/.test(r.body) && /isn't running/.test(r.body));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'report_status', arguments: { status: 'Assigning P0 steps' } } });
      log('report_status', /mission map/.test(r.body));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ask_owner', arguments: { question: 'Start P1 now?', options: ['Yes, go P1', 'Not yet'] } } });
      log('ask_owner', /Sent to the owner/.test(r.body) && p.inbox.length === 1);
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'handoff', arguments: { to: 'blender', summary: 'Built the kit pieces list.' } } });
      log('handoff writes a file', /Hand-off saved/.test(r.body) && fs.readdirSync(path.join(p.agentsDir, 'handoffs')).length === 1);
      // hooks
      const blender = ctx.consoles.get(p.key + ':blender');
      r = await post(port, `/hook/${blender.token}/notify`, { session_id: '11111111-2222-3333-4444-555555555555', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
      await sleep(300);
      log('hook 204 + needs status', r.status === 204 && blender.status === 'needs');
      log('session id saved', p.sessions.blender === '11111111-2222-3333-4444-555555555555');
      r = await post(port, `/hook/${blender.token}/tool`, {});
      log('hook working', blender.status === 'working');
      r = await post(port, `/hook/${blender.token}/notify`, { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' });
      await sleep(600);
      await shot('03_running_inbox');
      log('inbox shows 2 items', (await js(`document.querySelectorAll('.ibx').length`)) === 2);
      // answer the question from the UI
      await js(`[...document.querySelectorAll('.ibx .opts .btn')][0].click()`);
      await sleep(900);
      log('answer typed into Supervisor', /\[Answer from the owner\] Yes, go P1/.test(sup.buffer));
      // claude agent failure path (claude not installed here)
      await js(`(()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.textContent.includes('Security + QA'));[...t.querySelectorAll('.btn')].find(b=>b.textContent==='Start').click();})()`);
      await sleep(1200);
      const qa = ctx.consoles.get(p.key + ':qa');
      log('qa output', true, qa ? qa.buffer.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, ' ').slice(0, 400) : 'none');
      log('claude agent args built', !!qa && fs.readdirSync(path.join(ROOT, 'userdata', 'run')).some(f => f.endsWith('.mcp.json')));
      const mcpFile = fs.readdirSync(path.join(ROOT, 'userdata', 'run')).find(f => f.endsWith('.mcp.json'));
      const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'run', mcpFile), 'utf8'));
      log('qa mcp = agent_deck + roblox only', Object.keys(mcp.mcpServers).join(',') === 'agent_deck,roblox_studio', Object.keys(mcp.mcpServers).join(','));
      // loops
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent==='Loops').click()`);
      await sleep(300);
      await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent==='+ New loop').click()`);
      await sleep(300);
      await shot('04_loop_editor');
      await js(`(()=>{const ms=[...document.querySelectorAll('.modal')];const m=ms[ms.length-1];const sels=m.querySelectorAll('select');sels[0].value='studio';sels[1].value='output';sels[1].dispatchEvent(new Event('change'));const inputs=m.querySelectorAll('input.mono');inputs[0].value='PING_LOOP';[...m.querySelectorAll('.btn')].find(b=>b.textContent==='Add loop').click();})()`);
      await sleep(300);
      await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent==='Save loops').click()`);
      await sleep(500);
      log('loop saved', p.loops.length === 1 && p.loops[0].trigger === 'output', JSON.stringify(p.loops[0] || {}).slice(0, 160));
      studio.pty.write('echo PING_LOOP\r');
      await sleep(3500);
      log('output loop fired', (p.loops[0].runs || 0) >= 1);
      // owner talks to the team
      await js(`(()=>{const ta=document.querySelector('.c-text');ta.value='Make the plaza brighter and check the bridge road';ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
      await sleep(1200);
      log('owner message routed to lead', /\[From the owner\] Make the plaza brighter/.test(sup.buffer) && /Route this/.test(sup.buffer));
      await js(`(()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.textContent.includes('Studio builder'));t.querySelector('[title="Comment to this agent"]').click();})()`);
      await sleep(200);
      await js(`(()=>{const ta=document.querySelector('.c-text');ta.value='Use the warmer lamp color';ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
      await sleep(1200);
      log('comment reaches Studio builder', /\[Comment from the owner\] Use the warmer lamp color/.test(studio.buffer));
      // agents show views
      const { nativeImage } = require('electron');
      fs.mkdirSync(path.join(p.path, 'screenshots'), { recursive: true });
      fs.writeFileSync(path.join(p.path, 'screenshots', 'plaza.png'), (await win.webContents.capturePage({ x: 0, y: 0, width: 640, height: 400 })).toPNG());
      void nativeImage;
      const stu = studio;
      r = await post(port, `/mcp/${stu.token}`, { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'show_view', arguments: { title: 'Spawn plaza, side view', kind: 'image', path: 'screenshots/plaza.png' } } });
      log('show_view image', /owner's board/.test(r.body), r.body.slice(0, 160));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'show_view', arguments: { title: 'P0 test results', kind: 'text', text: 'PASS keep list\nPASS scan rules\nFAIL game passes export (2 missing)' } } });
      log('show_view text', /owner's board/.test(r.body));
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'show_view', arguments: { title: 'Bad', kind: 'image', path: '/etc/passwd' } } });
      log('show_view refuses files outside the project', /isError":true/.test(r.body));
      await sleep(900);
      log('view tiles on the board', (await js(`document.querySelectorAll('.imgv img').length`)) === 1 && (await js(`document.querySelectorAll('.textv').length`)) === 1);
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent.startsWith('Layout')).click()`);
      await sleep(200);
      await js(`[...document.querySelectorAll('.menu button')].find(b=>b.textContent.startsWith('Fit')).click()`);
      await sleep(900);
      await shot('09_views_and_talk');
      // app shortcuts: project files make Roblox Studio + Unreal show up
      fs.writeFileSync(path.join(p.path, 'default.project.json'), '{}');
      fs.writeFileSync(path.join(p.path, 'Game.uproject'), '{}');
      const L = await js(`window.deck.launchers('${p.key}')`);
      log('shortcuts detected', ['roblox-studio', 'unreal', 'vscode', 'rojo', 'folder'].every(id => L.some(l => l.id === id)), L.map(l => l.id + ':' + (l.run && l.run.type)).join(', '));
      await js(`(()=>{const ws=null;})()`);
      await sleep(9500);
      log('shortcut chips on the toolbar', (await js(`document.querySelectorAll('.lchip').length`)) >= 4);
      // kanban the agents use
      r = await post(port, `/mcp/${sup.token}`, { jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'task_board', arguments: { action: 'add', text: 'Export the UI kit scripts', agent: 'studio builder' } } });
      log('task_board add', /is in To do/.test(r.body), r.body.slice(0, 120));
      r = await post(port, `/mcp/${stu.token}`, { jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'task_board', arguments: { action: 'move', id: 'T1', column: 'doing' } } });
      log('task_board move', /is in Doing/.test(r.body));
      await sleep(600);
      log('kanban card shows on the board', (await js(`[...document.querySelectorAll('.kb-col')].map(c=>c.textContent).join('|')`)).includes('Export the UI kit scripts'));
      // suggested edits on a markdown file
      ctx.projects.get(p.key);
      await js(`(()=>{})()`);
      studio.pty.resize(240, 40); await sleep(300);
      const r2 = await js(`window.deck.suggestEdits('${p.key}', { rel: 'README.md', text: '# Demo game\\n\\nA test project with a brighter plaza.\\n', to: 'studio', note: 'brighter' })`);
      log('suggest edits writes a diff + tells the agent', /suggestions/.test(r2.file) && r2.to === 'Studio builder' && p.feed.some(f => f.kind === 'edit') && /\+ A test project with a brighter plaza/.test(fs.readFileSync(r2.file, 'utf8')));
      // markup: draw on the shared image and send it
      await js(`(()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.querySelector('.imgv'));t.querySelector('[title^="Mark up"]').click();})()`);
      await sleep(900);
      await js(`(()=>{const c=document.querySelector('.mk-canvas');const r=c.getBoundingClientRect();const ev=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:r.left+x,clientY:r.top+y,pointerId:1}));ev('pointerdown',20,20);ev('pointermove',120,80);ev('pointermove',200,40);ev('pointerup',200,40);})()`);
      await sleep(200);
      await shot('10_markup');
      await js(`(()=>{const m=[...document.querySelectorAll('.modal')].pop();m.querySelector('input.input').value='Make the lamps warmer';[...m.querySelectorAll('.btn')].find(b=>b.textContent==='Send markup').click();})()`);
      await sleep(900);
      const mk = path.join(p.agentsDir, 'markups');
      log('markup saved + sent', fs.existsSync(mk) && fs.readdirSync(mk).some(f => f.endsWith('.png')) && /\[Markup from the owner\]/.test(studio.buffer));
      // usage: a fake Claude Code log for this project
      const os = require('os');
      const fakeDir = path.join(os.homedir(), '.claude', 'projects', 'agentdeck-selftest');
      fs.mkdirSync(fakeDir, { recursive: true });
      const sid = '11111111-2222-3333-4444-555555555555';
      const lines = [];
      for (let d = 0; d < 6; d++) for (let k = 0; k < 3; k++) lines.push(JSON.stringify({ cwd: p.path, sessionId: k === 2 ? 'zzz' : sid, timestamp: new Date(Date.now() - d * 86400000 - k * 1000).toISOString(), requestId: 'r' + d + k, message: { id: 'm' + d + k, model: 'claude-opus-5-5', usage: { input_tokens: 1200 * (k + 1), output_tokens: 800 + d * 100, cache_read_input_tokens: 40000 + d * 5000, cache_creation_input_tokens: 3000 } } }));
      fs.writeFileSync(path.join(fakeDir, 's.jsonl'), lines.join('\n') + '\n');
      const U = await js(`window.deck.usage('${p.key}', 14)`);
      log('usage counts this project', U.messages === 18 && !!U.totals.blender && !!U.totals.other, JSON.stringify(Object.keys(U.totals)));
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent==='Usage').click()`);
      await sleep(1500);
      await shot('11_usage');
      await js(`document.querySelector('.modal .m-head .icon-btn').click()`);
      fs.rmSync(fakeDir, { recursive: true, force: true });
      // agents view
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent.startsWith('Layout')).click()`);
      await sleep(200);
      await js(`[...document.querySelectorAll('.menu button')].find(b=>b.textContent.startsWith('Agents view')).click()`);
      await sleep(900);
      log('agents view draws 3 connectors', (await js(`document.querySelectorAll('svg.links path.link').length`)) === 3);
      await shot('12_agents_view');
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.title && b.title.startsWith('Show or hide')).click()`);
      await sleep(900);
      await shot('13_agents_view_no_rail');
      log('panel hidden', (await js(`getComputedStyle(document.querySelector('.side')).display`)) === 'none');
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.title && b.title.startsWith('Show or hide')).click()`);
      // updater: a newer version in the update folder is offered; changed libraries need the installer
      // ---------------- updates from GitHub (a local stand-in serves the same paths)
      const srcRoot = path.join(__dirname, '..');
      const crypto = require('crypto');
      const ghFiles = ['src/main.js', 'src/remote/index.html', 'src/renderer/logo.svg'].map(rel => ({ path: rel, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(srcRoot, rel))).digest('hex') }));
      const mineDeps = JSON.parse(fs.readFileSync(path.join(srcRoot, 'package.json'), 'utf8')).dependencies;
      let ghManifest = { product: 'orbie-studio', version: '9.9.8', ref: 'v9.9.8', electron: process.versions.electron, dependencies: mineDeps, notes: '- GitHub notes', files: ghFiles, installer: 'https://github.com/x/y/releases/download/v9.9.8/Orbie-Studio-Setup-9.9.8.exe' };
      let tamper = false;
      const gh = http.createServer((q, s2) => {
        const u = decodeURIComponent(q.url);
        if (u === '/raw/main/update/orbie-studio.json') { s2.writeHead(200, { 'Content-Type': 'application/json' }); return s2.end(JSON.stringify(ghManifest)); }
        const m2 = u.match(/^\/raw\/v9\.9\.8\/(.+)$/);
        if (m2 && fs.existsSync(path.join(srcRoot, m2[1]))) { let b = fs.readFileSync(path.join(srcRoot, m2[1])); if (tamper && /main\.js$/.test(m2[1])) b = Buffer.concat([b, Buffer.from('//x')]); s2.writeHead(200); return s2.end(b); }
        s2.writeHead(404); s2.end();
      });
      await new Promise(r => gh.listen(0, '127.0.0.1', r));
      await js(`window.deck.saveSettings({ updateFeedBase: 'http://127.0.0.1:${gh.address().port}' })`);
      let G = await js(`window.deck.checkUpdate()`);
      log('GitHub update found by itself', G.available && G.via === 'github' && G.version === '9.9.8' && !G.needsInstaller && /GitHub notes/.test(G.notes), JSON.stringify(G).slice(0, 200));
      let staged = null; try { staged = await ctx.updater.stage(ctx.updater.manifest()); } catch (e) { staged = 'ERR ' + e.message; }
      log('GitHub files download and match their checksums', typeof staged === 'string' && !staged.startsWith('ERR') && fs.existsSync(path.join(staged, 'src', 'renderer', 'logo.svg')), String(staged));
      tamper = true;
      let ghBad = ''; try { await ctx.updater.stage(ctx.updater.manifest()); } catch (e) { ghBad = e.message; }
      log('a changed file is refused', /checksum/.test(ghBad), ghBad);
      tamper = false;
      // safety: an update list for another app (for example Agent Deck 1.7.0) is never offered
      const goodManifest = ghManifest;
      ghManifest = Object.assign({}, goodManifest, { product: 'agent-deck' });
      G = await js(`window.deck.checkUpdate()`);
      log('an update for another app is refused', !G.available && /another app/.test(G.githubError || ''), JSON.stringify(G).slice(0, 160));
      ghManifest = Object.assign({}, goodManifest, { ref: '../../other/repo/main' });
      G = await js(`window.deck.checkUpdate()`);
      log('an update with a strange download place is refused', !G.available && /not valid/.test(G.githubError || ''), JSON.stringify(G).slice(0, 160));
      ghManifest = goodManifest;
      ghManifest = Object.assign({}, ghManifest, { dependencies: Object.assign({}, mineDeps, { 'left-pad': '1.0.0' }) });
      G = await js(`window.deck.checkUpdate()`);
      log('GitHub library change offers the installer', G.needsInstaller && /releases\/download/.test(G.installer));
      await js(`window.deck.saveSettings({ updateFeedBase: 'http://127.0.0.1:1' })`);
      G = await js(`window.deck.checkUpdate()`);
      log('no GitHub and no folder shows "not connected"', G.connected === false && !G.available, JSON.stringify(G).slice(0, 160));
      await js(`showUpdate(${JSON.stringify(G)})`); await sleep(200);
      log('title bar says updates are not connected', (await js(`document.getElementById('update-bar').textContent`)).includes('not connected'));
      await shot('20_not_connected');
      await js(`window.deck.saveSettings({ updateFeedBase: '' })`);
      gh.close();
      const upd = path.join(ROOT, 'upd');
      fs.mkdirSync(path.join(upd, 'src', 'renderer'), { recursive: true });
      const mine = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      fs.writeFileSync(path.join(upd, 'package.json'), JSON.stringify(Object.assign({}, mine, { version: '9.9.9' })));
      fs.writeFileSync(path.join(upd, 'src', 'main.js'), '// new');
      fs.writeFileSync(path.join(upd, 'CHANGES.md'), '# Changes\n\n## 9.9.9\n- Test notes\n');
      await js(`window.deck.saveSettings({ updateSource: ${JSON.stringify(upd)} })`);
      let U2 = await js(`window.deck.checkUpdate()`);
      log('update offered', U2.available && !U2.needsInstaller && U2.version === '9.9.9' && /Test notes/.test(U2.notes), JSON.stringify(U2).slice(0, 200));
      fs.writeFileSync(path.join(upd, 'package.json'), JSON.stringify(Object.assign({}, mine, { version: '9.9.9', dependencies: Object.assign({}, mine.dependencies, { 'left-pad': '1.0.0' }) })));
      U2 = await js(`window.deck.checkUpdate()`);
      log('library change needs the installer', U2.available && U2.needsInstaller);
      // safety: a folder that holds another app is never offered as an update
      fs.writeFileSync(path.join(upd, 'package.json'), JSON.stringify(Object.assign({}, mine, { name: 'agent-deck', version: '9.9.9' })));
      U2 = await js(`window.deck.checkUpdate()`);
      log('a folder with another app is not an update', !U2.available, JSON.stringify(U2).slice(0, 160));
      // safety: the window cannot change where updates come from
      const before = JSON.stringify([settings.updateRepo, settings.remote && settings.remote.enabled]);
      await js(`window.deck.saveSettings({ updateRepo: 'evil/repo', remote: { enabled: true }, agentsRoot: '/' })`);
      log('the window cannot change the update place', JSON.stringify([settings.updateRepo, settings.remote && settings.remote.enabled]) === before && settings.agentsRoot !== '/', JSON.stringify(settings.updateRepo));
      // safety: the window can show a folder, but cannot make the PC run a file
      const badOpen = await js(`window.deck.openPath(${JSON.stringify(path.join(__dirname, 'main.js'))}).then(() => 'opened', e => e.message)`);
      log('the window cannot run a file', /Only folders/.test(badOpen), badOpen);
      // safety: the local server ignores a request that a web page sent through another name
      const rebind = await new Promise((resolve) => { const rq = http.request({ host: '127.0.0.1', port, path: `/mcp/${sup.token}`, method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, (rs) => { resolve(rs.statusCode); rs.resume(); }); rq.on('error', () => resolve(0)); rq.end('{}'); });
      log('the local server refuses another host name', rebind === 403, String(rebind));
      // themes
      await js(`setTheme('light')`); await sleep(500);
      log('theme is saved', settings.theme === 'light' && (await js(`document.documentElement.dataset.theme`)) === 'light');
      await shot('21_theme_light');
      await js(`setTheme('aurora')`); await sleep(400); await shot('22_theme_aurora');
      await js(`setTheme('midnight')`); await sleep(400); await shot('23_theme_midnight');
      await js(`setTheme('dark')`); await sleep(400);
      await js(`window.deck.saveSettings({ theme: 'nope' })`);
      log('an unknown theme is ignored', settings.theme === 'dark');
      // pages: every screen draws real data of the open game
      const drawn = {};
      for (const pg of ['home', 'status', 'previews', 'usage', 'questions', 'team']) {
        await js(`goPage('${pg}')`); await sleep(pg === 'usage' || pg === 'home' ? 1600 : 500);
        drawn[pg] = await js(`document.querySelectorAll('#page .gcard').length`);
        await shot('30_page_' + pg);
      }
      log('every page draws', Object.values(drawn).every(n => n > 0), JSON.stringify(drawn));
      await js(`goPage('status')`); await sleep(300);
      log('Status shows one card for each agent with a picture', (await js(`document.querySelectorAll('#page .agent-card .av img').length`)) === 4);
      await js(`goPage('usage')`); await sleep(1600);
      log('Usage shows the 19 stops and the rocket', (await js(`document.querySelectorAll('#page .stop').length`)) === 19 && (await js(`document.querySelectorAll('#page .track .rocket').length`)) === 1);
      await js(`studioView('canvas')`); await sleep(600);
      const cmodes = [];
      for (const m of ['tree', 'orbit', 'lanes', 'timeline', 'flow']) { await js(`document.querySelector('#navbar .lays button[aria-label="${m[0].toUpperCase() + m.slice(1)} layout"]').click()`); await sleep(500); cmodes.push(await js(`S.tabs[0].board.canvas.mode`)); await shot('32_canvas_' + m); }
      log('the five layouts arrange the cards', cmodes.join(',') === 'tree,orbit,lanes,timeline,flow' && (await js(`document.querySelectorAll('#page .cv .edge.give').length`)) === 3, cmodes.join(','));
      await js(`addSticky(S.tabs[0])`); await sleep(300);
      await js(`(()=>{const ta=document.querySelector('#page .sticky textarea');ta.value='Check the lamps';ta.dispatchEvent(new Event('input'));})()`); await sleep(1500);
      log('a sticky note is saved with the game', JSON.parse(fs.readFileSync(path.join(p.agentsDir, 'board.json'), 'utf8')).canvas.notes[0].text === 'Check the lamps');
      await shot('33_canvas_note');
      await js(`studioView('board')`); await sleep(500);
      const modes = [];
      for (const m of ['orbit', 'lanes', 'timeline', 'flow', 'tree']) { await js(`document.querySelector('#navbar .lays button[aria-label="${m[0].toUpperCase() + m.slice(1)} layout"]').click()`); await sleep(500); modes.push(await js(`S.tabs[0].board.mode`)); if (m !== 'tree') await shot('31_layout_' + m); }
      log('the five layouts arrange the board', modes.join(',') === 'orbit,lanes,timeline,flow,tree', modes.join(','));
      // team editor
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent==='Team').click()`);
      await sleep(400);
      await js(`[...document.querySelectorAll('.team-list button')].find(b=>b.textContent.includes('Security')).click()`);
      await sleep(300);
      await shot('05_team_editor');
      await js(`document.querySelector('.modal .m-head .icon-btn').click()`);
      // handoff modal
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent==='Hand off').click()`);
      await sleep(300);
      await shot('06_handoff');
      await js(`document.querySelector('.modal .m-head .icon-btn').click()`);
      // add tiles
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent.startsWith('Add')).click()`);
      await sleep(200);
      await js(`[...document.querySelectorAll('.menu button')].find(b=>b.textContent.startsWith('Checklist')).click()`);
      await sleep(400);
      await js(`[...document.querySelectorAll('.toolbar .btn')].find(b=>b.textContent.startsWith('Layout')).click()`);
      await sleep(200);
      await js(`[...document.querySelectorAll('.menu button')].find(b=>b.textContent.startsWith('Fit')).click()`);
      await sleep(900);
      await shot('07_after_layout');
      log('git card shows branch', (await js(`(document.querySelector('.branch')||{}).textContent||''`)).length > 0);
      // ---------------- remote view
      const RP = 7499;
      const rq = (method, pth, body, headers) => new Promise((resolve) => {
        const data = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request({ host: '127.0.0.1', port: RP, path: pth, method, headers: Object.assign(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Agent-Deck': '1', 'Content-Length': Buffer.byteLength(data) }, headers || {}) }, (res) => {
          let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
        });
        req.on('error', (e) => resolve({ status: 0, body: e.message, headers: {} }));
        req.end(data);
      });
      let RI = await js(`window.deck.remoteSet({ enabled: true, port: ${RP} })`);
      log('remote view starts', RI.enabled && RI.listening, JSON.stringify(RI).slice(0, 200));
      log('remote page served', (await rq('GET', '/')).status === 200);
      log('remote state needs pairing', (await rq('GET', '/api/state')).status === 401);
      log('remote write needs the header', (await rq('POST', '/api/pair', { code: RI.code }, { 'X-Agent-Deck': '0' })).status === 403);
      log('remote wrong code refused', (await rq('POST', '/api/pair', { code: RI.code === '000000' ? '111111' : '000000' })).status === 401);
      const firstCode = RI.code;
      const pr = await rq('POST', '/api/pair', { code: RI.code, name: 'Test Mac' });
      const cookie = String((pr.headers['set-cookie'] || [''])[0]).split(';')[0];
      log('remote pairs with the code', pr.status === 200 && /^adr=[a-f0-9]{48}$/.test(cookie), pr.body);
      log('remote code works once', (await rq('POST', '/api/pair', { code: firstCode })).status === 401);
      const ck = { Cookie: cookie };
      const stR = await rq('GET', '/api/state', undefined, ck);
      const st = JSON.parse(stR.body || '{}');
      log('remote state lists the project and consoles', stR.status === 200 && st.projects.length === 1 && st.projects[0].consoles.length >= 3, stR.body.slice(0, 160));
      // live stream: type into the Supervisor from "the Mac" and watch the output come back
      const sse = await new Promise((resolve) => {
        let buf = '';
        const req = http.request({ host: '127.0.0.1', port: RP, path: '/api/events', headers: ck }, (res) => {
          res.on('data', (c) => { buf += c; });
          resolve({ get text() { return buf; }, close: () => req.destroy(), status: res.statusCode });
        });
        req.end();
      });
      await sleep(300);
      const ir = await rq('POST', '/api/input', { id: p.key + ':supervisor', data: 'echo REMOTE_OK_$((40+2))\r' }, ck);
      await sleep(1500);
      log('remote typing reaches the agent and streams back', ir.status === 200 && sse.text.includes('REMOTE_OK_42'), sse.status + ' ' + sse.text.length);
      const sy = await rq('POST', '/api/say', { key: p.key, to: 'lead', text: 'hello from the mac' }, ck);
      await sleep(400);
      log('remote Tell the team works', sy.status === 200 && p.feed.some(f => /hello from the mac/.test(f.text)), sy.body);
      const tk = await rq('POST', '/api/task', { key: p.key, action: 'add', text: 'Remote card', agent: 'Studio builder' }, ck);
      await sleep(300);
      log('remote task add works', tk.status === 200 && sse.text.includes('Remote card'), tk.body);
      const cm = await rq('POST', '/api/command', { id: p.key + ':studio', cmd: 'not a command' }, ck);
      log('remote command must start with /', cm.status === 400);
      const bad = await rq('GET', '/api/markdown?key=' + p.key + '&path=' + encodeURIComponent('../../etc/passwd'), undefined, ck);
      log('remote cannot read outside the project', bad.status === 400);
      sse.close();
      // the page itself, in a separate browser session with the cookie
      const { BrowserWindow, session } = require('electron');
      const ses = session.fromPartition('remote-test');
      await ses.cookies.set({ url: `http://127.0.0.1:${RP}`, name: 'adr', value: cookie.slice(4), httpOnly: true });
      const rw = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { session: ses } });
      const rErrors = [];
      rw.webContents.on('console-message', (e, lv, msg) => { const level = e.level !== undefined ? e.level : lv; if (level === 'error' || level >= 3) rErrors.push(String(e.message !== undefined ? e.message : msg)); });
      await rw.loadURL(`http://127.0.0.1:${RP}/`);
      await sleep(2500);
      const rjs = (code) => rw.webContents.executeJavaScript(code, true);
      log('remote page shows the agents', (await rjs(`document.querySelectorAll('.chip').length`)) === 4);
      log('remote terminal shows the agent output', (await rjs(`(()=>{const b=R.terms.supervisor.term.buffer.active;let t='';for(let i=0;i<b.length;i++)t+=b.getLine(i).translateToString(true);return t;})()`)).includes('REMOTE_OK_42'));
      const fr = await rq('POST', '/api/resize', { id: p.key + ':studio', cols: 80, rows: 24 }, ck);
      log('remote Fit to this screen resizes the terminal', fr.status === 200 && ctx.consoles.get(p.key + ':studio').cols === 80);
      log('remote page has the task card', (await rjs(`document.getElementById('kanban').textContent.includes('Remote card')`)) === true);
      fs.writeFileSync(path.join(out, '09_remote_desktop.png'), (await rw.webContents.capturePage()).toPNG());
      await rjs(`document.querySelector('.side-tabs [data-tab=tasks]').click()`); await sleep(300);
      fs.writeFileSync(path.join(out, '10_remote_tasks.png'), (await rw.webContents.capturePage()).toPNG());
      rw.setSize(390, 844); await sleep(800);
      fs.writeFileSync(path.join(out, '11_remote_phone_agents.png'), (await rw.webContents.capturePage()).toPNG());
      await rjs(`document.querySelector('.bottom [data-go=talk]').click()`); await sleep(400);
      fs.writeFileSync(path.join(out, '12_remote_phone_talk.png'), (await rw.webContents.capturePage()).toPNG());
      log('remote page has no errors', rErrors.length === 0, rErrors.join(' | ').slice(0, 300));
      rw.destroy();
      // pairing screen for a new device
      const pw = new BrowserWindow({ width: 1000, height: 760, show: false, webPreferences: { partition: 'remote-test-2' } });
      await pw.loadURL(`http://127.0.0.1:${RP}/`); await sleep(1200);
      log('new device sees the pairing screen', (await pw.webContents.executeJavaScript(`!document.getElementById('pair').hidden`, true)) === true);
      fs.writeFileSync(path.join(out, '13_remote_pair.png'), (await pw.webContents.capturePage()).toPNG());
      pw.destroy();
      // the Remote dialog in the app
      await js(`document.querySelector('.remote-btn').click()`); await sleep(500);
      await shot('14_remote_modal');
      RI = await js(`window.deck.remoteInfo()`);
      log('paired device is listed', RI.devices.length === 1 && RI.devices[0].name === 'Test Mac');
      await js(`window.deck.remoteSignOut('all')`);
      log('signed-out device is refused', (await rq('GET', '/api/state', undefined, ck)).status === 401);
      await js(`document.querySelector('.modal .m-head .icon-btn').click()`);
      RI = await js(`window.deck.remoteSet({ enabled: false })`);
      log('remote view turns off', !RI.listening && (await rq('GET', '/')).status === 0);
      // ---------------- replies, main menu, folder switch
      // dialogs stay above agent windows even after many clicks raise them
      await js(`S.z = 50000; for (const el of document.querySelectorAll('.tile')) el.style.zIndex = ++S.z; document.querySelector('.tile').classList.add('max')`);
      await js(`helpModal()`); await sleep(300);
      const topEl = await js(`(()=>{const b=document.querySelector('.modal .m-head .icon-btn').getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!(e&&e.closest('.modal'));})()`);
      log('dialog Close button is on top of agent windows', topEl === true);
      await js(`closeAllModals(); document.querySelector('.tile').classList.remove('max')`); await sleep(200);
      const tdir = path.join(require('os').homedir(), '.claude', 'projects', 'agent-deck-selftest');
      fs.mkdirSync(tdir, { recursive: true });
      const tfile = path.join(tdir, 'transcript.jsonl');
      const JL = (o) => JSON.stringify(o);
      fs.writeFileSync(tfile, [
        JL({ type: 'user', message: { role: 'user', content: 'old prompt' } }),
        JL({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'OLD ANSWER' }] } }),
        JL({ type: 'user', message: { role: 'user', content: 'Build the spawn plaza' } }),
        JL({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Starting on the plaza.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }),
        JL({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
        JL({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '## Done\n\nSpawn plaza is **built**: 412 parts. REPLY_MARKER' }] } }),
      ].join('\n') + '\n');
      const blender2 = ctx.consoles.get(p.key + ':blender');
      r = await post(port, `/hook/${blender2.token}/stop`, { session_id: 'x', transcript_path: tfile });
      await sleep(600);
      const rep = p.replies[p.replies.length - 1];
      log('reply captured at the end of a turn', !!rep && rep.agentId === 'blender' && /Starting on the plaza/.test(rep.text) && /REPLY_MARKER/.test(rep.text) && !/OLD ANSWER/.test(rep.text), rep && rep.text.slice(0, 80));
      log('reply saved to logs/replies.jsonl', fs.existsSync(path.join(p.agentsDir, 'logs', 'replies.jsonl')));
      r = await post(port, `/hook/${blender2.token}/stop`, { session_id: 'x', last_assistant_message: 'Direct message REPLY2' });
      await sleep(400);
      log('reply from last_assistant_message', /REPLY2/.test(p.replies[p.replies.length - 1].text));
      await js(`activate(S.tabs[0].key)`); await sleep(500);
      log('replies panel shows the reply', (await js(`document.querySelector('.replies').textContent.includes('REPLY2')`)) === true);
      log('agent window has a new-reply button', (await js(`!!document.querySelector('.tile .icon-btn.new')`)) === true);
      await shot('15_replies_panel');
      await js(`repliesModal(S.tabs[0], 'blender')`); await sleep(500);
      log('replies dialog shows the full answer', (await js(`document.querySelector('.reply-list').textContent.includes('412 parts')`)) === true);
      await shot('16_replies_modal');
      await js(`closeAllModals()`); await sleep(200);
      log('reply button marked seen', (await js(`!document.querySelector('.tile .icon-btn.new')`)) === true);
      await js(`document.getElementById('main-menu').click()`); await sleep(300);
      const mm = await js(`document.querySelector('.menu').textContent`);
      log('main menu has folders, remote and themes', /Switch this tab to another folder/.test(mm) && /Change agents folder/.test(mm) && /Remote view/.test(mm) && /Midnight/.test(mm) && !/Quick guide/.test(mm), mm.slice(0, 200));
      await shot('17_main_menu');
      await js(`closeMenu()`);
      await js(`document.querySelector('.toolbar .proj').click()`); await sleep(300);
      log('folder menu opens from the project name', (await js(`document.querySelector('.menu').textContent.includes('Show project folder')`)) === true);
      await shot('18_folder_menu');
      await js(`closeMenu()`);
      const qg = await new Promise((resolve) => { http.get({ host: '127.0.0.1', port: 7499, path: '/icon.png' }, (res) => { resolve(res.statusCode); res.resume(); }).on('error', () => resolve(0)); });
      log('remote view is off, so its port is closed', qg === 0);
      // switch folder: point the tab at a second folder
      const proj2 = path.join(ROOT, 'Dev', 'other-app');
      fs.mkdirSync(proj2, { recursive: true });
      const { dialog } = require('electron');
      const realOpen = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [proj2] });
      const realMsg = dialog.showMessageBox;
      await js(`(async()=>{ const p = switchFolder(S.tabs[0]); await new Promise(r=>setTimeout(r,400)); const b=[...document.querySelectorAll('.modal .btn')].find(x=>/Stop and switch/.test(x.textContent)); if (b) b.click(); await p; })()`);
      await sleep(1500);
      dialog.showOpenDialog = realOpen; void realMsg;
      log('switch folder replaces the tab', (await js(`S.tabs.length === 1 && S.tabs[0].path.endsWith('other-app')`)) === true, await js(`S.tabs.map(t=>t.path).join(',')`));
      const chooser = await js(`(document.querySelector('.modal')||{textContent:''}).textContent`);
      log('new folder gets game team suggestions', /Game studio/.test(chooser) && /Prototype sprint/.test(chooser) && /New game/.test(chooser) && !/Make It In Miami/.test(chooser), chooser.slice(0, 200));
      await shot('19_game_presets');
      await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent==='Use this team').click()`); await sleep(800);
      const team2 = JSON.parse(fs.readFileSync(path.join(await js(`S.tabs[0].agentsDir`), 'team.json'), 'utf8'));
      log('Game studio team is saved', team2.name === 'Game studio' && team2.agents.length === 5 && team2.agents[0].lead, team2.agents.map(a => a.name).join(', '));
      await js(`closeAllModals()`); await sleep(300);
      try { fs.rmSync(tdir, { recursive: true, force: true }); } catch (e) {}
      // welcome screen
      await js(`document.querySelector('.brand').click()`);
      await sleep(400);
      await shot('08_welcome');
      log('board saved', fs.existsSync(path.join(p.agentsDir, 'board.json')));
    } catch (e) {
      log('selftest crashed', false, e.stack);
    }
    fs.writeFileSync(path.join(ROOT, 'result.json'), JSON.stringify(results, null, 2));
    setTimeout(() => ctx.quit(), 300);
  },
};
