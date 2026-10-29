const fs = require('fs');
const path = require('path');

const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
const nums = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).map(Number).filter(n => !Number.isNaN(n)) : []);

function record(base, chatId, root, tool, target, rel) {
  const dir = path.join(base, chatId);
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.max(0, ...nums(dir)) + 1;
  const d = path.join(dir, String(n));
  fs.mkdirSync(d);
  const existed = fs.existsSync(target);
  const m = { n, tool, rel, root, existed, ts: Date.now(), undone: false, created: null };
  if (tool === 'make_dir' && !existed) {
    let p = target;
    while (!fs.existsSync(path.dirname(p))) p = path.dirname(p);
    m.created = p;
  }
  if (existed && tool !== 'make_dir') fs.cpSync(target, path.join(d, 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
  return n;
}

function discard(base, chatId, n) {
  fs.rmSync(path.join(base, chatId, String(n)), { recursive: true, force: true });
}

function undoLast(base, chatId, root) {
  const dir = path.join(base, chatId);
  for (const n of nums(dir).sort((a, b) => b - a)) {
    const mf = path.join(dir, String(n), 'manifest.json');
    let m;
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { continue; }
    if (m.undone) continue;
    if (m.root !== root) throw new Error('El último cambio pertenece a otra carpeta: ' + m.root);
    const target = path.join(m.root, m.rel);
    if (!inside(m.root, target)) throw new Error('Ruta inválida en el respaldo.');
    if (m.tool === 'make_dir') {
      if (m.created && inside(m.root, m.created)) fs.rmSync(m.created, { recursive: true, force: true });
    } else {
      fs.rmSync(target, { recursive: true, force: true });
      if (m.existed) fs.cpSync(path.join(dir, String(n), 'data'), target, { recursive: true });
    }
    m.undone = true;
    fs.writeFileSync(mf, JSON.stringify(m));
    return m;
  }
  return null;
}

module.exports = { record, discard, undoLast };
