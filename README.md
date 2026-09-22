# Tabby

**[Get Tabby on the Chrome Web Store](https://chromewebstore.google.com/detail/tabby-new-tab-for-adoptab/elfpnkoboidkgahmoggodpnmekfodcig)**

Tabby is a Manifest V3 Chrome extension that replaces the new tab page with a nearby, photo-ready adoptable cat. It uses a cache-first UI and a small backend proxy so the RescueGroups public API key never ships in the extension.

## What is included

- New-tab UI with instant cached-card rendering and stale-while-revalidate refresh.
- Browser-coordinate lookup with native postal-code fallback.
- Server-side 25 -> 75 -> 150 -> 250 mile radius ladder, escalating on cumulative deduplicated results until 40 unique cats are found.
- RescueGroups `available/cats/haspic` query, nearest-first sorting, picture validation, organization join, and safe profile-url fallback.
- Content-aware crop for portrait photos: a row-wise edge-energy heuristic finds the likely subject band instead of always anchoring to the top, via a small hostname-locked analysis-thumbnail proxy (`GET /api/photo-thumb`) that works around RescueGroups' CDN sending no CORS headers.
- "Share this cat" via the Web Share API, attaching the actual photo (fetched through a second hostname-locked, share-sized proxy, `GET /api/photo-share`, for the same CORS reason as the crop analysis above) alongside the cat's details, a Tabby tagline, and its RescueGroups profile link. Degrades to a link-only native share if the photo can't be attached, and to a clipboard-copy if the platform has no Web Share API at all.
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
- `ALLOW_ORIGIN` — the installed extension's exact `chrome-extension://<id>` origin, not `*`. Each store (Chrome Web Store, Edge Add-ons, ...) assigns its own extension ID even for an identical package, so once the extension is published to more than one store this needs a comma-separated list of every store's origin, e.g. `chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig,chrome-extension://fieeoalehgckgnkohkdblljmgaemaiho` (Edge extensions also use the `chrome-extension://` scheme, not `edge-extension://`). The server reflects back whichever of these matches the incoming request's `Origin` header; an origin not in the list gets refused by the browser. This is only knowable once the extension has been uploaded to each store's dashboard at least once (that's what assigns the permanent ID), so it's normal to deploy once with `ALLOW_ORIGIN` unset (permissive, with a logged warning) and circle back to lock it down afterward — and to append to the list, rather than replace it, each time the extension is published to a new store.
- `NODE_ENV=production` — gates stack-trace logging in error responses. RescueGroups has only one API endpoint (`server/rescuegroups.js`'s `BASE_URL`); local dev, tests, and production all call the same live API, there is no separate dev/sandbox endpoint to select between.

The in-memory cache is correct as-is for the intended deployment target: a single persistent Node process (for example Render, Railway, Fly.io, or Northflank). It would need to be replaced with a shared cache (for example KV/Redis) only if the server is ever scaled to multiple concurrent instances, or moved to a serverless/edge platform (Vercel functions, Cloudflare Workers) where in-process state isn't reliably shared or persistent between requests — those platforms would also require restructuring `server/index.js` away from its current `node:http` `createServer` model.

`/api/nearby-cats` is also rate-limited per client IP (30 requests / 5 minutes, in-memory, same deployment assumption as the cache above) — a cache miss costs a real RescueGroups API call, so this bounds how much a script varying postal codes/coordinates can cost regardless of the response cache. The client IP is taken from `X-Forwarded-For` when present (Northflank and similar platforms terminate the real connection and forward, so `request.socket.remoteAddress` alone would otherwise be the platform's internal proxy address for every request), falling back to the raw socket address only when that header is absent, as in local dev. If a future host doesn't set `X-Forwarded-For` in front of this server, every request would be seen as one shared IP.

Once the server has a real HTTPS URL, package the extension with:

```powershell
npm.cmd run release 1.0.0 https://your-deployed-backend.example.com
```

This bumps `manifest.json`/`package.json` to the given version and zips `manifest.json` + `extension/` for the Chrome Web Store — it does not touch `server/` or its hosting environment. The `<backendUrl>` argument is required (must be `https://`) and is only baked into the **staged copy that gets zipped** — `extension/config.js` in the repo itself is never modified, so it always stays at `http://localhost:8787` for local dev and the test suite (which asserts requests go to `localhost:8787`). There's no manual edit-then-revert step needed for a release. The same zip is submitted to both the Chrome Web Store and Edge Add-ons — Edge is Chromium-based and needs no code changes.

## CI/CD

Three GitHub Actions workflows automate the release process end to end — see [RELEASE.md](RELEASE.md) for the step-by-step runbook:

- **`ci.yml`** — runs `npm test` on every push and pull request to `main`/`dev`, pinned to Node 22 to match the Dockerfile. `main` has a ruleset (Settings → Rules → Rulesets) requiring this check to pass and requiring a pull request before merging — the workflow alone doesn't block anything, only the ruleset does.
- **`tag-release.yml`** — on every push to `main`, tags the commit `v<version>` (read from `manifest.json`) if that tag doesn't already exist. Idempotent, so it's safe to fire on every push rather than needing to detect "was this actually a release."
- **`deploy-verify.yml`** — on every push to `main` that touches `server/**` or `Dockerfile` (mirroring the `tabby` service's own Northflank build trigger), polls the live `/healthz` endpoint until its `sha` field (see below) matches the pushed commit, then smoke-tests `/api/nearby-cats`, `/api/photo-thumb`, and `/api/photo-share` against production. A **green run is the signal that it's safe to build and submit the release to CWS/EWS** — since Northflank deploys in minutes and store review takes hours, the server is always live and correct well before any user's browser updates to a new extension version, as long as server changes stay additive/backward-compatible with whatever extension version is still in the wild.

`/healthz` reports `{ status: "ok", sha }`, where `sha` is Northflank's auto-injected `NF_DEPLOYMENT_SHA` runtime env var (the exact git commit of the running build) — `null` locally, where that variable is never set. This is what lets `deploy-verify.yml` confirm the *new* code is actually live, not just that some process answered the health check.

To manually smoke-test the unpacked extension against a real deployed backend (as opposed to packaging a release), temporarily edit `BACKEND_URL` in `extension/config.js` yourself, reload the unpacked extension, test, then revert the edit (`git checkout -- extension/config.js`) before committing anything or running the test suite.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-08-19 | Initial Chrome Web Store submission: location/ZIP search with radius escalation, explore-another-area, adoption fee display, redesigned card layout |
| 2.1.0 | 2026-09-14 | Custom "Share via" menu (WhatsApp, Email, X/Twitter, Facebook, Reddit, Pinterest, Nextdoor, Copy link) replacing the single native-share-only button |
| 2.2.0 | 2026-09-18 | Design polish: settings panel spacing + floating-label ZIP/Save input group (#30), tagline moved beside the wordmark (#25), dropped the un-loaded Inter font (#42), focus-visible rings and hover transitions, ZIP field now filters non-digit input as you type |

Add a row here as part of every release PR — see [RELEASE.md](RELEASE.md).

## Validation

```powershell
npm.cmd test
```

Run the live RescueGroups integration test once against the real API before merging any change to search radius, pagination, or the RescueGroups query contract, to confirm the pagination contract still holds. It requires a real `RG_API_KEY` (loaded from `.env`, same as `start:server`) and is excluded from `npm test`/CI by design:

```powershell
npm.cmd run test:live
```

The project design follows the architecture document in the parent workspace. The API key is intentionally absent from all source files.
