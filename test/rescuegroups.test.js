import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchRequest, normalizeCards, validateLocation, searchRadius, findNearbyCats } from "../server/rescuegroups.js";

test("ZIP fallback uses RescueGroups native postalcode radius filter", () => {
  const request = buildSearchRequest({ postalcode: "33629" }, 25);
  assert.deepEqual(request.body, { data: { filterRadius: { postalcode: "33629", miles: 25 } } });
  assert.match(request.url, /available\/cats\/haspic/);
  assert.match(request.url, /sort=animals.distance/);
});

test("buildSearchRequest defaults to page 1 and uses the raised MAX_LIMIT of 100", () => {
  const request = buildSearchRequest({ postalcode: "33629" }, 25);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("limit"), "100");
});

test("buildSearchRequest sends page as a plain scalar query param, not JSON:API bracket-style", () => {
  const request = buildSearchRequest({ postalcode: "33629" }, 25, 3);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.has("page[number]"), false);
  assert.equal(url.searchParams.has("page[size]"), false);
});

test("buildSearchRequest falls back to page 1 for a non-positive-integer page", () => {
  const request = buildSearchRequest({ postalcode: "33629" }, 25, -5);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("page"), "1");
});

test("coordinates are accepted and invalid locations are rejected", () => {
  assert.deepEqual(validateLocation({ lat: 27.95, lon: -82.5 }), { lat: 27.95, lon: -82.5 });
  assert.throws(() => validateLocation({ postalcode: "bad" }), /five-digit/);
});

test("normalizer uses attributes.distance and selects first usable ordered image", () => {
  const recentDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
  const cards = normalizeCards({
    data: [{ id: "1", attributes: { name: "Mochi", distance: 2.4, url: "https://rescue.test/mochi", updatedDate: recentDate }, relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p2", type: "pictures" }, { id: "p1", type: "pictures" }] } } }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Local Rescue", url: "https://rescue.test" } },
      { id: "p2", type: "pictures", attributes: { order: 2, large: { url: "https://images.test/second.jpg" } } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/first.jpg" } } }
    ]
  });
  assert.equal(cards[0].distanceMiles, 2.4);
  assert.equal(cards[0].imageUrl, "https://images.test/first.jpg");
  assert.equal(cards[0].rescueName, "Local Rescue");
  assert.equal(cards[0].rescueUrl, "https://rescue.test");
  assert.equal(cards[0].updatedAt, recentDate);
});

test("normalizer excludes photo relationships without usable URLs", () => {
  assert.deepEqual(normalizeCards({ data: [{ id: "1", relationships: { pictures: { data: [{ id: "p", type: "pictures" }] } } }], included: [{ id: "p", type: "pictures", attributes: { order: 1 } }] }), []);
});

test("normalizer drops stale cards and normalizes scheme-less rescue URLs", () => {
  const staleDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 366).toISOString();
  const cards = normalizeCards({
    data: [
      { id: "stale", attributes: { name: "Oldie", updatedDate: staleDate, url: "www.example.com/oldie" }, relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } } },
      { id: "fresh", attributes: { name: "Milo", ageString: "2 years", updatedDate: new Date().toISOString(), url: "www.example.com/milo" }, relationships: { orgs: { data: [{ id: "o2", type: "orgs" }] }, pictures: { data: [{ id: "p2", type: "pictures" }] } } }
    ],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Old Rescue", url: "www.oldrescue.test" } },
      { id: "o2", type: "orgs", attributes: { name: "Fresh Rescue", url: "www.freshrescue.test" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/old.jpg" } } },
      { id: "p2", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/fresh.jpg" } } }
    ]
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "Milo");
  assert.equal(cards[0].profileUrl, "https://www.example.com/milo");
  assert.equal(cards[0].rescueUrl, "https://www.freshrescue.test");
});

test("normalizer rejects cards with updatedDate older than one year", () => {
  const oldDate = "2023-03-15T00:28:57Z";
  const cards = normalizeCards({
    data: [{
      id: "old",
      attributes: { name: "Oldie", updatedDate: oldDate, url: "www.example.com/oldie" },
      relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } }
    }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Old Rescue", url: "www.oldrescue.test" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/old.jpg" } } }
    ]
  });
  assert.deepEqual(cards, []);
});

