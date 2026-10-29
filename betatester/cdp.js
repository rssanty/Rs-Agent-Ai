const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

function getJson(port, p) {
  return new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, resp => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    });
    r.on('error', () => res(null));
    r.on('timeout', () => { r.destroy(); res(null); });
  });
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (_res, socket, head) => {
      const ws = { onmessage: null, onclose: null };
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let frag = [];
      const send = (op, payload) => {
        const mask = crypto.randomBytes(4), n = payload.length;
        let h;
        if (n < 126) h = Buffer.from([0x80 | op, 0x80 | n]);
        else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(n, 2); }
        else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); }
        const m = Buffer.alloc(n);
        for (let i = 0; i < n; i++) m[i] = payload[i] ^ mask[i & 3];
        socket.write(Buffer.concat([h, mask, m]));
      };
      const parse = () => {
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 8) { socket.end(); return; }
          if (op === 9) { send(10, payload); continue; }
          if (op === 1 || op === 0) {
            frag.push(payload);
            if (fin) { const t = Buffer.concat(frag).toString('utf8'); frag = []; if (ws.onmessage) ws.onmessage(t); }
          }
        }
      };
      ws.send = t => send(1, Buffer.from(t));
      ws.close = () => { try { socket.destroy(); } catch {} };
      socket.on('data', d => { buf = Buffer.concat([buf, d]); parse(); });
      socket.on('close', () => { if (ws.onclose) ws.onclose(); });
      socket.on('error', () => {});
      parse();
      resolve(ws);
    });
    req.on('response', () => reject(new Error('El navegador rechazó la conexión de depuración.')));
    req.on('error', reject);
    req.end();
  });
}

const MODS = { alt: 1, ctrl: 2, control: 2, meta: 4, win: 4, shift: 8 };
const KEYS = {
  enter: ['Enter', 'Enter', 13], return: ['Enter', 'Enter', 13], tab: ['Tab', 'Tab', 9], esc: ['Escape', 'Escape', 27], escape: ['Escape', 'Escape', 27],
  space: [' ', 'Space', 32], backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], del: ['Delete', 'Delete', 46], insert: ['Insert', 'Insert', 45],
  up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40], left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34]
};
const COMMANDS = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo', y: 'redo' };

function keySpec(k) {
  k = k.trim().toLowerCase();
  if (KEYS[k]) return { key: KEYS[k][0], code: KEYS[k][1], vk: KEYS[k][2] };
  let m = k.match(/^f([1-9]|1[0-2])$/);
  if (m) return { key: 'F' + m[1], code: 'F' + m[1], vk: 111 + Number(m[1]) };
  if (/^[a-z]$/.test(k)) return { key: k, code: 'Key' + k.toUpperCase(), vk: k.toUpperCase().charCodeAt(0), char: true };
  if (/^[0-9]$/.test(k)) return { key: k, code: 'Digit' + k, vk: k.charCodeAt(0), char: true };
  throw new Error('Tecla desconocida: ' + k);
}

