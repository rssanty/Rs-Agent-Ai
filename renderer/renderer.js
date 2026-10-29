const $ = id => document.getElementById(id);
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('rs.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('rs.' + k, JSON.stringify(v)); } catch {} }
};
const h = (tag, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const ICONS = {
  plus: ['M12 5v14M5 12h14'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
  chat: ['M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z'],
  spark: ['M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z'],
  folder: ['M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  gear: ['c:12,12,3', 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  stop: ['M7 7h10v10H7z'],
  chevron: ['M6 9l6 6 6-6'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3z', 'M12 13v7'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  list: ['M9 6h11M9 12h11M9 18h11', 'M4 6h.01M4 12h.01M4 18h.01'],
  check: ['M5 12l5 5 9-10'],
  bot: ['M12 3v3', 'M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z', 'M9 13h.01M15 13h.01']
};
function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  for (const d of ICONS[name]) {
    if (d.startsWith('c:')) {
      const [cx, cy, r] = d.slice(2).split(',');
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      s.append(c);
    } else {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
  }
  return s;
}

const PROV_COLOR = { anthropic: '#C2603E', openai: '#1F8A70', gemini: '#9A66E8', deepseek: '#2B50D8', nvidia: '#76B900', openrouter: '#8A8A86', custom: '#8A8A86' };
const PROV_NAME = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek', nvidia: 'NVIDIA', openrouter: 'OpenRouter', custom: 'Otro proveedor' };
const dotEl = id => { const d = h('span', 'dot'); d.style.background = PROV_COLOR[id] || '#8A8A86'; return d; };

let providers = {}, view = 'home', tab = 'chat', mode = 'build', busy = false, cur = null, skills = [], recents = [], wsPath = null, cfgSec = 'prov';
const active = new Set(), changed = new Set(), openDirs = new Set(), acts = {};
const ids = { chat: null, work: null };
const L = () => $(tab === 'work' ? 'logWork' : 'logChat');
const scroll = () => { L().scrollTop = L().scrollHeight; };
const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  if (window.api.setTheme) api.setTheme(t);
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.th === t));
}
document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => { setTheme(b.dataset.th); if (view === 'config') renderConfig(); });

function setAi(el, raw) {
  el.replaceChildren();
  raw.split('```').forEach((part, i) => {
    if (i % 2) { const nl = part.indexOf('\n'); el.append(h('pre', 'code', nl >= 0 ? part.slice(nl + 1).replace(/\n$/, '') : part)); }
    else if (part.trim()) el.append(h('div', 'txt', part.replace(/^\n+|\n+$/g, '')));
  });
}
function addMsg(cls, text) {
  const d = h('div', cls === 'note' ? 'note' : 'msg ' + cls);
  if (cls === 'ai') setAi(d, text); else d.textContent = text;
  L().append(d);
  scroll();
  return d;
}

const VIEWS = { home: 'vHome', chat: 'vChat', work: 'vChat', skills: 'vSkills', agent: 'vAgent', config: 'vConfig' };
function go(v) {
  if (view === 'agent' && v !== 'agent') flushAgent();
  if ((v === 'chat' || v === 'work') && busy && (v === 'work' ? 'work' : 'chat') !== tab) return;
  view = v;
  for (const id of new Set(Object.values(VIEWS))) $(id).hidden = id !== VIEWS[v];
  if (v === 'chat' || v === 'work') { tab = v === 'work' ? 'work' : 'chat'; applyTab(); }
  syncChrome();
  renderNav();
  if (v === 'home') renderHome();
  if (v === 'skills') renderSkills();
  if (v === 'agent') renderAgent();
  if (v === 'config') renderConfig();
}

function syncChrome() {
  const inChat = view === 'chat' || view === 'work';
  document.querySelectorAll('.chatonly').forEach(e => { e.hidden = !inChat; });
  document.querySelectorAll('.workonly').forEach(e => { e.hidden = !(inChat && tab === 'work'); });
  if (!inChat) { $('pop').hidden = true; $('modeMenu').hidden = true; }
}

function renderWsChip() {
  const name = wsPath ? wsPath.split(/[\\/]/).filter(Boolean).pop() || wsPath : 'Sin carpeta';
  $('wsChip').replaceChildren(icon('folder', 16), h('span', '', name));
  $('wsChip').title = wsPath || 'Elige una carpeta';
}

function applyTab() {
  $('logChat').hidden = tab !== 'chat';
  $('logWork').hidden = tab !== 'work';
  $('tree').hidden = tab !== 'work';
  cur = null;
  hideAc();
  syncChrome();
  renderChips();
  renderPill();
  renderWsChip();
  setUsage(usageByTab[tab]);
  if (tab === 'work') renderTree();
}

function navBtn(v, label, ic) {
  const b = h('button', 'nav' + (view === v ? ' on' : ''));
  b.append(icon(ic), h('span', '', label));
  b.onclick = () => go(v);
  return b;
}
function renderNav() {
  $('nav').replaceChildren(navBtn('home', 'Inicio', 'home'), navBtn('chat', 'Chats', 'chat'), navBtn('skills', 'Skills', 'spark'), navBtn('agent', 'Agent', 'bot'), navBtn('work', 'Carpetas', 'folder'));
  $('navCfg').replaceChildren(navBtn('config', 'Configuración', 'gear'));
}

async function init() {
  setTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (api.platform === 'darwin') document.body.classList.add('mac');
  mode = store.get('mode', 'build');
  renderMode();
  $('newChat').append(icon('plus'), h('span', '', 'Nuevo chat'));
  $('newWork').append(icon('folder', 16), h('span', '', 'Nuevo chat de trabajo'));
  $('send').append(icon('arrow'));
  $('stop').append(icon('stop'));
  providers = await api.providers();
  skills = await api.skills();
  skills.forEach(s => { if (s.enabled) active.add(s.id); });
  $('provider').replaceChildren();
  for (const [k, v] of Object.entries(providers)) $('provider').add(new Option(v.label + (v.hasKey ? '' : ' (sin key)'), k));
  const pref = store.get('provider', null);
  $('provider').value = providers[pref] ? pref : Object.keys(providers).find(k => providers[k].hasKey) || 'anthropic';
  $('customUrl').value = store.get('customUrl', '');
  $('effort').value = store.get('effort', 'auto');
  syncProvider();
  renderNav();
  go('home');
  loadChats();
}

function renderPill() {
  const id = $('provider').value;
  const b = $('pill');
  b.replaceChildren(dotEl(id), h('span', 't', (PROV_NAME[id] || id) + ' · ' + ($('model').value || 'sin modelo')), icon('chevron', 16));
}
$('pill').onclick = e => { e.stopPropagation(); $('pop').hidden = !$('pop').hidden; };
document.addEventListener('click', e => {
  if (!$('pop').hidden && !$('pop').contains(e.target)) $('pop').hidden = true;
  if (!$('modeMenu').hidden && !$('modeMenu').contains(e.target)) $('modeMenu').hidden = true;
});

