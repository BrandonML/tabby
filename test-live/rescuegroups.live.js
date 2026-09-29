// Live integration test against the real RescueGroups API. NOT run by
// `npm test` — it lives outside test/ specifically so Node's default
// test-discovery (which sweeps every .js file directly under a directory
// named "test") can't pick it up; run it explicitly via `npm run test:live`.
// Requires a real RG_API_KEY. Safe to leave in the repo without one: it
// logs a message and exits 0 rather than failing.
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSearchRequest, findAvailableIds } from "../server/rescuegroups.js";

if (!process.env.RG_API_KEY) {
  console.log("Skipping live RescueGroups test — set RG_API_KEY to run");
  process.exit(0);
}

const CONTENT_TYPE = "application/vnd.api+json";
const API_KEY = process.env.RG_API_KEY;

// A stable, high-population ZIP, searched at the widest radius step. As of
// the [25, 75, 150, 250] ladder (Task 12/13), that's 250mi. Confirmed by an
// earlier live run at the previous widest step (100mi): ~2494 cats
// available, so it reliably spans multiple pages — a wider radius only adds
// more results.
const LOCATION = { postalcode: "10001" };
const MILES = 250;

// Confirmed pagination contract (live run against the location above):
// - `page` is a plain scalar query param (e.g. page=2), NOT JSON:API-style
//   page[number]/page[size]. Bracket params got HTTP 400 "Arrayis an
//   invalid page." — RescueGroups' query-string parser turns bracket
//   params into an array for `page`, and their validation rejects that.
// - `limit` (already sent by buildSearchRequest) continues to control page
//   size; it isn't part of the page param.
// - A page far beyond available results returns HTTP 200 with an empty
//   `data` array — not an error, not wrapped-around results. The response's
//   `meta` also includes `count` (total matching), `countReturned`,
//   `pageReturned`, and `pages` (total page count), which findNearbyCats's
//   radius-escalation logic can use to know when to stop paging instead of
//   guessing from an empty array alone.
async function searchPage(pageNumber) {
  const { url, body } = buildSearchRequest(LOCATION, MILES);
  const pagedUrl = new URL(url);
  if (pageNumber !== undefined) {
    pagedUrl.searchParams.set("page", String(pageNumber));
  }
  const response = await fetch(pagedUrl, {
    method: "POST",
    headers: { Authorization: API_KEY, "Content-Type": CONTENT_TYPE, Accept: CONTENT_TYPE },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}

function idsOf(payload) {
  return (payload?.data || []).map((animal) => animal.id);
}

async function searchAtRadius(miles) {
  const { url, body } = buildSearchRequest(LOCATION, miles);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: API_KEY, "Content-Type": CONTENT_TYPE, Accept: CONTENT_TYPE },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}

describe("RescueGroups live pagination contract", () => {
  it("page 1 and an explicit page 2 return non-overlapping id sets", async () => {
    const page1 = await searchPage();
    const page2 = await searchPage(2);

    console.log("[live] page 1 status:", page1.status, "ids:", idsOf(page1.payload));
    console.log("[live] page 2 status:", page2.status, "ids:", idsOf(page2.payload));

    assert.ok(page1.ok, `page 1 request failed: ${JSON.stringify(page1.payload)}`);
    assert.ok(page2.ok, `page 2 request failed: ${JSON.stringify(page2.payload)}`);

    const page1Ids = new Set(idsOf(page1.payload));
    const page2Ids = new Set(idsOf(page2.payload));
    const overlap = [...page1Ids].filter((id) => page2Ids.has(id));

    console.log("[live] overlap between page 1 and page 2:", overlap);
    assert.equal(overlap.length, 0, "page 2 repeated page 1's ids — pagination may have regressed, or this location no longer has enough cats to span two pages");
  });

  it("a page far beyond available results returns 200 with an empty array, not an error", async () => {
    const farPage = await searchPage(9999);

    console.log("[live] far-out-of-range page status:", farPage.status);
    console.log("[live] far-out-of-range page meta:", farPage.payload?.meta);

    assert.ok(farPage.ok, `expected a 200, got ${farPage.status}: ${JSON.stringify(farPage.payload)}`);
    assert.deepEqual(idsOf(farPage.payload), [], "expected an empty results array for an out-of-range page");
    assert.equal(farPage.payload?.meta?.countReturned, 0);
  });

  // Task 12/13 sanity check: RescueGroups' docs don't specify a radius
  // ceiling, so the new ladder's two largest steps (150mi, 250mi) are
  // assumed valid but unverified against the live API until now.
  it("the two largest ladder steps (150mi, 250mi) are accepted, not silently capped or rejected", async () => {
    const mid = await searchAtRadius(150);
    const wide = await searchAtRadius(250);

    console.log("[live] 150mi status:", mid.status, "count:", mid.payload?.meta?.count);
    console.log("[live] 250mi status:", wide.status, "count:", wide.payload?.meta?.count);

    assert.ok(mid.ok, `150mi request failed: ${JSON.stringify(mid.payload)}`);
    assert.ok(wide.ok, `250mi request failed: ${JSON.stringify(wide.payload)}`);
    assert.ok(
      (wide.payload?.meta?.count ?? 0) >= (mid.payload?.meta?.count ?? 0),
      "a wider radius returned fewer total matches than a narrower one — the API may be silently capping the search radius"
    );
  });
});

// Issue #79: the extension revalidates a long-idle cache by asking which of
// its cached ids are still available. This pins the two behaviors that
// approach depends on, against the real API: an `animals.id` `equal` filter
// with an array criteria works as an "in" filter on the available-cats
// endpoint, and an id that isn't a currently-available listing is silently
// left out (not an error). If either regresses, revalidation would either
// fail open forever (harmless but useless) or -- worse -- drop live cats.
describe("RescueGroups live by-id availability contract", () => {
  it("returns exactly the requested ids that are available, silently omitting unknown ones", async () => {
    const { url, body } = buildSearchRequest(LOCATION, 25);
    const seed = await fetch(url, {
      method: "POST",
      headers: { Authorization: API_KEY, "Content-Type": CONTENT_TYPE, Accept: CONTENT_TYPE },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000)
    }).then((response) => response.json());
    const realIds = idsOf(seed).slice(0, 20);
    assert.ok(realIds.length >= 5, "need a handful of real available ids to test with");
    const fakeIds = ["99999991", "99999992"];

    const availableIds = await findAvailableIds([...realIds, ...fakeIds], { apiKey: API_KEY });

    console.log("[live] asked about", realIds.length + fakeIds.length, "ids, got back", availableIds.length);
    assert.deepEqual([...availableIds].sort(), [...realIds].sort(), "every real id should come back, and neither fake one");
  });
});
