import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { run, ReleaseError } from "../scripts/release.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function readZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function listZipEntries(buffer) {
  return readZipEntries(buffer).map((entry) => entry.name);
}

describe("release script", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-release-test-"));
    for (const name of ["manifest.json", "package.json", "extension", "server", "test", "package-lock.json"]) {
      const src = path.join(REPO_ROOT, name);
      if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(tmpDir, name), { recursive: true });
      }
    }
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a missing version argument", () => {
    assert.throws(() => run(["node", "release.js"], tmpDir), ReleaseError);
  });

  it("rejects a malformed version argument", () => {
    assert.throws(() => run(["node", "release.js", "not-a-version", "https://example.com"], tmpDir), ReleaseError);
  });

  it("rejects a missing backendUrl argument", () => {
    assert.throws(() => run(["node", "release.js", "9.9.9"], tmpDir), ReleaseError);
  });

  it("rejects a backendUrl that isn't https", () => {
    assert.throws(() => run(["node", "release.js", "9.9.9", "http://not-secure.example.com"], tmpDir), ReleaseError);
  });

  it("bakes the given backendUrl into the zipped extension/config.js without touching the source tree", () => {
    const zipPath = run(["node", "release.js", "9.9.9", "https://tabby-api.example.com"], tmpDir);

    // The staged copy that got zipped has the real backend baked in...
    const entries = readZipEntries(fs.readFileSync(zipPath));
    const zippedConfig = entries.find((entry) => entry.name === "extension/config.js");
    assert.ok(zippedConfig, "zip should contain extension/config.js");
    assert.match(zippedConfig.data.toString("utf8"), /BACKEND_URL = "https:\/\/tabby-api\.example\.com"/);

    // ...but the source tree's own config.js — what local dev and the test
    // suite actually read — must still say localhost, untouched.
    const sourceConfig = fs.readFileSync(path.join(tmpDir, "extension", "config.js"), "utf8");
    assert.match(sourceConfig, /BACKEND_URL = "http:\/\/localhost:8787"/);
  });

  it("updates manifest.json and package.json to the given version and produces a clean zip", () => {
    const zipPath = run(["node", "release.js", "9.9.9", "https://tabby-api.example.com"], tmpDir);

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "manifest.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8"));
    assert.strictEqual(manifest.version, "9.9.9");
    assert.strictEqual(pkg.version, "9.9.9");

    assert.strictEqual(zipPath, path.join(tmpDir, "dist", "v9.9.9.zip"));
    assert.strictEqual(fs.existsSync(zipPath), true);

    const entries = listZipEntries(fs.readFileSync(zipPath));
    assert.ok(entries.includes("manifest.json"));
    assert.ok(entries.some((name) => name.startsWith("extension/")));

    for (const name of entries) {
      assert.ok(!name.startsWith("server/"), `zip should not contain server/: ${name}`);
      assert.ok(!name.startsWith("test/"), `zip should not contain test/: ${name}`);
      assert.ok(!name.startsWith(".git"), `zip should not contain .git: ${name}`);
      assert.ok(!name.includes("node_modules"), `zip should not contain node_modules: ${name}`);
      assert.notStrictEqual(name, "package-lock.json");
      assert.notStrictEqual(name, "package.json");
    }
  });
});
