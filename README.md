# KoloLogin Vault

- `extension/` Chrome extension (Load unpacked in every Chrome profile)
- `src/index.js` + `wrangler.toml` Cloudflare Worker (sync + live login status). Deployed from the repo root, no Root directory setting needed.

Setup: create a D1 database named `kolologin`, paste its ID in `wrangler.toml`, connect this repo in Workers & Pages, add the secret `TOKEN`.
