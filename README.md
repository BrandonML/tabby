# Tabby

Tabby is a Manifest V3 Chrome extension that replaces the new tab page with a nearby, photo-ready adoptable cat. It uses a cache-first UI and a small backend proxy so the RescueGroups public API key never ships in the extension.

## What is included

- New-tab UI with instant cached-card rendering and stale-while-revalidate refresh.
- Browser-coordinate lookup with native postal-code fallback.
- Server-side 25 -> 75 -> 150 -> 250 mile radius ladder, escalating on cumulative deduplicated results until 40 unique cats are found.
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
3. The backend URL is a build-time constant in `extension/config.js`, always `http://localhost:8787` in the repo itself (see "Production deployment" below for how a release swaps in the real URL without editing this file) — Settings only has a ZIP field and a "Use my location" button, no Backend URL field to configure.
4. Open a new tab and allow location, or enter a ZIP.

## Production deployment

Deploying the server is a separate step from packaging the extension; whatever host runs `server/index.js` (a `Dockerfile` is provided at the repo root — it has no build step, since the server has zero runtime dependencies beyond Node built-ins) needs these environment variables set:

- `RG_API_KEY` — set in the platform's secret manager, never committed.
- `ALLOW_ORIGIN` — the installed extension's exact `chrome-extension://<id>` origin, not `*`. This is only knowable once the extension has been uploaded to the Chrome Web Store dashboard at least once (that's what assigns the permanent ID), so it's normal to deploy once with `ALLOW_ORIGIN` unset (permissive, with a logged warning) and circle back to lock it down afterward.
- `NODE_ENV=production` — currently gates stack-trace logging; a follow-up change will also use it to select the production RescueGroups API endpoint instead of the dev/sandbox one.

The in-memory cache is correct as-is for the intended deployment target: a single persistent Node process (for example Render, Railway, Fly.io, or Northflank). It would need to be replaced with a shared cache (for example KV/Redis) only if the server is ever scaled to multiple concurrent instances, or moved to a serverless/edge platform (Vercel functions, Cloudflare Workers) where in-process state isn't reliably shared or persistent between requests — those platforms would also require restructuring `server/index.js` away from its current `node:http` `createServer` model.

Once the server has a real HTTPS URL, package the extension with:

```powershell
npm.cmd run release 1.0.0 https://your-deployed-backend.example.com
```

This bumps `manifest.json`/`package.json` to the given version and zips `manifest.json` + `extension/` for the Chrome Web Store — it does not touch `server/` or its hosting environment. The `<backendUrl>` argument is required (must be `https://`) and is only baked into the **staged copy that gets zipped** — `extension/config.js` in the repo itself is never modified, so it always stays at `http://localhost:8787` for local dev and the test suite (which asserts requests go to `localhost:8787`). There's no manual edit-then-revert step needed for a release.

To manually smoke-test the unpacked extension against a real deployed backend (as opposed to packaging a release), temporarily edit `BACKEND_URL` in `extension/config.js` yourself, reload the unpacked extension, test, then revert the edit (`git checkout -- extension/config.js`) before committing anything or running the test suite.

## Validation

```powershell
npm.cmd test
```

Run the live RescueGroups integration test once against the real API before merging any change to search radius, pagination, or the RescueGroups query contract, to confirm the pagination contract still holds. It requires a real `RG_API_KEY` (loaded from `.env`, same as `start:server`) and is excluded from `npm test`/CI by design:

```powershell
npm.cmd run test:live
```

The project design follows the architecture document in the parent workspace. The API key is intentionally absent from all source files.
