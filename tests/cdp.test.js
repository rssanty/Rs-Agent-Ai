const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const cdp = require('../betatester/cdp');

function frame(t) {
  const p = Buffer.from(t);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([h, p]);
}

function fakeBrowser(onCommand) {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ type: 'page', title: 'T', url: 'http://x', webSocketDebuggerUrl: `ws://127.0.0.1:${srv.address().port}/p` }]));
  });
  srv.on('upgrade', (req, socket) => {
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    let buf = Buffer.alloc(0);
    socket.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + 4 + len) return;
        const m = buf.subarray(off, off + 4), pl = Buffer.alloc(len);
        for (let i = 0; i < len; i++) pl[i] = buf[off + 4 + i] ^ m[i & 3];
        buf = buf.subarray(off + 4 + len);
        const msg = JSON.parse(pl.toString());
        const { result, events } = onCommand(msg);
        socket.write(frame(JSON.stringify({ id: msg.id, result: result || {} })));
        for (const e of events || []) socket.write(frame(JSON.stringify(e)));
      }
    });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv)));
}

test('captura errores de consola, excepciones y fallos HTTP', async () => {
  const srv = await fakeBrowser(msg => ({
    events: msg.method === 'Runtime.enable' ? [
      { method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'boom' }] } },
      { method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x' }, url: 'a.js', lineNumber: 4 } } },
      { method: 'Network.responseReceived', params: { response: { status: 404, url: 'http://x/a.png' } } }
    ] : []
  }));
  const c = await cdp.attach(srv.address().port, { timeout: 3000 });
  const fresh = c.fresh();
  assert.deepStrictEqual(fresh.map(e => e.kind), ['error', 'excepción', 'red']);
  assert.strictEqual(c.fresh().length, 0);
  c.close(); srv.close();
});

test('un error repetido vuelve a contarse como nuevo', async () => {
  const srv = await fakeBrowser(() => ({}));
  const c = await cdp.attach(srv.address().port, { timeout: 3000 });
  c.add('error', 'igual'); assert.strictEqual(c.fresh().length, 1);
  c.add('error', 'igual'); const f = c.fresh();
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].n, 2);
  c.close(); srv.close();
});

test('lee respuestas grandes (trama de 64 bits)', async () => {
  const srv = await fakeBrowser(msg => ({ result: msg.method === 'Runtime.evaluate' ? { result: { value: 'x'.repeat(70000) } } : {} }));
  const c = await cdp.attach(srv.address().port, { timeout: 3000 });
  assert.strictEqual((await c.eval('1')).length, 70000);
  c.close(); srv.close();
});

test('key envía modificadores y comandos de edición', async () => {
  const seen = [];
  const srv = await fakeBrowser(msg => { if (msg.method === 'Input.dispatchKeyEvent') seen.push(msg.params); return {}; });
  const c = await cdp.attach(srv.address().port, { timeout: 3000 });
  await c.key('ctrl+a');
  assert.strictEqual(seen[0].modifiers, 2);
  assert.deepStrictEqual(seen[0].commands, ['selectAll']);
  await assert.rejects(() => c.key('ctrl+nada'), /Tecla desconocida/);
  c.close(); srv.close();
});
