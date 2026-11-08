(() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const IDLE = 8 * 60 * 60 * 1000; // stays unlocked while you work; cleared when the browser closes

  async function derive(pass, salt) {
    const m = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 300000, hash: 'SHA-256' },
      m, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), data: b64(ct) };
  }
  async function open(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(blob.iv) }, key, ub64(blob.data));
    return JSON.parse(dec.decode(pt));
  }

  const KB = {
    async exists() { return !!(await chrome.storage.local.get('vault')).vault; },
    async create(master) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await derive(master, salt);
      const body = await seal(key, []);
      await chrome.storage.local.set({ vault: { salt: b64(salt), ...body } });
      await KB._session(key);
    },
    async unlock(master) {
      const { vault } = await chrome.storage.local.get('vault');
      const key = await derive(master, ub64(vault.salt));
      await open(key, vault); // throws if the master password is wrong
      await KB._session(key);
    },
    async _session(key) {
      const jwk = await crypto.subtle.exportKey('jwk', key);
      await chrome.storage.session.set({ sess: { jwk, until: Date.now() + IDLE } });
    },
    async _key() {
      const { sess } = await chrome.storage.session.get('sess');
      if (!sess || sess.until < Date.now()) return null;
      return crypto.subtle.importKey('jwk', sess.jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    },
    async touch() {
      const { sess } = await chrome.storage.session.get('sess');
      if (sess) { sess.until = Date.now() + IDLE; await chrome.storage.session.set({ sess }); }
    },
    async unlocked() { return !!(await KB._key()); },
    async lock() { await chrome.storage.session.remove('sess'); },
    async load() {
      const key = await KB._key(); if (!key) return null;
      const { vault } = await chrome.storage.local.get('vault');
      return open(key, vault);
    },
    async save(list) {
      const key = await KB._key(); if (!key) throw new Error('locked');
      const { vault } = await chrome.storage.local.get('vault');
      await chrome.storage.local.set({ vault: { salt: vault.salt, ...(await seal(key, list)) } });
      await KB.touch();
    },
  };
  globalThis.KB = KB;
})();
