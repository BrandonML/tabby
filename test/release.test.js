import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, ReleaseError } from "../scripts/release.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function listZipEntries(buffer) {
  const names = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(buffer.toString("utf8", nameStart, nameStart + nameLength));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
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
    assert.throws(() => run(["node", "release.js", "not-a-version"], tmpDir), ReleaseError);
  });

  it("updates manifest.json and package.json to the given version and produces a clean zip", () => {
    const zipPath = run(["node", "release.js", "9.9.9"], tmpDir);

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
