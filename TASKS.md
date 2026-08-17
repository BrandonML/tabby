# Tabby — Implementation Prompts for Jules

Ordered to minimize merge conflicts: each task is scoped to a distinct file set where
possible, and tasks that must touch a shared file (settings UI, RescueGroups client) are
sequenced back-to-back so each builds on the previous task's state rather than racing it.
Apply in order; each prompt assumes all prior tasks in this doc have already landed.

---

## Task 1 — AGENTS.md: scoped testing rules + QA checklist

**Issue:** AGENTS.md's testing table only has two tiers ("Server logic → unit tests" /
"UI or user-facing flow → Manual end-to-end QA") with no guidance on how much testing a
change actually needs, and no manual-QA checklist defining what "end-to-end QA" covers.
This creates two problems: (1) agents run the full suite even for a one-line comment or
README change, and (2) "manual QA" is undefined, so it's inconsistently performed or
skipped entirely (see the "Change back to Google?" modal in Task 10, which suggests
install-flow QA hasn't been done).

**Expected outcome:** AGENTS.md defines three testing tiers instead of two, and includes
a concrete manual QA checklist for UI-affecting changes.

**Implementation specifics:**
Edit the "4. Testing & QA" section of `AGENTS.md`. Replace the existing table with:

- **Tier 1 — Test-exempt** (no test run required): changes limited to `README.md`,
  `AGENTS.md`, code comments, `.gitignore`, or files under `/test` that only add or
  modify test cases (not source files).
- **Tier 2 — Narrow impact** (run only the directly affected test file(s)): a change
  confined to a single function or a single file with no changes to its exported
  signatures or call sites elsewhere. Example: editing `showNotice()`'s copy runs only
  `newtab.test.js`, not the full suite.
- **Tier 3 — Full suite required**: anything touching exported function signatures,
  `server/`, shared state shape (`feedCache`, `settings`), manifest permissions, or any
  `release/` branch. Full suite is **always** required before a version bump or release
  task regardless of what Tier 1/2 would otherwise allow.

Also add a "Manual QA Checklist" subsection listing the minimum steps for any UI-affecting
change: load unpacked extension in `chrome://extensions`, open a new tab and confirm card
render, open Settings and confirm save/close flow, and confirm no console errors in the
service worker or new-tab page devtools.

State explicitly that an agent's own judgment that a change is "probably fine to skip"
is **not** sufficient — only the Tier 1 allowlist above qualifies for a skip; everything
else falls to Tier 2 or 3.

**Testing required:** None (Tier 1 — docs only).

---

## Task 2 — Release build script

**Issue:** `package.json` only defines `test` and `start:server` scripts. There's no
automated way to bump the version number consistently across `manifest.json` and
`package.json`, or to package a clean, submission-ready zip for the Chrome Web Store.
AGENTS.md already restricts `manifest.json` edits to "release tasks only" but there's no
tooling that enforces or automates that boundary.

**Expected outcome:** Running `npm run release <version>` (e.g. `npm run release 0.2.0`)
updates the `version` field in both `manifest.json` and `package.json` to the given value,
then produces `v0.2.0.zip` in a `dist/` (gitignored) folder containing only
`manifest.json` and the `extension/` directory — no `server/`, `test/`, `node_modules`,
`.git`, or lockfiles.

**Implementation specifics:**
- Add a Node script (e.g. `scripts/release.js`) that: (1) reads the version argument from
  `process.argv`, validates it's semver-ish (`\d+\.\d+\.\d+`), (2) reads/writes `version`
  in `manifest.json` and `package.json` via `JSON.parse`/`JSON.stringify` (preserve
  existing formatting/indentation), (3) copies `manifest.json` + `extension/` into a temp
  staging dir, (4) zips the staging dir to `dist/v<version>.zip` (use Node's built-in
  zip via a small dependency-free implementation, or `archiver` if a dependency is
  justified — note the AGENTS.md rule that new dependencies must be justified in the
  commit message).
- Add `"release": "node scripts/release.js"` to `package.json` scripts.
- Add `dist/` to `.gitignore`.
- Fail loudly (non-zero exit) if the version argument is missing or malformed, or if
  `manifest.json`/`package.json` versions don't match after the write (sanity check).

**Testing required:** Tier 3 (new script, touches manifest/package.json handling). Add a
test file `test/release.test.js` that runs the script against a temp copy of the repo
fixtures and asserts: both files' versions match, the produced zip exists, and the zip
does **not** contain `server/`, `test/`, or `.git` paths. Run full suite after.

---

## Task 3 — Server & client logging / error handling

**Issue:** `server/index.js`'s catch block returns a generic error to the client but
never logs the underlying error server-side — a production RescueGroups outage or
malformed payload would be invisible. Client-side, the catch blocks in `newtab.js`
(`refresh()`, `_start()`) and `options.js` (`refreshCacheForZip()`) only call
`showNotice(...)`; nothing is logged for debugging a user-reported issue.

**Expected outcome:** Server errors are logged with enough context to diagnose without
exposing secrets (never log `RG_API_KEY` or full request bodies containing PII beyond
location). Client errors are logged to the console so they're visible in devtools during
support/debugging, in addition to the existing user-facing notice.

**Implementation specifics:**
- `server/index.js`: in the `catch (error)` block of the request handler, add
  `console.error("[tabby-server]", { status, message: error.message, url: request.url })`
  before the `send(...)` call. Do not log `location` coordinates/postal code at error
  level beyond what's already safe (postal code is fine; avoid logging full stack traces
  in production — gate stack trace logging behind `NODE_ENV !== "production"`).
