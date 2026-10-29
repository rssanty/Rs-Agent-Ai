const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROVIDERS, chat, listModels } = require('./providers');
const tools = require('./tools');
const perms = require('./perms');
const backup = require('./backup');
const diff = require('./diff');
const compact = require('./compact');
const bt = require('./betatester');
const { execFile } = require('child_process');

app.setName('Rs-Agent-Ai');
app.setPath('userData', path.join(app.getPath('appData'), 'agente-ia'));

let win, workspace = null, abort = null;
const histories = { chat: [], work: [] };
const meta = { chat: null, work: null };
const pending = new Map();
const keysFile = () => path.join(app.getPath('userData'), 'keys.json');
const chatsDir = () => path.join(app.getPath('userData'), 'chats');
const backupsDir = () => path.join(app.getPath('userData'), 'backups');
const sessionAllow = new Set();
let btAllow = false;
const gitChecked = new Set();
const enc = s => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s)).toString('base64');
const dec = v => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString());

function readKeys() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(keysFile(), 'utf8')); } catch {}
  const out = {};
  for (const [p, v] of Object.entries(raw)) out[p] = typeof v === 'string' ? { active: 'principal', items: { principal: v } } : v;
  return out;
}
function writeJson(f, data, mode) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(data), mode ? { mode } : undefined);
  fs.renameSync(f + '.tmp', f);
}
const writeKeys = k => writeJson(keysFile(), k, 0o600);
function keyOrder(p) {
  const k = readKeys()[p];
  if (!k) return [];
  return [k.active, ...Object.keys(k.items).filter(n => n !== k.active)].filter(n => k.items[n]);
}
const getKey = (p, name) => { const k = readKeys()[p]; return k && k.items[name] ? dec(k.items[name]) : null; };
function setActive(p, name) { const k = readKeys(); if (k[p]) { k[p].active = name; writeKeys(k); } }

