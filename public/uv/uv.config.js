self.__uv$config = {
  prefix: '/browse/',
  bare: '/bare/',
  encodeUrl(url) {
    if (!url) return url;
    const bytes = new TextEncoder().encode(String(url));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  },
  decodeUrl(url) {
    if (!url) return url;
    const [withoutHash, ...hash] = String(url).split('#');
    const [input, ...search] = withoutHash.split('?');
    const value = input.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(value);
    let decoded = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    if (search.length) { const target = new URL(decoded); target.search = '?' + search.join('?'); decoded = target.href; }
    if (hash.length) { const target = new URL(decoded); target.hash = '#' + hash.join('#'); decoded = target.href; }
    return decoded;
  },
  handler: '/uv/uv.handler.js',
  client: '/uv/uv.client.js',
  bundle: '/uv/uv.bundle.js',
  config: '/uv/uv.config.js',
  sw: '/uv/uv.sw.js'
};

// The bundled engine passes (base, specifier) when rewriting dynamic import().
// Resolve the specifier against its source module, not the other way around.
self.Ultraviolet.prototype.rewriteImport = function(base, specifier, meta = this.meta) {
  return this.rewriteUrl(specifier, { ...meta, base });
};