- `extension/newtab.js`: in `refresh()`'s caller (`_start`'s catch block) and any other
  catch sites, add `console.error("[tabby]", error)` alongside the existing
  `showNotice(...)` call.
- `extension/options.js`: same pattern in `refreshCacheForZip`'s catch block.

**Testing required:** Tier 2. Update `test/server.test.js` to assert `console.error` is
called (spy/mock) on the existing error-path tests (502/400/etc.) without changing their
status-code assertions. Similarly add a `console.error` spy assertion to the existing
"throws error on failure" test in `newtab.test.js` and the network-error test in
`options.test.js`. No full-suite run needed since signatures are unchanged, but run
`newtab.test.js`, `options.test.js`, and `server.test.js` directly.

---

## Task 4 — Remove the "Showing results within X miles" notice

**Issue:** `refresh()` in `extension/newtab.js` unconditionally calls
`showNotice(\`Showing results within ${feed.radiusMiles} miles.\`)` after every
successful refresh. This isn't intermittent — it fires every time — but per your
direction it should not display at all for now.

**Expected outcome:** After a successful refresh, the `#notice` element is empty (no
radius text shown). No other notice behavior changes (empty-results and error notices
remain as-is).

**Implementation specifics:** In `refresh()` in `extension/newtab.js`, remove the line
`showNotice(\`Showing results within ${feed.radiusMiles} miles.\`);` at the end of the
success path. Confirm nothing else depends on `#notice` being populated on the happy
path — it should simply stay empty until the next notice-worthy event (error, empty
results, or a stale-cache notice from `renderCard`'s `stale` flag).

**Testing required:** Tier 2. Update the "updates cache and renders card on success" test
in `newtab.test.js` to assert `notice.textContent` is empty rather than asserting the old
radius string. Run `newtab.test.js` only.

---

## Task 5 — Remove the Backend URL field from Settings

**Issue:** `extension/options.html` exposes a required "Backend URL" input, and
`options.js` reads/writes `settings.backendUrl`. Per your direction, you're the sole
developer and the production/dev backend address should be a build-time constant, not a
user-editable field — the current UI both leaks an implementation detail and lets someone
point the extension at an arbitrary endpoint.

**Expected outcome:** Settings only shows the Zip Code field. The backend URL is a single
hardcoded constant used everywhere `settings.backendUrl` was previously read, defaulting
to `http://localhost:8787` for local dev. No stored `backendUrl` value in
`chrome.storage.local` is read or written anymore.

**Implementation specifics:**
- Add a constant, e.g. `extension/config.js` exporting
  `export const BACKEND_URL = "http://localhost:8787";`. Swap this to the production URL
  as a manual step in the release checklist (Task 2) rather than a code TODO — AGENTS.md
  forbids committed TODO/FIXME comments, so call this out in the PR description instead.
- `extension/options.html`: remove the `#backend-field` div and its label/input entirely.
- `extension/options.js`: remove all `backend`/`backendField` DOM references and the
  `backend.value` read on submit; import `BACKEND_URL` from `./config.js` and use it in
  `refreshCacheForZip`'s `backendUrl` variable instead of `nextSettings.backendUrl`. Stop
  writing `backendUrl` into `nextSettings`.
- `extension/newtab.js`: same substitution — replace
  `settings.backendUrl || "http://localhost:8787"` with the imported `BACKEND_URL`
  constant in `refresh()` and `resolvedSettings`. Drop `backendUrl` from the
  `resolvedSettings` object entirely.
- `extension/service-worker.js`: remove `backendUrl` from the default settings object
  seeded on install.
- Leave `settings.location` and `settings.postalcode` untouched.

**Testing required:** Tier 3 (touches exported shape of `settings` object across three
files). Update `options.test.js` to remove backend-field assertions and confirm
`refreshCacheForZip` uses the constant. Update `newtab.test.js`'s `resolveLocation`/
`refresh` tests to stop passing/asserting `backendUrl` in settings fixtures. Update
`service-worker.test.js`'s default-settings assertion. Run full suite.

---

## Task 6 — Settings location controls + auto-return after save

**Issue:** Two gaps in the settings flow, both localized to `options.html`/`options.js`:
(1) there's no way to switch back to browser geolocation from Settings once a ZIP has
been saved — "Use my location" only exists on the first-run new-tab panel; (2) saving
settings shows a "Saved." message but requires a separate click on "Close" to return to
the new tab.

**Expected outcome:** Settings offers both "Use my location" and a ZIP code field, either
of which can be used to update location at any time. On successful save (either path),
the extension automatically navigates back to the new-tab page after a brief confirmation
(don't yank the user away before they see "Saved." — a ~600ms delay before navigating is
enough).

**Implementation specifics:**
- `extension/options.html`: add a "Use my location" button next to the existing ZIP
  input, mirroring the new-tab panel's button.
- `extension/options.js`: import the same geolocation logic used in `newtab.js`'s
  `locationFromBrowser()` (consider extracting it to a shared module, e.g.
  `extension/location.js`, imported by both `newtab.js` and `options.js`, since it's
  currently only defined in `newtab.js`). On "Use my location" click, resolve
  coordinates, write `{ ...settings, location: coords }` (clearing `postalcode` the same
  way the ZIP path currently clears `location`), and run the same
  `refreshCacheForZip`-style refresh (rename/generalize that function to accept either a
  `{ postalcode }` or `{ lat, lon }` location object, since it's currently ZIP-specific).
- After either save path succeeds (`saved.textContent = "Saved."`), call
  `setTimeout(() => closeSettings.click(), 600)` to reuse the existing close/navigate
  logic rather than duplicating it.

**Testing required:** Tier 3 (changes `refreshCacheForZip`'s signature/behavior). Add new
tests to `options.test.js` for the geolocation path (success and permission-denied
fallback) and for the auto-navigate-after-save behavior (assert `chrome.tabs.create`/
`chrome.tabs.remove` are called after the delay — use fake timers). Run
`options.test.js` and `newtab.test.js` (if `location.js` is extracted, both import it).

---

## Task 7 — Verify RescueGroups pagination contract (live API integration test)

**Issue:** The pagination approach in the next task (unseen-aware re-caching) assumes RescueGroups' v5 API supports JSON:API-style pagination (page[number]/page[size]), but this is unverified against the live API — the existing test suite only exercises rescuegroups.js against mocked fetchImpl responses, so a wrong parameter name would pass all unit tests while silently no-op'ing (or erroring) against the real API. This needs to be confirmed with an actual network call before pagination logic is built on top of an assumption.

**Expected outcome:** A repeatable, manually-triggered integration test exists that hits the real RescueGroups API and confirms: (1) the correct pagination parameter name and location (query string vs. request body — buildSearchRequest's body currently carries filterRadius, so paging might belong in body.data or the query string depending on their spec), (2) that requesting page 2 for the same location/radius returns a different set of animal IDs than page 1, and (3) what happens when a page beyond available results is requested (empty array vs. error vs. wrapped-around results) so findNearbyCats's radius-escalation logic in the next task can handle that case correctly. This test's findings get written up in that task's PR description; the test itself stays in the repo as a regression check.

**Implementation specifics:**

- Add test/rescuegroups.live.js (deliberately not matching the *.test.js pattern so Node's default node --test / npm test does not pick it up automatically — this must never run in normal CI or block regular development, since it requires network access and a real RG_API_KEY).
- At the top of the file, check process.env.RG_API_KEY; if unset, console.log a clear message ("Skipping live RescueGroups test — set RG_API_KEY to run") and exit 0 rather than failing, so it's safe to leave in the repo without breaking anything for contributors who don't have a key.
- Write it using Node's built-in test runner (node:test) same as the rest of the suite, so it can eventually be run via node --test test/rescuegroups.live.js.
- Test body: call searchRadius() (or a new lower-level helper if pagination isn't yet exposed there) twice against a real, stable location (e.g. a fixed ZIP with known cat volume) — once unpaginated/page 1, once explicitly requesting page 2 with a couple of candidate parameter shapes if the correct one isn't already known (try page[number]/page[size] as query params first, per JSON:API convention, since the existing buildSearchRequest already uses URLSearchParams for other fields like limit/sort). Assert the two responses return non-overlapping id sets. Also make one request for a page number far beyond available results and log/assert what comes back (don't guess the expected behavior in the assertion until you've seen the real response — first run should be exploratory, then lock in an assertion once observed).
- Add "test:live": "node --test test/rescuegroups.live.js" to package.json scripts, kept separate from "test" so it's opt-in only.
- Document in README.md's Validation section: npm run test:live requires RG_API_KEY and should be run once before merging any pagination-related change (i.e., before the next task).

**Testing required:** Tier 3, but only in the sense of "run it and read the output" — this test's entire purpose is to be run manually against the live API before the pagination task proceeds. It does not need to pass in a locked-down/assertion-heavy way on the first commit; get it landed with exploratory logging first, run it once with a real key, record the actual pagination contract, then tighten the assertions in a quick follow-up commit before starting the next task.

---

## Task 8 — Unseen-aware re-caching and pagination

> Revised 2026-08-17 after Task 7's live-API findings and a design discussion. The
> pagination contract below is confirmed (not assumed), and the original "raise the
> request size, then shuffle-and-truncate down to a smaller cached size" plan has been
> dropped in favor of caching everything a single request returns — see rationale inline.

**Issue:** Two related gaps, both in `server/rescuegroups.js` / `server/index.js`:
(1) re-cache timing is purely time-based (`FRESH_MS`/`STALE_MS` in `newtab.js`) with no
signal for "has the user actually seen most of what's cached"; (2) a repeat server call
for the same location returns the identical nearest-25 set every time, since
`buildSearchRequest` always requests the same unpaginated page sorted by distance —
`seenIds` in client storage only prevents repeats *within* one cached batch, not across
refreshes.
>
> A third original gap — "results aren't shuffled across rescues, so cached batches often
> come from a single dense-nearby organization" — no longer needs separate handling. That
> risk only existed because the original plan fetched a larger batch and then *truncated*
> it down to a small cached size, and a naive truncation of a distance-sorted list could
> cut off smaller orgs entirely. Dropping the truncation (below) removes the risk at the
> source: nothing gets cut, so no org can be disproportionately excluded. Per-card display
> order was already random regardless (`nextCard()` in `newtab.js` picks uniformly at
> random from whatever's unseen), so array order never needed active shuffling either.

**Expected outcome:**
- The client only triggers a background refresh when the cache is stale by time **and**
  at least half of the cached cards are in `seenIds` — not on time alone.
- A refresh for an unchanged location returns cats the user hasn't already seen, where
  the API has more available (via pagination), instead of re-serving the same 25.
- Each fetch pulls a much larger batch (see limit below) and caches all of it, not just a
  truncated subset — directly reducing how often a re-fetch is needed at all, which is
  the actual objective (fewer API calls, more cats available locally per call).

**Confirmed RescueGroups pagination/limit contract** (from Task 7's live test and the RG
API docs — no longer an assumption):
- `page` is a **plain scalar** query param (e.g. `page=2`), *not* JSON:API-style
  `page[number]`/`page[size]` — RescueGroups rejects bracket params with HTTP 400
  ("Arrayis an invalid page."), because their query-string parser turns bracket params
  into an array for `page` and their validation rejects an array there.
- `limit` continues to control page size, sent alongside `page`.
- A page beyond available results returns **HTTP 200 with an empty `data` array** — not
  an error, not wrapped-around results — and the response's `meta` includes `count`
  (total matching), `countReturned`, `pageReturned`, and `pages` (total page count).
  `findNearbyCats`'s escalation logic can check `meta.pages`/`meta.count` directly to
  know when it's exhausted the API instead of inferring it from an empty array alone.
- Per RG's docs: `limit`'s max is **250** for this endpoint ("A value that is non-numeric,
  negative, or higher than the max limit for the endpoint will result in a 400 error
  response"). Raise `MAX_LIMIT` from 25 to **100** — well above the old value (meaningfully
  reduces refresh frequency and page count for a given search) without pushing into the
  higher end of the range, which risks larger payloads, longer request latency against
  the existing 8s `AbortSignal.timeout`, and a bigger per-entry footprint in the server's
  in-memory cache (still bounded overall by the existing `MAX_CACHE_SIZE = 500` entries —
  a real but acceptable tradeoff, not a blocker). No separate request-size vs.
  cached/output-size split — one `MAX_LIMIT`, used for both, nothing truncated after.

**Implementation specifics:**
- **Client gate** (`extension/newtab.js`): in `_start()`, change the refresh condition
  from `age >= FRESH_MS || !feedCache?.cards?.length` to also require
  `getSeenIds(feedCache).length >= feedCache.cards.length / 2` (or no cache at all).
  Keep the hard `STALE_MS` cutoff as an unconditional refresh trigger regardless of
  seen-ratio, so a stale-for-30-min cache always refreshes even if the user barely looked
  at it.
- **Pagination** (`server/rescuegroups.js`): add a `page` parameter to
  `buildSearchRequest(location, miles, page = 1)`, sent as a plain scalar `page` query
  param (see confirmed contract above), not bracket-style. Thread `page` through
  `searchRadius` and `findNearbyCats`. The client should send its current `seenIds`
  (or simply a `page` counter stored alongside `feedCache`) to `/api/nearby-cats` in the
  POST body; `server/index.js`'s handler reads that and passes it to `findNearbyCats`.
  If a requested page returns fewer than `target` new (unseen) cards, escalate radius
  before escalating page, matching the existing radius-ladder pattern in
  `findNearbyCats`.
- **Server cache key**: the current `cacheKey()` in `index.js` is location-only, meaning
  the 3-minute server cache would return the same page regardless of the client's
  pagination request. Extend `cacheKey()` to include the page number so distinct pages
  cache independently.
- **Raise the request/cache size** (`server/rescuegroups.js`): change `MAX_LIMIT` from
  `25` to `100`. No truncation step, no interleave/shuffle step — cache whatever
  `normalizeCards` returns from the single request, in full (see rationale above).

**Testing required:** Tier 3 (core caching/API logic). Expect to touch most of
`rescuegroups.test.js` (pagination param assertions using the confirmed scalar `page`
shape, `MAX_LIMIT` value) and `server.test.js` (cache-key-with-page assertions), plus
`newtab.test.js`'s `_start` refresh-trigger tests (seen-ratio gating). Run full suite.
`test-live/rescuegroups.live.js` already exercises `buildSearchRequest` directly, so
running `npm run test:live` once after this change is a free sanity check that
`limit=100` behaves against the real API — not strictly required (the docs already
confirm 100 is well under the 250 ceiling), but cheap reassurance given it's a one-line
`npm run` away.

---

## Task 9 — "Explore a new area" random-location feature

**Issue:** No way to browse cats outside the user's set location. Net-new feature.

**Expected outcome:** A button on the new-tab page lets the user jump to a different,
pre-vetted US location and see cats there, without permanently overwriting their saved
location/ZIP.

**Implementation specifics:**
- Add a `const EXPLORE_LOCATIONS = [...]` list of ~25 `{ lat, lon, label }` entries for
  US cities known to have active RescueGroups coverage (spot-check a handful against the
  live API before finalizing the list — don't just guess coordinates).
- Add an "Explore another area" button to `extension/newtab.html`, near `#settings`.
- On click, pick a random entry from `EXPLORE_LOCATIONS`, call the existing `refresh()`
  with that location, but do **not** persist it to `settings.location` — store it in a
  transient in-memory variable (or a separate `exploreOverride` storage key) so the
  user's real saved location isn't clobbered. Show a small label (e.g. "Exploring near
  {label}") and a "Back to my area" control that re-runs `_start()` with no override.
- Since a `page`/pagination param may now exist from Task 7, make sure the explore path
  always requests `page 1` for the chosen location rather than inheriting the user's
  current page/seenIds state.

**Testing required:** Tier 3 (new state: `exploreOverride`). Add tests to `newtab.test.js`
covering: explore button triggers refresh with a location from the list, saved
`settings.location` is untouched afterward, and "back to my area" restores the original
cached feed. Run `newtab.test.js`.

---

## Task 10 — Photo placement / crop fix

**Issue:** Cards using `imageUrl` sometimes crop the cat out of frame when the source
image's aspect ratio doesn't match the card's fixed display area (`.photo` in
`newtab.css`, currently presumed `object-fit: cover` based on the cropping symptom).

**Expected outcome:** The subject of the photo is visible in the card in the large
majority of cases, with no more aggressive cropping than necessary.

**Implementation specifics:**
- In `extension/newtab.js`'s `renderCard()`, after setting `img.src = card.imageUrl`,
  add an `img.addEventListener("load", ...)` that compares `img.naturalWidth /
  img.naturalHeight` to the card's target aspect ratio; if the image is notably
  taller/narrower than the card (portrait-oriented cat photo in a landscape card), apply
  a modifier class that switches that image to `object-fit: contain` with a neutral
  letterbox background instead of `cover`. Leave near-matching aspect ratios on `cover`
  for the current tight, edge-to-edge look.
- As a quick comparative test before committing to this approach: temporarily swap
  `card.imageUrl` for `card.originalImageUrl` in a local build and eyeball a sample of
  real cards — if RescueGroups' "large" variant is itself already a tight crop (not just
  a smaller version of "original"), the fix belongs in `normalizeCards`' image selection,
  not just CSS. Note the outcome of this check in the PR description either way.

**Testing required:** Tier 2. Extend `renderCard` tests in `newtab.test.js` to cover the
`load` handler's class-switching logic (mock `naturalWidth`/`naturalHeight` on the
created `img`). No server-side changes, so `rescuegroups.test.js` untouched unless the
comparative check above concludes the fix belongs there instead.

---

## Task 11 — Onboarding copy for Chrome's new-tab override prompt + README

**Issue:** On first install, Chrome shows its built-in "Change back to Google? The page
was changed by the 'Tabby' extension" prompt. This is expected Chrome behavior for any
extension using `chrome_url_overrides.newtab` (anti-hijacking protection) — there's no
manifest flag or code path that suppresses it, so it's not a bug to fix in-code. The gap
is that nothing in the extension or its docs prepares the user for it.

**Expected outcome:** New users aren't confused by the prompt; it's called out ahead of
time in the install instructions.

**Implementation specifics:**
- `README.md`, in the "Run locally" section: add a step noting that Chrome will show a
  one-time "Did you mean to change your new tab page?" prompt after install, and the
  user should click "Keep it" to retain Tabby.
- Optional: if you plan a Chrome Web Store listing, add the same note to the store
  description copy so it's not just in the dev README.

**Testing required:** None (Tier 1 — docs only).
