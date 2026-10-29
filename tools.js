const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const bt = require('./betatester');

const DEFS = [
  { name: 'list_dir', description: 'Lista archivos y carpetas de un directorio.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', description: 'Lee un archivo de texto. Opcional: desde y hasta (número de línea, desde 1) para leer solo un rango.', parameters: { type: 'object', properties: { path: { type: 'string' }, desde: { type: 'integer' }, hasta: { type: 'integer' } }, required: ['path'] } },
  { name: 'search_text', description: 'Busca texto (o regex) dentro de los archivos del proyecto. Ignora node_modules, .git y binarios.', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, regex: { type: 'boolean' }, case_sensitive: { type: 'boolean' }, glob: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } },
  { name: 'find_files', description: 'Busca archivos por patrón glob (ej. **/*.js, *.md, src/**/test*.ts).', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer' } }, required: ['pattern'] } },
  { name: 'write_file', description: 'Crea o sobrescribe un archivo.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Reemplaza un fragmento exacto (único) de un archivo.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'make_dir', description: 'Crea una carpeta (recursivo).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'delete_path', description: 'Elimina un archivo o carpeta.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'run_command', description: 'Ejecuta un comando de shell. cwd opcional: cualquier ruta del sistema; por defecto la carpeta de trabajo.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] } }
];

const READ_ONLY = new Set(['list_dir', 'read_file', 'search_text', 'find_files']);
const EDITS = new Set(['write_file', 'edit_file', 'make_dir']);
const toolsFor = mode => (mode === 'plan' ? DEFS.filter(t => READ_ONLY.has(t.name)) : mode === 'test' ? [...DEFS.filter(t => READ_ONLY.has(t.name) || t.name === 'run_command'), ...bt.DEFS] : DEFS);

function safe(root, p) {
  const full = path.resolve(root, p || '.');
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Ruta fuera de la carpeta de trabajo: ' + p);
  // Resuelve enlaces simbólicos del ancestro existente más profundo para que no saquen la ruta de la carpeta.
  let probe = full;
  for (;;) {
    try { fs.lstatSync(probe); break; } catch { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  }
  let real, rootReal;
  try { real = fs.realpathSync(probe); rootReal = fs.realpathSync(root); } catch { throw new Error('Ruta no resoluble (¿enlace roto?): ' + p); }
  const r2 = path.relative(rootReal, real);
  if (r2.startsWith('..') || path.isAbsolute(r2)) throw new Error('Ruta fuera de la carpeta de trabajo (enlace simbólico): ' + p);
  return full;
}

const IGNORE = new Set(['node_modules', '.git', '.agente']);
const MAX_FILE = 1.5 * 1024 * 1024;

function walk(root, start, skip, limit = 20000) {
  const out = [];
  const rec = dir => {
    if (out.length >= limit) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= limit) return;
      if (IGNORE.has(e.name)) continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (skip && skip(rel)) continue;
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) out.push({ p, rel });
    }
  };
  rec(start);
  return out;
}

const isBinary = p => {
  try {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(4096);
    const n = fs.readSync(fd, b, 0, 4096, 0);
    fs.closeSync(fd);
    return b.subarray(0, n).includes(0);
  } catch { return true; }
};

