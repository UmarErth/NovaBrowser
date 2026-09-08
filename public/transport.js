// Load before the engine captures fetch. Decode incrementally with backpressure.
(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || url.pathname !== '/bare/v3/') return nativeFetch(request);
    const headers = new Headers(request.headers);
    headers.set('x-nova-encoding', 'base64');
    const response = await nativeFetch(new Request(request, { headers }));
    if (response.headers.get('x-nova-encoding') !== 'base64') return response;
    const decodedHeaders = new Headers(response.headers);
    decodedHeaders.delete('x-nova-encoding');
    decodedHeaders.delete('content-length');
    decodedHeaders.delete('content-encoding');
    return new Response(response.body?.pipeThrough(NovaCodec.decodeStream()) ?? null, {
      status: response.status, statusText: response.statusText, headers: decodedHeaders,
    });
  };
})();
