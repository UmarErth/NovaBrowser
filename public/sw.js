importScripts('/codec.js', '/transport.js');
importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.sw.js');
importScripts('/adblock.js');

const sw = new UVServiceWorker();
sw.on('response', event => {
  const data = event.data;
  if (data.url.hostname === 'search.brave.com' && ['document', 'iframe'].includes(data.request.request.destination) &&
      typeof data.body === 'string' && data.headers['content-type']?.includes('text/html')) {
    data.body = data.body.replace(/<\/head\s*>/i, '<script src="/site-compat.js"></script></head>');
  }
});

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const settingsURL = new URL('/__nova_settings', location.origin).href;
let blockAds = true;
const settingsReady = caches.open('nova-settings-v1').then(async cache => {
  const saved = await cache.match(settingsURL);
  if (saved) blockAds = (await saved.json()).blockAds !== false;
}).catch(() => {});
self.addEventListener('message', event => {
  if (event.data?.type !== 'set-adblock' || !event.source || !['/', '/index.html'].includes(new URL(event.source.url).pathname)) return;
  event.waitUntil(settingsReady.then(async () => {
    blockAds = event.data.enabled === true;
    try {
      const cache = await caches.open('nova-settings-v1');
      await cache.put(settingsURL, Response.json({ blockAds }));
    } catch {}
    event.ports[0]?.postMessage({ enabled: blockAds });
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.startsWith(location.origin + self.__uv$config.prefix)) {
    event.respondWith((async () => {
      await settingsReady;
      try {
        const target = new URL(self.__uv$config.decodeUrl(event.request.url.slice((location.origin + self.__uv$config.prefix).length)));
        if (blockAds && !['document', 'iframe'].includes(event.request.destination) && NovaAdblock.blocks(target.hostname)) {
          return new Response(null, { status: 204 });
        }
      } catch {}
      return sw.fetch(event);
    })());
  }
});