function createWindow() {
  win = new BrowserWindow({ icon: path.join(__dirname, 'build', 'icon.png'), width: 1280, height: 800, minWidth: 960, minHeight: 560, title: 'Rs-Agent-Ai', autoHideMenuBar: true, backgroundColor: '#F6F6F4', titleBarStyle: 'hidden', titleBarOverlay: { color: '#F6F6F4', symbolColor: '#1B1B1A', height: 52 }, webPreferences: { autoplayPolicy: 'no-user-gesture-required', preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile('renderer/index.html');
}

const emit = e => win.webContents.send('agent:event', e);

function contextFile(provider) {
  for (const name of [PROVIDERS[provider].ctx, 'AGENTS.md', 'AGENT.md']) {
    const f = path.join(workspace, name);
    if (fs.existsSync(f)) return { name, text: fs.readFileSync(f, 'utf8') };
  }
  return null;
}

const SEED = [
  { id: 'revisar', name: 'Revisor de código', cmd: 'revisar', desc: 'Revisa cambios y señala errores, estilo y riesgos.', text: 'Actúa como revisor de código: revisa el código o los cambios indicados, señala errores, problemas de estilo y riesgos, y propone correcciones concretas ordenadas por gravedad.', enabled: false },
  { id: 'resumen', name: 'Resumen de reuniones', cmd: 'resumen', desc: 'Convierte notas en acuerdos y tareas.', text: 'Convierte las notas de reunión en: resumen breve, acuerdos y tareas con responsable y fecha si aparecen.', enabled: false },
  { id: 'correo', name: 'Redactor de correos', cmd: 'correo', desc: 'Escribe correos claros con el tono que elijas.', text: 'Redacta correos claros y concisos con el tono que pida el usuario. Si falta contexto importante, pregunta antes de redactar.', enabled: false },
  { id: 'traducir', name: 'Traductor técnico', cmd: 'traducir', desc: 'Traduce documentación sin perder los términos.', text: 'Traduce documentación técnica conservando los términos técnicos, el código y el formato originales.', enabled: false }
];
const agentsDir = () => path.join(app.getPath('userData'), 'agents');
const AGENT_FILES = { anthropic: 'claude.md', openai: 'chatgpt.md', gemini: 'gemini.md', deepseek: 'deepseek.md', nvidia: 'nvidia.md', openrouter: 'openrouter.md', custom: 'otro.md' };
function readAgent(id) {
  try { return fs.readFileSync(path.join(agentsDir(), AGENT_FILES[id]), 'utf8'); } catch { return ''; }
}
function agentBlock(provider) {
  const t = AGENT_FILES[provider] ? readAgent(provider).trim() : '';
  return t ? `\n\n--- Agente (${AGENT_FILES[provider]}) ---\n${t}` : '';
}
const pricesFile = () => path.join(app.getPath('userData'), 'prices.json');
function readPrices() {
  try { const o = JSON.parse(fs.readFileSync(pricesFile(), 'utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
const priceFor = (provider, model) => { const p = readPrices(); return p[provider + ':' + model] || p[provider + ':*'] || null; };
const skillsFile = () => path.join(app.getPath('userData'), 'skills.json');
function readSkills() {
  try { const a = JSON.parse(fs.readFileSync(skillsFile(), 'utf8')); if (Array.isArray(a)) return a; } catch {}
  return SEED;
}
function skillsBlock(ids) {
  if (!Array.isArray(ids) || !ids.length) return '';
  const sel = readSkills().filter(k => ids.includes(k.id));
  return sel.length ? '\n\n--- Skills activas ---\n' + sel.map(k => `## ${k.name}\n${k.text}`).join('\n\n') : '';
}

function systemPrompt(provider, mode, tab, extra) {
  if (tab === 'chat') return `Eres un asistente conversacional con una herramienta: run_command, que ejecuta comandos de shell en el sistema del usuario (${process.platform}). Úsala solo cuando haga falta; cada comando requiere aprobación. Directorio por defecto: ${os.homedir()}; usa cwd para otro. Responde en el idioma del usuario. Sé conciso.${agentBlock(provider)}${extra}`;
  const ctx = contextFile(provider);
  const modeText = {
    plan: 'MODO PLAN: solo puedes leer. Investiga y entrega un plan paso a paso; no modifiques nada.',
    test: 'MODO BETATESTER: prueba el proyecto como un usuario real. Flujo: 1) test_detect para saber si es web, de escritorio o de consola. 2) test_open lanza la app (web: levanta el servidor y abre una ventana; escritorio: ejecuta y enfoca). 3) test_look devuelve el texto visible con su celda (columna,fila) en una cuadrícula; con zoom afinas una zona. 4) Actúa con test_click (item o cell), test_type, test_key y test_scroll; tras cada acción recibes la pantalla actualizada. 5) Explora las funciones, prueba casos límite y entradas inválidas, y al terminar guarda test_report con los errores y los pasos para reproducirlos, y cierra con test_close. En web y Electron test_look lee el DOM: los iconos salen con su nombre y los errores de consola llegan solos (test_console muestra todos). En otras apps de escritorio los iconos sin texto no salen por OCR: ubícalos por celda y verifica con zoom. Las apps de consola se prueban con run_command. También puedes leer el código. No modifiques archivos del proyecto. Funciona en Windows y Linux (X11 con xdotool, imagemagick y tesseract).',
    build: 'MODO BUILDER: ejecuta el trabajo con las herramientas. Cada cambio y comando requiere aprobación del usuario.'
  }[mode] || '';
  return [
    'Eres un agente de programación que trabaja dentro de una carpeta del usuario.',
    `Carpeta de trabajo: ${workspace}. Sistema: ${process.platform}. Usa rutas relativas.`,
    modeText,
    'run_command puede ejecutarse en cualquier ruta del sistema con el parámetro cwd; sin cwd usa la carpeta de trabajo.',
    'Responde en el idioma del usuario. Sé conciso.',
    agentBlock(provider),
    ctx ? `\n--- Instrucciones del proyecto (${ctx.name}) ---\n${ctx.text}` : '',
    extra
  ].join('\n');
}

function previewFor(c, root) {
  try {
    const a = c.args;
    if (bt.isTool(c.name)) return [{ t: ' ', s: bt.describe(c.name, a) }, { t: '!', s: 'Controla el mouse y el teclado sobre la app. Al permitir, el Betatester queda autorizado hasta cerrar Rs-Agent-Ai.' }];
    if (c.name === 'run_command') return [{ t: ' ', s: 'cwd: ' + (a.cwd || root) }, { t: '!', s: 'Los comandos no se pueden deshacer.' }];
    if (c.name === 'write_file') {
      const f = tools.safe(root, a.path);
      return fs.existsSync(f) ? diff.diff(fs.readFileSync(f, 'utf8'), a.content) : diff.added(a.content);
    }
    if (c.name === 'edit_file') {
      const old = fs.readFileSync(tools.safe(root, a.path), 'utf8');
      if (old.split(a.old).length - 1 !== 1) return [{ t: '!', s: 'El fragmento no coincide exactamente una vez.' }];
      return diff.diff(old, old.replace(a.old, () => a.new));
    }
    if (c.name === 'delete_path') return diff.listing(tools.safe(root, a.path), root);
  } catch {}
  return null;
}

function gitWarn(root, chatId) {
  if (gitChecked.has(chatId) || !fs.existsSync(path.join(root, '.git'))) return;
  gitChecked.add(chatId);
  execFile('git', ['status', '--porcelain'], { cwd: root }, (err, out) => {
    if (!err && out.trim()) emit({ type: 'notice', text: 'Esta carpeta es un repositorio git con cambios sin commit.' });
  });
}

function saveChat(tab) {
  const m = meta[tab];
  if (!m) return;
  const data = { ...m, tab, workspace: tab === 'work' ? workspace : null, updated: Date.now(), history: histories[tab] };
  fs.mkdirSync(chatsDir(), { recursive: true });
  const f = path.join(chatsDir(), m.id + '.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(data));
  fs.renameSync(f + '.tmp', f);
}

function view(history) {
  const out = [], results = {};
  for (const m of history) if (m.role === 'tool') results[m.id] = m.content;
  for (const m of history) {
    if (m.role === 'user') out.push(m.summary ? { kind: 'note', text: 'Chat compactado: la conversación anterior se resumió.' } : { kind: 'user', text: m.content });
    else if (m.role === 'assistant') {
      if (m.ack) continue;
      if (m.content) out.push({ kind: 'ai', text: m.content });
      for (const c of m.calls || []) {
        const t = String(results[c.id] ?? '');
        out.push({ kind: 'act', name: c.name, args: c.args, text: t, status: t.startsWith('Error:') ? 'error' : t.startsWith('El usuario rechazó') ? 'denied' : 'ok' });
      }
    }
  }
  return out;
}

ipcMain.handle('ws:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (!r.canceled) { workspace = r.filePaths[0]; histories.work = []; meta.work = null; }
  return workspace;
});

ipcMain.handle('providers:list', () => {
  const keys = readKeys();
  return Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => {
    const names = Object.keys(keys[k]?.items || {});
    return [k, { label: v.label, ctx: v.ctx, models: v.models, hasKey: names.length > 0, keys: { names, active: keys[k]?.active || '' }, reasoning: !!v.reasoning || v.format === 'anthropic' }];
  }));
});

ipcMain.handle('key:set', (_e, provider, name, key) => {
  const k = readKeys();
  k[provider] ||= { active: name, items: {} };
  k[provider].items[name] = enc(key);
  k[provider].active = name;
  writeKeys(k);
  return true;
});
ipcMain.handle('key:use', (_e, provider, name) => { setActive(provider, name); return true; });
ipcMain.handle('key:del', (_e, provider, name) => {
  const k = readKeys();
  if (!k[provider]) return true;
  delete k[provider].items[name];
  const left = Object.keys(k[provider].items);
  if (!left.length) delete k[provider];
  else if (k[provider].active === name) k[provider].active = left[0];
  writeKeys(k);
  return true;
});

ipcMain.handle('models:list', async (_e, provider, customUrl) => {
  const name = keyOrder(provider)[0];
  const key = name ? getKey(provider, name) : null;
  if (!key) return { error: 'Falta la API key.' };
  try { return { models: await listModels(provider, key, customUrl) }; } catch (e) { return { error: e.message }; }
});

ipcMain.handle('chats:list', (_e, tab) => {
  const out = [];
  try {
    for (const f of fs.readdirSync(chatsDir())) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(chatsDir(), f), 'utf8'));
        if ((!tab || d.tab === tab) && Array.isArray(d.history)) out.push({ id: d.id, title: d.title, updated: d.updated, tab: d.tab, provider: d.provider, pinned: !!d.pinned });
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.updated - a.updated);
});

ipcMain.handle('chats:open', (_e, id) => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(chatsDir(), path.basename(id) + '.json'), 'utf8'));
    if (!Array.isArray(d.history) || !histories[d.tab]) return { error: 'Chat dañado.' };
    histories[d.tab] = d.history;
    meta[d.tab] = { id: d.id, title: d.title, provider: d.provider, model: d.model, pinned: !!d.pinned, usage: d.usage || { input: 0, output: 0, cost: null } };
    if (d.tab === 'work') workspace = d.workspace && fs.existsSync(d.workspace) ? d.workspace : null;
    return { id: d.id, tab: d.tab, provider: d.provider, model: d.model, workspace: d.tab === 'work' ? workspace : null, usage: meta[d.tab].usage, view: view(d.history) };
  } catch { return { error: 'No se pudo abrir el chat.' }; }
});

