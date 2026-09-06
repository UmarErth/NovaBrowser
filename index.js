export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });

      if (url.pathname.endsWith('.js') || url.pathname === '/sw.js') {
        const asset = await env.ASSETS.fetch(request);
        const headers = new Headers(asset.headers);
        headers.set('Content-Type', 'application/javascript; charset=utf-8');
        headers.set('Service-Worker-Allowed', '/');
        return new Response(asset.body, { status: asset.status, headers });
      }

      if (url.pathname.startsWith('/bare/')) {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': '*',
            },
          });
        }

        const targetUrl = request.headers.get('x-bare-url');
        if (!targetUrl) {
          return new Response(
            JSON.stringify({ versions: ['v2', 'v3'], language: 'JS', memory: 0 }),
            { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
          );
        }

        let reqHeaders = new Headers();
        const rawHeaders = request.headers.get('x-bare-headers');
        if (rawHeaders) {
          const parsed = JSON.parse(rawHeaders);
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) v.forEach((val) => reqHeaders.append(k, val));
            else reqHeaders.set(k, v);
          }
        }

        const proxyReq = new Request(targetUrl, {
          method: request.method,
          headers: reqHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer(),
          redirect: 'manual',
        });

        const response = await fetch(proxyReq);
        const resHeadersObj = {};
        response.headers.forEach((val, key) => { resHeadersObj[key] = val; });

        return new Response(response.body, {
          status: 200,
          headers: {
            'x-bare-status': response.status.toString(),
            'x-bare-status-text': response.statusText || 'OK',
            'x-bare-headers': JSON.stringify(resHeadersObj),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': '*',
          },
        });
      }

      const staticAsset = await env.ASSETS.fetch(request);
      if (staticAsset.status !== 404) return staticAsset;
      return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};