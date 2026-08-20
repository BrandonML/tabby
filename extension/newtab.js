import { classifyRefreshError } from "./error-messages.js";
import { BACKEND_URL } from "./config.js";
import { locationFromBrowser } from "./location.js";

const FRESH_MS = 5 * 60 * 1000;
// A refresh replaces only the *seen* cards in the pool (kept unseen ones
// survive), so waiting until most of the pool has been shown just means
// fewer, chunkier fetches — there's no accuracy cost to waiting, unlike the
// old time-based cutoff this replaced (see git history on STALE_MS).
const SEEN_REFRESH_RATIO = 0.85;
// RescueGroups' photo height/width ratio is a continuous spread, not two
// clusters (sampled live across 5 metros: ~52% land in 0.9-1.1, but the
// portrait side alone stretches from 1.1 to 2.3+ with no natural gap) — a
// single portrait/non-portrait split either overcrops the mild end or
// undercrops the tall end. These two thresholds graduate the trade-off
// instead: a merely-more-than-square photo (e.g. 500x508) stays on the
// default crop, a moderately tall one gets a modestly taller top-anchored
// box, and only the genuinely tall tail gets the full treatment.
const MILD_PORTRAIT_HEIGHT_RATIO = 1.1;
const TALL_PORTRAIT_HEIGHT_RATIO = 1.35;
let inFlight = null;
const $ = (id) => document.getElementById(id);

// Well-known US metro coordinates, chosen for broad RescueGroups coverage.
// Not individually spot-checked against the live API — a location with no
// results degrades gracefully via the existing "no cats found" notice.
const EXPLORE_LOCATIONS = [
  { lat: 40.7128, lon: -74.0060, label: "New York, NY" },
  { lat: 34.0522, lon: -118.2437, label: "Los Angeles, CA" },
  { lat: 41.8781, lon: -87.6298, label: "Chicago, IL" },
  { lat: 29.7604, lon: -95.3698, label: "Houston, TX" },
  { lat: 33.4484, lon: -112.0740, label: "Phoenix, AZ" },
  { lat: 39.9526, lon: -75.1652, label: "Philadelphia, PA" },
  { lat: 29.4241, lon: -98.4936, label: "San Antonio, TX" },
  { lat: 32.7157, lon: -117.1611, label: "San Diego, CA" },
  { lat: 32.7767, lon: -96.7970, label: "Dallas, TX" },
  { lat: 37.3382, lon: -121.8863, label: "San Jose, CA" },
  { lat: 30.2672, lon: -97.7431, label: "Austin, TX" },
  { lat: 30.3322, lon: -81.6557, label: "Jacksonville, FL" },
  { lat: 39.9612, lon: -82.9988, label: "Columbus, OH" },
  { lat: 37.7749, lon: -122.4194, label: "San Francisco, CA" },
  { lat: 39.7684, lon: -86.1581, label: "Indianapolis, IN" },
  { lat: 35.2271, lon: -80.8431, label: "Charlotte, NC" },
  { lat: 47.6062, lon: -122.3321, label: "Seattle, WA" },
  { lat: 39.2904, lon: -76.6122, label: "Baltimore, MD" },
  { lat: 38.9072, lon: -77.0369, label: "Washington, DC" },
  { lat: 25.7617, lon: -80.1918, label: "Miami, FL" },
  { lat: 44.9778, lon: -93.2650, label: "Minneapolis, MN" },
  { lat: 39.0997, lon: -94.5786, label: "Kansas City, MO" },
  { lat: 36.1627, lon: -86.7816, label: "Nashville, TN" },
  { lat: 45.5152, lon: -122.6784, label: "Portland, OR" },
  { lat: 39.7392, lon: -104.9903, label: "Denver, CO" }
];