async function refreshProviders() {
  providers = await api.providers();
  for (const o of $('provider').options) o.text = providers[o.value].label + (providers[o.value].hasKey ? '' : ' (sin key)');
  refreshKeySel();
  renderPill();
  if (view === 'config') renderConfig();
  if (view === 'home') renderHome();
}

function refreshKeySel() {
  const k = providers[$('provider').value].keys;
  const s = $('keySel');
  s.replaceChildren();
  if (!k.names.length) s.add(new Option('sin keys', ''));
  k.names.forEach(n => s.add(new Option('🔑 ' + n, n)));
  s.value = k.active;
}
$('keySel').onchange = async () => {
  if (!$('keySel').value) return;
  await api.useKey($('provider').value, $('keySel').value);
  await refreshProviders();
  loadModels();
};

function fillList(models) {
  const l = $('modelList');
  l.replaceChildren();
  l.add(new Option(models.length ? models.length + ' modelos' : 'sin modelos', ''));
  models.forEach(m => l.add(new Option(m)));
  l.value = models.includes($('model').value) ? $('model').value : '';
}
$('modelList').onchange = () => { if ($('modelList').value) { $('model').value = $('modelList').value; renderPill(); } };
$('model').oninput = renderPill;
$('effort').onchange = () => store.set('effort', $('effort').value);

function syncProvider() {
  const id = $('provider').value;
  const p = providers[id];
  store.set('provider', id);
  fillList(p.models);
  $('model').value = p.models[0] || '';
  $('effort').disabled = !p.reasoning;
  $('customUrl').hidden = id !== 'custom';
  refreshKeySel();
  renderPill();
  loadModels();
}
async function loadModels() {
  const id = $('provider').value;
  if (!providers[id].hasKey) return;
  const r = await api.models(id, $('customUrl').value.trim());
  if (id !== $('provider').value) return;
  if (r.error) return addMsg('err', 'No se pudo listar modelos: ' + r.error);
  fillList(r.models);
}
$('refreshModels').onclick = loadModels;
$('customUrl').onchange = () => { store.set('customUrl', $('customUrl').value.trim()); loadModels(); };
$('provider').onchange = syncProvider;

const MODES = [
  { id: 'plan', name: 'Plan', desc: 'Solo lee y propone un plan', icon: 'list' },
  { id: 'build', name: 'Builder', desc: 'Edita archivos y ejecuta comandos', icon: 'pencil' },
  { id: 'test', name: 'Betatester', desc: 'Prueba el proyecto y reporta errores', icon: 'check' }
];
function renderMode() {
  const m = MODES.find(x => x.id === mode) || MODES[1];
  $('modeBtn').replaceChildren(icon(m.icon, 16), h('span', '', m.name), icon('chevron', 14));
  $('modeMenu').replaceChildren(...MODES.map(o => {
    const b = h('button', 'mitem' + (o.id === mode ? ' on' : ''));
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(o.id === mode));
    const t = h('div', 'mt');
    t.append(icon(o.icon, 16), h('strong', '', o.name));
    b.append(t, h('span', 'md', o.desc));
    b.onclick = () => { mode = o.id; store.set('mode', mode); $('modeMenu').hidden = true; renderMode(); };
    return b;
  }));
}
$('modeBtn').onclick = e => { e.stopPropagation(); $('modeMenu').hidden = !$('modeMenu').hidden; };

async function pickFolder() {
  const p = await api.pickFolder();
  if (!p) return;
  wsPath = p;
  $('logWork').replaceChildren();
  ids.work = null;
  usageByTab.work = null;
  changed.clear();
  openDirs.clear();
  go('work');
  renderTree();
  loadChats();
}

async function newChat(t) {
  if (busy) return;
  if (t === 'work' && !wsPath) return pickFolder();
  await api.reset(t);
  ids[t] = null;
  usageByTab[t] = null;
  $(t === 'work' ? 'logWork' : 'logChat').replaceChildren();
  if (t === 'work') changed.clear();
  go(t);
  loadChats();
}
$('newChat').onclick = () => newChat('chat');
$('newWork').onclick = () => newChat('work');

function renderChips() {
  const box = $('chips');
  box.replaceChildren();
  for (const s of skills) {
    if (!active.has(s.id)) continue;
    const c = h('span', 'chip');
    const x = h('button', 'chipx', '×');
    x.setAttribute('aria-label', 'Quitar skill');
    x.onclick = () => { active.delete(s.id); renderChips(); };
    c.append(icon('spark', 14), h('span', '', 'Skill: ' + s.name), x);
    box.append(c);
  }
  if (tab === 'work') for (const f of [...changed].slice(-6)) {
    const c = h('span', 'chip');
    c.append(badge(f), h('span', '', f.split('/').pop()));
    box.append(c);
  }
  box.hidden = !box.childNodes.length;
}

function send() {
  let text = $('input').value.trim();
  if (!text || busy) return;
  const m = text.match(/^\/(\S+)\s*/);
  if (m) {
    const s = skills.find(x => x.cmd === m[1]);
    if (s) { active.add(s.id); text = text.slice(m[0].length).trim(); renderChips(); }
    if (!text) { $('input').value = ''; return; }
  }
  $('input').value = '';
  $('input').style.height = 'auto';
  hideAc();
  addMsg('user', text);
  sfx('send');
  setBusy(true);
  api.send(text, { provider: $('provider').value, model: $('model').value.trim(), effort: $('effort').value, mode, tab, autoEdits: store.get('autoEdits', false), customUrl: $('customUrl').value.trim(), skills: [...active], maxSteps: store.get('maxSteps', 25), compactAt: store.get('compactAt', 60000) });
}
const usageByTab = { chat: null, work: null };
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
function setUsage(u) {
  const el = $('usage');
  if (!u) { el.hidden = true; return; }
  const parts = [];
  if (u.turn) parts.push('Turno ' + (u.turn.est ? '~' : '') + fmtTok(u.turn.input) + '↑ ' + fmtTok(u.turn.output) + '↓');
  parts.push('Total ' + fmtTok(u.total.input) + '↑ ' + fmtTok(u.total.output) + '↓');
  if (u.total.cost != null) parts.push('$' + u.total.cost.toFixed(u.total.cost < 1 ? 4 : 2));
  el.textContent = parts.join(' · ');
  el.title = 'Tokens de entrada (↑) y salida (↓); "~" indica estimación. El costo usa tu tabla de precios en Configuración > Uso y costos.';
  el.hidden = false;
}

let thinkEl = null;
function showThinking() {
  if (thinkEl && thinkEl.isConnected) return;
  thinkEl = h('div', 'thinking');
  const d = h('span', 'dots');
  d.append(h('span'), h('span'), h('span'));
  thinkEl.append(d, h('span', 'shimmer', 'Pensando…'));
  L().append(thinkEl);
  scroll();
}
function hideThinking() { thinkEl?.remove(); thinkEl = null; }
function setBusy(b) {
  busy = b;
  $('send').hidden = b;
  $('stop').hidden = !b;
  if (b) showThinking(); else hideThinking();
}

