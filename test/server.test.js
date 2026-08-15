import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { cache, server } from "../server/index.js";
import http from "node:http";

// Need to mock fetch globally to avoid actual RescueGroups hits
describe("server cache", () => {
  let port;

  beforeEach(async () => {
    cache.clear();
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    mock.restoreAll();
  });

  it("should bound the cache size to 500 entries via LRU", async () => {
    process.env.RG_API_KEY = "test-key";

    // Mock global fetch to return a fake successful response
    mock.method(global, 'fetch', async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          data: [],
          included: []
        })
      };
    });

    const makeRequest = (zip) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: port,
          path: '/api/nearby-cats',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ location: { postalcode: zip } }));
        req.end();
      });
    };

    // Make 500 requests
    // We can do them in batches or sequentially. Promise.all is fast.
    const initialPromises = [];
    for (let i = 0; i < 500; i++) {
      initialPromises.push(makeRequest(String(10000 + i)));
    }
    await Promise.all(initialPromises);

    assert.strictEqual(cache.size, 500);

    // Refresh the 0th item (zip:10000) by requesting it again
    await makeRequest("10000");

    // Now add 5 more
    const overflowPromises = [];
    for (let i = 500; i < 505; i++) {
      overflowPromises.push(makeRequest(String(10000 + i)));
    }
    await Promise.all(overflowPromises);

    assert.strictEqual(cache.size, 500);

    // zip:10000 should still be there because it was refreshed
    assert.strictEqual(cache.has("zip:10000"), true);

    // zip:10001 through zip:10005 should be evicted
    assert.strictEqual(cache.has("zip:10001"), false);
    assert.strictEqual(cache.has("zip:10002"), false);
    assert.strictEqual(cache.has("zip:10003"), false);
    assert.strictEqual(cache.has("zip:10004"), false);
    assert.strictEqual(cache.has("zip:10005"), false);

    // zip:10006 should be there
    assert.strictEqual(cache.has("zip:10006"), true);
  });
});
