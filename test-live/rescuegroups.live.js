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

// A stable, high-population ZIP, searched at the widest radius step (100mi),
// chosen to make it likely there are enough cats to span multiple pages.
// Confirmed by a live run: page 1 returned exactly MAX_LIMIT (25) results,
// meaning there's more available to page into.
const LOCATION = { postalcode: "10001" };
const MILES = 100;

// A first live run with page[number]/page[size] (JSON:API-style bracket
// params) got HTTP 400 "Arrayis an invalid page." from RescueGroups —
// their query-string parser turns page[number]=..&page[size]=.. into an
// array for `page`, and their validation rejects an array there. That
// points at `page` being a plain scalar instead, with `limit` (already
// sent by buildSearchRequest) continuing to control page size.
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
    assert.ok(page2.ok, `page 2 request failed (this is the key signal for whether a plain scalar "page" param is the right shape): ${JSON.stringify(page2.payload)}`);

    const page1Ids = new Set(idsOf(page1.payload));
    const page2Ids = new Set(idsOf(page2.payload));
    const overlap = [...page1Ids].filter((id) => page2Ids.has(id));

    console.log("[live] overlap between page 1 and page 2:", overlap);
    assert.equal(overlap.length, 0, "page 2 repeated page 1's ids — a scalar \"page\" param may not be the right shape, or this location doesn't have enough cats to span two pages");
  });

  it("logs what happens when requesting a page far beyond available results", async () => {
    const farPage = await searchPage(9999);

    console.log("[live] far-out-of-range page status:", farPage.status);
    console.log("[live] far-out-of-range page ids:", idsOf(farPage.payload));
    console.log("[live] far-out-of-range page body:", JSON.stringify(farPage.payload));

    // Exploratory: no assertion yet. Once a real run shows the actual
    // behavior (empty array vs. error vs. wrapped-around results), lock
    // this in with a real assertion in a follow-up commit.
  });
});
