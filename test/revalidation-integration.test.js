// Issue #79, client <-> server contract. test/newtab.test.js and
// test/server.test.js each test their own half against a mock of the other,
// which can't catch the two halves drifting apart (a renamed route, a changed
// response field, a different id format). This runs the real newtab.js in
// jsdom against the real server/index.js over a real localhost socket, with
// only RescueGroups itself faked -- so it covers the whole path: page ->
// /api/validate-cats -> RescueGroups by-id query -> pruned cache -> rendered
// card. test-live/stale-cache.live.js is the same flow against the real API.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { cache, server, resetAlertStateForTests, resetRateLimitsForTests } from "../server/index.js";
import { openNewtab } from "../test-support/newtab-harness.js";

const DAY = 24 * 60 * 60 * 1000;
const RG_ORIGIN = "https://api.rescuegroups.org/";
const nativeFetch = globalThis.fetch; // captured before any test mocks it

// A stand-in for RescueGroups: `available` is the set of ids it currently
// lists, and every request it receives is logged so tests can assert on what
// the server actually sent upstream.
function makeFakeRescueGroups() {
  const rg = { available: [], requests: [], byIdFailureStatus: null };

  const animal = (id, distance) => ({
    id,
    type: "animals",
    attributes: { name: `Cat ${id}`, distance, ageString: "Adult", sex: "Female", breedString: "Domestic Short Hair", updatedDate: new Date().toISOString() },
    relationships: { pictures: { data: [{ type: "pictures", id: `pic-${id}` }] }, orgs: { data: [{ type: "orgs", id: "org-1" }] } }
  });
  const included = (animals) => [
    { type: "orgs", id: "org-1", attributes: { name: "Test Rescue", url: "https://rescue.example.org" } },
    ...animals.map(({ id }) => ({ type: "pictures", id: `pic-${id}`, attributes: { large: { url: `https://cdn.rescuegroups.org/pic/${id}.jpg` }, original: { url: `https://cdn.rescuegroups.org/pic/${id}-orig.jpg` }, order: 1 } }))
  ];
  const respond = (payload) => ({ ok: true, status: 200, statusText: "OK", json: async () => payload });

  rg.handle = async (url, options) => {
    const body = JSON.parse(options.body);
    const idFilter = body.data.filters?.find((filter) => filter.fieldName === "animals.id");
    if (idFilter) {
      rg.requests.push({ kind: "byId", ids: idFilter.criteria, operation: idFilter.operation });
      if (rg.byIdFailureStatus) return { ok: false, status: rg.byIdFailureStatus, statusText: "Upstream failure", json: async () => ({ errors: [{ detail: "upstream is down" }] }) };
      const wanted = new Set(idFilter.criteria);
      return respond({ data: rg.available.filter((id) => wanted.has(id)).map((id) => animal(id, 1)) });
    }
    const page = Number(new URL(url).searchParams.get("page"));
    rg.requests.push({ kind: "radius", page, miles: body.data.filterRadius.miles });
    const animals = page === 1 ? rg.available.map((id, i) => animal(id, i + 1)) : [];
    return respond({ data: animals, included: included(animals) });
  };
  rg.requestsOfKind = (kind) => rg.requests.filter((request) => request.kind === kind);
  return rg;
}

