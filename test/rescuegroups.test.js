import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchRequest, normalizeCards, validateLocation, searchRadius } from "../server/rescuegroups.js";

test("ZIP fallback uses RescueGroups native postalcode radius filter", () => {
  const request = buildSearchRequest({ postalcode: "33629" }, 10);
  assert.deepEqual(request.body, { data: { filterRadius: { postalcode: "33629", miles: 10 } } });
  assert.match(request.url, /available\/cats\/haspic/);
  assert.match(request.url, /sort=animals.distance/);
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

test("searchRadius throws error joining detail strings when payload has errors with detail", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      errors: [{ detail: "Invalid radius." }, { detail: "Invalid location." }]
    })
  });
  await assert.rejects(
    searchRadius({ postalcode: "33629" }, 10, { apiKey: "test", fetchImpl }),
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
    searchRadius({ postalcode: "33629" }, 10, { apiKey: "test", fetchImpl }),
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
    searchRadius({ postalcode: "33629" }, 10, { apiKey: "test", fetchImpl }),
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
    searchRadius({ postalcode: "33629" }, 10, { apiKey: "test", fetchImpl }),
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
    searchRadius({ postalcode: "33629" }, 10, { apiKey: "test", fetchImpl }),
    /RescueGroups HTTP 502: Bad Gateway/
  );
});
