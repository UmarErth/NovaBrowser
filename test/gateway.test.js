import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker, { readHeaders, targetURL, socketRelay } from '../index.js';

const nativeFetch = globalThis.fetch;
const base = 'https://nova.example';
function request(headers = {}, init = {}) {
  return new Request(base + '/bare/v3/', { headers: { 'x-bare-url': 'https://website.example/path', ...headers }, ...init });
}
function chunks(bytes, size) {
  return new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  } });
}
test('Base64 preserves binary bytes across arbitrary network boundaries', async () => {
  for (const length of [0, 1, 2, 3, 255, 65537]) {
    const original = Uint8Array.from({ length }, (_, index) => index % 256);
    for (const width of length > 1000 ? [7, 8192] : [1, 7, 8192]) {
      const encoded = await new Response(chunks(original, width).pipeThrough(NovaCodec.encodeStream())).text();
      assert.equal(encoded, Buffer.from(original).toString('base64'));
      const decoded = await new Response(chunks(new TextEncoder().encode(encoded), width).pipeThrough(NovaCodec.decodeStream())).arrayBuffer();
      assert.deepEqual(new Uint8Array(decoded), original);
    }
  }
});
test('Base64 emits content before the entire download finishes', async () => {
  let source;
  const stream = new ReadableStream({ start(controller) { source = controller; } });
  const reader = stream.pipeThrough(NovaCodec.encodeStream()).getReader();
  source.enqueue(new TextEncoder().encode('abc'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'YWJj');
  source.close();
  assert.equal((await reader.read()).done, true);
});
test('manifest and method negotiation match bundled v3 client', async () => {
  const manifest = await worker.fetch(new Request(base + '/bare/'), {});
  assert.deepEqual((await manifest.json()).versions, ['v3']);
  const options = await worker.fetch(request({}, { method: 'OPTIONS' }), {});
  assert.match(options.headers.get('access-control-allow-methods'), /PATCH/);
  assert.equal((await worker.fetch(new Request(base + '/bare/v2/'), {})).status, 404);
});
test('split request headers are reassembled in numeric order and malformed chunks fail', () => {
  const raw = JSON.stringify({ Cookie: 'a'.repeat(4500) });
  const headers = new Headers();
  for (let i = 0; i < raw.length; i += 300) headers.set(`x-bare-headers-${i / 300}`, ';' + raw.slice(i, i + 300));
  assert.deepEqual(readHeaders(headers), JSON.parse(raw));
  headers.delete('x-bare-headers-1');
  assert.throws(() => readHeaders(headers));
});
test('destination validation rejects non-web and local destinations', () => {
  for (const target of ['file:///etc/passwd', 'http://localhost', 'http://127.1', 'http://10.0.0.1', 'http://[::1]', base]) {
    assert.throws(() => targetURL(target, base));
  }
  assert.equal(targetURL('https://example.com', base).hostname, 'example.com');
});
test('HTTP preserves redirects, multiple cookies, and large response headers', async () => {
  const upstreamHeaders = new Headers({ Location: '/next', 'X-Large': 'a'.repeat(5000) });
  upstreamHeaders.append('Set-Cookie', 'a=1; Path=/');
  upstreamHeaders.append('Set-Cookie', 'b=2; Path=/');
  globalThis.fetch = async () => new Response(null, { status: 302, headers: upstreamHeaders });
  try {
    const response = await worker.fetch(request(), {});
    assert.equal(response.headers.get('x-bare-status'), '302');
    assert.deepEqual(readHeaders(response.headers)['set-cookie'], ['a=1; Path=/', 'b=2; Path=/']);
    assert.equal(readHeaders(response.headers).location, '/next');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = nativeFetch; }
});
test('binary range responses encode without retaining invalid length headers', async () => {
  globalThis.fetch = async () => new Response(Uint8Array.of(0, 255, 1, 128), {
    status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/10', 'Content-Length': '4' },
  });
  try {
    const response = await worker.fetch(request({ 'x-nova-encoding': 'base64' }), {});
    assert.equal(response.headers.get('x-nova-encoding'), 'base64');
    assert.equal(response.headers.get('x-bare-status'), '206');
    const headers = readHeaders(response.headers);
    assert.equal(headers['content-range'], 'bytes 0-3/10');
    assert.equal(headers['content-length'], undefined);
    assert.equal(await response.text(), 'AP8BgA==');
  } finally { globalThis.fetch = nativeFetch; }
});
test('upload body is forwarded as a stream and HEAD is bodyless', async () => {
  let sent;
  globalThis.fetch = async (_url, init) => { sent = init; return new Response(null, { status: 204 }); };
  try {
    const upload = request({}, { method: 'POST', body: 'payload' });
    const body = upload.body;
    await worker.fetch(upload, {});
    assert.equal(sent.body, body);
    assert.equal(sent.redirect, 'manual');
    const response = await worker.fetch(request({}, { method: 'HEAD' }), {});
    assert.equal(sent.body, null);
    assert.equal(response.body, null);
  } finally { globalThis.fetch = nativeFetch; }
});
test('missing assets stay 404 instead of masquerading as the home page', async () => {
  const response = await worker.fetch(new Request(base + '/missing.js'), { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } });
  assert.equal(response.status, 404);
});
test('invalid input returns 400; upstream failures do not leak exception details', async () => {
  assert.equal((await worker.fetch(request({ 'x-bare-headers': '{' }), {})).status, 400);
  globalThis.fetch = async () => { throw new Error('private server detail'); };
  try {
    const response = await worker.fetch(request(), {});
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private server detail/);
  } finally { globalThis.fetch = nativeFetch; }
});
test('URL codec preserves Unicode, forms, hashes, and query strings', () => {
  const ctx = vm.createContext({ self: { Ultraviolet: { prototype: {} } }, TextEncoder, TextDecoder, btoa, atob, URL, Uint8Array });
  vm.runInContext(readFileSync(new URL('../public/uv/uv.config.js', import.meta.url), 'utf8'), ctx);
  const cfg = ctx.self.__uv$config;
  for (const url of ['https://example.com/日本?q=é#part', 'https://search.brave.com/search?q=hello&source=web']) {
    assert.equal(cfg.decodeUrl(cfg.encodeUrl(url)), url);
  }
  const encoded = cfg.encodeUrl('https://search.brave.com/search?q=old');
  assert.equal(cfg.decodeUrl(encoded + '?q=new#top'), 'https://search.brave.com/search?q=new#top');
  assert.equal(cfg.prefix, '/browse/');
  const rewrite = ctx.self.Ultraviolet.prototype.rewriteImport;
  assert.equal(rewrite.call({ meta: {}, rewriteUrl: (input, meta) => new URL(input, meta.base).href }, 'https://search.brave.com/assets/start.js', './chunks/app.js'), 'https://search.brave.com/assets/chunks/app.js');
});
test('ad rules match exact domains and subdomains, not unrelated sites', () => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../public/adblock.js', import.meta.url), 'utf8'), ctx);
  assert.equal(ctx.NovaAdblock.blocks('ads.doubleclick.net'), true);
  for (const domain of ['notdoubleclick.net', 'doubleclick.net.example.com', 'google.com', 'gstatic.com', 'search.brave.com', 'now.gg']) assert.equal(ctx.NovaAdblock.blocks(domain), false);
});
test('Brave Enter fallback submits encoded search, while IME composition stays untouched', () => {
  const handlers = {};
  const ctx = vm.createContext({ location: {}, __uv$config: { prefix: '/browse/', encodeUrl: value => encodeURIComponent(value) }, document: { addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(readFileSync(new URL('../public/site-compat.js', import.meta.url), 'utf8'), ctx);
  let prevented = false;
  const event = { key: 'Enter', isComposing: true, target: { value: 'hello world', matches: () => true }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} };
  handlers.keydown(event);
  assert.equal(prevented, false);
  event.isComposing = false;
  handlers.keydown(event);
  assert.equal(prevented, true);
  assert.equal(ctx.location.href, '/browse/' + encodeURIComponent('https://search.brave.com/search?q=hello%20world'));
});

test('transport adapter decodes bytes before the bundled client reads them', async () => {
  const ctx = vm.createContext({ Request, Response, Headers, URL, location: new URL(base), NovaCodec,
    fetch: async req => {
      assert.equal(req.headers.get('x-nova-encoding'), 'base64');
      return new Response('AP8BgA==', { headers: { 'x-nova-encoding': 'base64', 'x-bare-status': '206' } });
    },
  });
  vm.runInContext(readFileSync(new URL('../public/transport.js', import.meta.url), 'utf8'), ctx);
  const result = await ctx.fetch(request());
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), Uint8Array.of(0, 255, 1, 128));
  assert.equal(result.headers.get('x-bare-status'), '206');
});

