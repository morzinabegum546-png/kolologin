const $ = (s) => document.querySelector(s);
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v);
  }
  for (const x of c.flat()) if (x != null) e.append(x);
  return e;
};
const field = (l, i) => h('div', {}, h('label', {}, l), i);
const root = $('#app');
let accounts = [], st = null, cfg = null, filter = 'all', q = '', editing = null, timer = null;

const banned = (a) => (st ? !!(st.status[a.id] && st.status[a.id].banned) : a.status === 'banned');
const live = (a) => { const s = st && st.status[a.id]; return !!(s && s.ts && st.now - s.ts < FRESH); };

// ---------- cloud ----------
async function push() {
  const { vault, rev = 0 } = await chrome.storage.local.get(['vault', 'rev']);
  const r = await API.call('/vault', 'PUT', { vault, baseRev: rev });
  if (r.ok) { await chrome.storage.local.set({ rev: r.data.rev }); return 'ok'; }
  return r.status === 409 ? 'conflict' : 'error';
}
async function pull(onlyNewer) {
  const r = await API.call('/vault');
  if (!r.ok || !r.data.vault) return false;
  const { rev = 0 } = await chrome.storage.local.get('rev');
  if (onlyNewer && r.data.rev <= rev) return false;
  await chrome.storage.local.set({ vault: r.data.vault, rev: r.data.rev });
  return true;
}
async function loadState() { if (!cfg) return (st = null); const r = await API.call('/state'); st = r.ok ? r.data : null; }
const note = (t) => { const n = $('#note'); if (n) n.textContent = t || ''; };

// ---------- boot ----------
async function boot() {
  clearInterval(timer);
  const l = await chrome.storage.local.get(['cfg', 'skipCloud']);
  cfg = l.cfg || null;
  if (!(await KB.exists()) && cfg) await pull(false);
  if (!(await KB.exists())) return cfg || l.skipCloud ? viewAuth('setup') : viewCloud();
  if (cfg) await pull(true);
  if (!(await KB.unlocked())) return viewAuth('locked');
  accounts = await KB.load();
  await loadState();
  viewMain();
  timer = setInterval(async () => { await loadState(); renderStats(); renderList(); }, 15000);
}

function shell(extra, ...children) {
  root.replaceChildren(h('header', {}, h('div', { class: 'logo' }, 'K'), h('h1', {}, 'KoloLogin Vault'), ...extra), h('main', {}, ...children));
}

function viewCloud() {
  const f = { url: h('input', { placeholder: 'https://kolologin-sync.yourname.workers.dev' }), token: h('input', { type: 'password' }), profile: h('input', { placeholder: 'Profile 1' }) };
  const err = h('div', { class: 'err' });
  shell([],
    h('div', {}, h('h2', {}, 'Connect cloud sync'),
      h('p', { class: 'hint' }, 'Use the same Worker URL and token in every Chrome profile, but give each profile its own name.')),
    field('Worker URL', f.url), field('Access token', f.token), field('Name of this profile', f.profile), err,
    h('button', { class: 'primary', onclick: async () => {
      const c = { url: f.url.value.trim(), token: f.token.value.trim(), profile: f.profile.value.trim() };
      if (!/^https:\/\//.test(c.url) || !c.token || !c.profile) return (err.textContent = 'Fill in all three fields (URL must start with https://).');
      await chrome.storage.local.set({ cfg: c });
      const r = await API.call('/state');
      if (!r.ok) { await chrome.storage.local.remove('cfg'); return (err.textContent = r.status === 401 ? 'Wrong token.' : 'Could not reach the Worker. Check the URL.'); }
      boot();
    } }, 'Connect'),
    h('button', { class: 'ghost', onclick: async () => { await chrome.storage.local.set({ skipCloud: true }); boot(); } }, 'Skip, use this browser only'));
}

function viewAuth(mode) {
  const setup = mode === 'setup';
  const pass = h('input', { type: 'password', autocomplete: 'off' });
  const pass2 = h('input', { type: 'password', autocomplete: 'off' });
  const err = h('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try {
      if (setup) {
        if (pass.value.length < 8) return (err.textContent = 'Use at least 8 characters.');
        if (pass.value !== pass2.value) return (err.textContent = 'Passwords do not match.');
        await KB.create(pass.value);
        if (cfg) await push();
      } else await KB.unlock(pass.value);
      boot();
    } catch { err.textContent = 'Wrong master password.'; }
  };
  shell([],
    h('div', {}, h('h2', {}, setup ? 'Create your master password' : 'Unlock your vault'),
      h('p', { class: 'hint' }, setup ? 'Every account password is encrypted with it. Use the same master password on all profiles. If you forget it, the data cannot be recovered.' : 'Enter your master password.')),
    field('Master password', pass), setup ? field('Confirm password', pass2) : null, err,
    h('button', { class: 'primary', onclick: go }, setup ? 'Create vault' : 'Unlock'));
  pass.focus();
  [pass, pass2].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && go()));
}

