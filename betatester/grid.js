const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const autoGrid = (w, h, target = 110, max = 24) => ({ cols: clamp(Math.round(w / target), 4, max), rows: clamp(Math.round(h / target), 4, max) });

function parseCell(s) {
  if (s && typeof s === 'object') return { col: Number(s.col), row: Number(s.row) };
  const m = String(s).match(/(\d+)\D+(\d+)/);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

const inGrid = (c, cols, rows) => !!c && c.col >= 1 && c.col <= cols && c.row >= 1 && c.row <= rows;

function cellCenter(view, c) {
  const { region, cols, rows } = view;
  return { x: Math.round(region.x + (c.col - 0.5) * region.w / cols), y: Math.round(region.y + (c.row - 0.5) * region.h / rows) };
}

function cellOf(w, h, cols, rows, px, py) {
  return { col: clamp(Math.floor(px / (w / cols)) + 1, 1, cols), row: clamp(Math.floor(py / (h / rows)) + 1, 1, rows) };
}

function zoomRegion(full, c) {
  const cw = full.w / full.cols, ch = full.h / full.rows;
  const x = Math.max(0, (c.col - 1) * cw - cw / 2), y = Math.max(0, (c.row - 1) * ch - ch / 2);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(cw * 2, full.w - x)), h: Math.round(Math.min(ch * 2, full.h - y)) };
}

function groupWords(words) {
  const lines = new Map();
  for (const w of words) { if (!lines.has(w.l)) lines.set(w.l, []); lines.get(w.l).push(w); }
  const items = [];
  for (const ws of lines.values()) {
    ws.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const w of ws) {
      if (cur && w.x - (cur.x + cur.w) <= Math.max(cur.h, w.h) * 0.9) {
        const r = Math.max(cur.x + cur.w, w.x + w.w), b = Math.max(cur.y + cur.h, w.y + w.h);
        cur.text += ' ' + w.t;
        cur.y = Math.min(cur.y, w.y);
        cur.w = r - cur.x;
        cur.h = b - cur.y;
      } else {
        if (cur) items.push(cur);
        cur = { text: w.t, x: w.x, y: w.y, w: w.w, h: w.h };
      }
    }
    if (cur) items.push(cur);
  }
  return items;
}

function buildView({ region, cols, rows, words, scale }) {
  const ws = words.map(w => ({ t: String(w.t), l: w.l, x: w.x / scale, y: w.y / scale, w: w.w / scale, h: w.h / scale }));
  const items = groupWords(ws).map(i => {
    const cx = i.x + i.w / 2, cy = i.y + i.h / 2;
    const c = cellOf(region.w, region.h, cols, rows, cx, cy);
    return { text: i.text, col: c.col, row: c.row, x: Math.round(region.x + cx), y: Math.round(region.y + cy) };
  });
  items.sort((a, b) => a.row - b.row || a.col - b.col || a.y - b.y || a.x - b.x);
  items.forEach((it, k) => { it.id = k + 1; });
  return { region, cols, rows, items };
}

function buildDomView({ region, cols, rows, items }) {
  const out = [];
  for (const i of items) {
    const cx = i.x + i.w / 2, cy = i.y + i.h / 2;
    if (cx < region.x || cy < region.y || cx > region.x + region.w || cy > region.y + region.h) continue;
    const c = cellOf(region.w, region.h, cols, rows, cx - region.x, cy - region.y);
    out.push({ text: i.text, kind: i.kind, col: c.col, row: c.row, x: Math.round(cx), y: Math.round(cy) });
  }
  out.sort((a, b) => (b.kind !== 'texto') - (a.kind !== 'texto') || a.row - b.row || a.col - b.col || a.y - b.y || a.x - b.x);
  const cut = out.slice(0, 150);
  cut.sort((a, b) => a.row - b.row || a.col - b.col || a.y - b.y || a.x - b.x);
  cut.forEach((it, k) => { it.id = k + 1; });
  return { region, cols, rows, items: cut, total: out.length };
}

function render({ win, view, label, maxItems = 150, dom = false }) {
  const cw = Math.round(view.region.w / view.cols), ch = Math.round(view.region.h / view.rows);
  const head = `Ventana "${win.title}" ${win.w}×${win.h}. Vista: ${label} · cuadrícula ${view.cols} columnas × ${view.rows} filas (celda ≈ ${cw}×${ch} px).`;
  const shown = view.items.slice(0, maxItems);
  const L = [head];
  if (shown.length) {
    L.push(`${view.items.length} elementos de texto:`);
    shown.forEach(i => L.push(`#${i.id} ${i.kind ? '[' + i.kind + '] ' : ''}"${i.text.slice(0, 60)}" celda ${i.col},${i.row}`));
    if ((view.total || view.items.length) > shown.length) L.push(`… ${(view.total || view.items.length) - shown.length} más (usa zoom para ver una zona).`);
  } else L.push('No se detectó texto. Ubica los elementos por celda o verifica que la ventana esté visible.');
  L.push(dom ? 'Lectura del DOM: los iconos aparecen con su nombre (aria-label, title o clase). Actúa con test_click (item # o cell). Afina con test_look zoom "columna,fila".' : 'Actúa con test_click (item # o cell "columna,fila"). Afina una zona con test_look zoom "columna,fila". Los [icono?] son iconos sin texto detectados por su forma (heurística, pueden fallar): haz clic y confirma con otro test_look; ajusta con zoom.');
  return L.join('\n');
}

module.exports = { buildDomView, autoGrid, parseCell, inGrid, cellCenter, cellOf, zoomRegion, groupWords, buildView, render };