let actx = null;
const SFX = {
  send: [[660, 0, .06]],
  read: [[880, 0, .035]],
  ok: [[523, 0, .07], [784, .07, .1]],
  run: [[440, 0, .05], [587, .06, .09]],
  del: [[392, 0, .09], [262, .09, .15]],
  ask: [[660, 0, .09], [660, .15, .09]],
  err: [[220, 0, .13, 'square'], [165, .15, .2, 'square']],
  done: [[523, 0, .1], [659, .1, .1], [784, .2, .2]]
};
function sfx(name) {
  if (!store.get('sound', true)) return;
  try {
    actx ||= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    for (const [f, s, d, type] of SFX[name]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + s);
      g.gain.linearRampToValueAtTime(type ? 0.035 : 0.06, t0 + s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
      o.connect(g).connect(actx.destination);
      o.start(t0 + s);
      o.stop(t0 + s + d + 0.02);
    }
  } catch {}
}
$('send').onclick = send;
$('stop').onclick = () => api.stop();
let acState = null, acSeq = 0;
function hideAc() { acState = null; acSeq++; $('ac').hidden = true; }
function renderAc() {
  const box = $('ac');
  box.replaceChildren();
  acState.items.forEach((it, i) => {
    const row = h('div', 'aci' + (i === acState.sel ? ' on' : ''));
    row.setAttribute('role', 'option');
    if (it.kind === 'file') row.append(badge(it.path));
    else { const ic = h('span', 'ci chat'); ic.append(icon('spark', 16)); row.append(ic); }
    row.append(h('span', 'al', it.label), h('span', 'ad', it.desc));
    row.onmousedown = e => { e.preventDefault(); acceptAc(i); };
    box.append(row);
  });
  box.hidden = false;
  box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function showAc(items, from, to) {
  if (!items.length) return hideAc();
  acState = { items, sel: 0, from, to };
  renderAc();
}
function autosize() { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
function acceptAc(i) {
  if (!acState) return;
  const it = acState.items[i], ta = $('input');
  const caret = acState.from + it.insert.length;
  ta.value = ta.value.slice(0, acState.from) + it.insert + ta.value.slice(acState.to);
  ta.setSelectionRange(caret, caret);
  hideAc();
  autosize();
  ta.focus();
}
async function updateAc() {
  const ta = $('input'), pos = ta.selectionStart, before = ta.value.slice(0, pos);
  const my = ++acSeq;
  let m = before.match(/^\/(\S*)$/);
  if (m) {
    const q = m[1].toLowerCase();
    const items = skills
      .filter(s => s.cmd.includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.cmd.startsWith(q)) - Number(a.cmd.startsWith(q)))
      .slice(0, 8)
      .map(s => ({ kind: 'skill', label: '/' + s.cmd, desc: s.name + (active.has(s.id) ? ' · activa' : ''), insert: '/' + s.cmd + ' ' }));
    return showAc(items, 0, pos);
  }
  m = tab === 'work' && wsPath ? before.match(/(^|\s)@([^\s@]*)$/) : null;
  if (m) {
    const q = m[2], from = pos - q.length - 1;
    const files = await api.files(q);
    if (my !== acSeq) return;
    return showAc(files.map(f => ({ kind: 'file', path: f, label: f.split('/').pop(), desc: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '', insert: '@' + f + ' ' })), from, pos);
  }
  hideAc();
}
$('input').onkeydown = e => {
  if (acState) {
    const n = acState.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acState.sel = (acState.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderAc(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAc(acState.sel); return; }
    if (e.key === 'Escape') { e.preventDefault(); hideAc(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
};
$('input').oninput = () => { autosize(); updateAc(); };
$('input').onkeyup = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateAc(); };
$('input').onclick = updateAc;
$('input').onblur = () => setTimeout(hideAc, 120);

const EXT_COLOR = { ts: '#2B6CB0', tsx: '#2B6CB0', js: '#D9A441', jsx: '#D9A441', mjs: '#D9A441', css: '#7040C0', html: '#C2410C', json: '#4D7C0F', md: '#5C5C58', py: '#2B6CB0' };
function badge(path) {
  const name = String(path || '').split('/').pop();
  if (!/\.[^.]+$/.test(name)) { const f = h('span', 'fold'); f.append(icon('folder', 18)); return f; }
  const ext = name.split('.').pop().toLowerCase();
  const b = h('span', 'badge', ext === 'html' ? '<>' : ext === 'json' ? '{ }' : ext.slice(0, 3).toUpperCase());
  b.style.background = EXT_COLOR[ext] || '#5C5C58';
  return b;
}

function decide(ev, yesLabel, done) {
  const box = h('span', 'dec');
  const mk = (label, cls, v, scope, tip) => {
    const b = h('button', 'btn ' + cls, label);
    if (tip) b.title = tip;
    b.onclick = e => { e.stopPropagation(); api.approve(ev.id, v, scope); box.remove(); done(v); };
    return b;
  };
  box.append(mk('Rechazar', '', false, null));
  if (ev.canRemember) {
    if (!ev.sessionOnly) box.append(mk('Siempre', 'ghost', true, 'always', 'Permitir siempre este comando (se guarda en permisos.json)'));
    box.append(mk('Sesión', 'ghost', true, 'session', ev.sessionOnly ? 'Permitir las acciones del Betatester hasta cerrar la app' : 'Permitir este comando hasta cerrar la app'));
  }
  box.append(mk(yesLabel, 'primary', true, null));
  return box;
}

function fillDiff(body, lines) {
  const cls = { '+': 'dadd', '-': 'ddel', ' ': 'dctx', '!': 'dwarn', '.': 'dgap' };
  for (const l of lines) body.append(h('div', 'dl ' + cls[l.t], (l.t === '+' || l.t === '-' || l.t === ' ' ? l.t + ' ' : '') + l.s));
}

const FILE_TOOLS = { write_file: 'Aplicar', edit_file: 'Aplicar', make_dir: 'Crear', delete_path: 'Eliminar' };
const VERBS = {
  write_file: n => (n ? ['Creando…', 'Creado'] : ['Escribiendo…', 'Escrito']),
  edit_file: () => ['Editando…', 'Editado'],
  make_dir: () => ['Creando carpeta…', 'Carpeta creada'],
  delete_path: () => ['Eliminando…', 'Eliminado'],
  read_file: () => ['Leyendo…', 'Leyó'],
  list_dir: () => ['Listando…', 'Listó'],
  search_text: () => ['Buscando…', 'Buscó'],
  find_files: () => ['Buscando archivos…', 'Buscó archivos'],
  run_command: () => ['Ejecutando…', 'Ejecutado']
};
function working(label) {
  const w = h('span', 'working');
  w.append(h('span', 'spin'), h('span', 'shimmer', label));
  return w;
}

function fileAct(ev) {
  const a = ev.args || {};
  const [ing, done] = VERBS[ev.name](ev.isNew);
  const box = h('div', 'card act'), head = h('div', 'chead'), st = h('span', 'cstat'), body = h('div', 'diff');
  head.append(badge(a.path), h('span', 'cpath', a.path || ev.name), h('span', 'grow'), st);
  if (Array.isArray(ev.preview)) fillDiff(body, ev.preview);
  body.hidden = !(ev.ask && body.childNodes.length);
  const run = () => { st.className = 'cstat'; st.replaceChildren(working(ing)); box.classList.add('running'); };
  let dec = null;
  if (ev.ask) {
    st.textContent = 'Esperando aprobación';
    dec = decide(ev, FILE_TOOLS[ev.name], v => { if (v) run(); else st.textContent = ''; });
    head.append(dec);
  } else run();
  head.onclick = () => { if (body.childNodes.length) body.hidden = !body.hidden; };
  box.append(head, body);
  L().append(box);
  scroll();
  return {
    finish(status, text) {
      dec?.remove();
      box.classList.remove('running');
      st.className = 'cstat ' + status;
      st.textContent = status === 'denied' ? 'Rechazado' : status === 'error' ? 'Error' : done;
      if (status === 'error' && text) { body.replaceChildren(h('div', 'dl dwarn', text)); body.hidden = false; }
      else if (ev.ask) body.hidden = true;
    }
  };
}

function cmdAct(ev) {
  const a = ev.args || {};
  let row = null, rstat = null, termBox = null, tst = null, tbody = null;
  const ensureTerm = () => {
    if (termBox) return;
    termBox = h('div', 'card term act running');
    tst = h('span', 'tstat');
    tst.append(working('Ejecutando…'));
    const hd = h('div', 'thead2');
    hd.append(h('span', '', 'Terminal · ' + (a.cwd || '~')), h('span', 'grow'), tst);
    tbody = h('pre', 'tbody', '$ ' + (a.command || ''));
    termBox.append(hd, tbody);
    L().append(termBox);
    scroll();
  };
  if (ev.ask) {
    row = h('div', 'card crow act');
    const top = h('div', 'ctop'), info = h('div', 'cinfo');
    rstat = h('span', 'cstat', 'Esperando aprobación');
    info.append(h('span', 'dim', 'Ejecutar comando'), h('code', 'cmd', a.command || ''));
    top.append(info, h('span', 'grow'), rstat, decide(ev, 'Ejecutar', v => { if (v) { row.remove(); ensureTerm(); } else { rstat.className = 'cstat error'; rstat.textContent = 'Rechazado'; } }));
    row.append(top, h('div', 'csub', (a.cwd ? 'cwd: ' + a.cwd + ' · ' : '') + 'Los comandos no se pueden deshacer.'));
    L().append(row);
    scroll();
  } else ensureTerm();
  return {
    finish(status, text) {
      if (status === 'denied') { if (rstat) { rstat.className = 'cstat error'; rstat.textContent = 'Rechazado'; } return; }
      ensureTerm();
      termBox.classList.remove('running');
      const m = /^exit=(\S+)\n?/.exec(text || '');
      const code = m ? m[1] : null;
      const out = m ? text.slice(m[0].length) : text || '';
      tst.className = 'tstat ' + (status === 'ok' && code === '0' ? 'ok' : 'bad');
      tst.textContent = !m ? 'Error' : 'Terminó (código ' + code + ')';
      if (out.trim()) tbody.textContent += '\n' + out.trimEnd();
      scroll();
    }
  };
}

function miniAct(ev) {
  const [ing, done] = (VERBS[ev.name] || (() => [ev.name + '…', ev.name]))();
  const a0 = ev.args || {};
  const tgt = a0.query ? '"' + a0.query + '"' + (a0.path ? ' en ' + a0.path : '') : a0.pattern || (a0.desde ? a0.path + ' (' + a0.desde + '-' + (a0.hasta || '') + ')' : a0.path) || '';
  const line = h('div', 'mini'), lead = h('span', 'lead'), txt = h('span', '', tgt);
  lead.append(working(ing));
  line.append(lead, txt);
  L().append(line);
  scroll();
  return {
    finish(status) {
      lead.replaceChildren(document.createTextNode(status === 'ok' ? '✓ ' + done : '! Error'));
      line.classList.toggle('bad', status !== 'ok');
    }
  };
}

const TEST_LABELS = {
  test_detect: ['Analizando proyecto…', 'Proyecto analizado'],
  test_open: ['Abriendo app…', 'App abierta'],
  test_look: ['Mirando pantalla…', 'Pantalla leída'],
  test_click: ['Haciendo clic…', 'Clic hecho'],
  test_type: ['Escribiendo…', 'Texto escrito'],
  test_key: ['Pulsando tecla…', 'Tecla pulsada'],
  test_scroll: ['Desplazando…', 'Desplazado'],
  test_report: ['Guardando reporte…', 'Reporte guardado'],
  test_close: ['Cerrando app…', 'App cerrada']
};

function testAct(ev) {
  const [ing, done] = TEST_LABELS[ev.name] || [ev.name + '…', ev.name];
  const desc = ev.desc || ev.name;
  const box = h('div', 'tbox'), line = h('div', 'mini tline'), lead = h('span', 'lead'), txt = h('span', '', desc), body = h('pre', 'tout');
  body.hidden = true;
  line.append(lead, txt);
  line.onclick = () => { if (body.textContent) body.hidden = !body.hidden; };
  let row = null, rstat = null;
  if (ev.ask) {
    row = h('div', 'card crow act');
    const top = h('div', 'ctop'), info = h('div', 'cinfo');
    rstat = h('span', 'cstat', 'Esperando aprobación');
    info.append(h('span', 'dim', 'Betatester'), h('code', 'cmd', desc));
    top.append(info, h('span', 'grow'), rstat, decide(ev, 'Permitir', v => {
      if (v) { row.remove(); box.append(line, body); lead.replaceChildren(working(ing)); }
      else { rstat.className = 'cstat error'; rstat.textContent = 'Rechazado'; }
    }));
    row.append(top, h('div', 'csub', 'Controla el mouse y el teclado sobre la app. Al pulsar "Permitir" se autorizan todas las acciones del Betatester hasta cerrar Rs-Agent-Ai.'));
    box.append(row);
  } else { box.append(line, body); lead.replaceChildren(working(ing)); }
  L().append(box);
  scroll();
  return {
    finish(status, text) {
      if (status === 'denied') { if (rstat) { rstat.className = 'cstat error'; rstat.textContent = 'Rechazado'; } return; }
      if (!line.isConnected) box.append(line, body);
      lead.replaceChildren(document.createTextNode(status === 'ok' ? '✓ ' + done : '! Error'));
      line.classList.toggle('bad', status !== 'ok');
      if (status === 'error') txt.textContent = desc + ' — ' + String(text || '').replace(/^Error: /, '');
      else if (text) body.textContent = text;
    }
  };
}

function makeAct(ev) {
  if (String(ev.name).startsWith('test_')) return testAct(ev);
  if (ev.name === 'run_command') return cmdAct(ev);
  if (FILE_TOOLS[ev.name]) return fileAct(ev);
  return miniAct(ev);
}

function dateLabel(ts) {
  const d = new Date(ts), n = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(n) - day(d)) / 864e5);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) { const w = d.toLocaleDateString('es', { weekday: 'short' }).replace('.', ''); return w[0].toUpperCase() + w.slice(1); }
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

async function loadChats() {
  recents = await api.chats(null);
  renderRecents();
  if (view === 'home') renderHome();
}
const typeIcon = (t, size = 16) => { const s = h('span', 'ci ' + (t === 'work' ? 'work' : 'chat')); s.append(icon(t === 'work' ? 'folder' : 'chat', size)); return s; };

function renderRecents() {
  const box = $('recents');
  box.replaceChildren();
  const group = (label, list) => {
    if (!list.length) return;
    box.append(h('div', 'secT', label));
    list.forEach(c => box.append(recRow(c)));
  };
  group('FIJADOS', recents.filter(c => c.pinned));
  group('RECIENTES', recents.filter(c => !c.pinned));
  if (!recents.length) box.append(h('div', 'secT', 'SIN CHATS TODAVÍA'));
}

function recRow(c) {
  const row = h('div', 'rec' + (c.id === ids[c.tab] ? ' on' : ''));
  const t = h('span', 'rt', c.title || 'Sin título');
  const acts = h('span', 'racts');
  const btn = (name, label, fn) => {
    const b = h('button', 'ract');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(name, 14));
    b.onclick = e => { e.stopPropagation(); fn(b); };
    return b;
  };
  acts.append(
    btn('pin', c.pinned ? 'Desfijar' : 'Fijar', async () => { await api.pinChat(c.id, !c.pinned); loadChats(); }),
    btn('pencil', 'Renombrar', () => startRename(t, c)),
    btn('trash', 'Eliminar', b => armDelete(b, c))
  );
  row.append(typeIcon(c.tab), t);
  if (c.pinned) { const p = h('span', 'pinned'); p.append(icon('pin', 12)); row.append(p); }
  row.append(acts);
  row.onclick = () => openChat(c.id);
  return row;
}

function startRename(t, c) {
  const inp = h('input', 'renamer');
  inp.value = c.title || '';
  inp.maxLength = 80;
  t.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (save && v && v !== c.title) await api.renameChat(c.id, v);
    loadChats();
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
  inp.onclick = e => e.stopPropagation();
}

function armDelete(b, c) {
  if (b.dataset.arm) return removeChat(c);
  b.dataset.arm = '1';
  b.classList.add('arm');
  b.replaceChildren(h('span', '', '¿Borrar?'));
  setTimeout(() => {
    if (!b.isConnected) return;
    delete b.dataset.arm;
    b.classList.remove('arm');
    b.replaceChildren(icon('trash', 14));
  }, 3000);
}

async function removeChat(c) {
  if (busy) return;
  await api.delChat(c.id);
  for (const k of ['chat', 'work']) if (ids[k] === c.id) { ids[k] = null; $(k === 'work' ? 'logWork' : 'logChat').replaceChildren(); }
  loadChats();
}

async function openChat(id) {
  if (busy) return;
  const r = await api.openChat(id);
  if (r.error) return addMsg('err', r.error);
  ids[r.tab] = r.id;
  usageByTab[r.tab] = r.usage && (r.usage.input || r.usage.output) ? { turn: null, total: r.usage } : null;
  if (r.tab === 'work') { wsPath = r.workspace; changed.clear(); openDirs.clear(); }
  go(r.tab === 'work' ? 'work' : 'chat');
  L().replaceChildren();
  for (const v of r.view) {
    if (v.kind === 'act') {
      makeAct({ id: null, name: v.name, args: v.args, ask: false, preview: null }).finish(v.status, v.text);
      if (v.status === 'ok' && (v.name === 'write_file' || v.name === 'edit_file') && v.args && v.args.path) changed.add(norm(v.args.path));
    } else addMsg(v.kind, v.text);
  }
  if (providers[r.provider]) {
    $('provider').value = r.provider;
    syncProvider();
    if (r.model) { $('model').value = r.model; renderPill(); }
  }
  renderChips();
  if (r.tab === 'work') renderTree();
  loadChats();
}

async function startWith(id) {
  if (busy) return;
  $('provider').value = id;
  syncProvider();
  await api.reset('chat');
  ids.chat = null;
  usageByTab.chat = null;
  $('logChat').replaceChildren();
  go('chat');
  loadChats();
}

function renderHome() {
  const v = $('vHome');
  v.replaceChildren(h('h1', '', '¿Con qué modelo quieres empezar?'), h('p', 'sub', 'Tus claves se guardan solo en este equipo.'));
  const grid = h('div', 'pgrid');
  for (const [id, p] of Object.entries(providers)) {
    if (id === 'custom') continue;
    const c = h('div', 'card pcard'), t = h('div', 'ptitle'), st = h('div', 'pstat' + (p.hasKey ? ' ok' : ''));
    t.append(dotEl(id), h('span', '', PROV_NAME[id]));
    st.append(h('span', 'sd' + (p.hasKey ? ' on' : '')), h('span', '', p.hasKey ? 'Conectado' : 'Sin clave'));
    const b = h('button', 'btn', p.hasKey ? 'Chatear' : 'Añadir clave');
    b.onclick = () => { if (p.hasKey) startWith(id); else { cfgSec = 'prov'; go('config'); } };
    c.append(t, st, b);
    grid.append(c);
  }
  const other = h('div', 'card pcard dashed');
  other.append(icon('plus', 22), h('div', '', 'Otro proveedor'), h('div', 'dim', 'URL base + clave'));
  other.onclick = () => { cfgSec = 'prov'; go('config'); };
  grid.append(other);
  const two = h('div', 'two');
  const f = h('div', 'card'), fb = h('button', 'btn', 'Abrir carpeta');
  const ft = h('div', 'ctitle'); ft.append(icon('folder', 18), h('span', '', 'Trabajar en una carpeta'));
  fb.onclick = pickFolder;
  f.append(ft, h('p', 'dim', 'Deja que el modelo lea y edite los archivos de un proyecto.'), fb);
  const s = h('div', 'card'), sb = h('button', 'btn', 'Gestionar skills');
  const st2 = h('div', 'ctitle'); st2.append(icon('spark', 18), h('span', '', 'Skills'));
  sb.onclick = () => go('skills');
  s.append(st2, h('p', 'dim', 'Activa instrucciones reutilizables en tus chats.'), sb);
  two.append(f, s);
  v.append(grid, two);
  if (recents.length) {
    const list = h('div', 'card list');
    for (const c of recents.slice(0, 5)) {
      const r = h('div', 'lrow');
      r.append(typeIcon(c.tab), h('span', 't', c.title || 'Sin título'), h('span', 'dim', (PROV_NAME[c.provider] || '') + ' · ' + dateLabel(c.updated)));
      r.onclick = () => openChat(c.id);
      list.append(r);
    }
    v.append(h('h2', '', 'Continuar donde lo dejaste'), list);
  }
}

function renderSkills() {
  const v = $('vSkills');
  const top = h('div', 'vtop'), hd = h('div');
  hd.append(h('h1', '', 'Skills'), h('p', 'sub', 'Instrucciones reutilizables que se activan en tus chats.'));
  const nb = h('button', 'btn primary');
  nb.append(icon('plus', 16), h('span', '', 'Nueva skill'));
  nb.onclick = () => editSkill(null);
  top.append(hd, nb);
  const grid = h('div', 'sgrid');
  for (const s of skills) {
    const c = h('div', 'card scard'), body = h('div', 'sbody'), t = h('div', 'stitle');
    t.append(icon('spark', 16), h('span', '', s.name));
    body.append(t, h('div', 'sdesc', s.desc), h('code', 'scmd', '/' + s.cmd));
    body.onclick = () => editSkill(s);
    const sw = h('button', 'switch' + (s.enabled ? ' on' : ''));
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!s.enabled));
    sw.setAttribute('aria-label', 'Activar ' + s.name);
    sw.append(h('span', 'knob'));
    sw.onclick = async () => {
      s.enabled = !s.enabled;
      if (s.enabled) active.add(s.id); else active.delete(s.id);
      await api.saveSkills(skills);
      renderSkills();
      renderChips();
    };
    c.append(body, sw);
    grid.append(c);
  }
  v.replaceChildren(top, grid);
}

