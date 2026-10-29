const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const has = c => spawnSync('which', [c], { stdio: 'ignore' }).status === 0;
const missing = () => {
  const m = [];
  if (!process.env.DISPLAY) m.push('una sesión X11 (DISPLAY); en Wayland puro no funciona, usa XWayland o inicia sesión en Xorg');
  if (!has('xdotool')) m.push('xdotool');
  if (!has('import')) m.push('imagemagick');
  if (!has('tesseract')) m.push('tesseract-ocr');
  return m;
};

const miss = missing();
const supported = process.platform === 'linux' && miss.length === 0;
const NOT_SUPPORTED = process.platform === 'linux'
  ? 'Falta para el Betatester en Linux: ' + miss.join(', ') + '. Instala: sudo apt install xdotool imagemagick tesseract-ocr tesseract-ocr-spa'
  : 'El Betatester visual solo funciona en Windows y Linux.';

const run = (cmd, args, signal, timeout = 30000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, signal }, (err, out, errout) => {
    if (err) return reject(err.name === 'AbortError' ? err : new Error(String(errout || err.message).trim().slice(0, 300)));
    resolve(String(out));
  });
});

const LIST_SH = 'for id in $(xdotool search --onlyvisible --name .); do echo "$id|$(xdotool getwindowpid $id 2>/dev/null)|$(xdotool getwindowgeometry --shell $id 2>/dev/null | tr \'\\n\' \' \')|$(xdotool getwindowname $id 2>/dev/null)"; done';

async function list(signal) {
  const out = await run('sh', ['-c', LIST_SH], signal);
  const res = [];
  for (const line of out.split('\n')) {
    const p = line.split('|');
    if (p.length < 4) continue;
    const g = {};
    for (const m of p[2].matchAll(/(\w+)=(-?\d+)/g)) g[m[1]] = Number(m[2]);
    const title = p.slice(3).join('|').trim();
    if (!title || !(g.WIDTH >= 50) || !(g.HEIGHT >= 50)) continue;
    res.push({ hwnd: Number(p[0]), pid: Number(p[1]) || 0, x: g.X || 0, y: g.Y || 0, w: g.WIDTH, h: g.HEIGHT, title });
  }
  return res;
}

const foreground = async signal => Number((await run('xdotool', ['getactivewindow'], signal)).trim()) || 0;

async function geom(hwnd, signal) {
  let out;
  try { out = await run('xdotool', ['getwindowgeometry', '--shell', String(hwnd)], signal); } catch (e) { if (e.name === 'AbortError') throw e; throw new Error('gone'); }
  const g = {};
  for (const m of out.matchAll(/(\w+)=(-?\d+)/g)) g[m[1]] = Number(m[2]);
  if (!(g.WIDTH > 0)) throw new Error('gone');
  return { hwnd, x: g.X || 0, y: g.Y || 0, w: g.WIDTH, h: g.HEIGHT };
}

async function prep(hwnd, signal) {
  const o = await geom(hwnd, signal);
  try { await run('xdotool', ['windowactivate', '--sync', String(hwnd)], signal, 4000); }
  catch (e) { if (e.name === 'AbortError') throw e; try { await run('xdotool', ['windowfocus', String(hwnd)], signal, 3000); } catch { throw new Error('nofocus'); } }
  try { await run('xdotool', ['windowraise', String(hwnd)], signal, 2000); } catch {}
  return { ...o, ...(await geom(hwnd, signal)) };
}

const LANG = { en: 'eng', es: 'spa', fr: 'fra', de: 'deu', pt: 'por', it: 'ita' };

async function ocr(file, lang, signal) {
  const l = lang ? (LANG[String(lang).slice(0, 2).toLowerCase()] || lang) : null;
  let tsv;
  try { tsv = await run('tesseract', [file, 'stdout', '--psm', '11', ...(l ? ['-l', l] : []), 'tsv'], signal, 60000); }
  catch (e) { if (e.name === 'AbortError' || !l) throw e; tsv = await run('tesseract', [file, 'stdout', '--psm', '11', 'tsv'], signal, 60000); }
  const words = [], lineIds = new Map();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    if (!text || Number(c[10]) < 30) continue;
    const lk = c[2] + '-' + c[3] + '-' + c[4];
    if (!lineIds.has(lk)) lineIds.set(lk, lineIds.size);
    words.push({ t: text, x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]), l: lineIds.get(lk), c: Number(c[10]) });
  }
  return words;
}

async function snap({ hwnd, region, scale = 1, file, lang }, signal) {
  const o = await prep(hwnd, signal);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = ['-window', String(hwnd)];
  const full = region.x === 0 && region.y === 0 && region.w >= o.w && region.h >= o.h;
  if (!full) args.push('-crop', `${region.w}x${region.h}+${region.x}+${region.y}`, '+repage');
  if (scale !== 1) args.push('-filter', 'Lanczos', '-resize', Math.round(scale * 100) + '%');
  args.push('png:' + file);
  await run('import', args, signal, 30000);
  return { win: o, words: await ocr(file, lang, signal) };
}

const needIn = (o, x, y) => { if (x < 0 || y < 0 || x > o.w || y > o.h) throw new Error('outside'); };

async function click(hwnd, x, y, { button = 0, count = 1 } = {}, signal) {
  const o = await prep(hwnd, signal);
  needIn(o, x, y);
  await run('xdotool', ['mousemove', '--window', String(hwnd), String(Math.round(x)), String(Math.round(y)), 'click', '--repeat', String(count), '--delay', '70', button === 1 ? '3' : '1'], signal);
}

async function type(hwnd, text, signal) {
  await prep(hwnd, signal);
  await run('xdotool', ['type', '--delay', '8', '--', String(text).replace(/\r/g, '')], signal, 60000);
}

async function wheel(hwnd, x, y, delta, signal) {
  const o = await prep(hwnd, signal);
  needIn(o, x, y);
  const n = Math.max(1, Math.round(Math.abs(delta) / 120));
  await run('xdotool', ['mousemove', '--window', String(hwnd), String(Math.round(x)), String(Math.round(y)), 'click', '--repeat', String(n), '--delay', '30', delta > 0 ? '4' : '5'], signal);
}

const XK = { enter: 'Return', return: 'Return', tab: 'Tab', esc: 'Escape', escape: 'Escape', space: 'space', backspace: 'BackSpace', delete: 'Delete', del: 'Delete', insert: 'Insert', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', win: 'super' };

function parseKeys(combo) {
  return String(combo).split('+').map(k => {
    k = k.trim().toLowerCase();
    if (XK[k]) return XK[k];
    if (/^f([1-9]|1[0-2])$/.test(k) || /^[a-z0-9]$/.test(k)) return k;
    throw new Error('Tecla desconocida: ' + k);
  });
}

async function keys(hwnd, combo, signal) {
  await prep(hwnd, signal);
  await run('xdotool', ['key', '--clearmodifiers', '--', parseKeys(combo).join('+')], signal);
}

async function closeWindow(hwnd, signal) {
  try { await run('xdotool', ['windowquit', String(hwnd)], signal, 4000); }
  catch (e) { if (e.name === 'AbortError') throw e; await run('xdotool', ['windowclose', String(hwnd)], signal, 4000); }
}

const killTree = pid => { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } return Promise.resolve(); };

module.exports = { supported, NOT_SUPPORTED, ocr, list, foreground, snap, click, type, wheel, keys, parseKeys, closeWindow, killTree };
