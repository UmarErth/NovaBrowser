self.__uv$config = {
  prefix: '/proxy/',
  bare: '/bare/',
  encodeUrl: function(url) {
    if (!url) return url;
    return encodeURIComponent(
      url.toString().split('').map((char, ind) =>
        ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char
      ).join('')
    );
  },
  decodeUrl: function(url) {
    if (!url) return url;
    const [input, ...search] = url.split('?');
    return (
      decodeURIComponent(input)
        .split('')
        .map((char, ind) =>
          ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char
        )
        .join('') + (search.length ? '?' + search.join('?') : '')
    );
  },
  handler: '/uv/uv.handler.js',
  client: '/uv/uv.client.js',
  bundle: '/uv/uv.bundle.js',
  config: '/uv/uv.config.js',
  sw: '/uv/uv.sw.js'
};