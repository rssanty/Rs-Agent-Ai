// Prueba de extremo a extremo con Electron real. Se omite si no hay Electron instalado o no hay pantalla.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const electronBin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const hasDisplay = process.platform !== 'linux' || !!process.env.DISPLAY;
const skip = !fs.existsSync(electronBin) ? 'electron no instalado' : !hasDisplay ? 'sin DISPLAY (usa xvfb-run)' : false;

test('Betatester lee DOM, iconos, shadow DOM, iframes y consola de una app Electron', { skip, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-e2e-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', main: 'main.js', devDependencies: { electron: '*' } }));
  fs.writeFileSync(path.join(root, 'main.js'), "const { app, BrowserWindow } = require('electron'); app.commandLine.appendSwitch('no-sandbox'); app.whenReady().then(() => new BrowserWindow({ width: 900, height: 600 }).loadFile('index.html'));");
  fs.writeFileSync(path.join(root, 'frame.html'), '<button onclick="console.error(\'click-frame\')">Dentro</button>');
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><title>Demo</title>
<button aria-label="Cerrar"><svg width="24" height="24"><path d="M2 2L22 22" stroke="black"/></svg></button>
<button><i class="fa-trash"></i></button><input placeholder="correo"><div id="h"></div>
<iframe src="frame.html" width="300" height="80"></iframe>
<script>const r=document.getElementById('h').attachShadow({mode:'open'});r.innerHTML='<button id=s>Shadow</button>';
r.getElementById('s').onclick=()=>console.error('click-shadow');console.error('error-inicial');</script>`);
  const session = require('../betatester/session');
  const bt = require('../betatester/index');
  const ctx = { root };
  try {
    const first = await session.open({ command: `"${electronBin}" . --no-sandbox` }, ctx);
    assert.match(first, /modo DOM/);
    assert.match(first, /\[icono botón\] "Cerrar"/);
    assert.match(first, /\[icono botón\] "trash"/);
    assert.match(first, /\[campo\] "correo"/);
    assert.match(first, /"Shadow"/);
    assert.match(first, /\[frame\] Dentro/);
    assert.match(first, /error-inicial/);
    const id = n => Number(first.match(new RegExp('#(\\d+) \\[[^\\]]*\\] "' + n))[1]);
    assert.match(await bt.run('test_click', { item: id('Shadow') }, ctx), /click-shadow/);
    assert.match(await bt.run('test_click', { item: id('\\[frame\\] Dentro') }, ctx), /click-frame/);
    assert.match(await bt.run('test_console', {}, ctx), /error-inicial/);
  } finally { await session.close(true); }
});
