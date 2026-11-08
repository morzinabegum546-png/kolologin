chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// All cloud calls go through here so pages never see the token and CORS does not apply.
chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (sender.id !== chrome.runtime.id || m.type !== 'api') return;
  (async () => {
    const { cfg } = await chrome.storage.local.get('cfg');
    if (!cfg || !cfg.url || !cfg.token) return send({ ok: false, error: 'not-configured' });
    try {
      const r = await fetch(cfg.url.replace(/\/$/, '') + m.path, {
        method: m.method || 'GET',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: m.body ? JSON.stringify(m.body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      send({ ok: r.ok, status: r.status, data });
    } catch { send({ ok: false, error: 'network' }); }
  })();
  return true;
});
