const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../backup');
const compact = require('../compact');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-bk-'));

test('undoLast restaura un archivo editado y borra uno creado', () => {
  const base = tmp(), root = tmp();
  const f = path.join(root, 'a.txt');
  fs.writeFileSync(f, 'original');
  backup.record(base, 'chat1', root, 'write_file', f, 'a.txt');
  fs.writeFileSync(f, 'cambiado');
  const g = path.join(root, 'nuevo.txt');
  backup.record(base, 'chat1', root, 'write_file', g, 'nuevo.txt');
  fs.writeFileSync(g, 'x');
  assert.strictEqual(backup.undoLast(base, 'chat1', root).rel, 'nuevo.txt');
  assert.ok(!fs.existsSync(g));
  assert.strictEqual(backup.undoLast(base, 'chat1', root).rel, 'a.txt');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'original');
  assert.strictEqual(backup.undoLast(base, 'chat1', root), null);
});

test('undoLast rechaza otra carpeta y rutas que escapan', () => {
  const base = tmp(), root = tmp(), otra = tmp();
  const f = path.join(root, 'a.txt');
  fs.writeFileSync(f, 'x');
  backup.record(base, 'c', root, 'write_file', f, 'a.txt');
  assert.throws(() => backup.undoLast(base, 'c', otra), /otra carpeta/);
});

test('compact: plan conserva los últimos turnos y apply deja un resumen', () => {
  const h = [];
  for (let i = 0; i < 7; i++) h.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i });
  const pl = compact.plan(h);
  assert.ok(pl && pl.old.length === 6);
  compact.apply(h, pl.split, 'resumen');
  assert.strictEqual(h[0].summary, true);
  assert.strictEqual(h[1].ack, true);
  assert.strictEqual(compact.plan(h.slice(0, 4)), null);
});