let editing = null;
function editSkill(s) {
  editing = s;
  $('skTitle').textContent = s ? 'Editar skill' : 'Nueva skill';
  $('skName').value = s ? s.name : '';
  $('skCmd').value = s ? s.cmd : '';
  $('skDesc').value = s ? s.desc : '';
  $('skText').value = s ? s.text : '';
  $('skErr').textContent = '';
  $('skDel').hidden = !s;
  $('skillDlg').showModal();
  $('skName').focus();
}
$('skCancel').onclick = () => $('skillDlg').close();
$('skDel').onclick = async () => {
  skills = skills.filter(x => x !== editing);
  active.delete(editing.id);
  await api.saveSkills(skills);
  $('skillDlg').close();
  renderSkills();
  renderChips();
};
$('skSave').onclick = async () => {
  const name = $('skName').value.trim(), text = $('skText').value.trim();
  if (!name || !text) { $('skErr').textContent = 'Nombre e instrucciones son obligatorios.'; return; }
  let cmd = $('skCmd').value.trim().replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  if (skills.some(x => x !== editing && x.cmd === cmd)) { $('skErr').textContent = 'Ese comando ya existe.'; return; }
  if (editing) Object.assign(editing, { name, cmd, desc: $('skDesc').value.trim(), text });
  else skills.push({ id: 's' + Date.now().toString(36), name, cmd, desc: $('skDesc').value.trim(), text, enabled: false });
  await api.saveSkills(skills);
  $('skillDlg').close();
  renderSkills();
};