const globRe = g => {
  const e = g.trim().replace(/^\.\//, '').replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?').replace(/\u0000/g, '.*');
  return new RegExp('^' + e + '$');
};

function searchText(a, root, opts) {
  const start = safe(root, a.path || '.');
  const max = Math.min(300, Math.max(1, parseInt(a.max_results) || 100));
  let re = null;
  try { if (a.regex) re = new RegExp(a.query, a.case_sensitive ? '' : 'i'); } catch (e) { throw new Error('Regex inválida: ' + e.message); }
  const needle = a.case_sensitive ? String(a.query) : String(a.query).toLowerCase();
  const filter = a.glob ? globRe(a.glob) : null;
  const out = [];
  let nfiles = 0, truncated = false;
  for (const f of walk(root, start, opts.skip)) {
    if (filter && !filter.test(a.glob.includes('/') ? f.rel : path.basename(f.rel))) continue;
    let st;
    try { st = fs.statSync(f.p); } catch { continue; }
    if (st.size > MAX_FILE || isBinary(f.p)) continue;
    let text;
    try { text = fs.readFileSync(f.p, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const ok = re ? re.test(ln.length > 3000 ? ln.slice(0, 3000) : ln) : (a.case_sensitive ? ln : ln.toLowerCase()).includes(needle);
      if (!ok) continue;
      if (out.length >= max) { truncated = true; break; }
      hit = true;
      out.push(`${f.rel}:${i + 1}: ${ln.trim().slice(0, 200)}`);
    }
    if (hit) nfiles++;
    if (truncated) break;
  }
  if (!out.length) return 'Sin coincidencias.';
  return `${out.length} coincidencias en ${nfiles} archivos${truncated ? ' (truncado; afina la búsqueda)' : ''}\n` + out.join('\n');
}

function findFiles(a, root, opts) {
  const start = safe(root, a.path || '.');
  const max = Math.min(500, Math.max(1, parseInt(a.max_results) || 200));
  const pat = String(a.pattern);
  const re = globRe(pat);
  const byName = !pat.includes('/');
  const out = [];
  for (const f of walk(root, start, opts.skip)) {
    if (re.test(byName ? path.basename(f.rel) : f.rel)) { out.push(f.rel); if (out.length >= max) break; }
  }
  return out.length ? `${out.length} archivos${out.length >= max ? ' (truncado)' : ''}\n` + out.join('\n') : 'Sin archivos.';
}

const MAX_READ = 10 * 1024 * 1024;

function readFile(a, root) {
  const f = safe(root, a.path);
  const st = fs.statSync(f);
  if (!st.isFile()) throw new Error('No es un archivo: ' + a.path);
  if (st.size > MAX_READ) throw new Error(`Archivo demasiado grande (${Math.round(st.size / 1048576)} MB; máximo 10 MB). Usa search_text o run_command (head/tail).`);
  if (isBinary(f)) throw new Error('Parece un archivo binario; no se puede leer como texto.');
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  const total = lines.length;
  const ranged = a.desde != null || a.hasta != null;
  const from = Math.max(1, parseInt(a.desde) || 1);
  const to = Math.min(total, parseInt(a.hasta) || total);
  let body = ranged ? lines.slice(from - 1, to).join('\n') : text;
  const head = ranged ? `[líneas ${from}-${to} de ${total}]\n` : '';
  if (body.length > 20000) {
    body = body.slice(0, 20000);
    return head + body + `\n[recortado: se muestran ~${body.split('\n').length} líneas de ${total}; usa desde/hasta para leer el resto]`;
  }
  return head + body;
}

const cut = (s, n = 20000) => (s.length > n ? s.slice(0, n) + '\n...[recortado]' : s);

async function run(name, a, root, signal, opts = {}) {
  if (bt.isTool(name)) return bt.run(name, a, { root, signal });
  switch (name) {
    case 'list_dir':
      return fs.readdirSync(safe(root, a.path), { withFileTypes: true }).map(d => (d.isDirectory() ? d.name + '/' : d.name)).join('\n') || '(vacío)';
    case 'read_file': return readFile(a, root);
    case 'search_text': return searchText(a, root, opts);
    case 'find_files': return findFiles(a, root, opts);
    case 'write_file': {
      if (typeof a.content !== 'string') throw new Error('content debe ser un texto.');
      const f = safe(root, a.path);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, a.content);
      return 'Escrito: ' + a.path;
    }
    case 'edit_file': {
      if (typeof a.old !== 'string' || typeof a.new !== 'string' || !a.old) throw new Error('old y new deben ser textos (old no vacío).');
      const f = safe(root, a.path);
      const txt = fs.readFileSync(f, 'utf8');
      const n = txt.split(a.old).length - 1;
      if (n !== 1) throw new Error(`El fragmento aparece ${n} veces; debe aparecer exactamente 1.`);
      fs.writeFileSync(f, txt.replace(a.old, () => a.new));
      return 'Editado: ' + a.path;
    }
    case 'make_dir': fs.mkdirSync(safe(root, a.path), { recursive: true }); return 'Carpeta creada: ' + a.path;
    case 'delete_path': fs.rmSync(safe(root, a.path), { recursive: true, force: true }); return 'Eliminado: ' + a.path;
    case 'run_command': {
      const cwd = a.cwd ? path.resolve(root, a.cwd) : root;
      if (!fs.existsSync(cwd)) throw new Error('cwd no existe: ' + cwd);
      return new Promise(resolve => {
        exec(a.command, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, signal, windowsHide: true }, (err, out, errout) => {
          resolve(cut(`exit=${err ? err.code ?? 'error' : 0}\n${out}${errout ? '\n[stderr]\n' + errout : ''}`));
        });
      });
    }
    default: throw new Error('Herramienta desconocida: ' + name);
  }
}

const onlyCommand = () => DEFS.filter(t => t.name === 'run_command');
const find = n => DEFS.find(d => d.name === n) || bt.DEFS.find(d => d.name === n);

const listFiles = (root, skip) => walk(root, root, skip, 5000).map(f => f.rel);

module.exports = { listFiles, safe, onlyCommand, find, toolsFor, run, READ_ONLY, EDITS };
