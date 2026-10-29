const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const icons = require('../betatester/icons');

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; }
function png(w, h, draw) {
  const px = Buffer.alloc(w * h, 255);
  draw((x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = 0; });
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; px.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const tmp = name => path.join(os.tmpdir(), 'rsagent-' + process.pid + '-' + name);

test('decodePng lee un PNG en gris', () => {
  const f = tmp('a.png');
  fs.writeFileSync(f, png(20, 10, set => set(3, 3)));
  const img = icons.decodePng(fs.readFileSync(f));
  assert.strictEqual(img.w, 20);
  assert.strictEqual(img.g[3 * 20 + 3], 0);
});

test('findIcons detecta un icono sin texto', () => {
  const f = tmp('b.png');
  fs.writeFileSync(f, png(200, 120, set => {
    for (let i = 0; i < 30; i++) { set(40 + i, 40); set(40 + i, 70); set(40, 40 + i); set(70, 40 + i); set(40 + i, 40 + i); set(70 - i, 40 + i); }
  }));
  const found = icons.findIcons(f, []);
  assert.strictEqual(found.length, 1);
  assert.ok(found[0].w >= 25 && found[0].w <= 40);
});

test('findIcons ignora zonas ocupadas por texto del OCR', () => {
  const f = tmp('c.png');
  fs.writeFileSync(f, png(200, 120, set => { for (let i = 0; i < 30; i++) { set(40 + i, 40); set(40 + i, 70); set(40, 40 + i); set(70, 40 + i); } }));
  assert.strictEqual(icons.findIcons(f, [{ t: 'Guardar', x: 38, y: 38, w: 36, h: 36, c: 95 }]).length, 0);
});

test('isJunk reconoce símbolos sueltos del OCR', () => {
  assert.ok(icons.isJunk({ t: '®&)', x: 0, y: 0, w: 10, h: 10 }));
  assert.ok(!icons.isJunk({ t: 'Archivo', x: 0, y: 0, w: 60, h: 14, c: 95 }));
});
