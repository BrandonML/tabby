import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZipBuffer } from "./zip.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export class ReleaseError extends Error {}

function detectIndent(raw) {
  const match = raw.match(/\n([ \t]+)\S/);
  return match ? match[1] : "  ";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonVersion(filePath, version) {
  const raw = fs.readFileSync(filePath, "utf8");
  const indent = detectIndent(raw);
  const trailingNewline = raw.endsWith("\n");
  const data = JSON.parse(raw);
  data.version = version;
  const serialized = JSON.stringify(data, null, indent) + (trailingNewline ? "\n" : "");
  fs.writeFileSync(filePath, serialized);
}

// extension/config.js stays pointed at localhost in the repo itself, so local
// dev and the test suite (which asserts fetch calls hit localhost:8787) never
// need touching — only the staged copy that actually gets zipped is rewritten
// to the real backend, right before packaging.
function writeBackendUrl(filePath, backendUrl) {
  const raw = fs.readFileSync(filePath, "utf8");
  const updated = raw.replace(/export const BACKEND_URL = ".*?";/, `export const BACKEND_URL = "${backendUrl}";`);
  if (updated === raw) {
    throw new ReleaseError(`Could not find a BACKEND_URL constant to update in ${filePath}`);
  }
  fs.writeFileSync(filePath, updated);
}

function collectFiles(dir, baseDir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, baseDir, out);
    } else if (entry.isFile()) {
      out.push({
        name: path.relative(baseDir, fullPath).split(path.sep).join("/"),
        data: fs.readFileSync(fullPath),
      });
    }
  }
  return out;
}

export function run(argv, rootDir = ROOT) {
  const version = argv[2];
  const backendUrl = argv[3];
  const usage = "Usage: npm run release <version> <backendUrl> (e.g. npm run release 0.2.0 https://tabby-api.example.com)";
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ReleaseError(`${usage}. Got version: ${version ?? "(none)"}`);
  }
  if (!backendUrl || !/^https:\/\/.+/.test(backendUrl)) {
    throw new ReleaseError(`${usage}. Got backendUrl: ${backendUrl ?? "(none)"} (must start with https://)`);
  }

  const manifestPath = path.join(rootDir, "manifest.json");
  const packagePath = path.join(rootDir, "package.json");
  const extensionDir = path.join(rootDir, "extension");
  const distDir = path.join(rootDir, "dist");

  writeJsonVersion(manifestPath, version);
  writeJsonVersion(packagePath, version);

  const manifestVersion = readJson(manifestPath).version;
  const packageVersion = readJson(packagePath).version;
  if (manifestVersion !== version || packageVersion !== version) {
    throw new ReleaseError(
      `Version mismatch after write: manifest.json=${manifestVersion}, package.json=${packageVersion}, expected=${version}`
    );
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-release-"));
  try {
    fs.copyFileSync(manifestPath, path.join(stagingDir, "manifest.json"));
    fs.cpSync(extensionDir, path.join(stagingDir, "extension"), { recursive: true });
    writeBackendUrl(path.join(stagingDir, "extension", "config.js"), backendUrl);

    const entries = collectFiles(stagingDir, stagingDir);
    const zipBuffer = createZipBuffer(entries);

    fs.mkdirSync(distDir, { recursive: true });
    const zipPath = path.join(distDir, `v${version}.zip`);
    fs.writeFileSync(zipPath, zipBuffer);

    return zipPath;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const zipPath = run(process.argv);
    console.log(`[release] Wrote ${zipPath}`);
  } catch (error) {
    console.error(`[release] ${error.message}`);
    process.exit(1);
  }
}
