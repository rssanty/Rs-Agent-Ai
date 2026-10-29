const KEEP = 4;

function plan(history, keep = KEEP) {
  const starts = [];
  history.forEach((m, i) => { if (m.role === 'user' && !m.summary) starts.push(i); });
  if (starts.length <= keep) return null;
  const split = starts[starts.length - keep];
  return { split, old: history.slice(0, split) };
}

function transcript(old) {
  return old.map(m => {
    if (m.role === 'user') return (m.summary ? 'RESUMEN PREVIO: ' : 'Usuario: ') + m.content;
    if (m.role === 'assistant') return 'Asistente: ' + (m.content || '') + (m.calls?.length ? ' [herramientas: ' + m.calls.map(c => c.name + ' ' + JSON.stringify(c.args).slice(0, 200)).join('; ') + ']' : '');
    return 'Resultado: ' + String(m.content).slice(0, 500);
  }).join('\n').slice(-60000);
}

function apply(history, split, summary) {
  history.splice(0, split,
    { role: 'user', content: '[Resumen de la conversación anterior]\n' + summary, summary: true },
    { role: 'assistant', content: 'Entendido. Continúo con ese contexto.', ack: true });
}

const estimate = history => Math.ceil(JSON.stringify(history).length / 4);

module.exports = { KEEP, plan, transcript, apply, estimate };