test("normalizer rejects stale cards when the API uses updatedAt instead of updatedDate", () => {
  const oldDate = "2018-05-01T21:44:33Z";
  const cards = normalizeCards({
    data: [{
      id: "oldat",
      attributes: { name: "Oldie", updatedAt: oldDate, url: "www.example.com/oldie" },
      relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } }
    }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Old Rescue", url: "www.oldrescue.test" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/old.jpg" } } }
    ]
  });
  assert.deepEqual(cards, []);
});

test("normalizer prefers the most recent of updatedDate and updatedAt", () => {
  const recent = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
  const older = new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString();
  const cards = normalizeCards({
    data: [{
      id: "choose-newest",
      attributes: { name: "Nova", updatedDate: older, updatedAt: recent, url: "www.example.com/nova" },
      relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } }
    }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Nova Rescue", url: "www.novarescue.test" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/nova.jpg" } } }
    ]
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].updatedAt, recent);
});

test("normalizer rejects placeholder and malformed http values", () => {
  const cards = normalizeCards({
    data: [{ id: "1", attributes: { name: "Milo", updatedDate: new Date().toISOString(), url: "http://", profileUrl: "http://" }, relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } } }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Fresh Rescue", url: "http:/www.robinhoodanimalrescue.org" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/fresh.jpg" } } }
    ]
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].profileUrl, null);
  assert.equal(cards[0].rescueUrl, "http://www.robinhoodanimalrescue.org");
});

test("normalizer rejects cards with malformed or unsafe imageUrl", () => {
  const cards = normalizeCards({
    data: [{
      id: "malformed-img",
      attributes: { name: "Hacker Cat", updatedDate: new Date().toISOString() },
      relationships: {
        orgs: { data: [{ id: "o", type: "orgs" }] },
        pictures: { data: [{ id: "p1", type: "pictures" }] }
      }
    }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Rescue" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "javascript:alert(1)" } } }
    ]
  });
  assert.deepEqual(cards, []);
});

function cardWithFee(adoptionFeeString) {
  return normalizeCards({
    data: [{ id: "1", attributes: { name: "Milo", updatedDate: new Date().toISOString(), adoptionFeeString }, relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p1", type: "pictures" }] } } }],
    included: [
      { id: "o", type: "orgs", attributes: { name: "Rescue" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/milo.jpg" } } }
    ]
  })[0].adoptionFee;
}

// Sampled live against the real RescueGroups API: bare numeric values need a
// "$" prepended, already-priced/decorated and text-only values don't.
test("normalizer prepends a missing $ to bare numeric adoption fees", () => {
  assert.equal(cardWithFee("100"), "$100");
  assert.equal(cardWithFee("150.00"), "$150.00");
  assert.equal(cardWithFee("200 each"), "$200 each");
  assert.equal(cardWithFee("100 for both"), "$100 for both");
});

test("normalizer leaves already-priced adoption fees untouched", () => {
  assert.equal(cardWithFee("$150"), "$150");
  assert.equal(cardWithFee("$50-100"), "$50-100");
  assert.equal(cardWithFee("$125 each or $210 /pair"), "$125 each or $210 /pair");
});

test("normalizer leaves non-numeric adoption fee text untouched", () => {
  assert.equal(cardWithFee("Donation"), "Donation");
  assert.equal(cardWithFee("TBA"), "TBA");
  assert.equal(cardWithFee("Waived"), "Waived");
  assert.equal(cardWithFee("Sponsored"), "Sponsored");
});

test("normalizer maps a missing or blank adoption fee to null", () => {
  assert.equal(cardWithFee(undefined), null);
  assert.equal(cardWithFee(""), null);
  assert.equal(cardWithFee("   "), null);
});

test("searchRadius throws error joining detail strings when payload has errors with detail", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      errors: [{ detail: "Invalid radius." }, { detail: "Invalid location." }]
    })
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 400: Invalid radius.; Invalid location./
  );
});

