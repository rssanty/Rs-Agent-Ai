const test = require('node:test');
const assert = require('node:assert');
const lin = require('../betatester/linux');

test('parseKeys traduce combinaciones a nombres de xdotool', () => {
  assert.deepStrictEqual(lin.parseKeys('ctrl+shift+t'), ['ctrl', 'shift', 't']);
  assert.deepStrictEqual(lin.parseKeys('Enter'), ['Return']);
  assert.deepStrictEqual(lin.parseKeys('alt+F4'), ['alt', 'f4']);
  assert.throws(() => lin.parseKeys('ctrl+nada'), /Tecla desconocida/);
});

test('NOT_SUPPORTED explica qué falta', () => {
  assert.ok(typeof lin.NOT_SUPPORTED === 'string');
  if (!lin.supported && process.platform === 'linux') assert.match(lin.NOT_SUPPORTED, /Falta/);
});