test('only anonymous, explicitly public static responses receive private browser caching', async () => {
  globalThis.fetch = async () => new Response('body', { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=86400' } });
  try {
    const response = await worker.fetch(request(), {});
    assert.equal(response.headers.get('cache-control'), 'private, max-age=3600');
    const authenticated = await worker.fetch(request({ 'x-bare-headers': JSON.stringify({ Cookie: 'session=abc' }) }), {});
    assert.equal(authenticated.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = nativeFetch; }
});

test('WebSocket handshake preserves protocol, cookies, text and binary frames, and closure', async () => {
  const NativeResponse = globalThis.Response;
  const previousPair = globalThis.WebSocketPair;
  class Socket {
    listeners = {}; sent = []; closed = false;
    accept() {}
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async emit(type, data) { await Promise.all((this.listeners[type] || []).map(listener => listener({ data }))); }
    send(data) { this.sent.push(data); }
    close() { this.closed = true; }
  }
  let server;
  const remote = new Socket();
  globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = server = new Socket(); } };
  globalThis.Response = class { constructor(_body, init) { Object.assign(this, init); } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url.href, 'https://socket.example/chat');
    assert.equal(init.headers.get('sec-websocket-protocol'), 'chat');
    const headers = new Headers({ 'sec-websocket-protocol': 'chat' });
    headers.append('set-cookie', 'session=one');
    headers.append('set-cookie', 'theme=dark');
    return { status: 101, headers, webSocket: remote };
  };
  try {
    assert.equal(socketRelay(new Request(base + '/bare/v3/')).status, 101);
    await server.emit('message', JSON.stringify({ type: 'connect', remote: 'wss://socket.example/chat', protocols: ['chat'], headers: {} }));
    assert.deepEqual(JSON.parse(server.sent[0]), { type: 'open', protocol: 'chat', setCookies: ['session=one', 'theme=dark'] });
    await server.emit('message', 'hello');
    assert.equal(remote.sent[0], 'hello');
    const binary = Uint8Array.of(0, 255).buffer;
    await remote.emit('message', binary);
    assert.equal(server.sent[1], binary);
    await remote.emit('close');
    assert.equal(server.closed, true);
    assert.equal(remote.closed, true);
  } finally {
    server?.close();
    globalThis.Response = NativeResponse;
    globalThis.WebSocketPair = previousPair;
    globalThis.fetch = nativeFetch;
  }
});

