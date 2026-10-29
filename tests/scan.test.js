const test = require('node:test');
const assert = require('node:assert');
const scan = require('../betatester/scan');

test('scan.js es una función autocontenida que se puede inyectar', () => {
  assert.strictEqual(typeof scan.scan, 'function');
  assert.doesNotThrow(() => new Function('return ' + scan.source));
  assert.ok(!/require\(/.test(scan.source));
});
