import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverModulePath = fileURLToPath(new URL("../server/index.js", import.meta.url));
const warningMessage = "WARNING: ALLOW_ORIGIN is not set — accepting requests from any origin. Set ALLOW_ORIGIN to your extension's chrome-extension://<id> origin before deploying.";

function checkWarning(envOverrides) {
  const env = { ...process.env, ...envOverrides };

  // We explicitly delete ALLOW_ORIGIN or NODE_ENV if they are set to undefined
  // to ensure they are actually unset in the child process
  if (envOverrides.ALLOW_ORIGIN === undefined) delete env.ALLOW_ORIGIN;
  if (envOverrides.NODE_ENV === undefined) delete env.NODE_ENV;

  const result = spawnSync("node", ["-e", `import(${JSON.stringify(serverModulePath)})`], {
    env,
    encoding: "utf8",
    timeout: 1000
  });
  return result.stderr;
}

describe("Server ALLOW_ORIGIN warning", () => {
  it("NODE_ENV unset, ALLOW_ORIGIN unset -> warning fires", () => {
    const stderr = checkWarning({ NODE_ENV: undefined, ALLOW_ORIGIN: undefined });
    assert.ok(stderr.includes(warningMessage), "Expected warning to fire when NODE_ENV and ALLOW_ORIGIN are unset");
  });

  it("NODE_ENV='production', ALLOW_ORIGIN unset -> warning fires", () => {
    const stderr = checkWarning({ NODE_ENV: "production", ALLOW_ORIGIN: undefined });
    assert.ok(stderr.includes(warningMessage), "Expected warning to fire when NODE_ENV is production and ALLOW_ORIGIN is unset");
  });

  it("NODE_ENV='development', ALLOW_ORIGIN unset -> no warning", () => {
    const stderr = checkWarning({ NODE_ENV: "development", ALLOW_ORIGIN: undefined });
    assert.ok(!stderr.includes(warningMessage), "Expected no warning when NODE_ENV is development and ALLOW_ORIGIN is unset");
  });

  it("ALLOW_ORIGIN set (any NODE_ENV) -> no warning", () => {
    let stderr = checkWarning({ NODE_ENV: undefined, ALLOW_ORIGIN: "chrome-extension://123" });
    assert.ok(!stderr.includes(warningMessage), "Expected no warning when ALLOW_ORIGIN is set (NODE_ENV unset)");

    stderr = checkWarning({ NODE_ENV: "production", ALLOW_ORIGIN: "chrome-extension://123" });
    assert.ok(!stderr.includes(warningMessage), "Expected no warning when ALLOW_ORIGIN is set (NODE_ENV production)");

    stderr = checkWarning({ NODE_ENV: "development", ALLOW_ORIGIN: "chrome-extension://123" });
    assert.ok(!stderr.includes(warningMessage), "Expected no warning when ALLOW_ORIGIN is set (NODE_ENV development)");
  });
});
