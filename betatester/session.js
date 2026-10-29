const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const win = require('./win');
const grid = require('./grid');
const detect = require('./detect');
const cdp = require('./cdp');
const scanner = require('./scan');
const icons = require('./icons');

const IS_WIN = process.platform === 'win32';
const S = { child: null, exited: false, logs: '', logTotal: 0, logSeen: 0, win: null, own: false, full: null, view: null, shots: [], n: 0, mode: 'native', cdp: null, inproc: false, browser: null, dir: null, lastLog: [] };

const abortError = () => Object.assign(new Error('Detenido.'), { name: 'AbortError' });
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(abortError());
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(abortError()); }, { once: true });
});

const tail = () => S.logs.slice(-600).trim();
const native = () => { if (!win.supported) throw new Error(win.NOT_SUPPORTED); };
const windows = async signal => (await win.list(signal)).filter(w => w.pid !== process.pid);
const fmtLog = L => L.map(e => `[${e.t}] ${e.kind}${e.n > 1 ? ' ×' + e.n : ''}: ${e.text}`).join('\n');

function friendly(e) {
  const m = String(e.message);
  if (/\bgone\b/.test(m)) return new Error('La ventana ya no existe (¿se cerró la app?). Usa test_open de nuevo.');
  if (/nofocus/.test(m)) return new Error('No pude poner la ventana al frente. Ciérrala o restáurala y reintenta.');
  if (/outside/.test(m)) return new Error('El punto queda fuera de la ventana.');
  if (/se cerró/.test(m)) return new Error('La app o el navegador se cerró. Usa test_open de nuevo.');
  return e;
}

function startProc(cmd, cwd, env) {
  S.logs = '';
  S.logTotal = 0;
  S.logSeen = 0;
  S.exited = false;
  const c = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, env: env ? { ...process.env, ...env } : process.env });
  const add = d => { S.logs = (S.logs + d).slice(-4000); S.logTotal += String(d).length; };
  c.stdout.on('data', add);
  c.stderr.on('data', add);
  c.on('error', e => add('error al ejecutar: ' + e.message));
  c.on('exit', () => { if (S.child === c) S.exited = true; });
  S.child = c;
}

function killProc(child) {
  if (!child || !child.pid) return Promise.resolve();
  if (IS_WIN) return win.killTree(child.pid);
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  return Promise.resolve();
}

function ping(url) {
  return new Promise(res => {
    const lib = url.startsWith('https') ? https : http;
    const r = lib.get(url, { timeout: 1500 }, resp => { resp.resume(); res(true); });
    r.on('error', () => res(false));
    r.on('timeout', () => { r.destroy(); res(false); });
  });
}

function urlCandidates(url) {
  const set = new Set();
  const add = u => { set.add(u); set.add(u.replace('localhost', '127.0.0.1')); };
  if (url) add(url);
  for (const m of S.logs.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/g)) add(m[0]);
  return [...set];
}

async function waitUrl(url, timeoutMs, signal) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const u of urlCandidates(url)) if (await ping(u)) return u;
    if (S.exited) throw new Error('El servidor terminó antes de responder.\n' + tail());
    await sleep(500, signal);
  }
  throw new Error(`El servidor no respondió en ${Math.round(timeoutMs / 1000)} s.\n` + tail());
}

async function waitNew(before, title, timeoutMs, signal) {
  const end = Date.now() + timeoutMs;
  const fresh = async () => (await windows(signal)).filter(w => !before.has(w.hwnd));
  while (Date.now() < end) {
    if ((await fresh()).length) {
      await sleep(1200, signal);
      let f = await fresh();
      if (title) { const t = f.filter(w => w.title.toLowerCase().includes(String(title).toLowerCase())); if (t.length) f = t; }
      if (f.length) return f.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    }
    await sleep(500, signal);
  }
  return null;
}

