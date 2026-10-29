const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { chat } = require('../providers');

function server(handler) {
  const srv = http.createServer(handler);
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv)));
}
const sse = (res, events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write('data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n'); res.end(); };
const base = srv => ({ provider: 'custom', model: 'm', key: 'k', system: 's', history: [{ role: 'user', content: 'hola' }], tools: [], customUrl: `http://127.0.0.1:${srv.address().port}/v1/chat/completions` });

test('openai: junta texto y llamadas a herramientas en streaming', async () => {
  const srv = await server((req, res) => sse(res, [
    { choices: [{ delta: { content: 'Ho' } }] },
    'esto no es json',
    { choices: [{ delta: { content: 'la' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] },
    { usage: { prompt_tokens: 5, completion_tokens: 7 } },
    '[DONE]'
  ]));
  const tokens = [];
  const r = await chat({ ...base(srv), onToken: t => tokens.push(t) });
  assert.strictEqual(r.text, 'Hola');
  assert.deepStrictEqual(tokens, ['Ho', 'la']);
  assert.deepStrictEqual(r.calls.map(c => [c.id, c.name, c.args, c.bad]), [['c1', 'read_file', { path: 'a.txt' }, false]]);
  assert.deepStrictEqual(r.usage, { input: 5, output: 7, known: true });
  srv.close();
});

test('marca como incompletos los argumentos JSON rotos', async () => {
  const srv = await server((req, res) => sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path": "a' } }] } }] }, '[DONE]']));
  const r = await chat(base(srv));
  assert.strictEqual(r.calls[0].bad, true);
  srv.close();
});

test('reintenta ante 429 y luego responde', async () => {
  let n = 0;
  const srv = await server((req, res) => {
    if (n++ === 0) { res.writeHead(429, { 'retry-after': '0' }); return res.end('{"error":{"message":"slow down"}}'); }
    sse(res, [{ choices: [{ delta: { content: 'ok' } }] }, '[DONE]']);
  });
  const retries = [];
  const r = await chat({ ...base(srv), onRetry: x => retries.push(x.status) });
  assert.strictEqual(r.text, 'ok');
  assert.deepStrictEqual(retries, [429]);
  srv.close();
});

test('errores claros: clave inválida, cuota y URL inválida', async () => {
  const srv = await server((req, res) => { res.writeHead(401); res.end('{"error":{"message":"bad key"}}'); });
  await assert.rejects(() => chat(base(srv)), /Clave inválida.*bad key/);
  await assert.rejects(() => chat({ ...base(srv), customUrl: '' }), /URL del proveedor inválida/);
  await assert.rejects(() => chat({ ...base(srv), customUrl: 'http://ejemplo.com/v1/chat/completions' }), /https/);
  srv.close();
});

test('se puede cancelar con AbortSignal', async () => {
  const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'); });
  const ac = new AbortController();
  const p = chat({ ...base(srv), signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(p, e => e.name === 'AbortError' || /abort/i.test(e.message));
  srv.closeAllConnections?.(); srv.close();
});
