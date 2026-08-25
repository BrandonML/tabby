import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";

// Spawned as a separate process per case because ALLOW_ORIGIN is parsed once
// at module load (same reasoning as test/server-warning.test.js).
const serverModuleUrl = new URL("../server/index.js", import.meta.url).href;

function runWithOrigin({ allowOrigin, requestOrigin }) {
  const env = { ...process.env, NODE_ENV: "development" };
  if (allowOrigin === undefined) delete env.ALLOW_ORIGIN;
  else env.ALLOW_ORIGIN = allowOrigin;

  const script = `
    const { server } = await import(${JSON.stringify(serverModuleUrl)});
    const http = await import("node:http");
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const headers = ${JSON.stringify(requestOrigin)} ? { Origin: ${JSON.stringify(requestOrigin)} } : {};
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: "/healthz", method: "GET", headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.headers));
      });
      req.on("error", reject);
      req.end();
    });
    console.log(JSON.stringify(result));
    server.close();
  `;

  const result = spawnSync("node", ["--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 2000 });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}

describe("server CORS multi-origin resolution", () => {
  it("reflects the request Origin when it's in the allowlist", () => {
    const headers = runWithOrigin({
      allowOrigin: "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig,chrome-extension://fieeoalehgckgnkohkdblljmgaemaiho",
      requestOrigin: "chrome-extension://fieeoalehgckgnkohkdblljmgaemaiho"
    });
    assert.strictEqual(headers["access-control-allow-origin"], "chrome-extension://fieeoalehgckgnkohkdblljmgaemaiho");
    assert.strictEqual(headers["vary"], "Origin");
  });

  it("falls back to the first allowed origin when the request Origin isn't in the allowlist", () => {
    const headers = runWithOrigin({
      allowOrigin: "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig,chrome-extension://fieeoalehgckgnkohkdblljmgaemaiho",
      requestOrigin: "chrome-extension://someunknownid"
    });
    assert.strictEqual(headers["access-control-allow-origin"], "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig");
  });

  it("is permissive when ALLOW_ORIGIN is unset", () => {
    const headers = runWithOrigin({ allowOrigin: undefined, requestOrigin: "chrome-extension://anything" });
    assert.strictEqual(headers["access-control-allow-origin"], "*");
  });

  it("supports a single origin (backward compatible with the pre-multi-origin format)", () => {
    const headers = runWithOrigin({
      allowOrigin: "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig",
      requestOrigin: "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig"
    });
    assert.strictEqual(headers["access-control-allow-origin"], "chrome-extension://elfpnkoboidkgahmoggodpnmekfodcig");
  });
});
