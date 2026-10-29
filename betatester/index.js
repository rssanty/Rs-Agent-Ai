const detect = require('./detect');
const session = require('./session');
const report = require('./report');

const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const str = { type: 'string' };

const DEFS = [
  { name: 'test_detect', description: 'Analiza el proyecto y dice qué tipo es (web, escritorio, consola) y cómo ejecutarlo.', parameters: obj({}) },
  { name: 'test_open', description: 'Lanza el proyecto y enfoca su ventana. Web: levanta el servidor y abre una ventana del navegador. Escritorio: ejecuta y enfoca la ventana. Opcional: command, url, title. Con attach=true y title engancha una ventana que ya está abierta (con port engancha una app con depuración remota). Web y Electron se leen por DOM: ven iconos y consola.', parameters: obj({ command: str, url: str, title: str, attach: { type: 'boolean' }, port: { type: 'integer' } }) },
  { name: 'test_look', description: 'Captura la ventana de la app y devuelve el texto visible con su celda (columna,fila) en una cuadrícula. Con zoom="columna,fila" amplía esa zona para más precisión.', parameters: obj({ zoom: str, lang: str }) },
  { name: 'test_click', description: 'Hace clic en un elemento (item = número # de test_look) o en una celda (cell = "columna,fila") de la vista actual. Devuelve la pantalla actualizada.', parameters: obj({ item: { type: 'integer' }, cell: str, button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' } }) },
  { name: 'test_type', description: 'Escribe texto con el teclado en la ventana de la app. Devuelve la pantalla actualizada.', parameters: obj({ text: str }, ['text']) },
  { name: 'test_key', description: 'Pulsa una tecla o combinación: enter, tab, esc, up, down, f5, ctrl+s, alt+f4, ctrl+shift+t.', parameters: obj({ keys: str }, ['keys']) },
  { name: 'test_scroll', description: 'Desplaza con la rueda del mouse (en item o cell, o en el centro de la ventana).', parameters: obj({ direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer' }, item: { type: 'integer' }, cell: str }, ['direction']) },
  { name: 'test_console', description: 'Muestra los errores y avisos de la consola del navegador/app (excepciones, console.error, fallos de red HTTP 4xx/5xx) y la salida del proceso.', parameters: obj({}) },
  { name: 'test_report', description: 'Guarda un reporte de pruebas (resumen, recorrido y errores con pasos para reproducir) en .agente/reports.', parameters: obj({ title: str, summary: str, steps: { type: 'array', items: str }, bugs: { type: 'array', items: obj({ title: str, severity: str, steps: { type: 'array', items: str }, expected: str, actual: str }) } }) },
  { name: 'test_close', description: 'Cierra la app que abrió test_open y detiene su servidor.', parameters: obj({}) }
];

const NO_APPROVAL = new Set(['test_detect', 'test_look', 'test_console', 'test_report', 'test_close']);

const isTool = n => DEFS.some(d => d.name === n);
const needsApproval = n => isTool(n) && !NO_APPROVAL.has(n);

function describe(name, a = {}) {
  switch (name) {
    case 'test_detect': return 'Analizar el tipo de proyecto';
    case 'test_open': return a.attach ? `Enganchar la ventana "${a.title}"` : `Lanzar y probar${a.command ? ': ' + a.command : ' el proyecto detectado'}${a.url ? ' en ' + a.url : ''}`;
    case 'test_look': return a.zoom ? `Mirar la pantalla (zoom ${a.zoom})` : 'Mirar la pantalla';
    case 'test_click': return `Clic ${a.button === 'right' ? 'derecho ' : ''}${a.double ? 'doble ' : ''}en ${a.item != null ? 'elemento #' + a.item : 'celda ' + (a.cell || '?')}`;
    case 'test_type': return `Escribir "${String(a.text || '').slice(0, 60)}"`;
    case 'test_key': return `Pulsar ${a.keys}`;
    case 'test_scroll': return `Desplazar ${a.direction === 'up' ? 'arriba' : 'abajo'} ×${a.amount || 3}`;
    case 'test_console': return 'Leer la consola';
    case 'test_report': return 'Guardar el reporte de pruebas';
    case 'test_close': return 'Cerrar la app de prueba';
    default: return name;
  }
}

async function run(name, a, ctx) {
  if (name === 'test_detect') return detect.describe(detect.detect(ctx.root));
  if (name === 'test_console') return session.consoleReport();
  if (name === 'test_report') return report.write(ctx.root, a, session.shots(), session.consoleText());
  if (name === 'test_close') return session.close(false, ctx.signal);
  switch (name) {
    case 'test_open': return session.open(a, ctx);
    case 'test_look': return session.look(a, ctx);
    case 'test_click': return session.click(a, ctx);
    case 'test_type': return session.type(a, ctx);
    case 'test_key': return session.key(a, ctx);
    case 'test_scroll': return session.scroll(a, ctx);
    default: throw new Error('Herramienta desconocida: ' + name);
  }
}

module.exports = { DEFS, isTool, needsApproval, describe, run, shutdown: session.shutdown };
