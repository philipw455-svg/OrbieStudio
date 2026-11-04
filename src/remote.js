// Agent Deck: Remote view.
// Serves a browser version of the board to the owner's other devices (a Mac, a phone) on the home network
// or over Tailscale. Off by default. A device must pair once with a 6-digit code shown on the PC; after that
// it keeps a long-lived cookie until the owner signs it out. Only private-network addresses may connect.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 7420;
const STATIC = {
  '/': ['remote/index.html', 'text/html; charset=utf-8'],
  '/remote.js': ['remote/remote.js', 'text/javascript; charset=utf-8'],
  '/remote.css': ['remote/remote.css', 'text/css; charset=utf-8'],
  '/icon.png': ['renderer/icon.png', 'image/png'],
  '/quick-guide.pdf': ['docs/Agent Deck Quick Guide.pdf', 'application/pdf'],
  '/vendor/xterm.js': ['renderer/vendor/xterm.js', 'text/javascript; charset=utf-8'],
  '/vendor/xterm.css': ['renderer/vendor/xterm.css', 'text/css; charset=utf-8'],
  '/vendor/addon-fit.js': ['renderer/vendor/addon-fit.js', 'text/javascript; charset=utf-8'],
  '/vendor/marked.umd.js': ['renderer/vendor/marked.umd.js', 'text/javascript; charset=utf-8'],
  '/vendor/purify.min.js': ['renderer/vendor/purify.min.js', 'text/javascript; charset=utf-8'],
};
// Events from the main process that remote devices also receive.
const FORWARD = new Set(['console:data', 'console:status', 'console:size', 'feed:add', 'inbox:update', 'view:show', 'board:kanban', 'loops:update', 'remote:hello', 'console:reply']);

