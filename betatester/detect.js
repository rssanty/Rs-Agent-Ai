const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f, max = 200000) => { try { return fs.readFileSync(f, 'utf8').slice(0, max); } catch { return ''; } };
const has = (root, ...p) => fs.existsSync(path.join(root, ...p));

const SKIP = new Set(['node_modules', 'venv', 'env', '__pycache__', 'site-packages', 'dist', 'build']);
function pyFiles(root, limit = 200) {
  const out = [];
  const rec = (dir, depth) => {
    if (out.length >= limit || depth > 4) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= limit) return;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) rec(path.join(dir, e.name), depth + 1); }
      else if (e.name.endsWith('.py')) out.push(path.join(dir, e.name));
    }
  };
  rec(root, 0);
  return out;
}

const PY = process.platform === 'win32' ? 'python' : 'python3';
const PY_GUI = [['tkinter', 'Tkinter'], ['customtkinter', 'CustomTkinter'], ['PyQt5', 'PyQt5'], ['PyQt6', 'PyQt6'], ['PySide2', 'PySide2'], ['PySide6', 'PySide6'], ['pygame', 'pygame'], ['kivy', 'Kivy'], ['wx', 'wxPython'], ['flet', 'Flet'], ['dearpygui', 'Dear PyGui'], ['arcade', 'Arcade'], ['pyglet', 'pyglet']];
const PY_WEB = [['streamlit', 'Streamlit', 8501], ['gradio', 'Gradio', 7860], ['nicegui', 'NiceGUI', 8080], ['fastapi', 'FastAPI', 8000], ['django', 'Django', 8000], ['flask', 'Flask', 5000], ['dash', 'Dash', 8050], ['bottle', 'Bottle', 8080]];
const NODE_WEB = [['vite', 5173], ['next', 3000], ['react-scripts', 3000], ['@angular/cli', 4200], ['nuxt', 3000], ['astro', 4321], ['express', 3000], ['koa', 3000], ['fastify', 3000], ['svelte', 5173], ['vue', 5173]];

const importRe = name => new RegExp('^\\s*(?:import|from)\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'm');

function pyInfo(root) {
  const files = pyFiles(root);
  const reqs = (readText(path.join(root, 'requirements.txt')) + readText(path.join(root, 'pyproject.toml'))).toLowerCase();
  if (!files.length && !reqs) return null;
  const src = files.map(f => readText(f, 60000)).join('\n');
  const uses = n => importRe(n).test(src) || new RegExp('(^|[\\s"\'])' + n.toLowerCase() + '([\\s=<>~"\',\\[]|$)', 'm').test(reqs);
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const pref = ['main.py', 'app.py', 'run.py', 'gui.py', '__main__.py', 'manage.py'];
  let entry = pref.find(n => has(root, n));
  if (!entry) { const withMain = files.find(f => /__name__\s*==\s*['"]__main__['"]/.test(readText(f, 60000))); entry = withMain ? rel(withMain) : files[0] ? rel(files[0]) : null; }
  const out = [];
  const gui = PY_GUI.find(([n]) => uses(n));
  if (gui) out.push({ kind: 'desktop', stack: gui[1], run: entry ? PY + ' ' + entry : null, entry, evidence: ['Python usa ' + gui[0]] });
  const web = PY_WEB.find(([n]) => uses(n));
  if (web) {
    const mod = entry ? entry.replace(/\.py$/, '').replace(/\//g, '.') : 'main';
    let run = entry ? PY + ' ' + entry : null;
    if (web[0] === 'django' && has(root, 'manage.py')) run = PY + ' manage.py runserver';
    else if (web[0] === 'streamlit' && entry) run = 'streamlit run ' + entry;
    else if (web[0] === 'fastapi') run = `uvicorn ${mod}:app --port 8000`;
    else if (web[0] === 'flask' && entry && !/app\.run\(/.test(readText(path.join(root, entry), 60000))) run = `flask --app ${mod} run`;
    out.push({ kind: 'web', stack: web[1], run, url: 'http://localhost:' + web[2], entry, evidence: ['Python usa ' + web[0]] });
  }
  if (!out.length && entry) out.push({ kind: 'console', stack: 'Python', run: PY + ' ' + entry, entry, evidence: ['Python sin librerías de interfaz'] });
  return out;
}

function nodeInfo(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const sc = pkg.scripts || {};
  const out = [];
  if (deps.electron) out.push({ kind: 'desktop', stack: 'Electron', run: sc.start ? 'npm start' : 'npx electron .', evidence: ['package.json: electron'] });
  if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli'] || has(root, 'src-tauri')) out.push({ kind: 'desktop', stack: 'Tauri', run: 'npm run tauri dev', evidence: ['Tauri'] });
  if (!deps.electron) {
    const hit = NODE_WEB.find(([d]) => deps[d]);
    const run = sc.dev ? 'npm run dev' : sc.start ? 'npm start' : null;
    if (hit || run) out.push({ kind: 'web', stack: hit ? hit[0] : 'Node', run, url: 'http://localhost:' + (hit ? hit[1] : 3000), evidence: ['package.json: ' + (hit ? hit[0] : 'scripts')] });
  }
  return out;
}

function dotnetInfo(root) {
  let f;
  try { f = fs.readdirSync(root).find(n => n.endsWith('.csproj')); } catch { return null; }
  if (!f) return null;
  const t = readText(path.join(root, f), 20000);
  if (/UseWPF/i.test(t)) return [{ kind: 'desktop', stack: 'WPF', run: 'dotnet run', evidence: [f + ': UseWPF'] }];
  if (/UseWindowsForms/i.test(t)) return [{ kind: 'desktop', stack: 'WinForms', run: 'dotnet run', evidence: [f + ': UseWindowsForms'] }];
  return [{ kind: 'console', stack: '.NET', run: 'dotnet run', evidence: [f] }];
}

const PRIORITY = { desktop: 0, web: 1, console: 2 };

function detect(root) {
  const found = [...(nodeInfo(root) || []), ...(pyInfo(root) || []), ...(dotnetInfo(root) || [])];
  if (!found.length && has(root, 'index.html')) found.push({ kind: 'web', stack: 'HTML estático', run: null, url: pathToFileURL(path.join(root, 'index.html')).href, evidence: ['index.html en la raíz'] });
  if (!found.length) return { kind: 'unknown', stack: null, run: null, url: null, evidence: [], alternatives: [] };
  found.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const [best, ...alternatives] = found;
  return { ...best, alternatives };
}

const LABEL = { web: 'aplicación web', desktop: 'aplicación de escritorio', console: 'programa de consola', unknown: 'desconocido' };

function describe(info) {
  const L = [`Tipo: ${LABEL[info.kind]}${info.stack ? ' (' + info.stack + ')' : ''}`];
  if (info.run) L.push('Ejecutar: ' + info.run);
  if (info.url) L.push('URL probable: ' + info.url);
  if (info.evidence.length) L.push('Evidencia: ' + info.evidence.join('; '));
  if (info.alternatives && info.alternatives.length) L.push('También parece: ' + info.alternatives.map(a => `${LABEL[a.kind]} (${a.stack})`).join(', '));
  if (info.kind === 'console') L.push('No tiene ventana: pruébalo con run_command.');
  if (info.kind === 'unknown') L.push('No pude deducir cómo ejecutarlo. Pregunta al usuario o usa test_open con command/url.');
  return L.join('\n');
}

module.exports = { detect, describe };