test("searchRadius throws error joining title strings when payload has errors with title but no detail", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      errors: [{ title: "Unauthorized access" }, { title: "Invalid token" }]
    })
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 401: Unauthorized access; Invalid token/
  );
});

test("searchRadius throws error joining mixed detail and title strings", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      errors: [{ detail: "Forbidden." }, { title: "Account locked" }]
    })
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 403: Forbidden.; Account locked/
  );
});

test("searchRadius throws error falling back to statusText when payload has no errors array", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({ someOtherField: true })
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 500: Internal Server Error/
  );
});

test("searchRadius throws error falling back to statusText when response is not valid JSON", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    json: async () => { throw new Error("Unexpected token < in JSON"); }
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 502: Bad Gateway/
  );
});

function createMockCards(count) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      id: String(i),
      attributes: {
        name: `Cat ${i}`,
        distance: 5.0,
        url: `https://rescue.test/cat${i}`,
        updatedDate: new Date().toISOString()
      },
      relationships: {
        orgs: { data: [{ id: "o", type: "orgs" }] },
        pictures: { data: [{ id: "p1", type: "pictures" }] }
      }
    });
  }
  return {
    data,
    included: [
      { id: "o", type: "orgs", attributes: { name: "Local Rescue", url: "https://rescue.test" } },
      { id: "p1", type: "pictures", attributes: { order: 1, original: { url: "https://images.test/first.jpg" } } }
    ]
  };
}

function createFetchImpl(responsesByMiles) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const miles = body.data.filterRadius.miles;
    calls.push(miles);
    const count = responsesByMiles[miles] || 0;
    return {
      ok: true,
      json: async () => createMockCards(count)
    };
  };
  return { fetchImpl, calls };
}

// createFetchImpl's mock (via createMockCards) assigns ids 0..count-1 for a
// given step's raw response, which conveniently mirrors RescueGroups' real
// nearest-first overlap: a wider radius's raw response reuses the same
// low-numbered ids the narrower step already returned, plus new higher ones.
// So `responsesByMiles[miles]` below is each step's *raw cumulative* count
// straight from the API, and the *new unique* count (after dedup) is
// `thisStep - previousStep`.

test("findNearbyCats stops at the first radius once the default target (40) is reached", async () => {
  const { fetchImpl, calls } = createFetchImpl({ 25: 49 }); // worked example: 25mi -> 49 unique, stop immediately
  const result = await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", fetchImpl });
  assert.equal(result.exhausted, false);
  assert.equal(result.radiusMiles, 25);
  assert.equal(result.cards.length, 49);
  assert.deepEqual(calls, [25]);
});

test("findNearbyCats escalates and dedupes overlapping results by cumulative unique count", async () => {
  // Worked example: 25mi -> 31 unique (<40, continue). 75mi -> 42 new unique
  // (73 cumulative, >=40, stop). The raw 75mi response is 73 (31 repeats + 42 new).
  const { fetchImpl, calls } = createFetchImpl({ 25: 31, 75: 73 });
  const result = await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", fetchImpl });
  assert.equal(result.exhausted, false);
  assert.equal(result.radiusMiles, 75);
  assert.equal(result.cards.length, 73, "31 + 42 new unique, not 31 + 73 raw");
  assert.deepEqual(calls, [25, 75]);
  const ids = new Set(result.cards.map((c) => c.id));
  assert.equal(ids.size, 73, "no duplicate ids across steps");
});

test("findNearbyCats trims a >100 cumulative result to 100, keeping the closer steps intact", async () => {
  // Worked example: 25mi -> 8 unique (continue). 75mi -> 20 new (28 cumulative,
  // continue). 150mi -> 112 new (140 cumulative, >=40, stop). 140 > 100, so
  // trim to 100: all 28 from the closer two steps + the first 72 (of 112) from 150mi.
  const { fetchImpl, calls } = createFetchImpl({ 25: 8, 75: 28, 150: 140 });
  const result = await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", fetchImpl });
  assert.equal(result.exhausted, false);
  assert.equal(result.radiusMiles, 150);
  assert.equal(result.cards.length, 100);
  assert.deepEqual(calls, [25, 75, 150], "must not escalate to 250mi once trimmed cumulative already satisfies target");
  const ids = result.cards.map((c) => Number(c.id)).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, i) => i), "keeps ids 0-99: the full closer two steps plus the nearest 72 of the 150mi step");
});

