import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { findNearbyCats, validateLocation } from "./rescuegroups.js";

const port = Number(process.env.PORT || 8787);
// Comma-separated list — one origin per store build (Chrome, Edge, ...),
// since each store assigns its own extension ID.
const allowedOrigins = (process.env.ALLOW_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);

if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "development") {
  console.warn("WARNING: ALLOW_ORIGIN is not set — accepting requests from any origin. Set ALLOW_ORIGIN to your extension's chrome-extension://<id> origin(s), comma-separated if published to multiple stores, before deploying.");
}

function resolveAllowOrigin(requestOrigin) {
  if (allowedOrigins.length === 0) return "*";
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return allowedOrigins[0];
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

function send(response, status, body, requestOrigin, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": resolveAllowOrigin(requestOrigin),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

// Reads the body via events rather than `for await` so an early bail-out
// (oversized payload, timeout) never has to call request.destroy() while
// the body is still incomplete. IncomingMessage#destroy() destroys the
// underlying *socket* whenever readableEnded/complete is still false at
// that point — which is exactly the case both here and on a genuine
// timeout — so calling it there would kill the connection before the
// caller's error response ever reaches the client (confirmed empirically:
// the client saw a bare connection reset, not the intended 408/413 body).
// Listening for events and simply stopping avoids touching the socket at
// all; the caller is responsible for closing the connection afterward via
// a "Connection: close" response header instead.
function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    function cleanup() {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    }
    function onData(chunk) {
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
        cleanup();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

async function bodyOf(request) {
  // Read live rather than cached at module load (same reasoning as
  // ALERT_WEBHOOK_URL below) so tests can exercise this path with a short
  // timeout instead of waiting out the real 5s default.
  const timeoutMs = Number(process.env.REQUEST_BODY_TIMEOUT_MS) || 5000;
  const bodyPromise = readRequestBody(request, 16384);
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
    });
    const raw = await Promise.race([bodyPromise, timeoutPromise]);
    return JSON.parse(raw.toString("utf8") || "{}");
  } finally {
    clearTimeout(timer);
    // If the timeout won the race, the body-reading listeners are still
    // attached and will settle later (or never) — swallow that so it can't
    // surface as an unhandled rejection.
    bodyPromise.catch(() => {});
  }
}

function cacheKey(location, page) {
  const base = location.postalcode ? `zip:${location.postalcode}` : `coord:${location.lat.toFixed(2)},${location.lon.toFixed(2)}`;
  return `${base}:p${page}`;
}

function safePage(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") return send(response, 204, {}, origin);
  if (request.url === "/healthz") {
    if (request.method !== "GET") return send(response, 405, { error: "Method Not Allowed" }, origin, { "Allow": "GET" });
    return send(response, 200, { status: "ok" }, origin);
  }
  if (request.url !== "/api/nearby-cats") return send(response, 404, { error: "Not found" }, origin);
  if (request.method !== "POST") return send(response, 405, { error: "Method Not Allowed" }, origin, { "Allow": "POST" });
  try {
    const { location, page } = await bodyOf(request);
    const safeLocation = validateLocation(location);
    const requestedPage = safePage(page);
    const key = cacheKey(safeLocation, requestedPage);
    const cached = cache.get(key);

    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      if (Date.now() - cached.createdAt < CACHE_MS) return send(response, 200, { ...cached.value, cached: true }, origin);
    }

    const value = await findNearbyCats(safeLocation, { apiKey: process.env.RG_API_KEY, page: requestedPage });
    cache.set(key, { createdAt: Date.now(), value });

    if (cache.size > MAX_CACHE_SIZE) {
      cache.delete(cache.keys().next().value);
    }

    return send(response, 200, { ...value, cached: false }, origin);
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

    // A 408 or 413 means the body was abandoned mid-read (timed out, or cut
    // off past the size cap) — bytes the client already sent (or is still
    // sending) are never fully consumed, so the connection can't safely be
    // reused for a next request on the same socket. "Connection: close"
    // tells Node to close it once this response finishes, instead of
    // leaving it keep-alive.
    const extraHeaders = status === 408 || status === 413 ? { "Connection": "close" } : {};

    return send(response, status, { error: status < 500 ? error.message : "Unable to refresh nearby cats right now." }, origin, extraHeaders);
  }
});

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Tabby backend listening on http://localhost:${port}`));
}