class CDP {
  constructor(ws, port) {
    this.ws = ws; this.port = port; this.id = 0; this.pending = new Map();
    this.log = []; this.seq = 0; this.seenSeq = 0; this.closed = false; this.ctxs = new Map(); this.sessions = new Map();
    ws.onmessage = t => this.onMsg(t);
    ws.onclose = () => { this.closed = true; for (const p of this.pending.values()) p.rej(new Error('El navegador/app se cerró.')); this.pending.clear(); };
  }
  send(method, params = {}, timeout = 15000, sessionId) {
    if (this.closed) return Promise.reject(new Error('El navegador/app se cerró.'));
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error('Tiempo agotado: ' + method)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  add(kind, text) {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text || /Electron Security Warning/.test(text)) return;
    const last = this.log[this.log.length - 1];
    if (last && last.kind === kind && last.text === text) { last.n++; last.seq = ++this.seq; return; }
    this.log.push({ kind, text, n: 1, t: new Date().toISOString().slice(11, 19), seq: ++this.seq });
    if (this.log.length > 200) this.log.shift();
  }
  onMsg(t) {
    let m;
    try { m = JSON.parse(t); } catch { return; }
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
    const p = m.params || {};
    if (m.method === 'Runtime.executionContextCreated' && !m.sessionId && p.context && p.context.auxData && p.context.auxData.isDefault && p.context.auxData.frameId) this.ctxs.set(p.context.auxData.frameId, p.context.id);
    else if (m.method === 'Runtime.executionContextDestroyed') { for (const [k, v] of this.ctxs) if (v === p.executionContextId) this.ctxs.delete(k); }
    else if (m.method === 'Runtime.executionContextsCleared' && !m.sessionId) this.ctxs.clear();
    else if (m.method === 'Target.attachedToTarget' && p.targetInfo && p.targetInfo.type === 'iframe') this.sessions.set(p.targetInfo.targetId, p.sessionId);
    else if (m.method === 'Target.detachedFromTarget') { for (const [k, v] of this.sessions) if (v === p.sessionId) this.sessions.delete(k); }
    if (m.sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning' || p.type === 'assert')) {
      this.add(p.type === 'warning' ? 'warn' : 'error', (p.args || []).map(a => a.value != null ? a.value : a.description || a.type).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      this.add('excepción', ((d.exception && d.exception.description) || d.text || 'Excepción') + (d.url ? ` (${d.url}:${d.lineNumber + 1})` : ''));
    } else if (m.method === 'Log.entryAdded' && p.entry && (p.entry.level === 'error' || p.entry.level === 'warning')) {
      this.add(p.entry.level === 'warning' ? 'warn' : 'error', p.entry.text + (p.entry.url ? ' ' + p.entry.url : ''));
    } else if (m.method === 'Network.loadingFailed' && !p.canceled) {
      this.add('red', `Falló la carga: ${p.errorText || ''}`);
    } else if (m.method === 'Network.responseReceived' && p.response && p.response.status >= 400) {
      this.add('red', `HTTP ${p.response.status} ${p.response.url}`);
    }
  }
  fresh() { const out = this.log.filter(e => e.seq > this.seenSeq); this.seenSeq = this.seq; return out; }
  async init() {
    await Promise.all([this.send('Runtime.enable'), this.send('Log.enable'), this.send('Page.enable'), this.send('Network.enable'), this.send('DOM.enable')]);
    try { await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, 3000); } catch {}
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('Error en la página: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  async scanAll(source) {
    const main = await this.eval(source);
    let tree;
    try { tree = (await this.send('Page.getFrameTree', {}, 4000)).frameTree; } catch { return main; }
    if (!tree) return main;
    const kids = [];
    const walk = n => { for (const ch of n.childFrames || []) { kids.push(ch.frame.id); walk(ch); } };
    walk(tree);
    if (!kids.length) return main;
    try { await this.send('DOM.getDocument', { depth: 0 }, 4000); } catch {}
    for (const fid of kids.slice(0, 10)) {
      try {
        const owner = await this.send('DOM.getFrameOwner', { frameId: fid }, 4000);
        const box = (await this.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }, 4000)).model;
        const q = box.content;
        const ox = Math.min(q[0], q[2], q[4], q[6]), oy = Math.min(q[1], q[3], q[5], q[7]);
        const params = { expression: source, returnByValue: true };
        const sess = this.sessions.get(fid);
        if (!sess) { const ctx = this.ctxs.get(fid); if (!ctx) continue; params.contextId = ctx; }
        const r = await this.send('Runtime.evaluate', params, 6000, sess);
        if (r.exceptionDetails || !r.result || !r.result.value) continue;
        for (const it of r.result.value.items) {
          const x = it.x + ox, y = it.y + oy, cx = x + it.w / 2, cy = y + it.h / 2;
          if (cx < ox || cy < oy || cx > ox + box.width || cy > oy + box.height || cx < 0 || cy < 0 || cx > main.vw || cy > main.vh) continue;
          main.items.push({ ...it, x: Math.round(x), y: Math.round(y), text: (it.kind === 'texto' ? '' : '[frame] ') + it.text });
        }
      } catch {}
    }
    return main;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, 4000);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  async click(x, y, { button = 'left', count = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (let i = 1; i <= count; i++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i, buttons: button === 'left' ? 1 : 2 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i });
    }
  }
  wheel(x, y, dy) { return this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); }
  async type(text) {
    for (const c of String(text)) {
      if (c === '\r') continue;
      if (c === '\n') { await this.key('enter'); continue; }
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, unmodifiedText: c });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: c });
    }
  }
  async key(combo) {
    const parts = String(combo).split('+').map(s => s.trim()).filter(Boolean);
    let mods = 0;
    const main = [];
    for (const p of parts) { if (MODS[p.toLowerCase()] && parts.length > 1) mods |= MODS[p.toLowerCase()]; else main.push(p); }
    if (!main.length) throw new Error('Combinación inválida: ' + combo);
    const k = keySpec(main[main.length - 1]);
    const plain = !(mods & 7);
    const text = plain ? (k.key === 'Enter' ? '\r' : k.key.length === 1 ? (mods & 8 ? k.key.toUpperCase() : k.key) : undefined) : undefined;
    const cmd = (mods & 2) && !(mods & ~2 & 7) && COMMANDS[k.key] ? [COMMANDS[k.key]] : undefined;
    const base = { modifiers: mods, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await this.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text, unmodifiedText: text } : {}), ...(cmd ? { commands: cmd } : {}) });
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }
  close() { this.closed = true; try { this.ws.close(); } catch {} }
}