async function persist() {
  await KB.save(accounts);
  if (cfg) {
    const r = await push();
    if (r === 'conflict') { if (await pull(false)) accounts = await KB.load(); note('Another profile changed the vault first. The latest version is loaded. Please repeat your change.'); }
    else if (r === 'error') note('Saved on this profile, but cloud sync failed. Press Sync now later.');
  }
  renderStats(); renderList();
}

async function setBan(a, v) {
  if (st) { await API.call('/ban', 'POST', { id: a.id, banned: v }); await loadState(); }
  else { a.status = v ? 'banned' : 'ok'; await KB.save(accounts); }
  renderStats(); renderList();
}

function viewMain() {
  editing = null;
  const settings = () => {
    const f = { url: h('input', { value: cfg ? cfg.url : '' }), token: h('input', { type: 'password', value: cfg ? cfg.token : '' }), profile: h('input', { value: cfg ? cfg.profile : '' }) };
    const msg = h('div', { class: 'err' });
    return h('details', { class: 'card' }, h('summary', {}, cfg ? 'Cloud sync · ' + cfg.profile : 'Cloud sync (off)'),
      field('Worker URL', f.url), field('Access token', f.token), field('Name of this profile', f.profile), msg,
      h('div', { class: 'acts' },
        h('button', { class: 'primary', onclick: async () => {
          const c = { url: f.url.value.trim(), token: f.token.value.trim(), profile: f.profile.value.trim() };
          if (!/^https:\/\//.test(c.url) || !c.token || !c.profile) return (msg.textContent = 'Fill in all three fields.');
          await chrome.storage.local.set({ cfg: c }); cfg = c;
          const r = await push();
          if (r === 'conflict' && confirm('The cloud already has a vault. Switch this profile to the cloud vault? (You will unlock it again with the same master password.)')) { await pull(false); await KB.lock(); return boot(); }
          boot();
        } }, 'Save'),
        cfg ? h('button', { class: 'ghost', onclick: async () => { await chrome.storage.local.remove('cfg'); boot(); } }, 'Disconnect') : null));
  };
  shell([h('button', { class: 'ghost', onclick: async () => { await KB.lock(); boot(); } }, 'Lock')],
    h('div', { class: 'note', id: 'note' }),
    h('div', { class: 'stats', id: 'stats' }),
    h('input', { id: 'search', placeholder: 'Search account', oninput: (e) => { q = e.target.value; renderList(); } }),
    h('div', { class: 'chips', id: 'chips' }),
    h('div', { class: 'list', id: 'list' }),
    h('div', { class: 'card', id: 'form' }),
    h('details', { class: 'card' }, h('summary', {}, 'Bulk import'),
      h('p', { class: 'hint' }, 'One account per line: username:password'),
      h('textarea', { id: 'bulk', placeholder: 'user1@mail.com:pass1\nuser2@mail.com:pass2' }),
      h('button', { class: 'primary', onclick: bulkImport }, 'Import accounts'), h('div', { class: 'err', id: 'bulkmsg' })),
    settings());
  renderStats(); renderChips(); renderList(); renderForm();
}

function renderStats() {
  const ban = accounts.filter(banned).length, on = accounts.filter((a) => !banned(a) && live(a)).length;
  $('#stats').replaceChildren(
    ...[['Total', accounts.length, ''], ['Logged in', on, 'in'], ['Not logged in', accounts.length - ban - on, ''], ['Banned', ban, 'ban']]
      .map(([l, n, c]) => h('div', { class: 'stat ' + c }, h('b', {}, String(n)), h('span', {}, l))));
}
function renderChips() {
  $('#chips').replaceChildren(...[['all', 'All'], ['out', 'Not logged in'], ['in', 'Logged in'], ['ban', 'Banned']].map(([k, l]) =>
    h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; renderChips(); renderList(); } }, l)));
}
function renderList() {
  const rank = (a) => (banned(a) ? 2 : live(a) ? 1 : 0);
  const items = accounts
    .filter((a) => ((a.label || '') + ' ' + a.user + ' ' + (a.note || '')).toLowerCase().includes(q.toLowerCase()))
    .filter((a) => filter === 'all' || (filter === 'ban' && banned(a)) || (filter === 'in' && !banned(a) && live(a)) || (filter === 'out' && !banned(a) && !live(a)))
    .sort((x, y) => rank(x) - rank(y) || (x.label || x.user).localeCompare(y.label || y.user));
  $('#list').replaceChildren(...(items.length ? items.map(row) : [h('div', { class: 'empty' }, accounts.length ? 'No matching accounts.' : 'Add your first account below.')]));
}
function row(a) {
  const b = banned(a), on = !b && live(a);
  const where = st && st.status[a.id] ? st.status[a.id].profile : '';
  return h('div', { class: 'row' + (b ? ' banned' : '') + (on ? ' live' : '') },
    h('div', { class: 'top' },
      h('div', { class: 'who' }, h('b', {}, a.label || a.user), h('span', {}, a.user + (a.note ? ' · ' + a.note : ''))),
      h('span', { class: 'badge' + (!b && !on ? ' out' : '') }, b ? 'Banned' : on ? 'Logged in' + (where ? ' · ' + where : '') : 'Not logged in')),
    h('div', { class: 'acts' },
      h('button', { class: 'ghost', onclick: () => setBan(a, !b) }, b ? 'Unban' : 'Ban'),
      h('button', { class: 'ghost', onclick: () => { editing = a.id; renderForm(); $('#form').scrollIntoView(); } }, 'Edit'),
      h('button', { class: 'ghost danger', onclick: async () => { if (confirm('Delete ' + (a.label || a.user) + '?')) { accounts = accounts.filter((x) => x.id !== a.id); await persist(); } } }, 'Delete')));
}
function renderForm() {
  const a = accounts.find((x) => x.id === editing) || {};
  const f = { label: h('input', { value: a.label || '' }), user: h('input', { value: a.user || '', autocomplete: 'off' }),
    pass: h('input', { type: 'password', value: a.pass || '', autocomplete: 'off' }), note: h('input', { value: a.note || '' }) };
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!f.user.value.trim() || !f.pass.value) return (err.textContent = 'Username and password are required.');
    if (accounts.find((x) => x.user === f.user.value.trim() && x.id !== a.id)) return (err.textContent = 'This username is already saved.');
    const data = { label: f.label.value.trim(), user: f.user.value.trim(), pass: f.pass.value, note: f.note.value.trim() };
    if (a.id) Object.assign(a, data); else accounts.push({ id: crypto.randomUUID(), status: 'ok', ...data });
    editing = null; await persist(); renderForm();
  };
  $('#form').replaceChildren(h('h2', {}, a.id ? 'Edit account' : 'Add account'),
    field('Name (optional)', f.label), field('Username or email', f.user), field('Password', f.pass), field('Note (optional)', f.note), err,
    h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: save }, a.id ? 'Save changes' : 'Add account'),
      a.id ? h('button', { class: 'ghost', onclick: () => { editing = null; renderForm(); } }, 'Cancel') : null));
}
async function bulkImport() {
  let added = 0, skipped = 0;
  for (const l of $('#bulk').value.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const i = l.search(/[:|\t]/);
    const user = i > 0 ? l.slice(0, i).trim() : '', pass = i > 0 ? l.slice(i + 1).trim() : '';
    if (!user || !pass || accounts.some((x) => x.user === user)) { skipped++; continue; }
    accounts.push({ id: crypto.randomUUID(), label: '', user, pass, note: '', status: 'ok' }); added++;
  }
  await persist(); $('#bulk').value = ''; $('#bulkmsg').textContent = `Imported ${added}, skipped ${skipped}.`;
}
boot();
