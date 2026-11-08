(() => {
  if (window.__koloLoginLoaded) return;
  window.__koloLoginLoaded = true;
  const BEAT = 45000, POLL = 15000;

  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const findPassword = () => [...document.querySelectorAll('input[type="password"]')].find(visible);
  function findUserField(pw) {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter((i) => visible(i) && ['text', 'email', 'tel', ''].includes((i.getAttribute('type') || '').toLowerCase()));
    let best = null;
    for (const i of inputs) if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i;
    return best || inputs[0] || null;
  }
  function setVal(el, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus(); setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function submit(pw) {
    const form = pw.form;
    const btn = form && form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (btn) btn.click(); else if (form) (form.requestSubmit ? form.requestSubmit() : form.submit());
    else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .wrap { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 340px; max-height: 82vh; display: flex; flex-direction: column;
      background: #fff; color: #18202F; border: 1px solid #D8DDE8; border-radius: 14px; box-shadow: 0 14px 40px rgba(24,32,47,.22); overflow: hidden; }
    .wrap.inside { top: auto; bottom: 16px; }
    .wrap.min { width: auto; max-width: 300px; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #18202F; color: #fff; cursor: pointer; }
    .logo { width: 22px; height: 22px; border-radius: 6px; background: #4455D6; display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
    .title { font-weight: 650; font-size: 13.5px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sum { font-size: 12px; opacity: .8; white-space: nowrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #8A93A6; flex: none; }
    .dot.in { background: #34D399; } .dot.ban { background: #F0764F; }
    .body { display: flex; flex-direction: column; min-height: 0; }
    .min .body { display: none; }
    .chips { display: flex; gap: 6px; padding: 10px 10px 0; flex-wrap: wrap; }
    .chip { background: #fff; border: 1px solid #D8DDE8; color: #18202F; padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .chip.on { background: #18202F; color: #fff; border-color: #18202F; }
    .search { margin: 8px 10px 6px; padding: 8px 10px; border: 1px solid #D8DDE8; border-radius: 8px; font-size: 13px; outline: none; background: #F2F4F8; }
    .search:focus { border-color: #4455D6; background: #fff; box-shadow: 0 0 0 3px rgba(68,85,214,.15); }
    .list { overflow: auto; padding: 2px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 10px; border: 1px solid #D8DDE8; border-radius: 10px; }
    .row.banned { background: #FBF0EC; border-color: #F0CBBF; }
    .row.live { background: #F0FAF5; border-color: #BFE6D3; }
    .row.me { border-color: #4455D6; box-shadow: 0 0 0 1px #4455D6; }
    .who { flex: 1; min-width: 0; }
    .who b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who span { display: block; font-size: 11.5px; color: #6A7385; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .banned .who b { text-decoration: line-through; color: #8A3A22; }
    .live .who span { color: #1F7A57; }
    button { border: 0; border-radius: 7px; padding: 7px 11px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    button:focus-visible { outline: 2px solid #4455D6; outline-offset: 2px; }
    .go { background: #4455D6; color: #fff; } .go:hover { background: #3544B8; }
    .go[disabled] { background: #C9CEDB; cursor: not-allowed; }
    .flag { background: transparent; color: #6A7385; padding: 7px 8px; border: 1px solid #D8DDE8; }
    .flag:hover { color: #C8431F; border-color: #C8431F; }
    .out { margin: 8px 10px 0; background: #F2F4F8; color: #18202F; border: 1px solid #D8DDE8; }
    .msg { padding: 14px; font-size: 13px; color: #4A5367; line-height: 1.5; }
  `;

  let host, shadow;
  const S = { accounts: null, st: null, cfg: null, me: null, q: '', f: 'all', min: null, mode: null, lastBeat: 0 };
  const banned = (a) => (S.st ? !!(S.st.status[a.id] && S.st.status[a.id].banned) : a.status === 'banned');
  const live = (a) => { const s = S.st && S.st.status[a.id]; return !!(s && s.ts && S.st.now - s.ts < FRESH); };
  const where = (a) => (S.st && S.st.status[a.id] ? S.st.status[a.id].profile : '');

  async function load() {
    const l = await chrome.storage.local.get(['cfg', 'koloLast']);
    S.cfg = l.cfg || null;
    S.me = typeof l.koloLast === 'string' ? l.koloLast : (l.koloLast && l.koloLast.id) || null;
    S.accounts = (await KB.exists()) ? await KB.load() : null;
  }

  async function tick() {
    await load();
    if (S.cfg) {
      const { koloLast: k } = await chrome.storage.local.get('koloLast');
      if (k && typeof k === 'object') {
        if (findPassword()) {
          if (Date.now() - k.at > 20000) { // still on the login form 20 s after clicking Login, so not logged in
            await API.call('/logout', 'POST', { id: k.id, profile: S.cfg.profile });
            await chrome.storage.local.remove('koloLast'); S.me = null;
          }
        } else if (Date.now() - S.lastBeat >= BEAT) {
          S.lastBeat = Date.now();
          await API.call('/heartbeat', 'POST', { id: k.id, profile: S.cfg.profile });
          await KB.touch();
        }
      }
      const r = await API.call('/state'); if (r.ok) S.st = r.data;
    } else S.st = null;
    render();
  }

  function render() {
    if (shadow && shadow.activeElement && shadow.activeElement.classList.contains('search')) return;
    draw();
  }

  async function setBan(a, v) {
    if (S.cfg) { await API.call('/ban', 'POST', { id: a.id, banned: v }); const r = await API.call('/state'); if (r.ok) S.st = r.data; }
    else { a.status = v ? 'banned' : 'ok'; await KB.save(S.accounts); }
    draw();
  }

  async function login(a) {
    const pw = findPassword(); if (!pw) return;
    const user = findUserField(pw);
    if (user) setVal(user, a.user);
    setVal(pw, a.pass);
    await chrome.storage.local.set({ koloLast: { id: a.id, at: Date.now() } });
    if (S.cfg) await API.call('/heartbeat', 'POST', { id: a.id, profile: S.cfg.profile }); // claim it right away
    setTimeout(() => submit(pw), 150);
  }

  function draw() {
    const pw = findPassword();
    S.mode = pw ? 'login' : 'inside';
    if (!host) { host = document.createElement('div'); shadow = host.attachShadow({ mode: 'open' }); document.documentElement.appendChild(host); }
    const min = S.min === null ? S.mode === 'inside' : S.min;
    const A = S.accounts || [];
    const nBan = A.filter(banned).length;
    const nIn = A.filter((a) => !banned(a) && live(a)).length;
    const nOut = A.length - nBan - nIn;
    const me = A.find((a) => a.id === S.me);

    shadow.innerHTML = `<style>${CSS}</style><div class="wrap ${S.mode} ${min ? 'min' : ''}">
      <div class="head" id="head"><div class="logo">K</div>
        <span class="dot ${S.mode === 'inside' && S.me ? 'in' : ''}"></span>
        <div class="title"></div><div class="sum"></div></div><div class="body"></div></div>`;
    shadow.querySelector('.title').textContent = S.mode === 'inside' ? (me ? (me.label || me.user) : S.me ? 'Logged in' : 'KoloLogin') : 'KoloLogin';
    shadow.querySelector('.sum').textContent = A.length ? `${nIn} in · ${nOut} free` + (nBan ? ` · ${nBan} banned` : '') : (S.accounts ? '' : 'locked');
    shadow.getElementById('head').addEventListener('click', () => { S.min = !min; draw(); });
    const body = shadow.querySelector('.body');

    if (S.accounts === null) { body.innerHTML = '<div class="msg">The vault is locked. Click the KoloLogin icon in the toolbar and enter your master password.</div>'; return; }
    if (!A.length) { body.innerHTML = '<div class="msg">No accounts yet. Open the KoloLogin icon to add your accounts.</div>'; return; }

    if (S.mode === 'inside' && S.me && S.cfg) {
      const o = document.createElement('button'); o.className = 'out'; o.textContent = 'I logged out of this profile';
      o.addEventListener('click', async () => { await API.call('/logout', 'POST', { id: S.me, profile: S.cfg.profile }); await chrome.storage.local.remove('koloLast'); S.me = null; tick(); });
      body.append(o);
    }
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const [k, l, n] of [['all', 'All', A.length], ['out', 'Not logged in', nOut], ['in', 'Logged in', nIn], ['ban', 'Banned', nBan]]) {
      const c = document.createElement('button'); c.className = 'chip' + (S.f === k ? ' on' : ''); c.textContent = `${l} ${n}`;
      c.addEventListener('click', () => { S.f = k; draw(); }); chips.append(c);
    }
    const search = document.createElement('input'); search.className = 'search'; search.placeholder = 'Search account'; search.value = S.q;
    search.addEventListener('input', () => { S.q = search.value; draw(); const s = shadow.querySelector('.search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    const rank = (a) => (banned(a) ? 2 : live(a) ? 1 : 0);
    const items = A.filter((a) => (a.label + ' ' + a.user).toLowerCase().includes(S.q.toLowerCase()))
      .filter((a) => S.f === 'all' || (S.f === 'ban' && banned(a)) || (S.f === 'in' && !banned(a) && live(a)) || (S.f === 'out' && !banned(a) && !live(a)))
      .sort((x, y) => rank(x) - rank(y) || (x.label || x.user).localeCompare(y.label || y.user));
    const ul = document.createElement('div'); ul.className = 'list';
    for (const a of items) {
      const isB = banned(a), isL = !isB && live(a);
      const row = document.createElement('div');
      row.className = 'row' + (isB ? ' banned' : '') + (isL ? ' live' : '') + (S.me === a.id ? ' me' : '');
      const who = document.createElement('div'); who.className = 'who';
      const b = document.createElement('b'); b.textContent = a.label || a.user;
      const s = document.createElement('span');
      s.textContent = isB ? 'Banned' : isL ? 'Logged in' + (S.cfg && where(a) === S.cfg.profile ? ' · this profile' : where(a) ? ' · ' + where(a) : '') : 'Not logged in';
      who.append(b, s); row.append(who);
      const flag = document.createElement('button'); flag.className = 'flag'; flag.textContent = isB ? 'Unban' : 'Ban';
      flag.addEventListener('click', () => setBan(a, !isB)); row.append(flag);
      if (S.mode === 'login') {
        const go = document.createElement('button'); go.className = 'go';
        go.textContent = isL ? 'In use' : 'Login'; go.disabled = isB || isL;
        go.addEventListener('click', () => login(a)); row.append(go);
      }
      ul.append(row);
    }
    body.append(chips, search, ul);
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && (ch.vault || ch.cfg || ch.koloLast)) tick();
    if (area === 'session' && ch.sess && !ch.sess.oldValue !== !ch.sess.newValue) tick();
  });
  let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!!findPassword() !== (S.mode === 'login')) draw(); }, 300); })
    .observe(document.documentElement, { childList: true, subtree: true });
  tick(); setInterval(tick, POLL);
})();
