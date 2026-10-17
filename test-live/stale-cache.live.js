// Live end-to-end check for issue #79 (stale-cache revalidation): the real
// newtab.js in jsdom -> the real server/index.js (started in-process on a free
// port, so nothing needs to be running) -> the REAL RescueGroups API. It's the
// same flow as test/revalidation-integration.test.js, which runs in CI with
// RescueGroups faked; this is the one that proves the by-id availability query
// still behaves against the real service. NOT run by `npm test`/CI -- it needs
// a real RG_API_KEY and makes a handful of real API requests (about 6). Run it
// with `npm run test:live` before every release (see RELEASE.md) and after
// any change to the query contract. Safe to leave in the repo without a key:
// it logs a message and exits 0 rather than failing.
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { cache, server } from "../server/index.js";
import { openNewtab } from "../test-support/newtab-harness.js";

if (!process.env.RG_API_KEY) {
  console.log("Skipping live stale-cache test — set RG_API_KEY to run");
  process.exit(0);
}

const DAY = 24 * 60 * 60 * 1000;
const ZIP = "10001";
// 12 digits is the longest id the server accepts, and far past any real
// RescueGroups animal id (currently 8 digits), so these can never be listed.
const deadCard = (template, n) => ({ ...template, id: String(999999999990 + n), name: `DEAD-${n}` });

describe("stale-cache revalidation against the real RescueGroups API", () => {
  let backendUrl;
  let realCards; // a real page of cats, fetched once through the app itself

  const openTab = async (store) => {
    const tab = openNewtab({ backendUrl, store });
    await tab.start();
    return tab;
  };
  const cacheOf = (cards, { ageDays, page = 1, seenIds = [] }) => ({
    settings: { postalcode: ZIP, location: null },
    feedCache: { cards, fetchedAt: Date.now() - ageDays * DAY, location: { postalcode: ZIP }, page, radiusMiles: 25, seenIds }
  });

  before(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    backendUrl = `http://127.0.0.1:${server.address().port}`;
    const store = { settings: { postalcode: ZIP, location: null } };
    await openTab(store); // empty cache: exercises the real refresh path end to end
    realCards = store.feedCache.cards;
    console.log("[live] seeded", realCards.length, "real cats for", ZIP);
    assert.ok(realCards.length > 20, "need a real pool of cats to test with");
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("drops dead ids from an 8-day-old pool, keeps every real cat, and never advances the page", async () => {
    const dead = [0, 1, 2, 3, 4].map((n) => deadCard(realCards[0], n));
    const pool = [...realCards.slice(0, 40), ...dead, ...realCards.slice(40)];
    const store = cacheOf(pool, { ageDays: 8, seenIds: [realCards[0].id, dead[0].id] });
    const staleFetchedAt = store.feedCache.fetchedAt;

    const tab = await openTab(store);

    const validateRequests = tab.requestsTo("/api/validate-cats");
    const ids = store.feedCache.cards.map((card) => card.id);
    console.log("[live] validate requests:", validateRequests.length, "| pool", pool.length, "->", ids.length);
    assert.strictEqual(validateRequests.length, Math.ceil(pool.length / 100), "one request per up-to-100 ids");
    assert.strictEqual(tab.requestsTo("/api/nearby-cats").length, 0, "validation alone is enough: no search, no new page");
    assert.deepStrictEqual(ids.filter((id) => dead.some((card) => card.id === id)), [], "every dead card was dropped");
    const kept = realCards.filter((card) => ids.includes(card.id)).length;
    assert.ok(kept >= realCards.length - 2, `real cats should survive (kept ${kept} of ${realCards.length}; a couple may be adopted mid-test)`);
    assert.strictEqual(store.feedCache.page, 1);
    assert.strictEqual(store.feedCache.fetchedAt, staleFetchedAt);
    assert.ok(Date.now() - store.feedCache.validatedAt < 60_000, "validatedAt was stamped");
    assert.ok(!store.feedCache.seenIds.includes(dead[0].id), "a dead card's seen id was dropped too");
    assert.ok(!tab.shownName().startsWith("DEAD-"), "a dead card was never shown");
  });

  it("restarts from page 1 with a fresh pool when every cached card is dead", async () => {
    cache.clear(); // the server's 3-minute response cache: a real week would have expired it
    const store = cacheOf([0, 1, 2].map((n) => deadCard(realCards[0], n)), { ageDays: 35, page: 4 });

    const tab = await openTab(store);

    const searches = tab.requestsTo("/api/nearby-cats");
    console.log("[live] nearby requests:", searches.length, "| pages:", searches.map((s) => s.body.page), "| new pool:", store.feedCache.cards.length);
    assert.deepStrictEqual(searches.map((s) => s.body.page), [1], "a dead pool restarts pagination instead of walking further out");
    assert.ok(store.feedCache.cards.length > 20);
    assert.ok(store.feedCache.cards.every((card) => !card.id.startsWith("99999999999")));
    assert.strictEqual(store.feedCache.page, 1);
    assert.ok(!tab.shownName().startsWith("DEAD-"));
  });

  it("makes no requests at all for a pool that was checked 2 days ago", async () => {
    const store = cacheOf(realCards, { ageDays: 2 });

    const tab = await openTab(store);

    assert.strictEqual(tab.requests.length, 0);
    assert.ok(tab.shownName());
  });
});
