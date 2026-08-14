import { createServer } from "node:http";
import { findNearbyCats, validateLocation } from "./rescuegroups.js";

const port = Number(process.env.PORT || 8787);
const allowedOrigin = process.env.ALLOW_ORIGIN || "*";
const cache = new Map();
const CACHE_MS = 3 * 60 * 1000;

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function cacheKey(location) {
  return location.postalcode ? `zip:${location.postalcode}` : `coord:${location.lat.toFixed(2)},${location.lon.toFixed(2)}`;
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method !== "POST" || request.url !== "/api/nearby-cats") return send(response, 404, { error: "Not found" });
  try {
    const { location } = await bodyOf(request);
    const safeLocation = validateLocation(location);
    const key = cacheKey(safeLocation);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.createdAt < CACHE_MS) return send(response, 200, { ...cached.value, cached: true });
    const value = await findNearbyCats(safeLocation, { apiKey: process.env.RG_API_KEY });
    cache.set(key, { createdAt: Date.now(), value });
    return send(response, 200, { ...value, cached: false });
  } catch (error) {
    const status = /Provide a five-digit|location is required/.test(error.message) ? 400 : 502;
    return send(response, status, { error: status === 400 ? error.message : "Unable to refresh nearby cats right now." });
  }
}).listen(port, () => console.log(`Tabby backend listening on http://localhost:${port}`));