async function pickTarget(port, title) {
  const list = await getJson(port, '/json/list');
  if (!Array.isArray(list)) return null;
  let pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/^devtools:/.test(t.url));
  if (title) { const f = pages.filter(t => String(t.title).toLowerCase().includes(String(title).toLowerCase())); if (f.length) pages = f; }
  return pages[0] || null;
}

async function attach(port, { title, timeout = 20000, signal } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (signal && signal.aborted) throw Object.assign(new Error('Detenido.'), { name: 'AbortError' });
    const t = await pickTarget(port, title);
    if (t) {
      const c = new CDP(await wsConnect(t.webSocketDebuggerUrl), port);
      await c.init();
      return c;
    }
    await sleep(400);
  }
  return null;
}

function findBrowser() {
  const P = process.platform;
  const cands = [];
  if (P === 'win32') {
    const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const b of pf) cands.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(b, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']) {
      const r = spawnSync('which', [n], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) cands.push(r.stdout.trim());
    }
  }
  return cands.find(f => { try { return fs.existsSync(f); } catch { return false; } }) || null;
}

async function launchBrowser(bin, url, signal) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-br-'));
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,860', '--app=about:blank'];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  const child = spawn(bin, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
  child.on('error', () => {});
  const c = await attach(port, { timeout: 15000, signal });
  if (!c) { try { child.kill(); } catch {} throw new Error('No pude conectar con el navegador.'); }
  await c.send('Page.navigate', { url });
  await sleep(500);
  return { cdp: c, child, dir };
}

// Sin Chrome/Edge instalado: usa una ventana propia de Electron (la app host) controlada con webContents.debugger.
async function launchInternal(url) {
  const { BrowserWindow } = require('electron');
  const w = new BrowserWindow({ width: 1280, height: 860, title: 'Betatester', webPreferences: { contextIsolation: true, sandbox: true, partition: 'rsagent-betatester-' + Date.now() } });
  await w.loadURL('about:blank');
  const dbg = w.webContents.debugger;
  dbg.attach('1.3');
  const ws = { onmessage: null, onclose: null };
  ws.send = t => {
    const m = JSON.parse(t);
    (m.sessionId ? dbg.sendCommand(m.method, m.params || {}, m.sessionId) : dbg.sendCommand(m.method, m.params || {})).then(
      result => ws.onmessage && ws.onmessage(JSON.stringify({ id: m.id, result })),
      err => ws.onmessage && ws.onmessage(JSON.stringify({ id: m.id, error: { message: err.message } })));
  };
  ws.close = () => { try { dbg.detach(); } catch {} try { if (!w.isDestroyed()) w.destroy(); } catch {} };
  dbg.on('message', (_e, method, params, sessionId) => { if (ws.onmessage) ws.onmessage(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) })); });
  dbg.on('detach', () => { if (ws.onclose) ws.onclose(); });
  w.on('closed', () => { if (ws.onclose) ws.onclose(); });
  const c = new CDP(ws, 0);
  await c.init();
  await c.send('Page.navigate', { url });
  await sleep(500);
  return { cdp: c, win: w };
}

module.exports = { CDP, attach, freePort, findBrowser, launchBrowser, launchInternal, getJson };
