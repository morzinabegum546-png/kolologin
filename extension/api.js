globalThis.API = {
  call: (path, method = 'GET', body) =>
    new Promise((res) => chrome.runtime.sendMessage({ type: 'api', path, method, body }, (r) => res(r || { ok: false, error: 'no-response' }))),
};
globalThis.FRESH = 150000; // an account counts as "logged in" if its profile checked in within 150 s
