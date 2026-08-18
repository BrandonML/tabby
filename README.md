# Tabby

Tabby is a Manifest V3 Chrome extension that replaces the new tab page with a nearby, photo-ready adoptable cat. It uses a cache-first UI and a small backend proxy so the RescueGroups public API key never ships in the extension.

## What is included

- New-tab UI with instant cached-card rendering and stale-while-revalidate refresh.
- Browser-coordinate lookup with native postal-code fallback.
- Server-side 10 -> 25 -> 50 -> 100 mile radius ladder.
- RescueGroups `available/cats/haspic` query, nearest-first sorting, picture validation, organization join, and safe profile-url fallback.
- No third-party runtime dependencies; Node's built-in test runner.

## Run locally

1. Copy `.env.example` to `.env` and fill in your real `RG_API_KEY`. `.env` is gitignored and never committed — never place the key in extension code either.

   ```powershell
   Copy-Item .env.example .env
   # edit .env and set RG_API_KEY to your real key
   npm.cmd run start:server
   ```

   `start:server` loads `.env` automatically via Node's built-in `--env-file-if-exists` flag — no need to set the key inline on every run.

2. In Chrome, open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and select this `tabby` folder.
3. The backend URL is a build-time constant in `extension/config.js`, defaulting to `http://localhost:8787` — Settings only has a ZIP field and a "Use my location" button, no Backend URL field to configure.
4. Open a new tab and allow location, or enter a ZIP.

## Production deployment

`npm run release <version>` only packages the **extension** (bumps the version and zips `manifest.json` + `extension/` for the Chrome Web Store) — it does not touch `server/` or its hosting environment. Deploying the server is a separate, currently manual step; whatever host runs `server/index.js` needs these environment variables set:

- `RG_API_KEY` — set in the platform's secret manager, never committed.
- `ALLOW_ORIGIN` — the installed extension's exact `chrome-extension://<id>` origin, not `*`.
- `NODE_ENV=production` — currently gates stack-trace logging; a follow-up change will also use it to select the production RescueGroups API endpoint instead of the dev/sandbox one.

Also update `BACKEND_URL` in `extension/config.js` to the server's HTTPS endpoint before packaging a release. The in-memory cache is suitable for local development; replace it with a bounded shared cache (for example, KV/Redis) for multi-instance production.

## Validation

```powershell
npm.cmd test
```

Before merging any pagination-related change (see Task 8 in `TASKS.md`), also run the live RescueGroups integration test once against the real API to confirm the pagination contract still holds. It requires a real `RG_API_KEY` (loaded from `.env`, same as `start:server`) and is excluded from `npm test`/CI by design:

```powershell
npm.cmd run test:live
```

The project design follows the architecture document in the parent workspace. The API key is intentionally absent from all source files.
