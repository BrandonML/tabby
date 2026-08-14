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
3. Open Tabby settings and retain `http://localhost:8787` for local development. Enter a fallback ZIP if preferred.
4. Open a new tab and allow location, or enter a ZIP.

## Production deployment

Deploy `server/` behind HTTPS, set `RG_API_KEY` in the platform’s secret manager, set `ALLOW_ORIGIN` to the installed extension’s exact `chrome-extension://<id>` origin, and point Tabby settings at that HTTPS endpoint. The in-memory cache is suitable for local development; replace it with a bounded shared cache (for example, KV/Redis) for multi-instance production.

## Validation

```powershell
npm.cmd test
```

The project design follows the architecture document in the parent workspace. The API key is intentionally absent from all source files.
