// Live integration test against the real RescueGroups API. NOT run by
// `npm test` — it lives outside test/ specifically so Node's default
// test-discovery (which sweeps every .js file directly under a directory
// named "test") can't pick it up; run it explicitly via `npm run test:live`.
// Requires a real RG_API_KEY. Safe to leave in the repo without one: it
// logs a message and exits 0 rather than failing.
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSearchRequest } from "../server/rescuegroups.js";

if (!process.env.RG_API_KEY) {
  console.log("Skipping live RescueGroups test — set RG_API_KEY to run");
  process.exit(0);
}

const CONTENT_TYPE = "application/vnd.api+json";
const API_KEY = process.env.RG_API_KEY;

// A stable, high-population ZIP, searched at the widest radius step (100mi).
// Confirmed by a live run: ~2494 cats available (page 1 returned exactly
// MAX_LIMIT (25) results), so it reliably spans multiple pages.
const LOCATION = { postalcode: "10001" };
const MILES = 100;

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
});
