// Se ejecuta DENTRO de la página (vía CDP). Debe ser autocontenida.
function scan() {
  const vw = innerWidth, vh = innerHeight;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const CLICK = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[onclick],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  const ICON_CLASS = /(?:^|\s)(?:fa-|bi-|icon-|icon_|mdi-|ti-|lucide-|ph-|codicon-|feather-|glyphicon-)([\w-]+)/;

  const visible = (el, r) => {
    if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  };
  const center = r => {
    const x1 = Math.max(r.left, 0), x2 = Math.min(r.right, vw), y1 = Math.max(r.top, 0), y2 = Math.min(r.bottom, vh);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
  };
  const iconName = el => {
    const nodes = [el, ...Array.from(el.querySelectorAll('svg,i,span,img,use')).slice(0, 6)];
    for (const n of nodes) {
      const title = n.querySelector && n.querySelector('title');
      if (title && clean(title.textContent)) return clean(title.textContent);
      const tag = (n.tagName || '').toLowerCase();
      if (tag === 'img') {
        const a = clean(n.alt || n.title);
        if (a) return a;
        const f = (n.getAttribute('src') || '').split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
        if (f && !f.startsWith('data:')) return f;
      }
      if (tag === 'use') { const h = n.getAttribute('href') || n.getAttribute('xlink:href'); if (h) return h.replace(/^.*#/, ''); }
      const cls = typeof n.className === 'string' ? n.className : clean(n.getAttribute && n.getAttribute('class'));
      const m = cls.match(ICON_CLASS);
      if (m) return m[1];
      const tx = clean(n.textContent);
      if ((tag === 'span' || tag === 'i') && /material|symbol|icon/i.test(cls) && /^[a-z_]{2,30}$/.test(tx)) return tx;
      const a2 = n !== el ? clean(n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('title'))) : '';
      if (a2) return a2;
    }
    return '';
  };
  const kindOf = el => {
    const t = el.tagName.toLowerCase(), role = el.getAttribute('role');
    if (t === 'input') {
      const ty = (el.type || 'text').toLowerCase();
      if (ty === 'checkbox') return 'casilla';
      if (ty === 'radio') return 'opción';
      if (['button', 'submit', 'reset', 'image'].includes(ty)) return 'botón';
      return 'campo';
    }
    if (t === 'textarea' || el.isContentEditable) return 'campo';
    if (t === 'select') return 'lista';
    if (t === 'a' || role === 'link') return 'enlace';
    if (t === 'button' || role === 'button' || t === 'summary') return 'botón';
    if (role === 'tab') return 'pestaña';
    if (role === 'checkbox' || role === 'switch') return 'casilla';
    if (role === 'menuitem' || role === 'option') return 'menú';
    return 'clic';
  };
  const labelOf = (el, st) => {
    const t = el.tagName.toLowerCase();
    const aria = clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
    if (t === 'input' || t === 'textarea' || t === 'select') {
      const ty = (el.type || '').toLowerCase();
      const lab = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
      if (ty === 'button' || ty === 'submit' || ty === 'reset') return clean(el.value) || aria || ty;
      const val = t === 'select' ? clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text) : clean(el.value);
      const parts = [aria || clean(lab && lab.textContent) || clean(el.placeholder) || clean(el.name) || clean(el.id) || 'sin nombre'];
      if (val && ty !== 'password') parts.push('= "' + val.slice(0, 30) + '"');
      if (ty === 'checkbox' || ty === 'radio') parts.push(el.checked ? '(marcada)' : '(sin marcar)');
      if (el.disabled) parts.push('(deshabilitado)');
      return parts.join(' ');
    }
    let r = clean(el.innerText || el.textContent).slice(0, 60);
    if (!r) r = aria;
    if (!r || (aria && r.length <= 2)) { /* icono con nombre accesible o sin texto */ }
    if (!clean(el.innerText || el.textContent)) {
      st.icon = true;
      if (!r) r = iconName(el);
    }
    if (!r) r = clean(el.getAttribute('data-testid')) || clean(el.id) || clean(el.getAttribute('name')) || clean(el.getAttribute('href')) || 'sin nombre';
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') r += ' (deshabilitado)';
    return r;
  };

  const roots = [document];
  for (let i = 0; i < roots.length && roots.length < 200; i++) {
    for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  }
  const everything = [];
  for (const r of roots) for (const e of r.querySelectorAll('*')) everything.push(e);
  const set = new Set();
  for (const r of roots) for (const e of r.querySelectorAll(CLICK)) set.add(e);
  let n = 0;
  {
    for (const el of everything) {
      if (++n > 6000) break;
      if (set.has(el)) continue;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HTML' || tag === 'BODY') continue;
      const p = el.parentElement;
      if (getComputedStyle(el).cursor === 'pointer' && !(p && getComputedStyle(p).cursor === 'pointer')) set.add(el);
    }
  }

  const cand = [];
  for (const el of set) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const c = center(r);
    const rootNode = el.getRootNode && el.getRootNode();
    const top = (rootNode && rootNode.elementFromPoint ? rootNode : document).elementFromPoint(Math.min(vw - 1, Math.max(0, c.x)), Math.min(vh - 1, Math.max(0, c.y)));
    if (top && !(el.contains(top) || top.contains(el))) continue;
    const st = { icon: false };
    const text = labelOf(el, st);
    const kind = kindOf(el);
    cand.push({ el, kind: st.icon ? 'icono ' + kind : kind, text, x: c.x, y: c.y, w: c.w, h: c.h });
  }
  const items = cand.filter(a => !cand.some(b => b !== a && a.el.contains(b.el) && a.text === b.text))
    .slice(0, 300)
    .map(a => ({ kind: a.kind, text: a.text, x: Math.round(a.x - a.w / 2), y: Math.round(a.y - a.h / 2), w: Math.round(a.w), h: Math.round(a.h), el: a.el }));

  const own = new Set(items.map(i => i.el));
  const inClickable = node => { for (let e = node.parentElement, d = 0; e && d < 5; e = e.parentElement, d++) if (own.has(e) || set.has(e)) return true; return false; };
  const texts = [];
  let seen = 0;
  const textNodes = [];
  for (const r of roots) {
    const walker = document.createTreeWalker(r === document ? (document.body || document.documentElement) : r, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && textNodes.length < 2500) textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    if (seen++ >= 2500 || texts.length >= 200) break;
    const tx = clean(node.nodeValue);
    if (tx.length < 2) continue;
    const p = node.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || inClickable(node)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!visible(p, r)) continue;
    const c = center(r);
    texts.push({ kind: 'texto', text: tx.slice(0, 80), x: Math.round(c.x - c.w / 2), y: Math.round(c.y - c.h / 2), w: Math.round(c.w), h: Math.round(c.h) });
  }
  const se = document.scrollingElement || document.documentElement;
  return {
    vw, vh, title: document.title, url: location.href,
    scrollY: Math.round(se.scrollTop), scrollMax: Math.max(0, Math.round(se.scrollHeight - vh)),
    items: items.map(({ el, ...rest }) => rest).concat(texts)
  };
}

module.exports = { scan, source: '(' + scan.toString() + ')()' };
