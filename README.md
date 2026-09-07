# Nova Gateway

A Cloudflare Worker with a browser interface and the repository's bundled browsing engine.

## Development and verification

Use Node.js 24 or newer. Install dependencies with `npm ci`, then run:

```sh
npm test
npm run dev
npm run check
```

`npm run check` builds a deployment dry run without publishing. Wrangler's assets binding must be named `ASSETS`; `/bare/*` must run through the Worker. Missing assets return 404 so missing JavaScript cannot silently become HTML.

The files under `public/uv/` are the shipped engine (v2 with Bare v3 transport). The existing package dependency is v3 and is not copied into `public/uv/` automatically: doing so requires a separate transport migration. Two targeted compatibility repairs are applied to the shipped engine: dynamic import argument order in both configuration files, and modern `postMessage(message, options)` transfer handling in `uv.client.js`. Regression tests cover those repairs.

## Browsing and ads

Searches entered in the address bar use Brave. Its search input and text area have an Enter fallback when site JavaScript does not initialize. The engine waits for activation before navigating and reports initialization failures.

The Ads blocked / Ads allowed button controls a small, built-in advertising-domain list. Settings persist on this browser. Turn it off and reload the visited site if a site depends on advertising requests. This is not a full filter-list engine: first-party promotions, all video ads, and every tracker are not covered. CAPTCHA and login domains are deliberately excluded from the list.

The browsing route is `/browse/` with UTF-8 Base64url destination encoding. Old browsing bookmarks from the previous route need to be opened again from the address bar. App-owned identifiers and routes were renamed; third-party API identifiers and license text remain intact.

## Transport and privacy

Fetched HTTP response bodies (HTML, scripts, styles, images, media, and API responses) travel from the Worker to the service worker as streamed Base64 when requested by this app. Decoding occurs before the engine consumes them, preserving binary bytes and range metadata. The server also accepts ordinary Bare v3 HTTP clients. Uploads and WebSocket frames retain their native wire format; WebSocket text/binary types and transferred cookies are preserved.

**Base64 is encoding, not encryption or anonymity.** It adds about 33% to uncompressed payload size and cannot hide content from browser developer tools, the service operator, or anyone able to decode it. Use HTTPS for the app and HTTPS/WSS destinations for transport confidentiality. Destination headers and browser state are not made secret by URL encoding. No browsing-body logging is added.

Uploads are forwarded by the Worker as streams rather than buffered again. Anonymous static responses are cached privately only when the upstream explicitly permits public caching, supplies max-age, and has no Vary or Set-Cookie headers. Requests with cookies or authorization and other responses use no-store on the transport. Base64 overhead means a universal speed increase is not promised.

## Verification and remaining limitations

- 17 Node regression tests pass, including binary/chunk boundaries, early streaming, redirects, multiple cookies, large headers, errors, URL/query encoding, ad rules, private caching, message-port options, and a mocked WebSocket handshake/frame/close lifecycle.
- Browser testing through a local Node HTTP adapter verified startup, the ad toggle, Brave search results after Enter, and the now.gg home/search pages.
- Google still displayed a CAPTCHA. The dropped message-port bug was repaired, but CAPTCHA completion and Google's acceptance of a shared server IP were not verified.
- Roblox on now.gg remained unavailable: the test flow displayed Unauthorized Access and later ad-block detection, including with the local toggle disabled. A direct visit also failed to find the game. No gameplay success is claimed.
- Some dynamic module loads on Brave still reported errors even while ordinary search results worked. This is not a universal modern-site compatibility guarantee.
- The local Wrangler dry run was blocked by Windows `spawn EPERM`. WebSockets have unit coverage but were not exercised end to end in Cloudflare's runtime. Run `npm run check` and a staging smoke test before merging/deploying. No deployment was made.

The platform and upstream sites can impose authentication, CAPTCHA, region, DRM, WebRTC, or browser requirements that this HTTP/WebSocket transport cannot remove.