test('bundled message adapters preserve ports in modern postMessage options', () => {
  const source = readFileSync(new URL('../public/uv/uv.client.js', import.meta.url), 'utf8');
  const start = source.indexOf('const w=class extends t');
  const end = source.indexOf(';const v=class', start);
  assert.ok(start >= 0 && end > start);
  class Event { constructor(data, target, that) { Object.assign(this, { data, target, that }); } }
  const sandbox = vm.createContext({ t: class { emit() {} }, e: Event });
  vm.runInContext('globalThis.MessageAdapter=' + source.slice(start + 'const w='.length, end), sandbox);
  let received;
  const window = { postMessage(...args) { received = args; }, location: { origin: base }, __uv: { meta: { url: { origin: 'https://remote.example' } } } };
  const ctx = { window, worker: false, nativeMethods: { getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor },
    override(object, key, handler) { const original = object[key]; object[key] = function(...args) { return handler(original, this, args); }; },
    wrap(object, key, handler) { return function(...args) { return handler(object[key], this, args); }; },
  };
  const adapter = new sandbox.MessageAdapter(ctx);
  adapter.overridePostMessage();
  const port = {};
  window.postMessage('hello', { targetOrigin: '*', transfer: [port] });
  assert.equal(received[1], '*');
  assert.equal(received[2][0], port);
  window.postMessage('hello', { transfer: [port] });
  assert.equal(received[1], 'https://remote.example');
  const wrapped = adapter.wrapPostMessage({ postMessage(...args) { received = args; } }, 'postMessage');
  wrapped('hello', { targetOrigin: '*', transfer: [port] });
  assert.equal(received[1], '*');
  assert.equal(received[2][0], port);
});
