// KoloLogin sync: stores the ENCRYPTED vault (the server never sees passwords) and live login status per account.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const okId = (s) => typeof s === 'string' && /^[\w-]{8,64}$/.test(s);
const okProfile = (s) => typeof s === 'string' && s.length > 0 && s.length <= 40;

let ready;
const init = (db) => (ready ||= db.batch([
  db.prepare('CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY, salt TEXT, iv TEXT, data TEXT, rev INTEGER NOT NULL DEFAULT 0)'),
  db.prepare('CREATE TABLE IF NOT EXISTS status (id TEXT PRIMARY KEY, profile TEXT, ts INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0)'),
]));

export default {
  async fetch(req, env) {
    const auth = req.headers.get('Authorization') || '';
    if (!env.TOKEN || auth !== 'Bearer ' + env.TOKEN) return json({ error: 'unauthorized' }, 401);
    const { pathname } = new URL(req.url);
    const db = env.DB;
    await init(db); // tables are created automatically on first request
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

    if (req.method === 'GET' && pathname === '/state') {
      const rows = (await db.prepare('SELECT id, profile, ts, banned FROM status').all()).results;
      const v = await db.prepare('SELECT rev FROM vault WHERE id = 1').first();
      const status = {};
      for (const r of rows) status[r.id] = { profile: r.profile, ts: r.ts, banned: !!r.banned };
      return json({ now: Date.now(), rev: v ? v.rev : 0, status });
    }

    if (req.method === 'GET' && pathname === '/vault') {
      const v = await db.prepare('SELECT salt, iv, data, rev FROM vault WHERE id = 1').first();
      return json(v && v.data ? { rev: v.rev, vault: { salt: v.salt, iv: v.iv, data: v.data } } : { rev: 0, vault: null });
    }

    if (req.method === 'PUT' && pathname === '/vault') {
      const v = body.vault, base = Number(body.baseRev);
      if (!v || ![v.salt, v.iv, v.data].every((x) => typeof x === 'string') || v.data.length > 900000 || !Number.isInteger(base)) return json({ error: 'bad-request' }, 400);
      await db.prepare("INSERT OR IGNORE INTO vault (id, salt, iv, data, rev) VALUES (1, '', '', '', 0)").run();
      const r = await db.prepare('UPDATE vault SET salt = ?, iv = ?, data = ?, rev = rev + 1 WHERE id = 1 AND rev = ?').bind(v.salt, v.iv, v.data, base).run();
      if (!r.meta.changes) { const cur = await db.prepare('SELECT rev FROM vault WHERE id = 1').first(); return json({ error: 'conflict', rev: cur.rev }, 409); }
      return json({ rev: base + 1 });
    }

    if (req.method === 'POST' && pathname === '/heartbeat') {
      if (!okId(body.id) || !okProfile(body.profile)) return json({ error: 'bad-request' }, 400);
      await db.prepare('INSERT INTO status (id, profile, ts, banned) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, ts = excluded.ts')
        .bind(body.id, body.profile, Date.now()).run();
      return json({ ok: true });
    }

    if (req.method === 'POST' && pathname === '/logout') {
      if (!okId(body.id) || !okProfile(body.profile)) return json({ error: 'bad-request' }, 400);
      await db.prepare('UPDATE status SET ts = 0 WHERE id = ? AND profile = ?').bind(body.id, body.profile).run();
      return json({ ok: true });
    }

    if (req.method === 'POST' && pathname === '/ban') {
      if (!okId(body.id) || typeof body.banned !== 'boolean') return json({ error: 'bad-request' }, 400);
      await db.prepare("INSERT INTO status (id, profile, ts, banned) VALUES (?, '', 0, ?) ON CONFLICT(id) DO UPDATE SET banned = excluded.banned")
        .bind(body.id, body.banned ? 1 : 0).run();
      return json({ ok: true });
    }

    return json({ error: 'not-found' }, 404);
  },
};