function storageGet(keys) { return chrome.storage.local.get(keys); }
function storageSet(value) { return chrome.storage.local.set(value); }
function randomCard(cards) { return cards[Math.floor(Math.random() * cards.length)]; }
function setCardVisible(visible) {
  const card = $("card");
  if (!card) return;
  card.hidden = !visible;
}
function showExploreBanner(label) {
  $("explore-label").textContent = label;
  $("explore-banner").hidden = false;
}
function hideExploreBanner() {
  $("explore-banner").hidden = true;
}
function showNotice(message, { linkText = null, linkAction = null, type = "info" } = {}) {
  const notice = $("notice");
  if (!notice) return;

  notice.textContent = ""; // Clear existing content safely
  notice.classList.toggle("notice-error", type === "error");
  if (!message) return;

  if (type === "error") {
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";
    notice.appendChild(icon);
  }

  if (linkText && linkAction) {
    notice.appendChild(document.createTextNode(`${message} `));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "notice-link";
    button.dataset.action = linkAction;
    button.textContent = linkText;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (linkAction === "open-settings") openSettings();
    });

    notice.appendChild(button);
    return;
  }

  notice.appendChild(document.createTextNode(message));
}
function readingFormat(value) {
  if (!value) return "";
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return "";
  const ageInDays = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)));
  if (ageInDays < 1) return "Today";
  if (ageInDays < 30) return `${ageInDays} day${ageInDays === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(updatedAt);
}

function getSeenIds(feedCache) {
  return Array.isArray(feedCache?.seenIds) ? feedCache.seenIds : [];
}

function nextCard(cards, seenIds = []) {
  const seenSet = new Set(seenIds);
  const unseenCards = cards.filter((card) => !seenSet.has(card.id));
  if (unseenCards.length) {
    const selected = randomCard(unseenCards);
    seenSet.add(selected.id);
    return { selected, nextSeenIds: [...seenSet] };
  }
  const selected = randomCard(cards);
  return { selected, nextSeenIds: [selected.id] };
}

function renderCard(card, { stale = false, exploreLabel = null, locationLabel = null } = {}) {
  const meta = [card.breed, card.age, card.sex].filter(Boolean).join(" · ");
  // While exploring, distanceMiles is measured from the explored city, not
  // the user — naming that city avoids the number reading as "from you".
  // In normal mode, locationLabel names what the distance is measured from
  // instead (a saved ZIP, or "from you" when only browser geolocation is on
  // file) — it arrives pre-phrased so callers can pick either wording.
  const distanceSuffix = exploreLabel ? ` from ${exploreLabel}` : locationLabel ? ` ${locationLabel}` : "";
  const distance = card.distanceMiles != null ? `${card.distanceMiles.toFixed(1)} mi away${distanceSuffix}` : null;
  const updatedAt = readingFormat(card.updatedAt);
  const chips = [card.isAdoptionPending && { label: "Adoption pending", className: "pending" }, card.isSpecialNeeds && { label: "Special needs", className: "special-needs" }].filter(Boolean);
  const rescueUrl = card.rescueUrl || card.profileUrl;
  const profileUrl = card.profileUrl;

  const cardContainer = $("card");
  cardContainer.className = "card";
  cardContainer.hidden = false;
  cardContainer.textContent = ""; // Clear securely

  const img = document.createElement("img");
  img.className = "photo";
  img.src = card.imageUrl;
  img.alt = card.name;
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => { showNotice("That photo is no longer available. Refresh to try another cat.", { type: "error" }); });
  img.addEventListener("load", () => {
    // A portrait-oriented photo (taller than wide) can't fill the card's
    // full width without either cropping or shrinking down to fit beside
    // empty letterbox space — there isn't a box tall enough to avoid both
    // (RescueGroups' CDN only resizes proportionally, it can't hand us a
    // pre-cropped or face-centered variant). Trading some width for a
    // taller box and a top-anchored crop keeps the photo large and the
    // subject's face/torso in frame, at the cost of some legs/tail. See the
    // MILD/TALL_PORTRAIT_HEIGHT_RATIO comment above for why this is two
    // graduated tiers rather than one.
    if (img.naturalHeight > img.naturalWidth * TALL_PORTRAIT_HEIGHT_RATIO) {
      img.classList.add("photo-portrait");
    } else if (img.naturalHeight > img.naturalWidth * MILD_PORTRAIT_HEIGHT_RATIO) {
      img.classList.add("photo-portrait-mild");
    }
  });
  cardContainer.appendChild(img);

  const content = document.createElement("div");
  content.className = "content";

  const h1 = document.createElement("h1");
  // Long names (or names with extra text) can't be caught by CSS alone --
  // wrapping and the vw-based clamp() in .name already absorb most of them,
  // but a genuinely long one still reads better a size down than
  // balance-wrapped at full size.
  h1.className = card.name.length > 18 ? "name name-long" : "name";
  h1.textContent = card.name;
  content.appendChild(h1);

  if (meta) {
    const metaP = document.createElement("p");
    metaP.className = "meta";
    metaP.textContent = meta;
    content.appendChild(metaP);
  }

  if (chips.length > 0) {
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "chips";
    for (const chip of chips) {
      const chipSpan = document.createElement("span");
      chipSpan.className = `chip ${chip.className}`;
      chipSpan.textContent = chip.label;
      chipsDiv.appendChild(chipSpan);
    }
    content.appendChild(chipsDiv);
  }

  if (card.adoptionFee) {
    const feeP = document.createElement("p");
    feeP.className = "fee";
    feeP.textContent = card.adoptionFee;
    content.appendChild(feeP);
  }

  if (distance) {
    const distP = document.createElement("p");
    distP.className = "distance";
    distP.textContent = distance;
    content.appendChild(distP);
  }

  if (updatedAt) {
    const updatedP = document.createElement("p");
    updatedP.className = "updated";
    updatedP.textContent = `Updated ${updatedAt}`;
    content.appendChild(updatedP);
  }

  const rescueP = document.createElement("p");
  rescueP.className = "rescue";
  if (rescueUrl) {
    const rescueA = document.createElement("a");
    rescueA.href = rescueUrl;
    rescueA.target = "_blank";
    rescueA.rel = "noreferrer";
    rescueA.textContent = card.rescueName;
    rescueP.appendChild(rescueA);
  } else {
    rescueP.textContent = card.rescueName;
  }
  content.appendChild(rescueP);

  if (profileUrl) {
    const profileA = document.createElement("a");
    profileA.className = "profile";
    profileA.href = profileUrl;
    profileA.target = "_blank";
    profileA.rel = "noreferrer";
    profileA.textContent = "View profile";
    content.appendChild(profileA);
  }

  cardContainer.appendChild(content);

  showNotice(stale ? "Showing a recent saved match while we refresh." : "");
}

async function resolveLocation(settings, promptForLocation) {
  const savedLocation = settings?.location;
  if (savedLocation && Number.isFinite(savedLocation.lat) && Number.isFinite(savedLocation.lon)) {
    return { lat: savedLocation.lat, lon: savedLocation.lon };
  }
  if (promptForLocation) {
    try {
      const browserLocation = await locationFromBrowser();
      const nextSettings = { ...settings, location: browserLocation };
      await storageSet({ settings: nextSettings });
      return browserLocation;
    } catch { /* ZIP fallback below */ }
  }
  return /^\d{5}$/.test(settings.postalcode || "") ? { postalcode: settings.postalcode } : null;
}

function sameLocation(a, b) {
  return Boolean(a) && Boolean(b) && JSON.stringify(a) === JSON.stringify(b);
}

async function fetchCatsPage(location, page) {
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  const response = await fetch(`${backendUrl}/api/nearby-cats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, page }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not refresh cats.");
  return response.json();
}