let agentSel = 'anthropic', agentTimer = null, agentStatus = null;
async function flushAgent() {
  if (!agentTimer) return;
  clearTimeout(agentTimer);
  agentTimer = null;
  const ta = $('agentText');
  if (ta) await api.saveAgent(agentSel, ta.value);
}
async function renderAgent() {
  const v = $('vAgent');
  const list = await api.agents();
  const menu = h('div', 'cmenu'), pane = h('div', 'apane');
  for (const a of list) {
    const b = h('button', 'cm agentbtn' + (agentSel === a.id ? ' on' : '')), info = h('div', 'ainfo');
    info.append(h('span', 'an', PROV_NAME[a.id]), h('span', 'af', a.file));
    b.append(dotEl(a.id), info);
    if (a.size) b.append(h('span', 'hasc'));
    b.onclick = async () => { await flushAgent(); agentSel = a.id; renderAgent(); };
    menu.append(b);
  }
  const cur = list.find(a => a.id === agentSel) || list[0];
  const text = await api.getAgent(cur.id);
  const head = h('div', 'ahead'), tt = h('div');
  tt.append(h('h1', '', cur.file), h('p', 'sub', 'Instrucciones para ' + PROV_NAME[cur.id] + ' en todos tus chats. Si queda vacío, se desactiva. Además se lee el archivo del proyecto (' + (providers[cur.id] ? providers[cur.id].ctx : 'AGENTS.md') + ') dentro de cada carpeta.'));
  const acts = h('div', 'aacts');
  agentStatus = h('span', 'astat', 'Guardado');
  const save = h('button', 'btn primary', 'Guardar');
  const open = h('button', 'btn', 'Abrir carpeta');
  open.onclick = () => api.openAgents();
  acts.append(agentStatus, open, save);
  head.append(tt, acts);
  const ta = h('textarea');
  ta.id = 'agentText';
  ta.spellcheck = false;
  ta.value = text;
  ta.placeholder = '# Instrucciones\n\nEjemplo:\n- Responde siempre en español.\n- Sé conciso y muestra el código en bloques.\n- Antes de borrar archivos, explica por qué.';
  const commit = async () => {
    clearTimeout(agentTimer);
    agentTimer = null;
    await api.saveAgent(cur.id, ta.value);
    agentStatus.textContent = 'Guardado ✓';
    const btn = [...$('vAgent').querySelectorAll('.agentbtn')][list.findIndex(a => a.id === cur.id)];
    if (btn) { btn.querySelector('.hasc')?.remove(); if (ta.value.trim()) btn.append(h('span', 'hasc')); }
  };
  ta.oninput = () => {
    agentStatus.textContent = 'Guardando…';
    clearTimeout(agentTimer);
    agentTimer = setTimeout(commit, 700);
  };
  save.onclick = commit;
  pane.append(head, ta, h('div', 'acount', ''));
  v.replaceChildren(menu, pane);
}