ipcMain.handle('chats:delete', (_e, id) => {
  try { fs.unlinkSync(path.join(chatsDir(), path.basename(id) + '.json')); } catch {}
  for (const t of ['chat', 'work']) if (meta[t]?.id === id) { meta[t] = null; histories[t] = []; }
  return true;
});

ipcMain.handle('changes:undo', () => {
  const id = meta.work?.id;
  if (!id || !workspace) return { error: 'No hay un chat de trabajo activo.' };
  try {
    const r = backup.undoLast(backupsDir(), id, workspace);
    return r ? { ok: true, tool: r.tool, rel: r.rel } : { none: true };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('perms:get', () => (workspace ? { text: perms.read(workspace) } : { error: 'Elige una carpeta de trabajo.' }));
ipcMain.handle('perms:set', (_e, text) => (workspace ? perms.save(workspace, text) : { error: 'Elige una carpeta de trabajo.' }));
function patchChat(id, fn) {
  const f = path.join(chatsDir(), path.basename(id) + '.json');
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  fn(d);
  fs.writeFileSync(f + '.tmp', JSON.stringify(d));
  fs.renameSync(f + '.tmp', f);
  for (const t of ['chat', 'work']) if (meta[t]?.id === id) fn(meta[t]);
}
ipcMain.handle('chats:rename', (_e, id, title) => {
  const t = String(title).trim().slice(0, 80);
  if (!t) return { error: 'El nombre no puede estar vacío.' };
  try { patchChat(id, d => { d.title = t; }); return { ok: true }; } catch { return { error: 'No se pudo renombrar.' }; }
});
ipcMain.handle('chats:pin', (_e, id, pinned) => {
  try { patchChat(id, d => { d.pinned = !!pinned; }); return { ok: true }; } catch { return { error: 'No se pudo fijar.' }; }
});
ipcMain.on('theme:set', (_e, t) => {
  try { win.setTitleBarOverlay(t === 'dark' ? { color: '#161618', symbolColor: '#F2F2EF', height: 52 } : { color: '#F6F6F4', symbolColor: '#1B1B1A', height: 52 }); } catch {}
});
ipcMain.handle('agents:list', () => Object.keys(PROVIDERS).map(id => ({ id, file: AGENT_FILES[id], size: readAgent(id).trim().length })));
ipcMain.handle('agents:get', (_e, id) => (AGENT_FILES[id] ? readAgent(id) : ''));
ipcMain.handle('agents:save', (_e, id, text) => {
  if (!AGENT_FILES[id]) return { error: 'Proveedor inválido.' };
  fs.mkdirSync(agentsDir(), { recursive: true });
  const f = path.join(agentsDir(), AGENT_FILES[id]);
  fs.writeFileSync(f + '.tmp', String(text).slice(0, 30000));
  fs.renameSync(f + '.tmp', f);
  return { ok: true };
});
ipcMain.handle('agents:open', () => { fs.mkdirSync(agentsDir(), { recursive: true }); return shell.openPath(agentsDir()); });
ipcMain.handle('prices:get', () => readPrices());
ipcMain.handle('prices:set', (_e, obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'Formato inválido.' };
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 200)) {
    if (!/^[a-z0-9_-]+:.+$/i.test(k)) return { error: `Clave inválida: "${k}". Usa proveedor:modelo (o proveedor:*).` };
    const i = Number(v?.in), o = Number(v?.out);
    if (!(i >= 0) || !(o >= 0)) return { error: `Precios inválidos en "${k}".` };
    out[k] = { in: i, out: o };
  }
  writeJson(pricesFile(), out);
  return { ok: true };
});
let fileCache = { root: null, t: 0, list: [] };
ipcMain.handle('ws:files', (_e, q) => {
  if (!workspace) return [];
  const now = Date.now();
  if (fileCache.root !== workspace || now - fileCache.t > 4000) {
    const rules = perms.load(workspace).rules;
    fileCache = { root: workspace, t: now, list: tools.listFiles(workspace, rel => perms.isBlocked(rules, rel)) };
  }
  const s = String(q || '').toLowerCase();
  const scored = [];
  for (const rel of fileCache.list) {
    const l = rel.toLowerCase(), base = l.split('/').pop();
    const sc = !s ? 3 : base.startsWith(s) ? 0 : base.includes(s) ? 1 : l.includes(s) ? 2 : -1;
    if (sc >= 0) scored.push([sc, rel.length, rel]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 8).map(x => x[2]);
});
ipcMain.handle('skills:list', () => readSkills());
ipcMain.handle('skills:save', (_e, list) => {
  if (!Array.isArray(list)) return { error: 'Formato inválido.' };
  const clean = list.slice(0, 100).filter(k => k && typeof k === 'object').map(k => ({ id: String(k.id).slice(0, 40), name: String(k.name).slice(0, 80), cmd: String(k.cmd).replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 30), desc: String(k.desc || '').slice(0, 200), text: String(k.text).slice(0, 8000), enabled: !!k.enabled }));
  writeJson(skillsFile(), clean);
  return { ok: true };
});
ipcMain.handle('ws:tree', (_e, rel) => {
  if (!workspace) return { entries: [] };
  try {
    const dir = tools.safe(workspace, rel || '.');
    const rules = perms.load(workspace).rules;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !['.git', 'node_modules'].includes(d.name))
      .filter(d => !perms.isBlocked(rules, path.relative(workspace, path.join(dir, d.name)).split(path.sep).join('/')))
      .map(d => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    return { entries };
  } catch { return { entries: [] }; }
});
ipcMain.handle('chat:reset', (_e, tab) => { if (tab in histories) { histories[tab] = []; meta[tab] = null; } });
ipcMain.on('agent:approve', (_e, id, ok, scope) => { pending.get(id)?.({ ok, scope }); pending.delete(id); });
ipcMain.on('agent:stop', () => { abort?.abort(); for (const r of pending.values()) r({ ok: false }); pending.clear(); });

