// Se precarga en el proceso principal de Electron (NODE_OPTIONS=--require) y abre el puerto de depuración
// justo cuando la app pide 'electron', antes de que arranque.
if (process.type === 'browser' && process.env.RSAGENT_CDP_PORT) {
  const Module = require('module');
  const orig = Module._load;
  let done = false;
  Module._load = function (request, ...rest) {
    const r = orig.call(this, request, ...rest);
    if (!done && request === 'electron' && r && r.app && r.app.commandLine) {
      done = true;
      try { r.app.commandLine.appendSwitch('remote-debugging-port', process.env.RSAGENT_CDP_PORT); } catch {}
    }
    return r;
  };
}
