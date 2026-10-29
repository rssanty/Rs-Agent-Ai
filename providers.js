const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', format: 'anthropic', url: 'https://api.anthropic.com/v1/messages', ctx: 'CLAUDE.md', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] },
  openai: { label: 'ChatGPT (OpenAI)', format: 'openai', url: 'https://api.openai.com/v1/chat/completions', ctx: 'AGENTS.md', reasoning: true, models: ['gpt-5', 'gpt-5-mini', 'o4-mini'] },
  gemini: { label: 'Gemini (Google)', format: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', ctx: 'GEMINI.md', reasoning: true, models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  deepseek: { label: 'DeepSeek', format: 'openai', url: 'https://api.deepseek.com/chat/completions', ctx: 'DEEPSEEK.md', models: ['deepseek-chat', 'deepseek-reasoner'] },
  nvidia: { label: 'NVIDIA NIM', format: 'openai', url: 'https://integrate.api.nvidia.com/v1/chat/completions', ctx: 'NVIDIA.md', models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'] },
  openrouter: { label: 'OpenRouter', format: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', ctx: 'AGENTS.md', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5'] },
  custom: { label: 'Personalizado (compatible OpenAI)', format: 'openai', url: '', ctx: 'AGENTS.md', models: [] }
};

const BUDGET = { low: 2000, medium: 6000, high: 16000 };
const MAX_RETRIES = 4;

const abortError = () => Object.assign(new Error('Detenido.'), { name: 'AbortError' });
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(abortError());
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(abortError()); }, { once: true });
});

function httpError(status, body) {
  let detail = body;
  try {
    const j = JSON.parse(body);
    detail = j.error?.message || j.message || j.detail || (typeof j.error === 'string' ? j.error : body);
  } catch {}
  detail = String(detail).replace(/\s+/g, ' ').slice(0, 240);
  const head = {
    401: 'Clave inválida o sin permisos (401). Revisa la API key.',
    402: 'Sin saldo o cuota (402).',
    403: 'Acceso denegado (403). La clave no tiene permiso para este modelo o región.',
    404: 'Modelo no encontrado (404). Revisa el nombre o elige uno de la lista.',
    429: 'Límite de uso o cuota alcanzado (429).'
  }[status] || (status >= 500 ? `El proveedor falló (HTTP ${status}).` : `Error HTTP ${status}.`);
  return new Error(detail ? head + ' ' + detail : head);
}

const IDLE_MS = 120000;

async function* sse(res) {
  const dec = new TextDecoder();
  let buf = '';
  const it = res.body[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer;
      const r = await Promise.race([
        it.next(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('El proveedor dejó de responder (sin datos durante 2 minutos).')), IDLE_MS); })
      ]).finally(() => clearTimeout(timer));
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(d); } catch { continue; }
        yield ev;
      }
    }
  } finally {
    try { await it.return?.(); } catch {}
  }
}

function checkUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { throw new Error('URL del proveedor inválida o vacía. Revisa la URL personalizada.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('La URL debe usar https (http solo para localhost).');
  return u.toString();
}

async function open(url, headers, body, signal, onRetry) {
  url = checkUrl(url);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...body, stream: true }), signal: AbortSignal.any([signal, AbortSignal.timeout(600000)].filter(Boolean)) });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt >= MAX_RETRIES) throw new Error('Sin conexión con el proveedor: ' + (e.cause?.code || e.message));
      const wait = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 400;
      onRetry?.({ status: 'red', attempt: attempt + 1, wait });
      await sleep(wait, signal);
      continue;
    }
    if (res.ok) return res;
    const txt = await res.text();
    const quota = /quota|billing|credit|insufficient|exceeded your current/i.test(txt);
    if ((res.status === 429 || res.status >= 500) && !quota && attempt < MAX_RETRIES) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = Math.min(30000, ra > 0 ? ra * 1000 : 1000 * 2 ** attempt) + Math.random() * 400;
      onRetry?.({ status: res.status, attempt: attempt + 1, wait });
      await sleep(wait, signal);
      continue;
    }
    throw httpError(res.status, txt);
  }
}

