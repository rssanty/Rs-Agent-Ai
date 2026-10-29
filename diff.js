const mk = (t, s) => ({ t, s });
const MAX = 400;

function lcs(x, y) {
  const n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map(l => mk('-', l)), ...y.map(l => mk('+', l))];
  const w = m + 1, t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(mk(' ', x[i])); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) out.push(mk('-', x[i++]));
    else out.push(mk('+', y[j++]));
  }
  while (i < n) out.push(mk('-', x[i++]));
  while (j < m) out.push(mk('+', y[j++]));
  return out;
}

function diff(a, b, ctx = 3) {
  const x = String(a).split('\n'), y = String(b).split('\n');
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const ops = [
    ...x.slice(0, s).map(l => mk(' ', l)),
    ...lcs(x.slice(s, x.length - e), y.slice(s, y.length - e)),
    ...x.slice(x.length - e).map(l => mk(' ', l))
  ];
  const keep = new Array(ops.length).fill(false);
  let changed = false;
  ops.forEach((o, i) => {
    if (o.t === ' ') return;
    changed = true;
    for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
  });
  if (!changed) return [mk('!', 'Sin cambios.')];
  const out = [];
  let gap = false;
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (gap && out.length) out.push(mk('.', '⋯'));
      gap = false;
      out.push(o);
    } else gap = true;
  });
  return out.length > MAX ? [...out.slice(0, MAX), mk('!', 'Vista recortada.')] : out;
}

function added(text) {
  const l = String(text).split('\n');
  const out = l.slice(0, 200).map(s => mk('+', s));
  if (l.length > 200) out.push(mk('!', `… ${l.length - 200} líneas más.`));
  return out;
}

function listing(abs, root) {
  const fs = require('fs'), path = require('path');
  if (!fs.existsSync(abs)) return [mk('!', 'No existe.')];
  const st = fs.statSync(abs);
  const rel = p => path.relative(root, p).split(path.sep).join('/') || '.';
  if (!st.isDirectory()) return [mk('-', `${rel(abs)} (${st.size} bytes)`)];
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= 60) return;
      const p = path.join(d, e.name);
      out.push(mk('-', rel(p) + (e.isDirectory() ? '/' : '')));
      if (e.isDirectory()) walk(p);
    }
  };
  out.push(mk('-', rel(abs) + '/'));
  walk(abs);
  if (out.length >= 60) out.push(mk('!', 'Lista recortada.'));
  return out;
}

module.exports = { diff, added, listing };