// Appends the cards from `incomingCards` that aren't already in `keptCards`
// or in `excludeIds` (cards the user has already seen and dropped) — used to
// merge a freshly-fetched page into the kept unseen remainder without
// duplicating anything or letting a seen card quietly sneak back in.
function mergeCards(keptCards, incomingCards, excludeIds = []) {
  const knownIds = new Set([...keptCards.map((card) => card.id), ...excludeIds]);
  const freshCards = incomingCards.filter((card) => !knownIds.has(card.id));
  return [...keptCards, ...freshCards];
}

async function refresh(location, locationLabel) {
  const { feedCache } = await storageGet(["feedCache"]);
  const isRepeatLocation = sameLocation(feedCache?.location, location) && Boolean(feedCache?.cards?.length);
  const priorSeenIds = isRepeatLocation ? getSeenIds(feedCache) : [];
  // Only the *seen* cards are dropped on a refresh — whatever the user
  // hasn't looked at yet survives and is topped up with new cards below,
  // rather than being discarded wholesale.
  const keptUnseenCards = isRepeatLocation ? feedCache.cards.filter((card) => !priorSeenIds.includes(card.id)) : [];
  let page = isRepeatLocation ? (feedCache.page || 1) + 1 : 1;
  let feed = await fetchCatsPage(location, page);
  let mergedCards = mergeCards(keptUnseenCards, feed.cards || [], priorSeenIds);

  // `exhausted` means this page's cumulative unique count (across the radius
  // ladder) fell short of the target — it can still carry a non-empty page.
  // Only an exhausted page that's also empty means we've paged past the end
  // of what this location has, as opposed to this location having nothing at
  // all (which page 1 coming back empty+exhausted would mean). In that case,
  // restart pagination at page 1 rather than dead-ending on "no cats found"
  // — the location isn't out of cats, just out of new pages. Previously-seen
  // cards are allowed to resurface here (only the still-unseen leftovers are
  // excluded, to avoid an immediate duplicate).
  if (!feed.cards?.length && feed.exhausted && page > 1) {
    page = 1;
    feed = await fetchCatsPage(location, page);
    mergedCards = mergeCards(keptUnseenCards, feed.cards || []);
  }

  const nextCache = { cards: mergedCards, fetchedAt: Date.now(), radiusMiles: feed.radiusMiles || feedCache?.radiusMiles || 0, location, page, seenIds: [] };
  await storageSet({ feedCache: nextCache });
  if (!mergedCards.length) {
    setCardVisible(false);
    $("location-panel").hidden = true;
    showNotice(`No available cats were found within ${nextCache.radiusMiles} miles. Try using a different zip code instead.`, { linkText: "zip code", linkAction: "open-settings", type: "error" });
    return;
  }
  // Every card in mergedCards is guaranteed unseen (seen ones were dropped,
  // and the fetch was deduped against the prior seenIds), so seenIds starts
  // empty here — carrying forward stale ids that no longer match any card in
  // the pool would inflate _start()'s seen-ratio math against a phantom count.
  const { selected, nextSeenIds } = nextCard(mergedCards, []);
  const finalCache = { ...nextCache, seenIds: nextSeenIds };
  await storageSet({ feedCache: finalCache });
  $("location-panel").hidden = true;
  renderCard(selected, { locationLabel });
}

