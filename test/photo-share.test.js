import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { server, buildPhotoShareUrl } from "../server/index.js";

describe("buildPhotoShareUrl", () => {
  it("forces a share-sized width on a valid RescueGroups CDN URL", () => {
    const result = buildPhotoShareUrl("https://cdn.rescuegroups.org/1409/pictures/animals/22664/22664830/103576412.jpg");
    assert.strictEqual(result, "https://cdn.rescuegroups.org/1409/pictures/animals/22664/22664830/103576412.jpg?width=640");
  });

  it("discards a caller-supplied width/query instead of trusting it", () => {
    const result = buildPhotoShareUrl("https://cdn.rescuegroups.org/pic.jpg?width=5000&foo=bar");
    assert.strictEqual(result, "https://cdn.rescuegroups.org/pic.jpg?width=640");
  });

  it("rejects a URL on a different host (would otherwise be an open proxy)", () => {
    assert.strictEqual(buildPhotoShareUrl("https://evil.example.com/pic.jpg"), null);
  });

  it("rejects a non-https URL", () => {
    assert.strictEqual(buildPhotoShareUrl("http://cdn.rescuegroups.org/pic.jpg"), null);
  });

  it("rejects a malformed URL", () => {
    assert.strictEqual(buildPhotoShareUrl("not a url"), null);
    assert.strictEqual(buildPhotoShareUrl(""), null);
    assert.strictEqual(buildPhotoShareUrl(undefined), null);
  });
});

describe("GET /api/photo-share", () => {
  let port;

  beforeEach(async () => {
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    mock.restoreAll();
  });

  const get = (path) => {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  };

  it("streams back the upstream image with CORS headers on a valid request", async () => {
    const fakeImage = Buffer.from("fake-jpeg-bytes-but-bigger-for-sharing");
    let requestedUrl;
    mock.method(global, "fetch", async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: async () => fakeImage.buffer.slice(fakeImage.byteOffset, fakeImage.byteOffset + fakeImage.byteLength)
      };
    });

    const url = encodeURIComponent("https://cdn.rescuegroups.org/pic.jpg");
    const { res, body } = await get(`/api/photo-share?url=${url}`);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["content-type"], "image/jpeg");
    assert.strictEqual(res.headers["access-control-allow-origin"], "*");
    assert.deepStrictEqual(body, fakeImage);
    assert.strictEqual(requestedUrl, "https://cdn.rescuegroups.org/pic.jpg?width=640", "must request the share width, not the analysis thumbnail width");
  });

  it("returns 400 for a disallowed host without ever calling fetch", async () => {
    const fetchSpy = mock.method(global, "fetch", async () => { throw new Error("should not be called"); });

    const url = encodeURIComponent("https://evil.example.com/pic.jpg");
    const { res, body } = await get(`/api/photo-share?url=${url}`);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchSpy.mock.callCount(), 0);
    assert.strictEqual(JSON.parse(body.toString()).error, "Invalid photo URL.");
  });

  it("returns 502 when the upstream image exceeds the share size cap", async () => {
    const bigImage = Buffer.alloc(800 * 1024, 1);
    mock.method(global, "fetch", async () => ({
      ok: true,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => bigImage.buffer.slice(bigImage.byteOffset, bigImage.byteOffset + bigImage.byteLength)
    }));

    const url = encodeURIComponent("https://cdn.rescuegroups.org/pic.jpg");
    const { res } = await get(`/api/photo-share?url=${url}`);

    assert.strictEqual(res.statusCode, 502);
  });

  it("405s a non-GET request", async () => {
    const { res } = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: "/api/photo-share?url=x", method: "POST" }, (resp) => {
        resp.resume();
        resp.on("end", () => resolve({ res: resp }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.headers.allow, "GET");
  });
});
