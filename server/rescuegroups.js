const BASE_URL = "https://api.rescuegroups.org/v5";
const CONTENT_TYPE = "application/vnd.api+json";
const RADIUS_STEPS = [10, 25, 50, 100];
const MAX_LIMIT = 25;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function normalizeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  if (/^https?:\/\/?$/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    const fixed = trimmed.replace(/^https?:\/+(?!\/)/i, (match) => match.includes("//") ? match : `${match}/`);
    return fixed.startsWith("http:/") && !fixed.startsWith("http://") ? fixed.replace(/^http:\//i, "http://") : fixed;
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^http:\//i.test(trimmed)) return trimmed.replace(/^http:\//i, "http://");
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  if (trimmed.includes(".") && !/^[a-z]+:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function timestampValue(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function newestTimestamp(candidateA, candidateB) {
  const times = [timestampValue(candidateA), timestampValue(candidateB)].filter((value) => value !== null);
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function isRecentEnough(value) {
  if (!value) return true;
  const time = timestampValue(value);
  if (time === null) return true;
  return Date.now() - time <= ONE_YEAR_MS;
}

const ANIMAL_FIELDS = [
  "name", "ageString", "sex", "distance", "url", "pictureCount",
  "pictureThumbnailUrl", "breedString", "descriptionText", "isSpecialNeeds",
  "isAdoptionPending", "updatedDate", "updatedAt", "adoptionFeeString"
].join(",");

export function validateLocation(input) {
  if (!input || typeof input !== "object") throw new Error("A location is required.");
  if (/^\d{5}$/.test(String(input.postalcode || ""))) return { postalcode: String(input.postalcode) };
  const { lat, lon } = input;
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    return { lat, lon };
  }
  throw new Error("Provide a five-digit postal code or valid latitude and longitude.");
}

export function buildSearchRequest(location, miles) {
  const safeLocation = validateLocation(location);
  if (!RADIUS_STEPS.includes(miles)) throw new Error("Unsupported search radius.");
  const query = new URLSearchParams({
    limit: String(MAX_LIMIT),
    sort: "animals.distance",
    include: "orgs,pictures,statuses",
    "fields[animals]": ANIMAL_FIELDS,
    "fields[orgs]": "name,url",
    "fields[pictures]": "large,original,order",
    "fields[statuses]": "name,description"
  });
  return {
    url: `${BASE_URL}/public/animals/search/available/cats/haspic/?${query}`,
    body: { data: { filterRadius: { ...safeLocation, miles } } }
  };
}

function includedIndex(included = []) {
  return new Map(included.map((resource) => [`${resource.type}:${resource.id}`, resource]));
}

function relationshipResources(relationship, type, index) {
  const ids = relationship?.data || [];
  return ids.map((item) => index.get(`${type}:${item.id}`)).filter(Boolean);
}

export function normalizeCards(payload) {
  const index = includedIndex(payload.included);
  return (payload.data || []).map((animal) => {
    const relationships = animal.relationships || {};
    const pictures = relationshipResources(relationships.pictures, "pictures", index)
      .sort((a, b) => (a.attributes?.order ?? Number.MAX_SAFE_INTEGER) - (b.attributes?.order ?? Number.MAX_SAFE_INTEGER));
    let picture, imageUrl;
    for (const item of pictures.map((p) => p.attributes || {})) {
      const rawImg = item.large?.url || item.original?.url;
      imageUrl = normalizeUrl(rawImg);
      if (imageUrl) {
        picture = item;
        break;
      }
    }
    if (!picture) return null;
    const org = relationshipResources(relationships.orgs, "orgs", index)[0];
    const attrs = animal.attributes || {};
    const updatedAt = newestTimestamp(attrs.updatedDate, attrs.updatedAt);
    if (!isRecentEnough(updatedAt)) return null;
    const profileUrl = normalizeUrl(attrs.url || org?.attributes?.url || null);
    const rescueUrl = normalizeUrl(org?.attributes?.url || null);
    return {
      id: String(animal.id),
      name: attrs.name || "Unnamed cat",
      age: attrs.ageString || null,
      sex: attrs.sex || null,
      breed: attrs.breedString || null,
      distanceMiles: Number.isFinite(attrs.distance) ? attrs.distance : null,
      imageUrl,
      originalImageUrl: normalizeUrl(picture.original?.url),
      profileUrl,
      profileUrlKind: attrs.url ? "animal" : org?.attributes?.url ? "organization" : null,
      rescueName: org?.attributes?.name || "Rescue organization",
      rescueUrl,
      isAdoptionPending: Boolean(attrs.isAdoptionPending),
      isSpecialNeeds: Boolean(attrs.isSpecialNeeds),
      adoptionFee: attrs.adoptionFeeString || null,
      description: attrs.descriptionText || null,
      updatedAt
    };
  }).filter(Boolean);
}

export async function searchRadius(location, miles, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("RG_API_KEY is not configured.");
  const { url, body } = buildSearchRequest(location, miles);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": CONTENT_TYPE, Accept: CONTENT_TYPE },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = payload?.errors?.map((item) => item.detail || item.title).join("; ") || response.statusText;
    throw new Error(`RescueGroups HTTP ${response.status}: ${details}`);
  }
  return normalizeCards(payload);
}

export async function findNearbyCats(location, { apiKey, target = 8, fetchImpl = fetch } = {}) {
  for (const miles of RADIUS_STEPS) {
    const cards = await searchRadius(location, miles, { apiKey, fetchImpl });
    if (cards.length >= target || (cards.length > 0 && miles === RADIUS_STEPS.at(-1))) {
      return { cards, radiusMiles: miles, exhausted: cards.length < target };
    }
  }
  return { cards: [], radiusMiles: RADIUS_STEPS.at(-1), exhausted: true };
}
