# Tabby

Tabby is a Manifest V3 Chrome extension that replaces the new tab page with a nearby, photo-ready adoptable cat. It uses a cache-first UI and a small backend proxy so the RescueGroups public API key never ships in the extension.

## What is included

- New-tab UI with instant cached-card rendering and stale-while-revalidate refresh.
- Browser-coordinate lookup with native postal-code fallback.
- Server-side 10 -> 25 -> 50 -> 100 mile radius ladder.
- RescueGroups `available/cats/haspic` query, nearest-first sorting, picture validation, organization join, and safe profile-url fallback.
- No third-party runtime dependencies; Node's built-in test runner.

## Run locally

1. Start the proxy. Never place the key in extension code.

   ```powershell
   $env:RG_API_KEY = "your-key"
   npm.cmd run start:server
   ```

2. In Chrome, open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and select this `tabby` folder.
3. The backend URL is a build-time constant in `extension/config.js`, defaulting to `http://localhost:8787` — Settings only has a ZIP field and a "Use my location" button, no Backend URL field to configure.
4. Open a new tab and allow location, or enter a ZIP.

## Production deployment

Deploy `server/` behind HTTPS, set `RG_API_KEY` in the platform’s secret manager, set `ALLOW_ORIGIN` to the installed extension’s exact `chrome-extension://<id>` origin, and update `BACKEND_URL` in `extension/config.js` to that HTTPS endpoint before packaging a release with `npm run release <version>`. The in-memory cache is suitable for local development; replace it with a bounded shared cache (for example, KV/Redis) for multi-instance production.

## Validation

```powershell
npm.cmd test
```

Before merging any pagination-related change (see Task 8 in `TASKS.md`), also run the live RescueGroups integration test once against the real API to confirm the pagination contract still holds. It requires a real `RG_API_KEY` and is excluded from `npm test`/CI by design:

```powershell
$env:RG_API_KEY = "your-key"
npm.cmd run test:live
```

The project design follows the architecture document in the parent workspace. The API key is intentionally absent from all source files.
