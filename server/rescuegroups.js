const BASE_URL = "https://api.rescuegroups.org/v5";
const CONTENT_TYPE = "application/vnd.api+json";
const RADIUS_STEPS = [25, 75, 150, 250];
const MAX_LIMIT = 100;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// See issue #40's field audit: availableDate drifts 9-17 days from the true
// RG-admin status-change date in both directions, and updatedDate lags
// further behind whenever something else is edited after the fact. 60 days
// is wide enough to absorb that drift without keeping the badge on
// long-settled listings.
const NEW_BADGE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const SENIOR_AGE_YEARS = 10;

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

// adoptionFeeString is free text from RescueGroups: sampled live, it ranges
// from clean numbers ("100", "150.00") to already-prefixed/decorated values
// ("$150", "$50-100", "200 each") to genuinely non-numeric text ("Donation",
// "TBA", "Waived"). Prepending "$" only when the string has no currency
// symbol and starts with a digit covers the numeric cases without touching
// the text-only ones, which already read fine on their own.
function normalizeAdoptionFee(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("$") || !/^\d/.test(trimmed)) return trimmed;
  return `$${trimmed}`;
}

const ANIMAL_FIELDS = [
  "name", "ageString", "sex", "distance", "url", "pictureCount",
  "pictureThumbnailUrl", "breedString", "descriptionText", "isSpecialNeeds",
  "isAdoptionPending", "updatedDate", "updatedAt", "adoptionFeeString",
  "availableDate", "adoptedDate", "birthDate", "ageGroup"
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

export function buildSearchRequest(location, miles, page = 1) {
  const safeLocation = validateLocation(location);
  if (!RADIUS_STEPS.includes(miles)) throw new Error("Unsupported search radius.");
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const query = new URLSearchParams({
    limit: String(MAX_LIMIT),
    page: String(safePage),
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

// Pictures are pre-sorted by `order`; returns the first one whose large/
// original URL actually normalizes to something usable, or null if none do.
function getBestPicture(pictures) {
  for (const item of pictures.map((p) => p.attributes || {})) {
    const imageUrl = normalizeUrl(item.large?.url || item.original?.url);
    if (imageUrl) return { picture: item, imageUrl };
  }
  return null;
}

// Issue #40's recommended logic, minus the statuses.name check: the search
// request already hits .../search/available/... so every animal reaching
// this function is already Available -- that branch could never be false.
function computeIsNew(attrs, updatedAtIso) {
  const availableTime = timestampValue(attrs.availableDate);
  if (availableTime === null) return false; // some orgs don't populate this field; nothing to fall back to
  const updatedTime = timestampValue(updatedAtIso);
  const now = Date.now();
  if (attrs.adoptedDate) {
    // Adopted-then-returned: RG freezes availableDate at the original listing
    // date on a return, so updatedDate is the better proxy here -- a
    // hypothesis validated against one manually-checked case (issue #40),
    // not a fully proven signal.
    return updatedTime !== null && now - updatedTime <= NEW_BADGE_WINDOW_MS;
  }
  const withinAvailableWindow = now - availableTime <= NEW_BADGE_WINDOW_MS;
  // Free upper-bound sanity check: updatedDate can never predate the true
  // status-change date, so if it's stale the animal can't be newly
  // available either. Missing entirely, it just can't rule anything out.
  const withinUpdatedCeiling = updatedTime === null || now - updatedTime <= NEW_BADGE_WINDOW_MS;
  return withinAvailableWindow && withinUpdatedCeiling;
}

function ageYears(birthDateValue) {
  const birth = new Date(birthDateValue);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) years--;
  return years;
}

// birthDate is what ageString is itself derived from (per RG's field docs,
// ageString only exists "assuming a birth date value exists"), so checking
// birthDate directly is both simpler and more precise than parsing
// ageString's free text. ageGroup is a secondary, user-entered signal
// only trusted when birthDate isn't available at all.
function computeIsSenior(attrs) {
  if (attrs.birthDate) {
    const years = ageYears(attrs.birthDate);
    return years !== null && years >= SENIOR_AGE_YEARS;
  }
  return attrs.ageGroup === "Senior";
}

export function normalizeCards(payload) {
  const index = includedIndex(payload.included);
  return (payload.data || []).map((animal) => {
    const relationships = animal.relationships || {};
    const pictures = relationshipResources(relationships.pictures, "pictures", index)
      .sort((a, b) => (a.attributes?.order ?? Number.MAX_SAFE_INTEGER) - (b.attributes?.order ?? Number.MAX_SAFE_INTEGER));
    const best = getBestPicture(pictures);
    if (!best) return null;
    const { picture, imageUrl } = best;
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
      isNew: computeIsNew(attrs, updatedAt),
      isSenior: computeIsSenior(attrs),
      adoptionFee: normalizeAdoptionFee(attrs.adoptionFeeString),
      description: attrs.descriptionText || null,
      updatedAt
    };
  }).filter(Boolean);
}

export async function searchRadius(location, miles, { apiKey, fetchImpl = fetch, page = 1 } = {}) {
  if (!apiKey) throw new Error("RG_API_KEY is not configured.");
  const { url, body } = buildSearchRequest(location, miles, page);
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
  // A 2xx status doesn't guarantee a parseable JSON:API body — an empty or
  // non-JSON response here would otherwise reach normalizeCards() as null
  // and crash on `payload.included`, rather than surfacing as the network
  // error it actually is.
  if (!payload || typeof payload !== "object") {
    throw new Error(`RescueGroups HTTP ${response.status}: empty or malformed response body`);
  }
  return normalizeCards(payload);
}

export async function findNearbyCats(location, { apiKey, target = 40, fetchImpl = fetch, page = 1 } = {}) {
  // Every step re-requests the same `page`, and RescueGroups sorts
  // nearest-first, so a wider radius's results substantially overlap the
  // narrower step's — they are not a disjoint additional batch. Dedup by id
  // as each step is appended, and gate escalation on the cumulative unique
  // count (not each step's own raw count), or duplicate animals would be
  // double-counted and double-cached.
  const seenIds = new Set();
  let accumulated = [];
  let radiusMiles = RADIUS_STEPS[0];
  for (const miles of RADIUS_STEPS) {
    const cards = await searchRadius(location, miles, { apiKey, fetchImpl, page });
    const freshCards = cards.filter((card) => !seenIds.has(card.id));
    freshCards.forEach((card) => seenIds.add(card.id));
    accumulated = accumulated.concat(freshCards);
    radiusMiles = miles;
    if (accumulated.length >= target || miles === RADIUS_STEPS.at(-1)) break;
  }
  // Cards are appended in step order (closer radius first), so trimming to
  // the first MAX_LIMIT naturally keeps the closest results and only
  // truncates the tail contributed by the farthest step queried.
  const cards = accumulated.length > MAX_LIMIT ? accumulated.slice(0, MAX_LIMIT) : accumulated;
  return { cards, radiusMiles, exhausted: accumulated.length < target };
}