async function _start({ requestLocation = false } = {}) {
  setCardVisible(false);
  const { settings = { postalcode: "", location: null }, feedCache } = await storageGet(["settings", "feedCache"]);
  const resolvedSettings = {
    postalcode: settings.postalcode || "",
    location: settings.location || null
  };
  const locationLabel = resolvedSettings.postalcode ? `from ${resolvedSettings.postalcode}` : "from you";
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  const seenRatio = feedCache?.cards?.length ? getSeenIds(feedCache).length / feedCache.cards.length : 1;
  const shouldRefresh = !feedCache?.cards?.length || (age >= FRESH_MS && seenRatio >= SEEN_REFRESH_RATIO);
  if (feedCache?.cards?.length) {
    const { selected, nextSeenIds } = nextCard(feedCache.cards, getSeenIds(feedCache));
    await storageSet({ feedCache: { ...feedCache, seenIds: nextSeenIds } });
    renderCard(selected, { stale: shouldRefresh, locationLabel });
  } else if (feedCache && !feedCache.cards?.length) {
    showNotice(`No available cats were found within ${feedCache.radiusMiles || 0} miles. Try using a different zip code instead.`, { linkText: "zip code", linkAction: "open-settings", type: "error" });
  }
  const location = await resolveLocation(resolvedSettings, requestLocation);
  if (!location) {
    $("location-panel").hidden = false;
    if (requestLocation) {
      showNotice("Unable to determine your location. Try entering a zip code instead.", { linkText: "zip code", linkAction: "open-settings", type: "error" });
    }
    return;
  }
  $("location-panel").hidden = true;
  if (shouldRefresh) {
    try { await refresh(location, locationLabel); } catch (error) {
      console.error("[tabby]", error);
      const finalMessage = classifyRefreshError(error.message);
      showNotice(finalMessage, { linkText: "zip code", linkAction: "open-settings", type: "error" });
      if (!feedCache?.cards?.length) $("location-panel").hidden = false;
    }
  }
}

