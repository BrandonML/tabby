import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { findNearbyCats, validateLocation } from "./rescuegroups.js";

const port = Number(process.env.PORT || 8787);
const allowedOrigin = process.env.ALLOW_ORIGIN || "*";

if (!process.env.ALLOW_ORIGIN && process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
  console.warn("WARNING: ALLOW_ORIGIN is not set — accepting requests from any origin. Set ALLOW_ORIGIN to your extension's chrome-extension://<id> origin before deploying.");
}

export const cache = new Map();
const CACHE_MS = 3 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

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

function cacheKey(location) {
  return location.postalcode ? `zip:${location.postalcode}` : `coord:${location.lat.toFixed(2)},${location.lon.toFixed(2)}`;
}

export const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.url !== "/api/nearby-cats") return send(response, 404, { error: "Not found" });
  if (request.method !== "POST") return send(response, 405, { error: "Method Not Allowed" }, { "Allow": "POST" });
  try {
    const { location } = await bodyOf(request);
    const safeLocation = validateLocation(location);
    const key = cacheKey(safeLocation);
    const cached = cache.get(key);

    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      if (Date.now() - cached.createdAt < CACHE_MS) return send(response, 200, { ...cached.value, cached: true });
    }

    const value = await findNearbyCats(safeLocation, { apiKey: process.env.RG_API_KEY });
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

    return send(response, status, { error: status < 500 ? error.message : "Unable to refresh nearby cats right now." });
  }
});

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Tabby backend listening on http://localhost:${port}`));
}
