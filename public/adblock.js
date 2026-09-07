// Conservative domain rules: leave login, CAPTCHA, media and first-party scripts alone.
globalThis.NovaAdblock = {
  hosts: new Set(['doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adnxs.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
    'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com']),
  blocks(hostname) {
    let host = hostname.toLowerCase();
    while (host.includes('.')) {
      if (this.hosts.has(host)) return true;
      host = host.slice(host.indexOf('.') + 1);
    }
    return false;
  },
};