async function openBrowserNative(url, before, signal) {
  if (!/^(https?|file):\/\/[^\s"&|<>^]+$/.test(url)) throw new Error('URL inválida: ' + url);
  native();
  const launch = c => spawn(c, { shell: true, stdio: 'ignore', detached: !IS_WIN }).on('error', () => {});
  launch(IS_WIN ? `start "" msedge --new-window --app="${url}"` : `xdg-open "${url}"`);
  let w = await waitNew(before, null, 12000, signal);
  if (!w && IS_WIN) {
    launch(`start "" "${url}"`);
    w = await waitNew(before, null, 8000, signal);
  }
  if (!w) {
    const fg = await win.foreground(signal);
    w = (await windows(signal)).find(x => x.hwnd === fg);
  }
  if (!w) throw new Error('No encontré la ventana del navegador.');
  return w;
}

async function open(a, ctx) {
  await close(true, ctx.signal);
  const before = win.supported ? new Set((await windows(ctx.signal)).map(w => w.hwnd)) : new Set();
  if (a.attach) {
    if (a.port) {
      S.cdp = await cdp.attach(Number(a.port), { title: a.title, timeout: 8000, signal: ctx.signal });
      if (!S.cdp) throw new Error(`No hay nada escuchando en el puerto de depuración ${a.port}.`);
      S.mode = 'cdp';
    } else {
      native();
      if (!a.title) throw new Error('attach requiere title (o port si la app tiene depuración remota).');
      const w = (await windows(ctx.signal)).find(x => x.title.toLowerCase().includes(String(a.title).toLowerCase()));
      if (!w) throw new Error(`No hay ninguna ventana con "${a.title}".`);
      S.win = w;
    }
    S.own = false;
  } else {
    const info = detect.detect(ctx.root);
    const electronCmd = /\belectron\b/i.test(a.command || '');
    const isWeb = !!a.url || (info.kind === 'web' && !electronCmd);
    const url = a.url || (info.kind === 'web' ? info.url : null);
    const cmd = a.command || info.run;
    if (info.kind === 'console' && !a.command && !a.url) throw new Error('Este proyecto es de consola y no tiene ventana. Pruébalo con run_command.');
    if (!cmd && !(isWeb && url)) throw new Error('No sé cómo ejecutar este proyecto. Pasa command (y url si es web).');
    if (isWeb) {
      if (cmd) startProc(cmd, ctx.root);
      const ready = url.startsWith('file:') ? url : await waitUrl(url, 60000, ctx.signal);
      const bin = cdp.findBrowser();
      if (bin) {
        const b = await cdp.launchBrowser(bin, ready, ctx.signal);
        S.cdp = b.cdp; S.browser = b.child; S.dir = b.dir; S.mode = 'cdp';
      } else if (process.versions.electron) {
        const b = await cdp.launchInternal(ready);
        S.cdp = b.cdp; S.inproc = true; S.mode = 'cdp';
      } else {
        S.win = await openBrowserNative(ready, before, ctx.signal);
      }
    } else {
      const electron = info.stack === 'Electron' || /\belectron\b/i.test(cmd || '');
      const port = electron ? await cdp.freePort() : null;
      startProc(cmd, ctx.root, electron ? { RSAGENT_CDP_PORT: String(port), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${path.join(__dirname, 'inject.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1').replace(/\\/g, '/')}"`.trim() } : null);
      if (electron) {
        S.cdp = await cdp.attach(port, { title: a.title, timeout: 30000, signal: ctx.signal });
        if (S.cdp) S.mode = 'cdp';
        else if (S.exited) throw new Error('La app terminó antes de abrir ventana.\n' + tail());
      }
      if (S.mode !== 'cdp') {
        native();
        S.win = await waitNew(before, a.title, 40000, ctx.signal);
        if (!S.win) throw new Error('No apareció ninguna ventana en 40 s.\n' + tail());
      }
    }
    S.own = true;
  }
  if (S.mode === 'cdp') {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      let st = null;
      try { st = await S.cdp.eval('({ rs: document.readyState, w: innerWidth, u: location.href })'); } catch {}
      if (st && st.rs !== 'loading' && st.w > 0 && st.u !== 'about:blank') break;
      await sleep(250, ctx.signal);
    }
  }
  S.full = null;
  S.view = null;
  let seen;
  try { seen = await look({}, ctx); } catch (e) { if (e.name === 'AbortError') throw e; seen = 'No pude leer la pantalla todavía: ' + e.message; }
  const head = S.mode === 'cdp' ? `Ventana lista (modo DOM, rápido, ve iconos y consola): "${S.win && S.win.title}" ${S.win && S.win.w}×${S.win && S.win.h}.` : `Ventana lista: "${S.win.title}" ${S.win.w}×${S.win.h}.`;
  return head + '\n\n' + seen;
}

function processErrors() {
  const n = S.logTotal - S.logSeen;
  S.logSeen = S.logTotal;
  if (n <= 0) return '';
  const lines = S.logs.slice(-Math.min(n, S.logs.length)).split('\n').map(l => l.trim()).filter(l => /error|exception|traceback|fatal|warn|cannot|failed|unhandled/i.test(l));
  return lines.length ? 'Salida del proceso con errores:\n' + lines.slice(-10).map(l => l.slice(0, 300)).join('\n') : '';
}

async function lookCdp(a, ctx) {
  if (!S.cdp || S.cdp.closed) throw friendly(new Error('se cerró'));
  let info;
  try { info = await S.cdp.scanAll(scanner.source); } catch (e) { if (/cerró/.test(e.message)) throw friendly(e); await sleep(400, ctx.signal); info = await S.cdp.scanAll(scanner.source); }
  S.win = { hwnd: 0, title: info.title || info.url, w: info.vw, h: info.vh };
  let region = { x: 0, y: 0, w: info.vw, h: info.vh }, g = grid.autoGrid(info.vw, info.vh), label = 'completa';
  if (a.zoom) {
    const c = grid.parseCell(a.zoom);
    if (!S.full || !grid.inGrid(c, S.full.cols, S.full.rows)) throw new Error('zoom necesita una vista completa previa y una celda válida "columna,fila".');
    region = grid.zoomRegion(S.full, c);
    g = grid.autoGrid(region.w, region.h, 50, 12);
    label = `zoom en celda ${c.col},${c.row}`;
  }
  S.n++;
  const rel = path.join('.agente', 'screens', String(S.n).padStart(3, '0') + '.png');
  try { await S.cdp.shot(path.join(ctx.root, rel)); S.shots.push(rel.split(path.sep).join('/')); } catch {}
  const view = grid.buildDomView({ region, cols: g.cols, rows: g.rows, items: info.items });
  S.view = view;
  if (!a.zoom) S.full = { cols: g.cols, rows: g.rows, w: info.vw, h: info.vh };
  let out = grid.render({ win: S.win, view, label, dom: true });
  if (info.scrollMax > 0) out += `\nScroll vertical: ${info.scrollY}/${info.scrollMax} px.`;
  const errs = S.cdp.fresh();
  if (errs.length) out += `\n\nConsola (${errs.length} nuevo${errs.length > 1 ? 's' : ''}):\n` + fmtLog(errs);
  const pe = processErrors();
  if (pe) out += '\n\n' + pe;
  return out;
}

async function look(a, ctx) {
  if (S.mode === 'cdp') return lookCdp(a, ctx);
  if (!S.win) throw new Error('No hay ventana abierta. Usa test_open primero.');
  native();
  const w0 = S.win;
  let region = { x: 0, y: 0, w: w0.w, h: w0.h }, scale = 1, g = grid.autoGrid(w0.w, w0.h), label = 'completa';
  if (a.zoom) {
    const c = grid.parseCell(a.zoom);
    if (!S.full || !grid.inGrid(c, S.full.cols, S.full.rows)) throw new Error('zoom necesita una vista completa previa y una celda válida "columna,fila".');
    region = grid.zoomRegion(S.full, c);
    scale = 2;
    g = grid.autoGrid(region.w, region.h, 50, 12);
    label = `zoom en celda ${c.col},${c.row}`;
  }
  S.n++;
  const rel = path.join('.agente', 'screens', String(S.n).padStart(3, '0') + '.png');
  let res;
  try { res = await win.snap({ hwnd: S.win.hwnd, region, scale, file: path.join(ctx.root, rel), lang: a.lang }, ctx.signal); } catch (e) { throw friendly(e); }
  S.win = { ...S.win, ...res.win };
  S.shots.push(rel.split(path.sep).join('/'));
  let words = res.words;
  try {
    const ic = icons.findIcons(path.join(ctx.root, rel), words, { scale });
    words = icons.dropJunkInside(words, ic).concat(ic.map((b, i) => ({ t: '[icono?]', x: b.x, y: b.y, w: b.w, h: b.h, l: 900000 + i })));
  } catch {}
  const view = grid.buildView({ region, cols: g.cols, rows: g.rows, words, scale });
  S.view = view;
  if (!a.zoom) S.full = { cols: g.cols, rows: g.rows, w: S.win.w, h: S.win.h };
  let out = grid.render({ win: S.win, view, label });
  const pe = processErrors();
  if (pe) out += '\n\n' + pe;
  return out;
}

async function afterAction(msg, ctx) {
  await sleep(S.mode === 'cdp' ? 150 : 400, ctx.signal);
  try { return msg + '\n\nPantalla ahora:\n' + await look({}, ctx); } catch (e) { if (e.name === 'AbortError') throw e; return msg + '\n(No pude leer la pantalla: ' + e.message + ')'; }
}

function point(a) {
  const v = S.view;
  if (!v) throw new Error('Primero usa test_look.');
  if (a.item != null) {
    const it = v.items.find(i => i.id === Number(a.item));
    if (!it) throw new Error(`No existe el elemento #${a.item} en la vista actual.`);
    return { x: it.x, y: it.y, label: `#${it.id} "${it.text.slice(0, 40)}"` };
  }
  if (a.cell != null) {
    const c = grid.parseCell(a.cell);
    if (!grid.inGrid(c, v.cols, v.rows)) throw new Error(`Celda fuera de la cuadrícula (${v.cols} columnas × ${v.rows} filas).`);
    return { ...grid.cellCenter(v, c), label: `celda ${c.col},${c.row}` };
  }
  return null;
}

function live() {
  if (S.mode === 'cdp') { if (!S.cdp || S.cdp.closed) throw friendly(new Error('se cerró')); return; }
  if (!S.win) throw new Error('No hay ventana abierta. Usa test_open primero.');
  native();
}

async function click(a, ctx) {
  live();
  const p = point(a);
  if (!p) throw new Error('Indica item o cell.');
  try {
    if (S.mode === 'cdp') await S.cdp.click(p.x, p.y, { button: a.button === 'right' ? 'right' : 'left', count: a.double ? 2 : 1 });
    else await win.click(S.win.hwnd, p.x, p.y, { button: a.button === 'right' ? 1 : 0, count: a.double ? 2 : 1 }, ctx.signal);
  } catch (e) { throw friendly(e); }
  return afterAction(`Clic ${a.button === 'right' ? 'derecho ' : ''}${a.double ? 'doble ' : ''}en ${p.label}.`, ctx);
}

async function type(a, ctx) {
  live();
  const text = String(a.text);
  if (text.length > 2000) throw new Error('Texto demasiado largo (máx. 2000).');
  try { if (S.mode === 'cdp') await S.cdp.type(text); else await win.type(S.win.hwnd, text, ctx.signal); } catch (e) { throw friendly(e); }
  return afterAction(`Texto escrito (${text.length} caracteres).`, ctx);
}

async function key(a, ctx) {
  live();
  try { if (S.mode === 'cdp') await S.cdp.key(a.keys); else await win.keys(S.win.hwnd, a.keys, ctx.signal); } catch (e) { throw friendly(e); }
  return afterAction(`Tecla ${a.keys}.`, ctx);
}

async function scroll(a, ctx) {
  live();
  const p = point(a) || { x: Math.round(S.win.w / 2), y: Math.round(S.win.h / 2) };
  const amount = Math.min(20, Math.max(1, parseInt(a.amount) || 3));
  try {
    if (S.mode === 'cdp') await S.cdp.wheel(p.x, p.y, (a.direction === 'up' ? -1 : 1) * 120 * amount);
    else await win.wheel(S.win.hwnd, p.x, p.y, (a.direction === 'up' ? 1 : -1) * 120 * amount, ctx.signal);
  } catch (e) { throw friendly(e); }
  return afterAction(`Desplazado ${a.direction === 'up' ? 'arriba' : 'abajo'} ×${amount}.`, ctx);
}

function consoleText() {
  const L = S.cdp ? S.cdp.log : S.lastLog;
  return L.length ? fmtLog(L.slice(-50)) : '';
}

function consoleReport() {
  const parts = [];
  if (S.mode === 'cdp' || S.lastLog.length) {
    const t = consoleText();
    parts.push(t ? 'Consola del navegador/app (errores, avisos y fallos de red):\n' + t : 'Consola del navegador/app: sin errores ni avisos registrados.');
  } else parts.push('Sin consola de navegador: esta ventana no es web/Electron. Solo hay salida del proceso.');
  if (S.logs.trim()) parts.push('Salida del proceso (últimas líneas):\n' + S.logs.slice(-1200).trim());
  S.logSeen = S.logTotal;
  if (S.cdp) S.cdp.seenSeq = S.cdp.seq;
  return parts.join('\n\n');
}

async function close(silent, signal) {
  const had = !!(S.win || S.child || S.cdp);
  if (S.cdp) {
    S.lastLog = S.cdp.log.slice(-100);
    if (S.own && !S.inproc) { try { await S.cdp.send('Browser.close', {}, 1500); } catch {} }
    S.cdp.close();
  } else if (S.win && S.own && win.supported) {
    try { await win.closeWindow(S.win.hwnd, signal); await sleep(400, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  if (S.browser) await killProc(S.browser);
  if (S.child) await killProc(S.child);
  if (S.dir) { const d = S.dir; setTimeout(() => fs.rm(d, { recursive: true, force: true }, () => {}), 1500); }
  S.child = null; S.browser = null; S.dir = null; S.cdp = null; S.inproc = false;
  S.win = null;
  S.mode = 'native';
  S.full = null;
  S.view = null;
  S.exited = false;
  return silent ? '' : had ? 'App cerrada.' : 'No había ninguna app abierta.';
}

function shutdown() {
  for (const c of [S.child, S.browser]) {
    if (!c || !c.pid) continue;
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} } }
  }
  if (S.dir) { try { fs.rmSync(S.dir, { recursive: true, force: true }); } catch {} }
}

module.exports = { S, open, look, click, type, key, scroll, close, shutdown, consoleReport, consoleText, shots: () => S.shots };
