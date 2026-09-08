import './public/codec.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Cache-Control': 'no-store',
};
const emptyStatuses = new Set([101, 204, 205, 304]);
function failure(status, message) {
  return Response.json({ code: 'GATEWAY_ERROR', message }, { status, headers: cors });
}
export function targetURL(value, origin, socket = false) {
  const url = new URL(value);
  if (!(socket ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol) || url.username || url.password) throw new Error('Invalid destination');
  const host = url.hostname.toLowerCase();
  if (host === new URL(origin).hostname || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') ||
      /^(0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Destination is not a public website');
  return url;
}
export function readHeaders(headers) {
  let raw = headers.get('x-bare-headers');
  if (headers.has('x-bare-headers-0')) {
    const parts = [...headers].filter(([k]) => /^x-bare-headers-\d+$/.test(k))
      .sort(([a], [b]) => Number(a.slice(15)) - Number(b.slice(15)));
    raw = parts.map(([key, value], index) => {
      if (key !== `x-bare-headers-${index}` || !value.startsWith(';')) throw new Error('Invalid split headers');
      return value.slice(1);
    }).join('');
  }
  const value = JSON.parse(raw || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid headers');
  return value;
}
function outgoingHeaders(value) {
  const headers = new Headers();
  for (const [key, values] of Object.entries(value)) {
    if (/^(host|connection|content-length|transfer-encoding|upgrade|sec-websocket-key|sec-websocket-version|sec-websocket-extensions)$/i.test(key)) continue;
    for (const item of Array.isArray(values) ? values : [values]) {
      if (typeof item !== 'string') throw new Error('Invalid header value');
      headers.append(key, item);
    }
  }
  return headers;
}
function responseHeaders(response) {
  const result = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) result['set-cookie'] = cookies;
  return result;
}
function writeHeaders(headers, value) {
  const raw = JSON.stringify(value);
  if (raw.length <= 3072) headers.set('x-bare-headers', raw);
  else for (let i = 0; i < raw.length; i += 3072) headers.set(`x-bare-headers-${i / 3072}`, ';' + raw.slice(i, i + 3072));
}
async function relay(request) {
  let target, headers;
  try {
    target = targetURL(request.headers.get('x-bare-url'), request.url);
    headers = outgoingHeaders(readHeaders(request.headers));
    for (const key of ['accept-language', ...(request.headers.get('x-bare-forward-headers') || '').split(',')]) {
      const name = key.trim().toLowerCase();
      if (name && !/^(host|cookie|authorization|connection|transfer-encoding|content-length|x-bare-)/.test(name) && request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    headers.set('accept-encoding', 'identity');
  } catch { return failure(400, 'Invalid destination or request headers'); }
  const upstream = await fetch(target, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    redirect: 'manual', signal: request.signal, duplex: 'half',
  });
  const metadata = responseHeaders(upstream);
  delete metadata['content-encoding'];
  delete metadata['content-length'];
  delete metadata['transfer-encoding'];
  const resultHeaders = new Headers(cors);
  // Cache only explicitly public static resources in this browser, never shared sessions.
  const policy = upstream.headers.get('cache-control') || '';
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(policy);
  if (request.method === 'GET' && upstream.status === 200 && maxAge && /(?:^|,)\s*public\s*(?:,|$)/i.test(policy) &&
      !/no-store|no-cache|private/i.test(policy) && !headers.has('cookie') && !headers.has('authorization') &&
      !metadata['set-cookie'] && !upstream.headers.has('vary') &&
      /^(text\/css|(?:application|text)\/javascript|image\/|font\/)/i.test(metadata['content-type'] || '')) {
    resultHeaders.set('Cache-Control', `private, max-age=${Math.min(Number(maxAge[1]), 3600)}`);
    resultHeaders.set('Vary', 'x-bare-url, x-bare-headers, x-nova-encoding');
  }
  resultHeaders.set('x-bare-status', String(upstream.status));
  resultHeaders.set('x-bare-status-text', upstream.statusText);
  writeHeaders(resultHeaders, metadata);
  let body = request.method === 'HEAD' || emptyStatuses.has(upstream.status) ? null : upstream.body;
  if (request.headers.get('x-nova-encoding') === 'base64') {
    resultHeaders.set('x-nova-encoding', 'base64');
    resultHeaders.set('Content-Type', 'text/plain; charset=us-ascii');
    body = body?.pipeThrough(globalThis.NovaCodec.encodeStream()) ?? null;
  }
  return new Response(body, { status: 200, headers: resultHeaders });
}
export function socketRelay(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  let remote, connecting = false, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try { server.close(1000); } catch {}
    try { remote?.close(1000); } catch {}
  };
  const timer = setTimeout(close, 15000);
  server.addEventListener('close', close);
  server.addEventListener('error', close);
  server.addEventListener('message', async event => {
    try {
      if (remote) { remote.send(event.data); return; }
      if (connecting || typeof event.data !== 'string') { close(); return; }
      connecting = true;
      const hello = JSON.parse(event.data);
      if (hello.type !== 'connect' || !Array.isArray(hello.protocols) ||
          !hello.protocols.every(p => typeof p === 'string' && /^[!#$%&'*+\-.^_`|~\w]+$/.test(p)) ||
          !hello.headers || typeof hello.headers !== 'object' || Array.isArray(hello.headers)) throw new Error('Invalid handshake');
      const target = targetURL(hello.remote, request.url, true);
      target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
      const headers = outgoingHeaders(hello.headers);
      headers.set('Upgrade', 'websocket');
      if (hello.protocols.length) headers.set('Sec-WebSocket-Protocol', hello.protocols.join(', '));
      const response = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (!response.webSocket || response.status !== 101) { close(); return; }
      remote = response.webSocket;
      if (closed) { remote.accept(); remote.close(1000); return; }
      remote.addEventListener('message', event => { try { server.send(event.data); } catch { close(); } });
      remote.addEventListener('close', close);
      remote.addEventListener('error', close);
      server.send(JSON.stringify({ type: 'open', protocol: response.headers.get('sec-websocket-protocol') || '', setCookies: response.headers.getSetCookie() }));
      remote.accept();
      clearTimeout(timer);
    } catch { close(); }
  });
  return new Response(null, { status: 101, webSocket: client });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/bare/')) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (url.pathname === '/bare/' && request.method === 'GET') return Response.json({ versions: ['v3'], language: 'JavaScript', memory: 0 }, { headers: cors });
        if (url.pathname !== '/bare/v3/') return failure(404, 'Unknown transport endpoint');
        if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return socketRelay(request);
        return await relay(request);
      }
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
      return await env.ASSETS.fetch(request);
    } catch { return failure(502, 'Unable to connect to the website'); }
  },
};