function renderConfig() {
  const v = $('vConfig');
  const menu = h('div', 'cmenu'), pane = h('div', 'cpane');
  [['gen', 'General'], ['prov', 'Proveedores'], ['use', 'Uso y costos'], ['look', 'Apariencia'], ['fold', 'Carpetas'], ['keys', 'Atajos']].forEach(([id, label]) => {
    const b = h('button', 'cm' + (cfgSec === id ? ' on' : ''), label);
    b.onclick = () => { cfgSec = id; renderConfig(); };
    menu.append(b);
  });
  ({ gen: cfgGeneral, prov: cfgProviders, use: cfgUsage, look: cfgLook, fold: cfgFolders, keys: cfgKeys })[cfgSec](pane);
  v.replaceChildren(menu, pane);
}

function switchEl(on, label, fn) {
  const sw = h('button', 'switch' + (on ? ' on' : ''));
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(on));
  sw.setAttribute('aria-label', label);
  sw.append(h('span', 'knob'));
  sw.onclick = () => { fn(!on); renderConfig(); };
  return sw;
}
function setRow(title, desc, control) {
  const r = h('div', 'card setrow'), d = h('div');
  d.append(h('strong', '', title), h('p', '', desc));
  r.append(d, control);
  return r;
}

function numRow(title, desc, key, def, min, max, step) {
  const inp = h('input');
  inp.type = 'number';
  inp.min = min;
  inp.max = max;
  inp.step = step;
  inp.value = store.get(key, def);
  inp.style.width = '130px';
  inp.onchange = () => {
    const n = Math.min(max, Math.max(min, parseInt(inp.value)));
    const v = Number.isNaN(n) ? def : n;
    inp.value = v;
    store.set(key, v);
  };
  return setRow(title, desc, inp);
}

