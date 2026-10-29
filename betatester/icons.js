// Detección heurística de iconos sin texto en una captura PNG (apps nativas, sin DOM).
const fs = require('fs');
const zlib = require('zlib');

function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null;
  const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
    else if (type === 'PLTE') plte = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || il !== 0 || ![0, 2, 3, 6].includes(ct) || !w || !h || (ct === 3 && !plte)) return null;
  const bpp = { 0: 1, 2: 3, 3: 1, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (ct === 0) g[i] = out[i];
    else if (ct === 3) { const k = out[i] * 3; g[i] = (plte[k] * 77 + plte[k + 1] * 150 + plte[k + 2] * 29) >> 8; }
    else g[i] = (out[i * bpp] * 77 + out[i * bpp + 1] * 150 + out[i * bpp + 2] * 29) >> 8;
  }
  return { w, h, g };
}

// Palabra que el OCR probablemente leyó de un icono (símbolos sueltos o baja confianza).
const isJunk = k => (k.c != null && k.c < 70 && String(k.t).length <= 3) || /^[^\p{L}\p{N}]{1,3}$/u.test(String(k.t)) || (String(k.t).length <= 2 && k.w >= 30 && k.h >= 30);

function findIcons(file, allWords = [], { min = 12, max = 72, scale = 1, limit = 30 } = {}) {
  const words = allWords.filter(k => !isJunk(k));
  let img;
  try { img = decodePng(fs.readFileSync(file)); } catch { return []; }
  if (!img) return [];
  const { w, h, g } = img;
  const lo = Math.round(min * scale), hi = Math.round(max * scale);
  const e = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]) > 40) e[i] = 1;
  }
  const M = Math.max(2, Math.round(3 * scale));
  for (const k of words) {
    const x0 = Math.floor(k.x - M), y0 = Math.floor(k.y - M), x1 = Math.ceil(k.x + k.w + M), y1 = Math.ceil(k.y + k.h + M);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) e.fill(0, y * w + Math.max(0, x0), y * w + Math.min(w, x1));
  }
  const boxes = [];
  const pass = R => {
    const t = new Uint8Array(w * h), d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      const row = y * w;
      for (let x = 0; x < w; x++) { if (e[row + x]) last = x; if (x - last <= R) t[row + x] = 1; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (e[row + x]) last = x; if (last - x <= R) t[row + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= R) d[y * w + x] = 1; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= R) d[y * w + x] = 1; }
    }
    const seen = new Uint8Array(w * h), stack = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!d[s0] || seen[s0]) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
      seen[s0] = 1; stack.push(s0);
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i - x) / w;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (d[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      const bx = x0 + R, by = y0 + R, bw = x1 - x0 - 2 * R, bh = y1 - y0 - 2 * R;
      if (bw < lo || bh < lo || bw > hi || bh > hi || n < 40) continue;
      const ar = bw / bh;
      if (ar < 0.35 || ar > 3) continue;
      if (words.some(k => k.x + k.w / 2 > bx && k.x + k.w / 2 < bx + bw && k.y + k.h / 2 > by && k.y + k.h / 2 < by + bh)) continue;
      const dup = boxes.some(o => { const ix = Math.max(0, Math.min(o.x + o.w, bx + bw) - Math.max(o.x, bx)), iy = Math.max(0, Math.min(o.y + o.h, by + bh) - Math.max(o.y, by)); return ix * iy > 0.5 * Math.min(o.w * o.h, bw * bh); });
      if (!dup) boxes.push({ x: bx, y: by, w: bw, h: bh });
    }
  };
  pass(0);
  pass(Math.max(1, Math.round(1 * scale)));
  pass(Math.max(2, Math.round(3 * scale)));
  const kept = boxes.filter(a => !boxes.some(b => b !== a && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && b.w * b.h > a.w * a.h));
  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  return kept.slice(0, limit);
}

// Quita del OCR las palabras basura que caen dentro de un icono detectado.
const dropJunkInside = (words, icons) => words.filter(k => !(isJunk(k) && icons.some(b => k.x + k.w / 2 >= b.x - 4 && k.x + k.w / 2 <= b.x + b.w + 4 && k.y + k.h / 2 >= b.y - 4 && k.y + k.h / 2 <= b.y + b.h + 4)));

module.exports = { findIcons, decodePng, isJunk, dropJunkInside };
