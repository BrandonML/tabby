import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { server, buildPhotoThumbUrl } from "../server/index.js";

describe("buildPhotoThumbUrl", () => {
  it("forces a small width on a valid RescueGroups CDN URL", () => {
    const result = buildPhotoThumbUrl("https://cdn.rescuegroups.org/1409/pictures/animals/22664/22664830/103576412.jpg");
    assert.strictEqual(result, "https://cdn.rescuegroups.org/1409/pictures/animals/22664/22664830/103576412.jpg?width=100");
  });

  it("discards a caller-supplied width/query instead of trusting it", () => {
    const result = buildPhotoThumbUrl("https://cdn.rescuegroups.org/pic.jpg?width=5000&foo=bar");
    assert.strictEqual(result, "https://cdn.rescuegroups.org/pic.jpg?width=100");
  });

  it("rejects a URL on a different host (would otherwise be an open proxy)", () => {
    assert.strictEqual(buildPhotoThumbUrl("https://evil.example.com/pic.jpg"), null);
  });

  it("rejects a non-https URL", () => {
    assert.strictEqual(buildPhotoThumbUrl("http://cdn.rescuegroups.org/pic.jpg"), null);
  });

  it("rejects a malformed URL", () => {
    assert.strictEqual(buildPhotoThumbUrl("not a url"), null);
    assert.strictEqual(buildPhotoThumbUrl(""), null);
    assert.strictEqual(buildPhotoThumbUrl(undefined), null);
  });

  it("rejects a lookalike host that merely contains the allowed hostname", () => {
    assert.strictEqual(buildPhotoThumbUrl("https://cdn.rescuegroups.org.evil.com/pic.jpg"), null);
    assert.strictEqual(buildPhotoThumbUrl("https://notcdn.rescuegroups.org.example.com/pic.jpg"), null);
  });
});

describe("GET /api/photo-thumb", () => {
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
    const fakeImage = Buffer.from("fake-jpeg-bytes");
    mock.method(global, "fetch", async () => ({
      ok: true,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => fakeImage.buffer.slice(fakeImage.byteOffset, fakeImage.byteOffset + fakeImage.byteLength)
    }));

    const url = encodeURIComponent("https://cdn.rescuegroups.org/pic.jpg");
    const { res, body } = await get(`/api/photo-thumb?url=${url}`);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["content-type"], "image/jpeg");
    assert.strictEqual(res.headers["access-control-allow-origin"], "*");
    assert.deepStrictEqual(body, fakeImage);
  });

  it("returns 400 for a disallowed host without ever calling fetch", async () => {
    const fetchSpy = mock.method(global, "fetch", async () => { throw new Error("should not be called"); });

    const url = encodeURIComponent("https://evil.example.com/pic.jpg");
    const { res, body } = await get(`/api/photo-thumb?url=${url}`);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchSpy.mock.callCount(), 0);
    assert.strictEqual(JSON.parse(body.toString()).error, "Invalid photo URL.");
  });

  it("returns 502 when the upstream fetch fails", async () => {
    mock.method(global, "fetch", async () => ({ ok: false }));
    const errorSpy = mock.method(console, "error", () => {});

    const url = encodeURIComponent("https://cdn.rescuegroups.org/pic.jpg");
    const { res } = await get(`/api/photo-thumb?url=${url}`);

    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(errorSpy.mock.callCount(), 0, "an unsuccessful upstream response is handled, not thrown");
  });

  it("returns 502 when the upstream content isn't an image", async () => {
    mock.method(global, "fetch", async () => ({
      ok: true,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new ArrayBuffer(0)
    }));

    const url = encodeURIComponent("https://cdn.rescuegroups.org/pic.jpg");
    const { res } = await get(`/api/photo-thumb?url=${url}`);

    assert.strictEqual(res.statusCode, 502);
  });

  it("405s a non-GET request", async () => {
    const { res } = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: "/api/photo-thumb?url=x", method: "POST" }, (resp) => {
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
