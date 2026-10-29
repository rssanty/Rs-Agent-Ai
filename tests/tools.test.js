const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../tools');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-tools-'));

test('safe rechaza rutas fuera de la carpeta', () => {
  const root = tmp();
  assert.throws(() => tools.safe(root, '../x'), /fuera de la carpeta/);
  assert.throws(() => tools.safe(root, path.resolve(root, '..', 'otro')), /fuera de la carpeta/);
  assert.doesNotThrow(() => tools.safe(root, 'a/b/c.txt'));
});

test('safe rechaza enlaces simbólicos que escapan', { skip: process.platform === 'win32' }, () => {
  const root = tmp(), fuera = tmp();
  fs.symlinkSync(fuera, path.join(root, 'salida'));
  assert.throws(() => tools.safe(root, 'salida/secreto.txt'), /enlace simbólico/);
  fs.symlinkSync(path.join(fuera, 'no-existe'), path.join(root, 'roto'));
  assert.throws(() => tools.safe(root, 'roto'), /no resoluble|enlace/);
});

test('write_file, edit_file y delete_path', async () => {
  const root = tmp();
  await tools.run('write_file', { path: 'a/x.txt', content: 'hola mundo' }, root);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a/x.txt'), 'utf8'), 'hola mundo');
  await tools.run('edit_file', { path: 'a/x.txt', old: 'mundo', new: 'Rs' }, root);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a/x.txt'), 'utf8'), 'hola Rs');
  await assert.rejects(() => tools.run('edit_file', { path: 'a/x.txt', old: 'zzz', new: 'q' }, root), /0 veces/);
  await assert.rejects(() => tools.run('write_file', { path: 'b.txt', content: undefined }, root), /texto/);
  await tools.run('delete_path', { path: 'a' }, root);
  assert.ok(!fs.existsSync(path.join(root, 'a')));
});

test('read_file: rango, binarios y tamaño', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 't.txt'), 'uno\ndos\ntres\ncuatro');
  assert.match(await tools.run('read_file', { path: 't.txt', desde: 2, hasta: 3 }, root), /\[líneas 2-3 de 4\]\ndos\ntres/);
  fs.writeFileSync(path.join(root, 'b.bin'), Buffer.from([1, 2, 0, 3]));
  await assert.rejects(() => tools.run('read_file', { path: 'b.bin' }, root), /binario/);
});

test('search_text y find_files ignoran node_modules y respetan el glob', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'const NEEDLE = 1;');
  fs.writeFileSync(path.join(root, 'src/b.md'), 'needle en markdown');
  fs.writeFileSync(path.join(root, 'node_modules/c.js'), 'NEEDLE');
  const r = await tools.run('search_text', { query: 'needle', glob: '*.js' }, root, undefined, { skip: () => false });
  assert.match(r, /src\/a\.js:1/);
  assert.doesNotMatch(r, /node_modules|b\.md/);
  assert.match(await tools.run('find_files', { pattern: '**/*.md' }, root, undefined, { skip: () => false }), /src\/b\.md/);
  await assert.rejects(() => tools.run('search_text', { query: '(', regex: true }, root, undefined, { skip: () => false }), /Regex inválida/);
});

test('run_command devuelve código de salida y salida', async () => {
  const root = tmp();
  const out = await tools.run('run_command', { command: 'node -e "console.log(42);process.exit(3)"' }, root);
  assert.match(out, /exit=3/);
  assert.match(out, /42/);
});

test('toolsFor limita las herramientas por modo', () => {
  const names = m => tools.toolsFor(m).map(t => t.name);
  assert.ok(!names('plan').includes('write_file'));
  assert.ok(names('build').includes('write_file'));
  assert.ok(names('test').includes('test_open') && !names('test').includes('write_file'));
});