async function cfgUsage(p) {
  p.append(h('h1', '', 'Uso y costos'), h('p', 'sub', 'Define el precio de cada modelo (USD por millón de tokens) para estimar el costo de tus chats. Sin precio, solo se muestran los tokens.'));
  const rows = Object.entries(await api.getPrices()).map(([key, v]) => ({ key, in: v.in, out: v.out }));
  const box = h('div'), status = h('span', 'astat');
  const ex = h('div', 'card setrow exrow');
  ex.append(h('strong', '', 'Ejemplo (solo ilustrativo, no se guarda)'), h('code', 'scmd', 'openai:modelo-ejemplo    entrada 1.00    salida 4.00'), h('p', '', 'Usa proveedor:* para aplicar el mismo precio a todos los modelos de un proveedor.'));
  const draw = () => {
    box.replaceChildren();
    if (rows.length) {
      const hd = h('div', 'prr hd');
      ['Proveedor:modelo', 'Entrada $/M', 'Salida $/M', ''].forEach(t => hd.append(h('span', '', t)));
      box.append(hd);
    }
    rows.forEach((r, i) => {
      const line = h('div', 'prr'), k = h('input');
      k.value = r.key;
      k.placeholder = 'proveedor:modelo';
      k.oninput = () => { r.key = k.value.trim(); };
      const num = field => { const n = h('input'); n.type = 'number'; n.min = 0; n.step = 'any'; n.value = r[field]; n.oninput = () => { r[field] = n.value; }; return n; };
      const del = h('button', 'btn ghost', 'Quitar');
      del.onclick = () => { rows.splice(i, 1); draw(); };
      line.append(k, num('in'), num('out'), del);
      box.append(line);
    });
  };
  draw();
  const add = h('button', 'btn', 'Añadir fila');
  add.onclick = () => { rows.push({ key: '', in: '', out: '' }); draw(); };
  const cur = h('button', 'btn', 'Usar modelo actual');
  cur.onclick = () => { rows.push({ key: $('provider').value + ':' + $('model').value.trim(), in: '', out: '' }); draw(); };
  const save = h('button', 'btn primary', 'Guardar');
  save.onclick = async () => {
    const obj = {};
    for (const r of rows) { if (!r.key && r.in === '' && r.out === '') continue; obj[r.key] = { in: Number(r.in), out: Number(r.out) }; }
    const res = await api.setPrices(obj);
    status.className = 'astat' + (res.error ? ' bad' : '');
    status.textContent = res.error || 'Guardado ✓';
  };
  const bar = h('div', 'aacts');
  bar.style.marginTop = '12px';
  bar.append(add, cur, save, status);
  p.append(ex, box, bar);
}

function cfgGeneral(p) {
  p.append(h('h1', '', 'General'), h('p', 'sub', 'Comportamiento del agente.'));
  p.append(setRow('Aprobar ediciones solas', 'Crear y editar archivos sin pedir permiso. Eliminar y ejecutar comandos siempre preguntan.', switchEl(store.get('autoEdits', false), 'Aprobar ediciones solas', v => store.set('autoEdits', v))));
  p.append(setRow('Sonidos', 'Avisos sonoros al aprobar, ejecutar, terminar o fallar.', switchEl(store.get('sound', true), 'Sonidos', v => { store.set('sound', v); if (v) sfx('ok'); })));
  const sel = h('select');
  [['auto', 'Auto'], ['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto']].forEach(([v, t]) => sel.add(new Option(t, v)));
  sel.value = $('effort').value;
  sel.style.width = '140px';
  sel.onchange = () => { $('effort').value = sel.value; store.set('effort', sel.value); };
  p.append(setRow('Esfuerzo de razonamiento', 'Solo aplica a modelos que lo soportan.', sel));
  p.append(numRow('Límite de pasos por turno', 'Máximo de llamadas al modelo antes de detenerse. El agente avisa al alcanzarlo.', 'maxSteps', 25, 1, 100, 1), numRow('Compactar chat desde (tokens)', 'Cuando el historial estimado supera este valor, se resume lo antiguo y se conservan los últimos turnos. 0 lo desactiva.', 'compactAt', 60000, 0, 1000000, 1000));
}

function provRow(id) {
  const pr = providers[id], r = h('div', 'card prow'), name = h('div', 'pname'), mid = h('div', 'pmid');
  name.append(dotEl(id), h('span', '', PROV_NAME[id]));
  if (pr.keys.names.length) {
    const sel = h('select');
    pr.keys.names.forEach(n => sel.add(new Option('🔑 ' + n, n)));
    sel.value = pr.keys.active;
    sel.style.width = '130px';
    sel.onchange = async () => { await api.useKey(id, sel.value); await refreshProviders(); };
    mid.append(sel);
  }
  if (id === 'custom') {
    const u = h('input');
    u.placeholder = 'URL base .../chat/completions';
    u.value = store.get('customUrl', '');
    u.onchange = () => { store.set('customUrl', u.value.trim()); $('customUrl').value = u.value.trim(); };
    mid.append(u);
  }
  const inp = h('input');
  inp.type = 'password';
  inp.placeholder = 'Pega tu API key';
  inp.autocomplete = 'off';
  const save = h('button', 'btn', 'Guardar');
  save.onclick = async () => {
    const k = inp.value.trim();
    if (!k) return;
    await api.setKey(id, pr.keys.names.length ? 'key ' + (pr.keys.names.length + 1) : 'principal', k);
    await refreshProviders();
  };
  inp.onkeydown = e => { if (e.key === 'Enter') save.click(); };
  mid.append(inp, save);
  const st = h('div', 'pst' + (pr.hasKey ? ' ok' : ''));
  st.append(h('span', 'sd' + (pr.hasKey ? ' on' : '')), h('span', '', pr.hasKey ? 'Conectado' : 'Sin clave'));
  const test = h('button', 'btn', 'Probar');
  test.onclick = async () => {
    st.className = 'pst';
    st.replaceChildren(h('span', '', 'Probando…'));
    const res = await api.models(id, store.get('customUrl', ''));
    st.className = 'pst ' + (res.error ? 'bad' : 'ok');
    st.replaceChildren(h('span', '', res.error ? String(res.error).slice(0, 60) : 'Conectado · ' + res.models.length + ' modelos'));
  };
  const del = h('button', 'btn ghost', 'Quitar');
  del.hidden = !pr.hasKey;
  del.onclick = async () => { await api.delKey(id, pr.keys.active); await refreshProviders(); };
  const act = h('div', 'pact');
  act.append(test, del);
  r.append(name, st, act, mid);
  return r;
}
function cfgProviders(p) {
  p.append(h('h1', '', 'Proveedores'), h('p', 'sub', 'Las claves se guardan cifradas en este equipo. Puedes guardar varias por proveedor.'));
  for (const id of Object.keys(providers)) p.append(provRow(id));
}

function cfgLook(p) {
  p.append(h('h1', '', 'Apariencia'), h('p', 'sub', 'Tema de la interfaz.'));
  const seg = h('div', 'seg');
  seg.style.width = '240px';
  [['light', 'Claro'], ['dark', 'Oscuro']].forEach(([t, l]) => {
    const b = h('button', document.documentElement.dataset.theme === t ? 'on' : '', l);
    b.onclick = () => { setTheme(t); renderConfig(); };
    seg.append(b);
  });
  p.append(setRow('Tema', 'Claro u oscuro.', seg));
}

