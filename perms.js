const fs = require('fs');
const path = require('path');

const MUT = new Set(['write_file', 'edit_file', 'make_dir', 'delete_path']);
const EMPTY = { comandos: { permitir: [], preguntar: [], bloquear: [] }, rutas: { permitir: [], preguntar: [], bloquear: [] } };
const GROUPS = ['comandos', 'rutas'];
const LISTS = ['permitir', 'preguntar', 'bloquear'];
const CHAIN = /&&|\|\||[;|`<>\n\r]|\$\(/;
const DESTRUCTIVE = [
  /(^|[\s;&|(])(rm|rmdir|del|erase|rd|format|mkfs|dd|shutdown|reboot|sudo|doas|chown|chmod|mv|move|kill|killall|taskkill|diskpart|fdisk)(\s|$)/i,
  /remove-item/i,
  /git\s+(push\s.*(-f\b|--force)|reset\s+--hard|clean)/i,
  /(curl|wget|iwr|irm)[^|]*\|\s*(sh|bash|zsh|iex|powershell)/i
];

const file = root => path.join(root, '.agente', 'permisos.json');
const template = () => JSON.stringify({ comandos: { permitir: [], preguntar: [], bloquear: [] }, rutas: { permitir: [], preguntar: [], bloquear: ['.env'] } }, null, 2);

function check(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'Debe ser un objeto JSON.';
  for (const k of Object.keys(o)) if (!GROUPS.includes(k)) return `Clave desconocida: "${k}". Usa "comandos" y "rutas".`;
  for (const g of GROUPS) {
    const v = o[g];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `"${g}" debe ser un objeto.`;
    for (const k of Object.keys(v)) {
      if (!LISTS.includes(k)) return `Clave desconocida en "${g}": "${k}". Usa permitir, preguntar o bloquear.`;
      if (!Array.isArray(v[k]) || v[k].some(x => typeof x !== 'string' || !x.trim())) return `"${g}.${k}" debe ser una lista de textos no vacíos.`;
    }
  }
  return null;
}

const norm = o => ({ comandos: { ...EMPTY.comandos, ...(o.comandos || {}) }, rutas: { ...EMPTY.rutas, ...(o.rutas || {}) } });

function load(root) {
  const f = file(root);
  if (!fs.existsSync(f)) return { rules: EMPTY, error: null };
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    const e = check(o);
    return e ? { rules: EMPTY, error: e } : { rules: norm(o), error: null };
  } catch (e) { return { rules: EMPTY, error: 'JSON inválido: ' + e.message }; }
}

const read = root => (fs.existsSync(file(root)) ? fs.readFileSync(file(root), 'utf8') : template());

function save(root, text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return { error: 'JSON inválido: ' + e.message }; }
  const err = check(o);
  if (err) return { error: err };
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(o, null, 2));
  return { ok: true };
}

function addCommand(root, cmd) {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(file(root), 'utf8')); if (check(o)) o = {}; } catch {}
  const n = norm(o);
  if (!n.comandos.permitir.includes(cmd)) n.comandos.permitir.push(cmd);
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(n, null, 2));
}

const canRemember = cmd => typeof cmd === 'string' && cmd.trim() !== '' && !CHAIN.test(cmd) && !DESTRUCTIVE.some(r => r.test(cmd));

const glob = g => {
  const e = g.trim().replace(/^\.\//, '').replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp('^' + e + '(/.*)?$');
};

function evaluate(rules, tool, args, root) {
  if (tool === 'run_command') {
    const cmd = String(args.command || '').trim();
    const pre = (list, c) => list.some(p => c === p.trim() || c.startsWith(p.trim() + ' '));
    const segs = cmd.split(/&&|\|\||[;|\n\r]/).map(s => s.trim());
    if (segs.some(sg => pre(rules.comandos.bloquear, sg))) return 'block';
    if (DESTRUCTIVE.some(r => r.test(cmd))) return 'ask';
    const lit = rules.rutas.bloquear.map(g => g.trim().replace(/^\.\//, '')).filter(g => g && !/[*?]/.test(g));
    if (lit.some(g => cmd.toLowerCase().includes(g.toLowerCase()))) return 'ask';
    if (pre(rules.comandos.preguntar, cmd)) return 'ask';
    if (canRemember(cmd) && pre(rules.comandos.permitir, cmd)) return 'allow';
    return 'default';
  }
  if (!args.path) return 'default';
  const rel = path.relative(root, path.resolve(root, args.path)).split(path.sep).join('/');
  if (rel.startsWith('..')) return 'default';
  const m = list => list.some(g => glob(g).test(rel));
  if (m(rules.rutas.bloquear)) return 'block';
  if (!MUT.has(tool)) return 'allow';
  if (rel === '.agente' || rel.startsWith('.agente/') || m(rules.rutas.preguntar)) return 'ask';
  if (m(rules.rutas.permitir)) return 'allow';
  return 'default';
}

function log(root, state, tool, detail) {
  try {
    fs.mkdirSync(path.join(root, '.agente'), { recursive: true });
    fs.appendFileSync(path.join(root, '.agente', 'registro.log'), `${new Date().toISOString()}\t${state}\t${tool}\t${String(detail).replace(/\s+/g, ' ').slice(0, 300)}\n`);
  } catch {}
}

const isBlocked = (rules, rel) => rules.rutas.bloquear.some(g => glob(g).test(rel));

module.exports = { isBlocked, MUT, EMPTY, load, read, save, addCommand, canRemember, evaluate, log };
