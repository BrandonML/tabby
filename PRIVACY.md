# Privacy Policy for Tabby

_Last updated: 2026-09-22_

Tabby ("the extension") replaces your new tab page with one real, adoptable cat sourced from [RescueGroups.org](https://rescuegroups.org). It's the same extension package on both the Chrome Web Store and Edge Add-ons, and this policy applies to both. This policy explains what data Tabby collects, how it's used, and how it's stored.

## What Data We Collect

**Your location, or a ZIP code you enter.** If you click "Use my location," your browser's native permission prompt asks your consent before Tabby reads your device's GPS coordinates. If you'd rather not share your location, you can enter a five-digit ZIP code instead — Tabby works identically either way, and location access is never required.

Tabby does not collect your name, email address, browsing history, or any other personal information. It does not use cookies or any advertising or tracking technology.

**Basic usage analytics, where the store provides them.** On the Chrome Web Store, Tabby uses the Google Analytics 4 (GA4) analytics offered directly through the Chrome Web Store developer dashboard — a Chrome Web Store platform feature, not code added to Tabby itself. It tracks basic, aggregate usage metrics (such as install and active-user counts), and this data is not sold, used for advertising or retargeting, or used for any purpose beyond GA4 reporting on the extension's usage. No analytics code ships in the extension package itself on either store — Edge Add-ons doesn't offer an equivalent built-in analytics feature, so no usage analytics exist for the Edge install at all.

## How Data Is Used

Your location or ZIP code is sent to Tabby's own backend server, which uses it to search RescueGroups.org for adoptable cats near that location. Nothing else is sent — no browsing history, no device identifiers, no data from other tabs or sites.

## How Data Is Stored

Your location/ZIP code and the most recently fetched batch of cat listings are stored locally on your device, using the browser's local extension storage (`chrome.storage.local` — the same API on both Chrome and Edge, since Edge is Chromium-based). This data is **not** synced to Google's, Microsoft's, or any other cloud service, and never leaves your device except for the single search request described above.

On the server side, Tabby's backend keeps a short-lived (a few minutes) cache of search results, keyed only by a rounded location and page number — never by anything that identifies you personally, such as an IP address, account, or device ID. This cache exists purely to avoid making duplicate requests to RescueGroups.org and is not linked to you as an individual.

## Third-Party Services

Tabby's backend queries the [RescueGroups.org](https://rescuegroups.org) public API to find adoptable cats. Your search location (ZIP code or coordinates) is sent to RescueGroups.org as part of that search — this is the only third party that ever receives your location, and only for the purpose of returning matching adoptable-cat listings. See [RescueGroups.org's own privacy policy](https://rescuegroups.org/privacy-policy/) for how they handle that request.

Tabby also uses Chrome Web Store's built-in GA4 analytics, as described above — this collects only basic, aggregate usage metrics, not your location or any other data described in this policy. Tabby does not use any advertising or crash-reporting service. No data is sold, rented, or shared with any party other than RescueGroups.org and Google/Chrome Web Store as described in this policy.

## Data Retention and Deletion

Your saved location and cached cat listings stay on your device until you change your location/ZIP code in Settings, or until you uninstall the extension — uninstalling Tabby removes all locally stored data automatically, as with any browser extension.

## Changes to This Policy

If Tabby's data practices change, this policy will be updated and the "Last updated" date above will reflect the change. Continued use of the extension after an update constitutes acceptance of the revised policy.

## Contact

Questions about this policy or how Tabby handles data can be raised by opening an issue at [github.com/BrandonML/tabby/issues](https://github.com/BrandonML/tabby/issues).