function cfgFolders(p) {
  p.append(h('h1', '', 'Carpetas'), h('p', 'sub', 'Permisos y cambios del proyecto abierto.'));
  const perm = h('button', 'btn', 'Editar permisos');
  perm.onclick = openPerms;
  const undo = h('button', 'btn', 'Deshacer último cambio');
  undo.onclick = doUndo;
  p.append(setRow('Reglas de permisos', 'Se guardan en .agente/permisos.json dentro de la carpeta.', perm), setRow('Deshacer', 'Revierte el último cambio de archivos del chat de trabajo.', undo));
}

function cfgKeys(p) {
  p.append(h('h1', '', 'Atajos'), h('p', 'sub', 'Teclas del chat.'));
  const list = h('div', 'card list');
  [['Enviar mensaje', 'Enter'], ['Salto de línea', 'Shift + Enter'], ['Activar una skill', '/comando']].forEach(([a, k]) => {
    const r = h('div', 'krow');
    r.append(h('span', '', a), h('kbd', '', k));
    list.append(r);
  });
  p.append(list);
}

async function openPerms() {
  const r = await api.getPerms();
  if (r.error) { go('work'); return addMsg('err', r.error); }
  $('permText').value = r.text;
  $('permErr').textContent = '';
  $('permDlg').showModal();
}
async function doUndo() {
  if (busy) return;
  const r = await api.undo();
  go('work');
  addMsg('note', r.error || (r.none ? 'No hay cambios para deshacer.' : 'Deshecho: ' + r.tool + ' ' + r.rel));
  renderTree();
}
$('undo').onclick = doUndo;
$('permBtn').onclick = openPerms;
$('permCancel').onclick = () => $('permDlg').close();
$('permSave').onclick = async () => {
  const r = await api.setPerms($('permText').value);
  if (r.error) { $('permErr').textContent = r.error; return; }
  $('permDlg').close();
  addMsg('note', 'Permisos guardados.');
};

$('keyBtn').onclick = () => {
  const k = providers[$('provider').value].keys;
  $('keyTitle').textContent = 'API keys de ' + providers[$('provider').value].label + (k.names.length ? ' (' + k.names.length + ' guardadas)' : '');
  $('keyName').value = 'key ' + (k.names.length + 1);
  $('keyInput').value = '';
  $('keyDel').hidden = !k.names.length;
  $('keyDlg').showModal();
  $('keyInput').focus();
};
$('keyCancel').onclick = () => $('keyDlg').close();
$('keySave').onclick = async () => {
  const key = $('keyInput').value.trim();
  const name = $('keyName').value.trim() || 'principal';
  if (key) { await api.setKey($('provider').value, name, key); await refreshProviders(); loadModels(); }
  $('keyDlg').close();
};
$('keyDel').onclick = async () => {
  const k = providers[$('provider').value].keys;
  if (k.active) { await api.delKey($('provider').value, k.active); await refreshProviders(); }
  $('keyDlg').close();
};
$('keyInput').onkeydown = e => { if (e.key === 'Enter') $('keySave').click(); };

let treeTimer = null;
const refreshTree = () => { clearTimeout(treeTimer); treeTimer = setTimeout(() => { if (tab === 'work') renderTree(); }, 250); };

async function renderTree() {
  const t = $('tree');
  renderWsChip();
  if (!wsPath) {
    const e = h('div', 'tempty'), b = h('button', 'btn primary', 'Abrir carpeta');
    b.onclick = pickFolder;
    e.append(h('div', '', 'Elige una carpeta para trabajar con el agente.'), b);
    t.replaceChildren(e);
    return;
  }
  const list = h('div'), foot = h('button', 'btn', 'Cambiar carpeta');
  list.id = 'tlist';
  foot.onclick = pickFolder;
  t.replaceChildren(list, foot);
  await loadDir('', list, 0);
}

async function loadDir(rel, container, depth) {
  const r = await api.tree(rel);
  for (const e of r.entries) {
    const p = rel ? rel + '/' + e.name : e.name;
    const row = h('div', 'trow');
    row.style.paddingLeft = 10 + depth * 16 + 'px';
    if (e.dir) {
      const f = h('span', 'fold');
      f.append(icon('folder', 18));
      row.append(f, h('span', 'n', e.name + '/'));
    } else {
      row.append(badge(e.name), h('span', 'n', e.name));
      if (changed.has(p)) row.append(h('span', 'cdot'));
    }
    container.append(row);
    if (e.dir) {
      const sub = h('div');
      container.append(sub);
      row.onclick = async () => {
        if (openDirs.has(p)) { openDirs.delete(p); sub.replaceChildren(); }
        else { openDirs.add(p); await loadDir(p, sub, depth + 1); }
      };
      if (openDirs.has(p)) await loadDir(p, sub, depth + 1);
    }
  }
}

const MUTATING = ['write_file', 'edit_file', 'make_dir', 'delete_path'];
api.onEvent(ev => {
  if (ev.type === 'thinking') { if (busy) showThinking(); }
  else if (ev.type === 'delta') {
    hideThinking();
    cur ||= { el: addMsg('ai', ''), raw: '' };
    cur.raw += ev.text;
    setAi(cur.el, cur.raw);
    scroll();
  }
  else if (ev.type === 'assistant_end') { if (cur && !cur.raw.trim()) cur.el.remove(); cur = null; }
  else if (ev.type === 'notice') addMsg('note', ev.text);
  else if (ev.type === 'keys') refreshProviders();
  else if (ev.type === 'usage') { usageByTab[tab] = { turn: ev.turn, total: ev.total }; setUsage(usageByTab[tab]); }
  else if (ev.type === 'chat') { ids[tab] = ev.id; loadChats(); }
  else if (ev.type === 'error') { hideThinking(); addMsg('err', ev.text); setBusy(false); if (ev.text !== 'Detenido.') sfx('err'); loadChats(); }
  else if (ev.type === 'done') { setBusy(false); sfx('done'); loadChats(); }
  else if (ev.type === 'action') {
    hideThinking();
    acts[ev.id] = makeAct(ev);
    if (ev.ask) sfx('ask');
  }
  else if (ev.type === 'action_done') {
    const a = acts[ev.id];
    if (a) a.finish(ev.status, ev.text);
    if (ev.status === 'error') sfx('err');
    else if (ev.status === 'ok') {
      if (ev.name === 'run_command') sfx(/^exit=0\b/.test(ev.text || '') ? 'run' : 'err');
      else if (ev.name === 'delete_path') sfx('del');
      else if (['read_file', 'list_dir', 'search_text', 'find_files', 'test_look', 'test_detect'].includes(ev.name)) sfx('read');
      else sfx('ok');
    }
    if (ev.status === 'ok' && MUTATING.includes(ev.name)) {
      if (ev.path && ev.name !== 'delete_path') changed.add(norm(ev.path));
      renderChips();
      refreshTree();
    }
  }
});

init();
