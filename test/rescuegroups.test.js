import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchRequest, normalizeCards, validateLocation } from "../server/rescuegroups.js";

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
  const cards = normalizeCards({
    data: [{ id: "1", attributes: { name: "Mochi", distance: 2.4, url: "https://rescue.test/mochi", updatedDate: "2024-05-06T00:00:00Z" }, relationships: { orgs: { data: [{ id: "o", type: "orgs" }] }, pictures: { data: [{ id: "p2", type: "pictures" }, { id: "p1", type: "pictures" }] } } }],
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
  assert.equal(cards[0].updatedAt, "2024-05-06T00:00:00Z");
});

test("normalizer excludes photo relationships without usable URLs", () => {
  assert.deepEqual(normalizeCards({ data: [{ id: "1", relationships: { pictures: { data: [{ id: "p", type: "pictures" }] } } }], included: [{ id: "p", type: "pictures", attributes: { order: 1 } }] }), []);
});
