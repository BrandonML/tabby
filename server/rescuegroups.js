const BASE_URL = "https://api.rescuegroups.org/v5";
const CONTENT_TYPE = "application/vnd.api+json";
const RADIUS_STEPS = [10, 25, 50, 100];
const MAX_LIMIT = 25;

const ANIMAL_FIELDS = [
  "name", "ageString", "sex", "distance", "url", "pictureCount",
  "pictureThumbnailUrl", "breedString", "descriptionText", "isSpecialNeeds",
  "isAdoptionPending", "updatedDate", "adoptionFeeString"
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
    const picture = pictures.map((item) => item.attributes || {}).find((item) => item.large?.url || item.original?.url);
    if (!picture) return null;
    const org = relationshipResources(relationships.orgs, "orgs", index)[0];
    const attrs = animal.attributes || {};
    return {
      id: String(animal.id),
      name: attrs.name || "Unnamed cat",
      age: attrs.ageString || null,
      sex: attrs.sex || null,
      breed: attrs.breedString || null,
      distanceMiles: Number.isFinite(attrs.distance) ? attrs.distance : null,
      imageUrl: picture.large?.url || picture.original?.url,
      originalImageUrl: picture.original?.url || null,
      profileUrl: attrs.url || org?.attributes?.url || null,
      profileUrlKind: attrs.url ? "animal" : org?.attributes?.url ? "organization" : null,
      rescueName: org?.attributes?.name || "Rescue organization",
      isAdoptionPending: Boolean(attrs.isAdoptionPending),
      isSpecialNeeds: Boolean(attrs.isSpecialNeeds),
      adoptionFee: attrs.adoptionFeeString || null,
      description: attrs.descriptionText || null,
      updatedAt: attrs.updatedDate || null
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