describe("stale cache revalidation, real extension code against the real server (issue #79)", () => {
  let backendUrl;
  let store;
  let rg;

  beforeEach(async () => {
    process.env.RG_API_KEY = "test-key";
    cache.clear();
    resetRateLimitsForTests();
    resetAlertStateForTests();
    delete process.env.ALERT_WEBHOOK_URL;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    backendUrl = `http://127.0.0.1:${server.address().port}`;
    store = { settings: { postalcode: "10001", location: null } };
    rg = makeFakeRescueGroups();
    mock.method(globalThis, "fetch", (url, options) => (String(url).startsWith(RG_ORIGIN) ? rg.handle(url, options) : nativeFetch(url, options)));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    mock.restoreAll();
  });

  const idRange = (from, count) => Array.from({ length: count }, (_, i) => String(from + i));
  const openTab = async () => {
    const tab = openNewtab({ backendUrl, store });
    await tab.start();
    return tab;
  };
  // Simulates `days` passing between tab loads: the stored cache ages, and
  // the server's short-lived response cache (3 minutes) has long expired.
  const timePasses = (days) => {
    const at = Date.now() - days * DAY;
    store.feedCache = { ...store.feedCache, fetchedAt: at, validatedAt: at };
    cache.clear();
  };
  const seedPool = async (ids) => {
    rg.available = ids;
    await openTab();
    assert.deepStrictEqual(store.feedCache.cards.map((card) => card.id), ids, "the first load builds the pool through the real refresh path");
    rg.requests.length = 0;
  };

  it("drops adopted cats, keeps every cat still listed, and never advances the page", async () => {
    const ids = idRange(1001, 12);
    await seedPool(ids);
    const adopted = [ids[1], ids[4], ids[9]];
    store.feedCache.seenIds = [ids[0], ids[1], ids[2]]; // ids[1] is seen *and* about to be adopted
    timePasses(8);
    const staleFetchedAt = store.feedCache.fetchedAt;
    rg.available = ids.filter((id) => !adopted.includes(id));

    const tab = await openTab();

    const byId = rg.requestsOfKind("byId");
    assert.strictEqual(byId.length, 1, "one RescueGroups by-id request for the whole pool");
    assert.deepStrictEqual(byId[0].ids, ids, "every cached id was asked about");
    assert.strictEqual(byId[0].operation, "equal");
    assert.strictEqual(rg.requestsOfKind("radius").length, 0, "no search, so no radius escalation and no new page");
    assert.strictEqual(tab.requestsTo("/api/validate-cats").length, 1);
    assert.strictEqual(tab.requestsTo("/api/nearby-cats").length, 0);

    assert.deepStrictEqual(store.feedCache.cards.map((card) => card.id), rg.available, "survivors kept, in their original order");
    assert.strictEqual(store.feedCache.page, 1);
    assert.strictEqual(store.feedCache.fetchedAt, staleFetchedAt);
    assert.ok(Date.now() - store.feedCache.validatedAt < 60_000, "validatedAt was stamped");
    assert.ok(!store.feedCache.seenIds.includes(ids[1]), "the adopted-but-seen id is gone from seenIds too");
    assert.ok(store.feedCache.seenIds.includes(ids[0]) && store.feedCache.seenIds.includes(ids[2]));
    assert.ok(rg.available.some((id) => tab.shownName() === `Cat ${id}`), `shown card ${tab.shownName()} should be a survivor`);
  });

  it("does nothing at all for a cache that was checked recently", async () => {
    await seedPool(idRange(1001, 12));
    timePasses(6);

    const tab = await openTab();

    assert.strictEqual(rg.requests.length, 0);
    assert.strictEqual(tab.requests.length, 0);
    assert.ok(tab.shownName());
  });

  it("serves the cache and backs off when RescueGroups is failing, instead of surfacing an error", async () => {
    const ids = idRange(1001, 12);
    await seedPool(ids);
    timePasses(8);
    rg.byIdFailureStatus = 500;
    const errorSpy = mock.method(console, "error", () => {}); // both the server and the page log the failure

    const tab = await openTab();

    assert.strictEqual(tab.requestsTo("/api/validate-cats").length, 1);
    assert.strictEqual(rg.requestsOfKind("byId").length, 1);
    assert.ok(errorSpy.mock.callCount() > 0, "the failure is logged");
    assert.deepStrictEqual(store.feedCache.cards.map((card) => card.id), ids, "nothing was dropped on a failed check");
    assert.ok(tab.shownName(), "the user still gets a cat");
    assert.strictEqual(tab.noticeText(), "", "a background check failing is not the user's problem");
    assert.ok(store.feedCache.validationRetryAfter > Date.now());

    const nextTab = await openTab();
    assert.strictEqual(nextTab.requestsTo("/api/validate-cats").length, 0, "backs off for the cooldown instead of retrying on every tab");
    assert.strictEqual(rg.requestsOfKind("byId").length, 1);
  });

  it("restarts from page 1, not page + 1, when every cached cat has been adopted", async () => {
    await seedPool(idRange(1001, 12));
    store.feedCache.page = 3; // a user well into the radius ladder
    timePasses(8);
    rg.available = idRange(2001, 5); // none of the old cats are listed; a new batch is

    const tab = await openTab();

    assert.strictEqual(rg.requestsOfKind("byId").length, 1);
    const searches = rg.requestsOfKind("radius");
    assert.ok(searches.length > 0);
    assert.ok(searches.every((search) => search.page === 1), `a dead pool restarts pagination, saw pages ${searches.map((s) => s.page)}`);
    assert.deepStrictEqual(store.feedCache.cards.map((card) => card.id), idRange(2001, 5), "nothing from the dead pool was kept");
    assert.strictEqual(store.feedCache.page, 1);
    assert.ok(/^Cat 200\d$/.test(tab.shownName()), `only a fresh cat is shown, got ${tab.shownName()}`);
  });

  it("asks about a pool larger than 100 cats in two requests through the real server", async () => {
    const ids = idRange(1001, 150);
    store.feedCache = { cards: ids.map((id) => ({ id, name: `Cat ${id}`, imageUrl: `https://cdn.rescuegroups.org/pic/${id}.jpg` })), fetchedAt: Date.now() - 8 * DAY, location: { postalcode: "10001" }, page: 1, radiusMiles: 25, seenIds: [] };
    rg.available = ids.filter((id) => Number(id) % 2 === 0);

    await openTab();

    assert.deepStrictEqual(rg.requestsOfKind("byId").map((request) => request.ids.length), [100, 50]);
    assert.deepStrictEqual(store.feedCache.cards.map((card) => card.id), rg.available);
  });
});
