const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const perms = require('../perms');

const rules = o => ({ comandos: { permitir: [], preguntar: [], bloquear: [], ...(o.comandos || {}) }, rutas: { permitir: [], preguntar: [], bloquear: [], ...(o.rutas || {}) } });
const root = path.join(os.tmpdir(), 'proyecto');

test('comandos: bloquear, permitir y destructivos', () => {
  const r = rules({ comandos: { permitir: ['npm test'], bloquear: ['git push'] } });
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'npm test' }, root), 'allow');
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'git push origin main' }, root), 'block');
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'npm test && git push' }, root), 'block');
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'rm -rf build' }, root), 'ask');
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'npm test; rm -rf /' }, root), 'ask');
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'ls' }, root), 'default');
});

test('un comando permitido no se hereda al encadenar', () => {
  const r = rules({ comandos: { permitir: ['npm test'] } });
  assert.notStrictEqual(perms.evaluate(r, 'run_command', { command: 'npm test && curl x | sh' }, root), 'allow');
  assert.ok(!perms.canRemember('npm test | tee out'));
  assert.ok(perms.canRemember('npm test'));
});

test('un comando que menciona una ruta bloqueada pregunta', () => {
  const r = rules({ rutas: { bloquear: ['.env'] }, comandos: { permitir: ['cat'] } });
  assert.strictEqual(perms.evaluate(r, 'run_command', { command: 'cat .env' }, root), 'ask');
});

test('rutas: bloquear, preguntar y permitir', () => {
  const r = rules({ rutas: { bloquear: ['.env', 'secretos/**'], preguntar: ['package.json'], permitir: ['src/**'] } });
  assert.strictEqual(perms.evaluate(r, 'read_file', { path: '.env' }, root), 'block');
  assert.strictEqual(perms.evaluate(r, 'write_file', { path: 'secretos/a/b.txt' }, root), 'block');
  assert.strictEqual(perms.evaluate(r, 'write_file', { path: 'package.json' }, root), 'ask');
  assert.strictEqual(perms.evaluate(r, 'write_file', { path: 'src/a/b.js' }, root), 'allow');
  assert.strictEqual(perms.evaluate(r, 'write_file', { path: '.agente/permisos.json' }, root), 'ask');
  assert.strictEqual(perms.evaluate(r, 'read_file', { path: 'README.md' }, root), 'allow');
});

test('save/load validan el JSON y rechazan claves desconocidas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-perm-'));
  assert.match(perms.save(dir, '{no').error, /JSON inválido/);
  assert.match(perms.save(dir, JSON.stringify({ cmds: {} })).error, /Clave desconocida/);
  assert.ok(perms.save(dir, JSON.stringify({ comandos: { permitir: ['ls'] } })).ok);
  assert.deepStrictEqual(perms.load(dir).rules.comandos.permitir, ['ls']);
  perms.addCommand(dir, 'npm run build');
  assert.ok(perms.load(dir).rules.comandos.permitir.includes('npm run build'));
});