test("findNearbyCats exhausts all radii if the target is never reached but finds some cats", async () => {
  const { fetchImpl, calls } = createFetchImpl({ 25: 2, 75: 5, 150: 9, 250: 15 });
  const result = await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", fetchImpl });
  assert.equal(result.exhausted, true);
  assert.equal(result.radiusMiles, 250);
  assert.equal(result.cards.length, 15);
  assert.deepEqual(calls, [25, 75, 150, 250]);
});

test("findNearbyCats returns empty and exhausted if no cats are found", async () => {
  const { fetchImpl, calls } = createFetchImpl({});
  const result = await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", fetchImpl });
  assert.equal(result.exhausted, true);
  assert.equal(result.radiusMiles, 250);
  assert.equal(result.cards.length, 0);
  assert.deepEqual(calls, [25, 75, 150, 250]);
});

test("searchRadius forwards the page option to the request URL", async () => {
  let fetchUrl;
  const fetchImpl = async (url) => {
    fetchUrl = url;
    return { ok: true, json: async () => createMockCards(0) };
  };
  await searchRadius({ postalcode: "33629" }, 25, { apiKey: "test", fetchImpl, page: 4 });
  assert.equal(new URL(fetchUrl).searchParams.get("page"), "4");
});

test("findNearbyCats forwards the page option to every radius step", async () => {
  const pagesRequested = [];
  const fetchImpl = async (url) => {
    pagesRequested.push(new URL(url).searchParams.get("page"));
    return { ok: true, json: async () => createMockCards(0) };
  };
  await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", target: 8, fetchImpl, page: 2 });
  assert.deepEqual(pagesRequested, ["2", "2", "2", "2"]);
});

test("findNearbyCats defaults to page 1 when no page option is given", async () => {
  const pagesRequested = [];
  const fetchImpl = async (url) => {
    pagesRequested.push(new URL(url).searchParams.get("page"));
    return { ok: true, json: async () => createMockCards(10) };
  };
  await findNearbyCats({ postalcode: "33629" }, { apiKey: "test", target: 8, fetchImpl });
  assert.deepEqual(pagesRequested, ["1"]);
});

test("searchRadius throws error if apiKey is not provided", async () => {
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 25, {}),
    /RG_API_KEY is not configured./
  );
});


test("searchRadius returns normalized cards on successful response", async () => {
  let fetchUrl;
  let fetchOptions;
  const mockPayload = createMockCards(2);

  const fetchImpl = async (url, options) => {
    fetchUrl = url;
    fetchOptions = options;
    return {
      ok: true,
      json: async () => mockPayload
    };
  };

  const location = { postalcode: "33629" };
  const apiKey = "test-api-key";
  const miles = 25;
  const cards = await searchRadius(location, miles, { apiKey, fetchImpl });

  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, "Cat 0");
  assert.equal(cards[1].name, "Cat 1");

  assert.match(fetchUrl, /^https:\/\/api\.rescuegroups\.org\/v5\/public\/animals\/search\/available\/cats\/haspic\/\?/);

  assert.equal(fetchOptions.method, "POST");
  assert.equal(fetchOptions.headers.Authorization, apiKey);
  assert.equal(fetchOptions.headers["Content-Type"], "application/vnd.api+json");
  assert.equal(fetchOptions.headers.Accept, "application/vnd.api+json");
  assert.ok(fetchOptions.signal instanceof AbortSignal);

  const body = JSON.parse(fetchOptions.body);
  assert.deepEqual(body, { data: { filterRadius: { postalcode: "33629", miles: 25 } } });
});