function start(options = {}) {
  if (inFlight) return inFlight;
  inFlight = _start(options).finally(() => { inFlight = null; });
  return inFlight;
}

// Exploring never touches the `feedCache` storage key, so it can't clobber
// the user's real cache. State lives only in this tab's memory (exploreBatch
// plus the DOM's hidden explore-banner) — reloading the new tab always
// returns to the user's own location, which is the desired "transient"
// behavior. The full fetched batch (not just the one shown card) is kept so
// "Show another cat" can cycle through it without a second network call.
let exploreBatch = null; // { label, cards, seenIds } while exploring, else null

async function exploreArea() {
  const entry = EXPLORE_LOCATIONS[Math.floor(Math.random() * EXPLORE_LOCATIONS.length)];
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  try {
    const response = await fetch(`${backendUrl}/api/nearby-cats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { lat: entry.lat, lon: entry.lon }, page: 1 }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not explore that area.");
    const feed = await response.json();
    if (!feed.cards?.length) {
      exploreBatch = null;
      hideExploreBanner();
      showNotice(`No available cats were found near ${entry.label}. Try exploring again.`, { type: "error" });
      return;
    }
    const { selected, nextSeenIds } = nextCard(feed.cards, []);
    exploreBatch = { label: entry.label, cards: feed.cards, seenIds: nextSeenIds };
    $("location-panel").hidden = true;
    renderCard(selected, { exploreLabel: entry.label });
    showExploreBanner(entry.label);
  } catch (error) {
    console.error("[tabby]", error);
    exploreBatch = null;
    hideExploreBanner();
    showNotice("Unable to explore that area right now. Try again.", { type: "error" });
  }
}

function showAnotherExploreCard() {
  if (!exploreBatch) return;
  const { selected, nextSeenIds } = nextCard(exploreBatch.cards, exploreBatch.seenIds);
  exploreBatch = { ...exploreBatch, seenIds: nextSeenIds };
  renderCard(selected, { exploreLabel: exploreBatch.label });
}

function openSettings() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("extension/options.html") });
      return;
    }
    chrome.runtime.openOptionsPage();
  });
}

$("settings").addEventListener("click", openSettings);
$("use-location").addEventListener("click", async () => {
  $("location-panel").hidden = true;
  showNotice("Finding your location…");
  await start({ requestLocation: true });
});
$("open-settings").addEventListener("click", openSettings);
$("explore").addEventListener("click", async () => {
  showNotice("Exploring a new area…");
  await exploreArea();
});
$("show-another-explore-cat").addEventListener("click", () => showAnotherExploreCard());
$("back-to-my-area").addEventListener("click", async () => {
  exploreBatch = null;
  hideExploreBanner();
  await start();
});
start();
