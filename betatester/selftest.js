const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const win = require('./win');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('OK     ' + m);
const bad = m => { console.log('FALLÓ  ' + m); process.exitCode = 1; };
const has = c => spawnSync('which', [c], { stdio: 'ignore' }).status === 0;

function pickApp() {
  if (process.platform === 'win32') return { cmd: 'notepad.exe', args: [], edit: true };
  if (process.platform === 'linux') {
    for (const c of ['mousepad', 'gedit', 'kate', 'xterm']) if (has(c)) return { cmd: c, args: [], edit: true };
    if (has('xmessage')) return { cmd: 'xmessage', args: ['-center', 'Hola Rs-Agent-Ai'], edit: false };
  }
  return null;
}

(async () => {
  if (!win.supported) return console.log(win.NOT_SUPPORTED);
  const app = pickApp();
  if (!app) return bad('No encontré una app de prueba (instala mousepad, gedit, xterm o x11-apps).');
  const before = new Set((await win.list()).map(w => w.hwnd));
  ok('ventanas visibles: ' + before.size);
  const child = spawn(app.cmd, app.args, { detached: process.platform !== 'win32', stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  let w = null;
  for (let i = 0; i < 25 && !w; i++) { await sleep(600); w = (await win.list()).find(x => !before.has(x.hwnd)); }
  if (!w) return bad('no apareció la ventana de prueba (' + app.cmd + ')');
  ok('ventana nueva: "' + w.title + '" ' + w.w + 'x' + w.h);
  const file = path.join(os.tmpdir(), 'rsagent-selftest.png');
  const region = { x: 0, y: 0, w: w.w, h: w.h };
  const s1 = await win.snap({ hwnd: w.hwnd, region, scale: 1, file });
  ok('captura y OCR: ' + s1.words.length + ' palabras (archivo: ' + file + ')');
  if (app.edit) {
    await win.click(w.hwnd, Math.round(w.w / 2), Math.round(w.h / 2));
    await win.type(w.hwnd, 'Hola Rs-Agent-Ai');
    await sleep(600);
    const s2 = await win.snap({ hwnd: w.hwnd, region, scale: 1, file });
    const txt = s2.words.map(x => x.t).join(' ');
    if (/Hola|Agent/i.test(txt)) ok('teclado y OCR funcionan'); else bad('no se leyó el texto escrito. OCR: ' + txt.slice(0, 200));
    await win.keys(w.hwnd, 'ctrl+a');
    await win.keys(w.hwnd, 'delete');
  } else if (!/Agent/i.test(s1.words.map(x => x.t).join(' '))) bad('el OCR no leyó el texto de la ventana');
  else ok('OCR leyó el texto de la ventana');
  await win.closeWindow(w.hwnd);
  ok('ventana cerrada');
})().catch(e => bad(e.message));