async function chat({ provider, model, key, effort, system, history, tools, signal, customUrl, onToken = () => {}, onRetry }) {
  const p = PROVIDERS[provider];
  if (p.format === 'anthropic') return anthropic(p, { model, key, effort, system, history, tools, signal, onToken, onRetry });
  const url = provider === 'custom' ? customUrl : p.url;
  const messages = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content || null, ...(m.calls?.length ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
    else if (m.role === 'tool') messages.push({ role: 'tool', tool_call_id: m.id, content: m.content });
    else messages.push({ role: 'user', content: m.content });
  }
  const body = { model, messages };
  if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: t }));
  if (p.reasoning && effort !== 'auto') body.reasoning_effort = effort;
  if (provider !== 'custom') body.stream_options = { include_usage: true };
  let res;
  try {
    res = await open(url, { authorization: `Bearer ${key}` }, body, signal, onRetry);
  } catch (e) {
    if (!body.stream_options || !/stream_options/i.test(e.message)) throw e;
    delete body.stream_options;
    res = await open(url, { authorization: `Bearer ${key}` }, body, signal, onRetry);
  }
  let text = '';
  const acc = [];
  let lastId = '';
  let usage = { input: 0, output: 0, known: false };
  for await (const ev of sse(res)) {
    if (ev.usage) usage = { input: ev.usage.prompt_tokens ?? ev.usage.input_tokens ?? 0, output: ev.usage.completion_tokens ?? ev.usage.output_tokens ?? 0, known: true };
    const d = ev.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) { text += d.content; onToken(d.content); }
    for (const tc of d.tool_calls || []) {
      let slot = tc.index;
      if (slot === undefined) slot = tc.id && lastId && tc.id !== lastId ? acc.length : Math.max(acc.length - 1, 0);
      if (tc.id) lastId = tc.id;
      const c = (acc[slot] ||= { id: '', name: '', args: '' });
      if (tc.id && !c.id) c.id = tc.id;
      const nm = tc.function?.name;
      if (nm && c.name !== nm && !c.name.endsWith(nm)) c.name += nm;
      if (tc.function?.arguments) c.args += tc.function.arguments;
    }
  }
  const calls = acc.filter(Boolean).map((c, i) => ({ id: c.id || 'call_' + i, name: c.name.split('<|')[0].trim(), args: safeJson(c.args), bad: isBad(c.args) }));
  return { text, calls, usage };
}

async function anthropic(p, { model, key, effort, system, history, tools, signal, onToken, onRetry }) {
  const messages = [];
  for (const m of history) {
    if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.raw || [{ type: 'text', text: m.content || '...' }] });
    else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.id, content: m.content };
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else messages.push({ role: 'user', content: [block] });
    } else messages.push({ role: 'user', content: m.content });
  }
  const body = { model, max_tokens: 8192, system, messages };
  if (tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (BUDGET[effort]) { body.thinking = { type: 'enabled', budget_tokens: BUDGET[effort] }; body.max_tokens = BUDGET[effort] + 8192; }
  const res = await open(p.url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, signal, onRetry);
  const blocks = [];
  const bad = new Set();
  const usage = { input: 0, output: 0, known: false };
  for await (const ev of sse(res)) {
    if (ev.type === 'error') throw new Error(ev.error?.message || 'Error de stream');
    if (ev.type === 'message_start' && ev.message?.usage) {
      const u = ev.message.usage;
      usage.input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      usage.output = u.output_tokens || 0;
      usage.known = true;
    } else if (ev.type === 'message_delta' && ev.usage) {
      if (ev.usage.output_tokens != null) usage.output = ev.usage.output_tokens;
      usage.known = true;
    } else if (ev.type === 'content_block_start') {
      const b = { ...ev.content_block };
      if (b.type === 'text') b.text = '';
      if (b.type === 'thinking') { b.thinking = ''; b.signature = ''; }
      if (b.type === 'tool_use') b._json = '';
      blocks[ev.index] = b;
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index], d = ev.delta;
      if (d.type === 'text_delta') { b.text += d.text; onToken(d.text); }
      else if (d.type === 'input_json_delta') b._json += d.partial_json;
      else if (d.type === 'thinking_delta') b.thinking += d.thinking;
      else if (d.type === 'signature_delta') b.signature = d.signature;
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b.type === 'tool_use') { if (isBad(b._json)) bad.add(ev.index); b.input = safeJson(b._json); delete b._json; }
    }
  }
  const raw = blocks.filter(Boolean);
  return {
    text: raw.filter(b => b.type === 'text').map(b => b.text).join('\n'),
    calls: blocks.map((b, i) => (b && b.type === 'tool_use' ? { id: b.id, name: b.name, args: b.input, bad: bad.has(i) } : null)).filter(Boolean),
    raw,
    usage
  };
}

const isBad = s => { if (!s || !s.trim()) return false; try { JSON.parse(s); return false; } catch { return true; } };
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

async function listModels(provider, key, customUrl) {
  const p = PROVIDERS[provider];
  const headers = p.format === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` };
  const get = async url => {
    const res = await fetch(checkUrl(url), { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw httpError(res.status, await res.text());
    return res.json();
  };
  const ids = [];
  if (p.format === 'anthropic') {
    let after = '';
    for (let i = 0; i < 20; i++) {
      const d = await get('https://api.anthropic.com/v1/models?limit=100' + after);
      ids.push(...d.data.map(m => m.id));
      if (!d.has_more) break;
      after = '&after_id=' + d.last_id;
    }
  } else {
    const base = (provider === 'custom' ? customUrl : p.url).replace(/\/chat\/completions\/?$/, '');
    const d = await get(base + '/models');
    ids.push(...(d.data || d.models || []).map(m => (m.id || m.name || '').replace(/^models\//, '')));
  }
  return [...new Set(ids.filter(Boolean))].sort();
}

module.exports = { PROVIDERS, chat, listModels };
