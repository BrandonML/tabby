import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { findNearbyCats, validateLocation } from "./rescuegroups.js";

const port = Number(process.env.PORT || 8787);
const allowedOrigin = process.env.ALLOW_ORIGIN || "*";

if (!process.env.ALLOW_ORIGIN && process.env.NODE_ENV !== "development") {
  console.warn("WARNING: ALLOW_ORIGIN is not set — accepting requests from any origin. Set ALLOW_ORIGIN to your extension's chrome-extension://<id> origin before deploying.");
}

export const cache = new Map();
const CACHE_MS = 3 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

// Upstream-failure alerting: a 502 here always means something unexpected
// happened trying to serve a real request (RescueGroups itself failing, a
// network-level error reaching it, or a genuine bug) — never routine bad
// user input, which is already mapped to its own 4xx status above. Northflank's
// own infrastructure alerts don't cover this: the process stays up and
// /healthz stays green throughout, since neither depends on RescueGroups
// being reachable (deliberately — coupling liveness to a third-party API
// would turn their outage into our own restart-loop). A burst of these
// getting silently swallowed is exactly what went undetected for hours
// during a real RescueGroups connectivity incident, hence this.
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const ALERT_THRESHOLD = 5;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let failureTimestamps = [];
let lastAlertAt = 0;

// Test-only: reset the module-level alerting state between test runs.
export function resetAlertStateForTests() {
  failureTimestamps = [];
  lastAlertAt = 0;
}

function recordUpstreamFailureAndMaybeAlert(errorMessage) {
  // Read live (like RG_API_KEY below), not cached at module load — so it
  // can be absent in dev/test and configured only in the deployed environment.
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  const now = Date.now();
  failureTimestamps.push(now);
  failureTimestamps = failureTimestamps.filter((t) => now - t <= ALERT_WINDOW_MS);
  if (failureTimestamps.length < ALERT_THRESHOLD || now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;
  const count = failureTimestamps.length;
  // Fire-and-forget: never let a slow/unreachable webhook delay or fail the
  // actual user-facing error response.
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: `Tabby backend: ${count} upstream failures in the last ${ALERT_WINDOW_MS / 60000} minutes. Latest error: ${errorMessage}` }),
    signal: AbortSignal.timeout(5000)
  }).catch((alertError) => {
    console.error("[tabby-server] failed to send failure alert", { message: alertError.message });
  });
}

function send(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  request.setTimeout(5000, () => request.destroy(new Error("Request timeout")));
  const chunks = [];
  let totalLength = 0;
  try {
    for await (const chunk of request) {
      totalLength += chunk.length;
      if (totalLength > 16384) throw new Error("Payload too large");
      chunks.push(chunk);
    }
  } finally {
    if (request.socket) {
      request.setTimeout(0);
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function cacheKey(location, page) {
  const base = location.postalcode ? `zip:${location.postalcode}` : `coord:${location.lat.toFixed(2)},${location.lon.toFixed(2)}`;
  return `${base}:p${page}`;
}

function safePage(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.url === "/healthz") {
    if (request.method !== "GET") return send(response, 405, { error: "Method Not Allowed" }, { "Allow": "GET" });
    return send(response, 200, { status: "ok" });
  }
  if (request.url !== "/api/nearby-cats") return send(response, 404, { error: "Not found" });
  if (request.method !== "POST") return send(response, 405, { error: "Method Not Allowed" }, { "Allow": "POST" });
  try {
    const { location, page } = await bodyOf(request);
    const safeLocation = validateLocation(location);
    const requestedPage = safePage(page);
    const key = cacheKey(safeLocation, requestedPage);
    const cached = cache.get(key);

    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      if (Date.now() - cached.createdAt < CACHE_MS) return send(response, 200, { ...cached.value, cached: true });
    }

    const value = await findNearbyCats(safeLocation, { apiKey: process.env.RG_API_KEY, page: requestedPage });
    cache.set(key, { createdAt: Date.now(), value });

    if (cache.size > MAX_CACHE_SIZE) {
      cache.delete(cache.keys().next().value);
    }

    return send(response, 200, { ...value, cached: false });
  } catch (error) {
    let status = 502;
    if (error.message === "Payload too large") status = 413;
    else if (error.message === "Request timeout") status = 408;
    else if (error instanceof SyntaxError || /Provide a five-digit|location is required/.test(error.message)) status = 400;
    else if (/not a recognized postalcode/i.test(error.message)) status = 400;

    console.error("[tabby-server]", {
      status,
      message: error.message,
      url: request.url,
      ...(process.env.NODE_ENV !== "production" ? { stack: error.stack } : {})
    });

    if (status === 502) recordUpstreamFailureAndMaybeAlert(error.message);

    return send(response, status, { error: status < 500 ? error.message : "Unable to refresh nearby cats right now." });
  }
});

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Tabby backend listening on http://localhost:${port}`));
}
