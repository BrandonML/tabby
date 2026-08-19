# Chrome Web Store Listing — Tabby

> Last Updated: 2026-08-19

## Store Listing

**Extension Name** [REQUIRED]
Tabby - Nearby Adoptable Cats New Tab
<!-- Matches manifest.json "name" (37 chars). "Tabby" kept per instruction; added "New Tab" — a
     major search term for this category — and kept "Adoptable" prominent. A live Chrome Web
     Store name search turned up existing "Tabby Cat" and "Tabby Cats Extension" listings, both
     virtual/decorative cat companions, not real adoption listings — "Adoptable" is what
     differentiates Tabby from those. -->


**Short Description** [REQUIRED]
Shows one real, nearby adoptable cat from RescueGroups.org on every new tab. Search by location or ZIP code.
<!-- 108 chars. Matches manifest.json "description" (this field doubles as both). -->


**Detailed Description** [REQUIRED]
<!-- 2,169 / 16,000 chars. Plain text, no markdown — CWS strips it. -->
```
Tabby replaces your new tab page with one real, adoptable cat at a time — sourced live from RescueGroups.org, the same database thousands of shelters and rescues use every day.

FEATURES
• Real, current listings — every cat is an actual adoptable animal from a nearby rescue or shelter, not a stock photo or wallpaper.
• Search by ZIP code or your current location — Tabby automatically widens its search radius, up to 250 miles, until it finds enough cats, so even less-populated areas get real results.
• One cat, front and center — name, breed, age, sex, adoption fee, and how recently the listing was updated, plus a direct link to the cat's full profile and the rescue organization.
• Adoption-pending and special-needs cats are clearly flagged, so you know a cat's status before reaching out.
• "Explore another area" lets you browse adoptable cats in other major U.S. cities, even if you're not planning to adopt locally.
• Fast and quiet — Tabby shows your last cat instantly from a local cache and refreshes in the background, so opening a new tab never feels slow.

HOW TO USE
1. Install Tabby and open a new tab.
2. Allow location access, or enter your ZIP code instead.
3. See a nearby adoptable cat every time you open a new tab. Click "View profile" for more, or the rescue's name to visit their site.
4. Click "Explore another area" to browse cats in other cities, or open Settings anytime to change your location.

PRIVACY
Tabby does not use ads, analytics, or trackers of any kind. Your location or ZIP code is used only to search for nearby cats and is stored on your device — Tabby never sells your data or shares it with third parties beyond what's needed to run that search (see the Privacy Policy link on this listing for full details).

PERMISSIONS
"Storage" saves your ZIP code or location and your most recent cat listings locally on your device, so Tabby loads instantly on your next new tab.
"Geolocation" is used only when you click "Use my location," to find cats near you — Tabby works just as well with a ZIP code if you'd rather not share it.

SUPPORT
Found a bug or have a suggestion? Open an issue at github.com/BrandonML/tabby/issues.
```


**Category** [REQUIRED] — ⚠️ NEEDS YOUR INPUT
<!-- Chrome Web Store's public category taxonomy (now grouped under "Productivity," "Lifestyle,"
     and "Make Chrome Yours") is not fully published outside the signed-in Developer Dashboard,
     and I couldn't reliably enumerate the current option names without your dashboard access —
     I'd rather flag that than guess at exact labels. Open the Store Listing tab in the
     dashboard and pick the closest fit; based on what Tabby does (new-tab replacement themed
     around pet adoption, not a work-productivity tool), the "Lifestyle" group is the better fit
     over "Productivity" — pick whichever specific category under it best matches (something
     animal/pets-adjacent if offered, otherwise a general "Lifestyle" or "Fun" option). -->


**Single Purpose** [REQUIRED]
Tabby replaces the new tab page with a single real, adoptable cat sourced live from RescueGroups.org, based on the user's location or ZIP code, with an optional feature to browse adoptable cats in other U.S. cities. The extension's only function is surfacing real shelter/rescue cat listings on the new tab page — it does not manage tabs, bookmarks, or any unrelated browser feature.
<!-- 391 / 1000 chars -->


**Primary Language** [REQUIRED]
English


## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready (existing) | `extension/icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store-assets/screenshot-1-main-card.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/screenshot-2-explore.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/screenshot-3-first-run.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-assets/screenshot-4-settings.png` |
| Screenshot 5 | 1280×800 | ✅ Ready | `store-assets/screenshot-5-fee-tags.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `store-assets/small-promo-tile.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-assets/marquee-promo-tile.png` |

<!-- Status options: ⬜ Not created | 🟡 Needs update | ✅ Ready -->

### Screenshot Notes
1. **Main card** — the primary new-tab experience: a cat card front and center (name, meta, fee, distance, "Updated" freshness, rescue link, View profile button).
2. **Explore another area** — the explore banner active, showing the "browse other cities" feature and its "Show another cat" / "Back to my area" links.
3. **First run** — the "Find cats near you" panel (Use my location / enter ZIP), so users see how onboarding works before installing.
4. **Settings** — the redesigned settings page (stacked "Use my location" / ZIP layout from the recent redesign).
5. **Status chips & fee** — a card showing the "Adoption pending" / "Special needs" chips and a normalized adoption fee, to demonstrate the extension surfaces real, practical adoption details.

All screenshots were captured from the actual `extension/newtab.html` and `extension/options.html` running unmodified, with realistic sample data standing in for a live RescueGroups response (an automated capture can't depend on a real user's location or the live API's current inventory) — layout, CSS, and copy are all pixel-real, not a mockup.


## Permissions Justification

<!-- Every permission in manifest.json needs a justification. The review team reads these.
     "Required for functionality" will be rejected. -->

| Permission | Type | Justification |
|------------|------|----------------|
| `storage` | permissions | The storage permission lets Tabby save the user's chosen location (ZIP code or geolocation coordinates) and the most recently fetched batch of adoptable-cat listings locally on the device, via `chrome.storage.local` (never `chrome.storage.sync`). This is what lets the new tab page render instantly from a local cache instead of re-fetching from the network on every tab open, and lets Tabby remember which cats the user has already seen so repeat refreshes surface new cats first. No data stored via this permission is synced to Google's servers or shared with any third party. |
| `geolocation` | permissions | The geolocation permission is used only when the user explicitly clicks "Use my location," either on first run or in Settings. It triggers Chrome's native location permission prompt; if the user allows it, Tabby reads the device's coordinates once to search RescueGroups.org for adoptable cats near that location, sending only those coordinates (never any other browser or device data) to Tabby's own backend to perform the search. Users can decline and enter a five-digit ZIP code instead — geolocation is never required for the extension to work. |

<!-- ⚠️ The task brief for this document asked for "activeTab" and "scripting" justifications,
     but manifest.json's permissions array is exactly ["storage", "geolocation"] — Tabby
     requests neither activeTab nor scripting, and there's no content-script injection or
     tabs/scripting API usage anywhere in the codebase. Those two fields simply won't appear in
     the real CWS dashboard for this extension (it only shows a justification box per permission
     actually declared) — they're not filled in above because there's nothing to justify.
     Conversely, "geolocation" — the extension's single most sensitive permission — wasn't in
     the brief's checklist at all, so I added it above since the dashboard will ask for it. -->

**Remote code** — No.
Tabby does not execute any remotely hosted code. All JavaScript running in the extension is bundled in the package itself. The extension does make network requests — to its own backend server, and from that server (code the extension itself never executes) to the RescueGroups.org API — but these only ever return JSON data (cat listings), never scripts, and nothing fetched is evaluated or executed as code anywhere in the extension.


## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | — | — | — |
| Health info | No | — | — | — |
| Financial info | No | — | — | — |
| Authentication info | No | — | — | — |
| Personal communications | No | — | — | — |
| Location | Yes | Yes | To search RescueGroups.org for adoptable cats near the user (ZIP code or GPS coordinates) | Yes — RescueGroups.org receives the search location as part of the query, solely to return matching listings; not shared with any advertiser, analytics provider, or data broker |
| Web history | No | — | — | — |
| User activity | No | — | — | — |
| Website content | No | — | — | — |

**On the "Location" checkbox specifically:** check it Yes. Tabby reads device location (or accepts a ZIP code as an alternative) and transmits it to its own backend server to run the RescueGroups.org search. Even though the immediate recipient is Tabby's own first-party server rather than a third-party ad/analytics network, CWS's own definition of this category explicitly includes GPS coordinates and "information about things near the user's device" — that's exactly what's being sent, so it needs to be disclosed regardless of who the first recipient is.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes


## Privacy Policy

**Privacy Policy URL** [REQUIRED] — ⚠️ NEEDS YOUR INPUT
Drafted at `PRIVACY.md` in the repo root. Once merged to `main`, it's immediately usable at:
`https://github.com/BrandonML/tabby/blob/main/PRIVACY.md`
That's a stable, publicly-accessible URL and is fine to submit as-is. If you'd rather have a cleaner-looking page, enabling GitHub Pages for this repo and publishing the same content there is a quick upgrade — let me know if you want that set up instead.


## Distribution

**Visibility**: Public *(assumed — confirm if you want Unlisted/Private instead)*
**Regions**: All regions *(assumed — the backend and RescueGroups.org data are US-focused, so this is worth a second look; narrowing to United States is also reasonable)*

## Developer Info

**Publisher Name** [REQUIRED] — ⚠️ NEEDS YOUR INPUT
<!-- The footer in newtab.html credits "Brandon" (linke.ro/brandon) and links a GitHub account
     "BrandonML" — I didn't want to assume which name (or a different public/business name
     entirely) you want to appear publicly on the store listing, so left this open. -->

**Contact Email** [REQUIRED] — ⚠️ NEEDS YOUR INPUT
<!-- Displayed publicly on the store listing — I'm not filling this in with an inferred address
     without you confirming you want it public. -->

**Support URL / Email** [RECOMMENDED]
https://github.com/BrandonML/tabby/issues
<!-- Already linked as "Report an issue" in the extension's own footer, so this is consistent
     with what users already see in the product. -->

**Homepage URL** [RECOMMENDED]
https://github.com/BrandonML/tabby


## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-08-19 | Initial Chrome Web Store submission: location/ZIP search with radius escalation, explore-another-area, adoption fee display, redesigned card layout | Draft |


## Review Notes

### Known Issues / Limitations
- **`extension/config.js`'s `BACKEND_URL` is still `http://localhost:8787`.** Per the README, this must be updated to the deployed server's real HTTPS endpoint before packaging the release build — as it stands, a real user's install would try to talk to `localhost` and every search would fail. This has to happen before `npm run release` is run for the actual submission, not just before writing this document. Deploying the server and getting its permanent URL also has to happen *before* `ALLOW_ORIGIN` on that server can be locked down to the real `chrome-extension://<ID>` origin (which Chrome only assigns once the item exists in the dashboard) — see the README's "Production deployment" section for the full sequencing.
- Screenshots/promo images use realistic sample data (see Screenshot Notes above) rather than a live capture against a real user's location, since this was generated in an automated environment without a live browsing session or real GPS location.
- Category, Publisher Name, Contact Email, and the exact Privacy Policy hosting choice are flagged above as open items — everything else in this document should be ready to copy into the dashboard as-is.

### Rejection History
None yet — first submission.