let running = false;
ipcMain.handle('agent:send', async (_e, text, s) => {
  if (running) return emit({ type: 'error', text: 'Ya hay una tarea en curso. Espera o pulsa Detener.' });
  if (!s || typeof text !== 'string' || !PROVIDERS[s.provider] || !histories[s.tab]) return emit({ type: 'error', text: 'Solicitud inválida.' });
  running = true;
  try { return await runAgent(text, s); } finally { running = false; }
});

async function runAgent(text, s) {
  if (s.tab === 'work' && !workspace) return emit({ type: 'error', text: 'Elige una carpeta de trabajo primero.' });
  const order = keyOrder(s.provider);
  if (!order.length) return emit({ type: 'error', text: 'Falta la API key de ' + PROVIDERS[s.provider].label });
  abort = new AbortController();
  const chatTab = s.tab === 'chat';
  const mode = chatTab ? 'build' : s.mode;
  const allowed = chatTab ? tools.onlyCommand() : tools.toolsFor(mode);
  const root = chatTab ? os.homedir() : workspace;
  const history = histories[s.tab];
  if (!meta[s.tab]) { meta[s.tab] = { id: Date.now().toString(36), title: text.slice(0, 50) }; emit({ type: 'chat', id: meta[s.tab].id }); }
  meta[s.tab].provider = s.provider;
  meta[s.tab].model = s.model;
  meta[s.tab].usage ||= { input: 0, output: 0, cost: null };
  history.push({ role: 'user', content: text });
  const maxSteps = Math.min(100, Math.max(1, parseInt(s.maxSteps) || 25));
  const compactAt = Math.max(0, parseInt(s.compactAt) || 0);
  const turn = { input: 0, output: 0, est: false };
  let ki = 0, permWarned = false, lastSig = '', streak = 0, ended = false, compactFailed = false;

  const base = () => ({
    provider: s.provider, model: s.model, key: getKey(s.provider, order[ki]), effort: s.effort, signal: abort.signal, customUrl: s.customUrl,
    onRetry: r => emit({ type: 'notice', text: `Reintentando (${r.attempt}/4) en ${Math.round(r.wait / 1000)} s… (${r.status === 'red' ? 'sin conexión' : 'HTTP ' + r.status})` })
  });
  const withFailover = async fn => {
    for (;;) {
      try { return await fn(); } catch (e) {
        if (ki + 1 < order.length && !abort.signal.aborted && /\b(401|402|403|429)\b|quota|credit|billing|insufficient|exceed|rate.?limit/i.test(e.message)) {
          ki++;
          setActive(s.provider, order[ki]);
          emit({ type: 'notice', text: `Key agotada o rechazada. Cambiando a "${order[ki]}".` });
          emit({ type: 'keys' });
          continue;
        }
        throw e;
      }
    }
  };
  const addUsage = u => {
    turn.input += u.input;
    turn.output += u.output;
    turn.est ||= !!u.est;
    const tot = meta[s.tab].usage;
    tot.input += u.input;
    tot.output += u.output;
    const pr = priceFor(s.provider, s.model);
    if (pr) tot.cost = (tot.cost || 0) + (u.input * pr.in + u.output * pr.out) / 1e6;
    emit({ type: 'usage', turn: { ...turn }, total: { input: tot.input, output: tot.output, cost: tot.cost } });
  };
  const maybeCompact = async () => {
    if (!compactAt || compactFailed || compact.estimate(history) <= compactAt) return;
    const pl = compact.plan(history);
    if (!pl) return;
    const tr = compact.transcript(pl.old);
    try {
      const r = await withFailover(() => chat({ ...base(), system: 'Eres un asistente que resume conversaciones de trabajo con precisión.', history: [{ role: 'user', content: 'Resume esta conversación conservando: objetivo, decisiones, archivos creados o modificados, estado actual y pendientes. Máximo 400 palabras.\n\n' + tr }], tools: [], effort: 'auto' }));
      const summary = (r.text || '').trim();
      if (!summary) throw new Error('resumen vacío');
      addUsage(r.usage && r.usage.known ? r.usage : { input: Math.ceil(tr.length / 4), output: Math.ceil(summary.length / 4), est: true });
      compact.apply(history, pl.split, summary);
      saveChat(s.tab);
      emit({ type: 'notice', text: `Chat compactado: ${pl.old.length} mensajes resumidos.` });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      compactFailed = true;
      emit({ type: 'notice', text: 'No se pudo compactar el chat: ' + e.message });
    }
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      await maybeCompact();
      emit({ type: 'thinking' });
      const sys = systemPrompt(s.provider, mode, s.tab, skillsBlock(s.skills));
      const r = await withFailover(() => chat({ ...base(), system: sys, history, tools: allowed, onToken: t => emit({ type: 'delta', text: t }) }));
      addUsage(r.usage && r.usage.known ? r.usage : { input: Math.ceil((sys.length + JSON.stringify(history).length) / 4), output: Math.ceil(((r.text || '').length + JSON.stringify(r.calls).length) / 4), est: true });
      emit({ type: 'assistant_end' });
      const results = [];
      let loopHit = false;
      for (const [i, c] of r.calls.entries()) {
        if (abort.signal.aborted) throw Object.assign(new Error('Detenido.'), { name: 'AbortError' });
        const uid = step + '-' + i;
        const readOnly = tools.READ_ONLY.has(c.name);
        const def = tools.find(c.name);
        const detail = c.args.command || c.args.path || c.args.query || c.args.pattern || '';
        const logIt = st => { if (!chatTab) perms.log(root, st, c.name, detail); };
        let out, status = 'ok', problem = null, needs = false, canRemember = false, blocked = false, rulesNow = perms.EMPTY;
        const sig = c.name + JSON.stringify(c.args);
        streak = sig === lastSig ? streak + 1 : 1;
        lastSig = sig;
        if (!def) problem = 'Herramienta desconocida: ' + c.name;
        else if (c.bad) problem = 'Los argumentos llegaron incompletos o no son JSON válido. Vuelve a enviar la llamada completa.';
        else if (!allowed.some(t => t.name === c.name)) problem = 'No permitido en este modo.';
        else {
          const missing = (def.parameters.required || []).filter(k => c.args[k] == null);
          if (missing.length) problem = 'Faltan argumentos: ' + missing.join(', ') + '. Envíalos como JSON con esos nombres exactos.';
        }
        if (!problem && streak >= (bt.isTool(c.name) ? (c.name === 'test_look' || c.name === 'test_console' ? 10 : 6) : 3)) { problem = 'Acción repetida varias veces seguidas con los mismos argumentos; se detuvo para evitar un bucle.'; loopHit = true; }
        if (!problem) {
          const P = chatTab ? { rules: perms.EMPTY, error: null } : perms.load(root);
          rulesNow = P.rules;
          if (P.error && !permWarned) { permWarned = true; emit({ type: 'notice', text: 'permisos.json inválido (' + P.error + '). Se preguntará todo.' }); }
          let decision = 'default';
          try { decision = perms.evaluate(P.rules, c.name, c.args, root); } catch {}
          if (decision === 'block') { problem = 'Bloqueado por las reglas de permisos.'; blocked = true; }
          else {
            canRemember = c.name === 'run_command' && perms.canRemember(c.args.command);
            const sess = canRemember && sessionAllow.has(c.args.command);
            if (readOnly) needs = false;
            else if (bt.isTool(c.name)) { needs = bt.needsApproval(c.name) && !btAllow; canRemember = false; }
            else if (c.name === 'delete_path') needs = true;
            else if (c.name === 'run_command') needs = !(decision === 'allow' || sess);
            else needs = decision === 'ask' ? true : !(decision === 'allow' || (!chatTab && s.autoEdits));
          }
        }
        let isNew = false;
        if (c.name === 'write_file' && !problem) { try { isNew = !fs.existsSync(tools.safe(root, c.args.path)); } catch {} }
        emit({ type: 'action', id: uid, name: c.name, args: c.args, isNew, ask: needs, preview: needs ? previewFor(c, root) : null, canRemember: needs && canRemember, sessionOnly: bt.isTool(c.name), desc: bt.isTool(c.name) ? bt.describe(c.name, c.args) : undefined });
        if (problem) { out = 'Error: ' + problem; status = 'error'; if (blocked) logIt('bloqueada'); }
        else {
          let n = null;
          try {
            let ok = true, scope = null;
            if (needs) { const ans = await new Promise(res => pending.set(uid, res)); ok = ans.ok; scope = ans.scope; if (ok && bt.isTool(c.name)) btAllow = true; }
            if (!ok) { out = 'El usuario rechazó esta acción.'; status = 'denied'; logIt('rechazada'); }
            else {
              if (needs && canRemember && scope) {
                if (bt.isTool(c.name)) btAllow = true;
                else if (scope === 'always' && !chatTab) perms.addCommand(root, c.args.command);
                else sessionAllow.add(c.args.command);
              }
              logIt(needs ? 'aprobada' : 'permitida por regla');
              if (perms.MUT.has(c.name) && !chatTab) {
                gitWarn(root, meta[s.tab].id);
                n = backup.record(backupsDir(), meta[s.tab].id, root, c.name, tools.safe(root, c.args.path), c.args.path);
              }
              out = String(await tools.run(c.name, c.args, root, abort.signal, { skip: rel => perms.isBlocked(rulesNow, rel) }));
            }
          } catch (err) {
            out = 'Error: ' + err.message; status = 'error';
            if (n) backup.discard(backupsDir(), meta[s.tab].id, n);
          }
        }
        emit({ type: 'action_done', id: uid, status, text: out.slice(0, 3000), name: c.name, path: c.args.path });
        results.push({ role: 'tool', id: c.id, content: out });
      }
      if (abort.signal.aborted) throw Object.assign(new Error('Detenido.'), { name: 'AbortError' });
      history.push({ role: 'assistant', content: r.text, calls: r.calls, raw: r.raw }, ...results);
      saveChat(s.tab);
      if (loopHit) { emit({ type: 'notice', text: 'Bucle detectado: el modelo repitió la misma acción 3 veces. Se detuvo el turno.' }); ended = true; break; }
      if (!r.calls.length) { ended = true; break; }
    }
    if (!ended) emit({ type: 'notice', text: `Se alcanzó el límite de ${maxSteps} pasos. Escribe "continúa" para seguir.` });
    emit({ type: 'done' });
  } catch (err) {
    emit({ type: 'assistant_end' });
    emit({ type: 'error', text: err.name === 'AbortError' ? 'Detenido.' : err.message });
  } finally {
    saveChat(s.tab);
  }
}

app.on('before-quit', () => bt.shutdown());
app.whenReady().then(() => {
  createWindow();
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showMessageBox(win, { type: 'warning', title: 'Rs-Agent-Ai', message: 'Este sistema no tiene almacén seguro de claves (keyring).', detail: 'Tus API keys se guardarán sin cifrar en el disco. En Linux instala gnome-keyring o kwallet.' }).catch(() => {});
  }
});
app.on('window-all-closed', () => app.quit());
