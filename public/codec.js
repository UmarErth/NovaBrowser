// Base64 is reversible encoding. HTTPS provides transport confidentiality.
(() => {
  const encoder = new TextEncoder();
  function encodeBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  function decodeBytes(text) { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); }
  globalThis.NovaCodec = {
    encodeBytes, decodeBytes,
    encodeStream() {
      let pending = new Uint8Array();
      return new TransformStream({
        transform(chunk, controller) {
          const bytes = new Uint8Array(pending.length + chunk.length);
          bytes.set(pending); bytes.set(chunk, pending.length);
          const end = bytes.length - bytes.length % 3;
          if (end) controller.enqueue(encoder.encode(encodeBytes(bytes.subarray(0, end))));
          pending = bytes.slice(end);
        },
        flush(controller) { if (pending.length) controller.enqueue(encoder.encode(encodeBytes(pending))); },
      });
    },
    decodeStream() {
      let pending = '';
      const decoder = new TextDecoder();
      return new TransformStream({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const end = pending.length - pending.length % 4;
          if (end) controller.enqueue(decodeBytes(pending.slice(0, end)));
          pending = pending.slice(end);
        },
        flush(controller) { pending += decoder.decode(); if (pending) controller.enqueue(decodeBytes(pending)); },
      });
    },
  };
})();
