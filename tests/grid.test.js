const test = require('node:test');
const assert = require('node:assert');
const grid = require('../betatester/grid');

test('buildDomView asigna celdas e ids estables', () => {
  const v = grid.buildDomView({ region: { x: 0, y: 0, w: 1000, h: 800 }, cols: 10, rows: 8, items: [
    { text: 'menu', kind: 'icono botón', x: 10, y: 10, w: 20, h: 20 },
    { text: 'Hola', kind: 'texto', x: 500, y: 400, w: 50, h: 20 }
  ] });
  assert.strictEqual(v.items.length, 2);
  const icon = v.items.find(i => i.text === 'menu');
  assert.deepStrictEqual([icon.col, icon.row], [1, 1]);
  assert.deepStrictEqual(v.items.map(i => i.id).sort(), [1, 2]);
});

test('buildDomView descarta lo que queda fuera de la región (zoom)', () => {
  const v = grid.buildDomView({ region: { x: 500, y: 0, w: 500, h: 400 }, cols: 5, rows: 4, items: [
    { text: 'fuera', kind: 'botón', x: 10, y: 10, w: 20, h: 20 },
    { text: 'dentro', kind: 'botón', x: 600, y: 100, w: 20, h: 20 }
  ] });
  assert.deepStrictEqual(v.items.map(i => i.text), ['dentro']);
});

test('render muestra el tipo y avisa del modo DOM', () => {
  const v = grid.buildDomView({ region: { x: 0, y: 0, w: 400, h: 300 }, cols: 4, rows: 3, items: [{ text: 'trash', kind: 'icono botón', x: 5, y: 5, w: 20, h: 20 }] });
  const out = grid.render({ win: { title: 't', w: 400, h: 300 }, view: v, label: 'completa', dom: true });
  assert.match(out, /\[icono botón\] "trash"/);
  assert.match(out, /Lectura del DOM/);
});

test('parseCell acepta "col,fila" y rechaza basura', () => {
  assert.deepStrictEqual(grid.parseCell('3,2'), { col: 3, row: 2 });
  assert.strictEqual(grid.inGrid(grid.parseCell('99,99'), 5, 5), false);
});
