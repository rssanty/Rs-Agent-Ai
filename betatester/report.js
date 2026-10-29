const fs = require('fs');
const path = require('path');

const asList = v => (Array.isArray(v) ? v.map((s, i) => `${i + 1}. ${s}`) : String(v).split('\n'));

function write(root, a, shots, consoleLog) {
  const dir = path.join(root, '.agente', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const bugs = Array.isArray(a.bugs) ? a.bugs : [];
  const steps = Array.isArray(a.steps) ? a.steps : [];
  const L = [`# ${a.title || 'Reporte de pruebas'}`, '', `Fecha: ${now.toLocaleString('es')}`, ''];
  if (a.summary) L.push('## Resumen', '', String(a.summary), '');
  L.push(`## Errores encontrados (${bugs.length})`, '');
  if (!bugs.length) L.push('No se encontraron errores.', '');
  bugs.forEach((b, i) => {
    L.push(`### ${i + 1}. ${b.title || 'Sin título'}${b.severity ? ' [' + b.severity + ']' : ''}`, '');
    if (b.steps) L.push('**Pasos para reproducir:**', '', ...asList(b.steps), '');
    if (b.expected) L.push(`**Esperado:** ${b.expected}`, '');
    if (b.actual) L.push(`**Obtenido:** ${b.actual}`, '');
  });
  if (steps.length) L.push('## Recorrido', '', ...steps.map((s, i) => `${i + 1}. ${s}`), '');
  if (consoleLog) L.push('## Consola (errores y avisos)', '', '```', consoleLog, '```', '');
  if (shots && shots.length) L.push('## Capturas', '', ...shots.slice(-5).map(s => `- ${s}`), '');
  const file = path.join(dir, stamp + '.md');
  fs.writeFileSync(file, L.join('\n'));
  return 'Reporte guardado en ' + path.relative(root, file).split(path.sep).join('/');
}

module.exports = { write };
