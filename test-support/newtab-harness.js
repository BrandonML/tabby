// Shared harness for the two end-to-end suites -- test/revalidation-integration.test.js
// (CI: real server + real newtab.js, RescueGroups mocked) and
// test-live/stale-cache.live.js (manual: same, against the real RescueGroups
// API). Lives outside test/ on purpose: Node's test discovery runs every .js
// file under a directory named "test", and this is a helper, not a test.
//
// It loads the real extension/newtab.html + newtab.js into jsdom -- not a
// re-implementation -- pointed at a backend of the caller's choosing, with
// chrome.storage backed by a plain object the caller owns. Reusing the same
// `store` across openNewtab() calls models closing a tab and opening another
// one, which is exactly what the cache-age logic cares about.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Captured at import time, before any suite mocks globalThis.fetch to fake
// RescueGroups -- requests from the page must still reach the real server.
const nativeFetch = globalThis.fetch;

function readExtensionFile(name) {
  return fs.readFileSync(path.join(ROOT, "extension", name), "utf8");
}

// Same inlining trick as test/newtab.test.js: newtab.js is an ES module, but
// the harness runs it as a classic script, so its imports are replaced with
// the imported files' own source.
function buildScript(backendUrl) {
  const errorMessages = readExtensionFile("error-messages.js").replace(/export function/g, "function");
  const config = readExtensionFile("config.js").replace("export const", "const").replace("http://localhost:8787", backendUrl);
  const location = readExtensionFile("location.js").replace("export async function", "async function");
  const script = readExtensionFile("newtab.js")
    .replace(/import \{ classifyRefreshError, isInvalidZipError \} from "\.\/error-messages\.js";/, () => errorMessages)
    .replace(/import \{ BACKEND_URL \} from "\.\/config\.js";/, () => config)
    .replace(/import \{ locationFromBrowser \} from "\.\/location\.js";/, () => location);
  // The file ends by starting itself. The harness starts it explicitly so a
  // caller can await it, and must not run it twice -- so the auto-start goes,
  // and if it can't be found, fail loudly rather than silently double-start.
  const autoStart = /\r?\nstart\(\);\r?\nupdateSavedHeaderIndicator\(\);\s*$/;
  if (!autoStart.test(script)) throw new Error("newtab-harness: could not find newtab.js's trailing start() call -- update the harness.");
  return script.replace(autoStart, "\n");
}

/**
 * Opens a new-tab page. `store` is the chrome.storage.local contents (mutated
 * in place by the page); `requests` records every fetch the page makes.
 * `await tab.start()` runs one full load of the page.
 */
export function openNewtab({ backendUrl, store }) {
  const dom = new JSDOM(readExtensionFile("newtab.html"), { runScripts: "dangerously" });
  const { window } = dom;
  const requests = [];

  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])])),
        set: async (value) => { Object.assign(store, structuredClone(value)); }
      }
    },
    runtime: { openOptionsPage() {}, getURL: (file) => file },
    tabs: { query: (_query, callback) => callback([{ id: 1 }]), update() {} }
  };
  // Node's fetch rejects jsdom's AbortSignal, so requests go out without one.
  window.fetch = async (url, options = {}) => {
    requests.push({ url, path: new URL(url).pathname, body: options.body ? JSON.parse(options.body) : null });
    return nativeFetch(url, { ...options, signal: undefined });
  };

  const scriptEl = window.document.createElement("script");
  scriptEl.textContent = buildScript(backendUrl);
  window.document.body.appendChild(scriptEl);

  const document = window.document;
  return {
    window,
    requests,
    start: () => window.start(),
    requestsTo: (pathname) => requests.filter((request) => request.path === pathname),
    shownName: () => document.querySelector("#card h1")?.textContent ?? null,
    isCardHidden: () => document.getElementById("card").hidden,
    noticeText: () => document.getElementById("notice").textContent
  };
}