// Loopback, home networks (10/8, 172.16/12, 192.168/16), link-local, Tailscale (100.64/10) and IPv6 private ranges.
function isPrivate(addr) {
  let a = String(addr || '').toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1' || a === '127.0.0.1') return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function newCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function eq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function deviceName(ua) {
  ua = String(ua || '');
  const sys = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${sys} · ${br}`;
}

module.exports = function createRemote(deps) {
  // deps: settings, saveSettings, notify, onChange, api {state, buffer, input, send, command, say, answer, dismiss, start, stop, task, image, markdown}
  const S = () => {
    const s = deps.settings();
    s.remote = s.remote || {};
    const r = s.remote;
    if (typeof r.enabled !== 'boolean') r.enabled = false;
    if (!r.port) r.port = DEFAULT_PORT;
    if (!r.code) r.code = newCode();
    r.devices = Array.isArray(r.devices) ? r.devices : [];
    return r;
  };
  let server = null, listening = false, lastError = '';
  const clients = new Set(); // { res, deviceId }
  const fails = new Map();   // ip -> { n, until }
  let failsSinceCode = 0;

  function info() {
    const r = S();
    const addrs = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family !== 'IPv4' && n.family !== 4) continue;
        if (n.internal || !isPrivate(n.address)) continue;
        const ts = /^100\./.test(n.address) || /tailscale/i.test(name);
        addrs.push({ url: `http://${n.address}:${r.port}`, label: ts ? 'Tailscale (anywhere)' : `Home network (${name})`, tailscale: ts });
      }
    }
    addrs.sort((a, b) => Number(a.tailscale) - Number(b.tailscale));
    const live = new Map();
    for (const c of clients) live.set(c.deviceId, (live.get(c.deviceId) || 0) + 1);
    return {
      enabled: r.enabled, listening, port: r.port, code: r.code, error: lastError, addresses: addrs,
      devices: r.devices.map(d => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen, online: live.has(d.id) })),
      connected: clients.size,
    };
  }
  function changed() { try { deps.onChange(info()); } catch (e) {} }

  function emit(channel, payload) {
    if (!clients.size || !FORWARD.has(channel)) return;
    const line = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) { try { c.res.write(line); } catch (e) {} }
  }

  function deviceFor(req) {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)adr=([a-f0-9]{48})/);
    if (!m) return null;
    const h = sha(m[1]);
    return S().devices.find(d => eq(d.hash, h)) || null;
  }

  function json(res, code, obj, extra) {
    const body = JSON.stringify(obj === undefined ? null : obj);
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }, extra || {}));
    res.end(body);
  }
  const SEC = {
    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };

  function serveStatic(res, rel, type) {
    const f = path.join(__dirname, rel);
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': buf.length }, SEC, /pdf/.test(type) ? { 'Content-Disposition': 'attachment; filename="Agent Deck Quick Guide.pdf"' } : {}));
      res.end(buf);
    });
  }

  function pair(req, res, body, ip) {
    const r = S();
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return json(res, 429, { error: 'Too many wrong codes. Wait a few minutes and try again.' });
    const code = String((body && body.code) || '').replace(/\D/g, '');
    if (!code || !eq(code, r.code)) {
      f.n += 1; if (f.n >= 5) { f.until = Date.now() + 5 * 60000; f.n = 0; }
      fails.set(ip, f);
      failsSinceCode += 1;
      if (failsSinceCode >= 15) { r.code = newCode(); failsSinceCode = 0; deps.saveSettings(); changed(); deps.notify('Remote view', 'Too many wrong pairing codes, so Agent Deck made a new one.'); }
      return json(res, 401, { error: 'That code is not right. Check the code on the PC (Remote button).' });
    }
    fails.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    const dev = { id: crypto.randomBytes(6).toString('hex'), hash: sha(token), name: String((body && body.name) || '').slice(0, 40) || deviceName(req.headers['user-agent']), pairedAt: Date.now(), lastSeen: Date.now() };
    r.devices.push(dev);
    if (r.devices.length > 12) r.devices.splice(0, r.devices.length - 12);
    r.code = newCode(); // a code works once
    failsSinceCode = 0;
    deps.saveSettings();
    changed();
    deps.notify('Remote view', `${dev.name} is now paired with Agent Deck.`);
    json(res, 200, { ok: true, device: dev.name }, { 'Set-Cookie': `adr=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
  }

  function events(req, res, dev) {
    res.writeHead(200, Object.assign({}, SEC, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
    res.write('retry: 3000\n\n');
    const c = { res, deviceId: dev.id };
    clients.add(c);
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    const done = () => { clearInterval(ping); clients.delete(c); changed(); };
    res.on('close', done);
    changed();
  }

  async function api(req, res, route, body, dev) {
    const A = deps.api;
    const q = new URL(req.url, 'http://x').searchParams;
    switch (route) {
      case 'state': return json(res, 200, Object.assign(A.state(), { device: dev.name }));
      case 'buffer': return json(res, 200, A.buffer(q.get('id')));
      case 'image': return json(res, 200, { data: A.image(q.get('key'), q.get('path')) });
      case 'markdown': return json(res, 200, { text: A.markdown(q.get('key'), q.get('path')) });
      case 'input': A.input(body.id, String(body.data || '').slice(0, 8000)); return json(res, 200, true);
      case 'send': return json(res, 200, A.send(body.id, body.text));
      case 'command': return json(res, 200, A.command(body.id, body.cmd));
      case 'say': return json(res, 200, A.say(body.key, { to: body.to, text: body.text, comment: !!body.comment }));
      case 'answer': return json(res, 200, A.answer(body.key, body.itemId, String(body.text || '')));
      case 'dismiss': return json(res, 200, A.dismiss(body.key, body.itemId));
      case 'start': return json(res, 200, A.start(body.key, body.agentId, { resume: body.resume !== false }));
      case 'stop': return json(res, 200, A.stop(body.id));
      case 'resize': return json(res, 200, A.resize(body.id, parseInt(body.cols, 10), parseInt(body.rows, 10)));
      case 'task': return json(res, 200, A.task(body.key, body));
      case 'signout': { const r = S(); r.devices = r.devices.filter(d => d.id !== dev.id); deps.saveSettings(); changed(); return json(res, 200, true, { 'Set-Cookie': 'adr=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
      default: return json(res, 404, { error: 'Unknown request.' });
    }
  }

  function handler(req, res) {
    const ip = req.socket.remoteAddress;
    if (!isPrivate(ip)) { res.writeHead(403); return res.end(); }
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && STATIC[url]) return serveStatic(res, STATIC[url][0], STATIC[url][1]);
    if (!url.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    const route = url.slice(5);
    // Writes need a JSON body and a custom header, which a page on another site cannot send without our consent.
    if (req.method === 'POST' && (req.headers['x-agent-deck'] !== '1' || !/^application\/json/.test(String(req.headers['content-type'] || '')))) return json(res, 403, { error: 'Bad request.' });
    let raw = '';
    req.on('data', ch => { raw += ch; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body = {};
      if (req.method === 'POST') { try { body = JSON.parse(raw || '{}') || {}; } catch (e) { return json(res, 400, { error: 'Bad JSON.' }); } }
      try {
        if (route === 'pair' && req.method === 'POST') return pair(req, res, body, ip);
        const dev = deviceFor(req);
        if (!dev) return json(res, 401, { error: 'pair' });
        if (Date.now() - (dev.lastSeen || 0) > 60000) { dev.lastSeen = Date.now(); deps.saveSettings(); }
        if (route === 'events' && req.method === 'GET') return events(req, res, dev);
        await api(req, res, route, body, dev);
      } catch (e) { json(res, 400, { error: e && e.message ? e.message : String(e) }); }
    });
  }

  function stop() {
    for (const c of clients) { try { c.res.end(); } catch (e) {} }
    clients.clear();
    if (server) { try { server.close(); } catch (e) {} }
    server = null; listening = false;
  }
  function start() {
    stop();
    const r = S();
    if (!r.enabled) { lastError = ''; changed(); return Promise.resolve(info()); }
    return new Promise((resolve) => {
      server = http.createServer(handler);
      server.keepAliveTimeout = 65000;
      server.on('error', (e) => {
        listening = false;
        lastError = e.code === 'EADDRINUSE' ? `Port ${r.port} is already in use. Pick another port.` : (e.message || String(e));
        changed(); resolve(info());
      });
      server.listen(r.port, '0.0.0.0', () => { listening = true; lastError = ''; changed(); resolve(info()); });
    });
  }

  return {
    info, emit, start, stop,
    async set(patch) {
      const r = S();
      if (patch && typeof patch.enabled === 'boolean') r.enabled = patch.enabled;
      if (patch && patch.port) {
        const p = parseInt(patch.port, 10);
        if (!(p >= 1024 && p <= 65535)) throw new Error('Pick a port between 1024 and 65535.');
        r.port = p;
      }
      deps.saveSettings();
      return start();
    },
    newCode() { const r = S(); r.code = newCode(); failsSinceCode = 0; deps.saveSettings(); changed(); return info(); },
    signOut(id) {
      const r = S();
      const gone = id === 'all' ? r.devices.map(d => d.id) : [id];
      r.devices = id === 'all' ? [] : r.devices.filter(d => d.id !== id);
      for (const c of [...clients]) if (gone.includes(c.deviceId)) { try { c.res.end(); } catch (e) {} clients.delete(c); }
      deps.saveSettings(); changed(); return info();
    },
    _isPrivate: isPrivate,
  };
};
