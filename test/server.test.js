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
          hostname: '127.0.0.1',
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

    // Make requests in bounded-concurrency batches rather than all 500 (plus
    // the later 5) at once — firing hundreds of simultaneous loopback
    // connections reliably triggers OS-level connection refusals on this
    // Windows environment. A batch is small enough to stay well under
    // whatever that ceiling is, while still large enough that entries
    // within a batch land in the cache in close-to-issue-order (the exact
    // ordering the assertions below depend on).
    const BATCH_SIZE = 25;
    async function makeRequestsInBatches(zips) {
      for (let i = 0; i < zips.length; i += BATCH_SIZE) {
        await Promise.all(zips.slice(i, i + BATCH_SIZE).map(makeRequest));
      }
    }

    // Make 500 requests
    await makeRequestsInBatches(Array.from({ length: 500 }, (_, i) => String(10000 + i)));

    assert.strictEqual(cache.size, 500);

    // Refresh the 0th item (zip:10000) by requesting it again
    await makeRequest("10000");

    // Now add 5 more
    await makeRequestsInBatches(Array.from({ length: 5 }, (_, i) => String(10500 + i)));

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

describe("server routing and behavior", () => {
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

  const request = (options, body = null) => {
    return new Promise((resolve, reject) => {
      const req = http.request({ ...options, hostname: '127.0.0.1', port }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ res, data }));
      });
      req.on('error', reject);
      if (body !== null) {
        req.write(body);
      }
      req.end();
    });
  };

  it("POST /api/nearby-cats with valid body returns 200 with expected shape and CORS headers", async () => {
    process.env.RG_API_KEY = "test-key";
    mock.method(global, 'fetch', async () => ({
      ok: true,
      json: async () => ({ data: [], included: [] })
    }));

    const { res, data } = await request(
      { path: '/api/nearby-cats', method: 'POST' },
      JSON.stringify({ location: { postalcode: "12345" } })
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["access-control-allow-origin"], "*");
    assert.strictEqual(res.headers["access-control-allow-methods"], "POST, OPTIONS");
    assert.strictEqual(res.headers["access-control-allow-headers"], "Content-Type");

    const body = JSON.parse(data);
    assert.strictEqual(body.cached, false);
    assert.deepStrictEqual(body.cards, []);
  });

  it("A second identical request within CACHE_MS returns the cached result (cached: true)", async () => {
    process.env.RG_API_KEY = "test-key";
    let fetchCalls = 0;
    mock.method(global, 'fetch', async () => {
      fetchCalls++;
      return {
        ok: true,
        json: async () => ({ data: [], included: [] })
      };
    });

    const bodyStr = JSON.stringify({ location: { postalcode: "12345" } });

    // First request
    const req1 = await request({ path: '/api/nearby-cats', method: 'POST' }, bodyStr);
    assert.strictEqual(req1.res.statusCode, 200);
    const body1 = JSON.parse(req1.data);
    assert.strictEqual(body1.cached, false);
    assert.strictEqual(fetchCalls, 4); // RADIUS_STEPS triggers 4 fetches if no results

    // Second request
    const req2 = await request({ path: '/api/nearby-cats', method: 'POST' }, bodyStr);
    assert.strictEqual(req2.res.statusCode, 200);
    const body2 = JSON.parse(req2.data);
    assert.strictEqual(body2.cached, true);
    assert.strictEqual(fetchCalls, 4); // Still 4 fetches
  });

  it("OPTIONS returns 204 with the correct CORS headers", async () => {
    const { res, data } = await request({ path: '/api/nearby-cats', method: 'OPTIONS' });
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers["access-control-allow-origin"], "*");
    assert.strictEqual(res.headers["access-control-allow-methods"], "POST, OPTIONS");
    assert.strictEqual(res.headers["access-control-allow-headers"], "Content-Type");
    assert.strictEqual(data, ""); // 204 should have no body
  });

  it("GET /api/nearby-cats returns 405 with an Allow header", async () => {
    const { res, data } = await request({ path: '/api/nearby-cats', method: 'GET' });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.headers["allow"], "POST");
    const body = JSON.parse(data);
    assert.strictEqual(body.error, "Method Not Allowed");
  });

  it("An unknown path returns 404", async () => {
    const { res, data } = await request({ path: '/api/unknown', method: 'POST' });
    assert.strictEqual(res.statusCode, 404);
    const body = JSON.parse(data);
    assert.strictEqual(body.error, "Not found");
  });

  it("An oversized body is rejected (413) without hanging", async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const bigBody = "x".repeat(16385);
    const { res, data } = await request(
      { path: '/api/nearby-cats', method: 'POST' },
      bigBody
    );
    assert.strictEqual(res.statusCode, 413);
    const body = JSON.parse(data);
    assert.strictEqual(body.error, "Payload too large");
    assert.strictEqual(errorSpy.mock.callCount(), 1);
  });

  it("Malformed JSON body returns 400, not 502", async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const { res, data } = await request(
      { path: '/api/nearby-cats', method: 'POST' },
      "{ location: "
    );
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(data);
    assert.match(body.error, /Expected property name or '}'/);
    assert.strictEqual(errorSpy.mock.callCount(), 1);
  });

  it("A location that fails validateLocation() returns 400 with the validation message", async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const { res, data } = await request(
      { path: '/api/nearby-cats', method: 'POST' },
      JSON.stringify({ location: { postalcode: "123" } }) // Invalid length
    );
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(data);
    assert.strictEqual(body.error, "Provide a five-digit postal code or valid latitude and longitude.");
    assert.strictEqual(errorSpy.mock.callCount(), 1);
  });

  it("Mock findNearbyCats failing returns 502 with the generic error message", async () => {
    process.env.RG_API_KEY = "test-key";
    mock.method(global, 'fetch', async () => {
      throw new Error("Raw upstream crash");
    });
    const errorSpy = mock.method(console, 'error', () => {});

    const { res, data } = await request(
      { path: '/api/nearby-cats', method: 'POST' },
      JSON.stringify({ location: { postalcode: "12345" } })
    );

    assert.strictEqual(res.statusCode, 502);
    const body = JSON.parse(data);
    assert.strictEqual(body.error, "Unable to refresh nearby cats right now.");
    assert.strictEqual(errorSpy.mock.callCount(), 1);
    const [label, logPayload] = errorSpy.mock.calls[0].arguments;
    assert.strictEqual(label, "[tabby-server]");
    assert.strictEqual(logPayload.status, 502);
    assert.strictEqual(logPayload.message, "Raw upstream crash");
  });
});
