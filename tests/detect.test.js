const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const detect = require('../betatester/detect');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsagent-det-'));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(root, k), v);
  return root;
}

test('detecta Electron como app de escritorio', () => {
  const r = detect.detect(project({ 'package.json': JSON.stringify({ devDependencies: { electron: '33' }, main: 'main.js' }), 'main.js': '' }));
  assert.strictEqual(r.kind, 'desktop');
  assert.strictEqual(r.stack, 'Electron');
});

test('detecta Vite como web con su URL', () => {
  const r = detect.detect(project({ 'package.json': JSON.stringify({ devDependencies: { vite: '5' }, scripts: { dev: 'vite' } }) }));
  assert.strictEqual(r.kind, 'web');
  assert.match(r.url, /localhost:5173/);
});

test('Python usa python3 fuera de Windows', () => {
  const r = detect.detect(project({ 'main.py': 'import tkinter' }));
  assert.strictEqual(r.stack, 'Tkinter');
  assert.match(r.run, process.platform === 'win32' ? /^python main\.py/ : /^python3 main\.py/);
});

test('proyecto vacío es unknown', () => {
  assert.strictEqual(detect.detect(project({ 'README.md': 'x' })).kind, 'unknown');
});
