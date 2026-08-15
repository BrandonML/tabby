import { classifyRefreshError } from "./error-messages.js";

const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
let inFlight = null;
const $ = (id) => document.getElementById(id);

function storageGet(keys) { return chrome.storage.local.get(keys); }
function storageSet(value) { return chrome.storage.local.set(value); }
function randomCard(cards) { return cards[Math.floor(Math.random() * cards.length)]; }
function setCardVisible(visible) {
  const card = $("card");
  if (!card) return;
  card.hidden = !visible;
}
function showNotice(message, { linkText = null, linkAction = null } = {}) {
  const notice = $("notice");
  if (!notice) return;

  notice.textContent = ""; // Clear existing content safely

  if (linkText && linkAction) {
    notice.appendChild(document.createTextNode(`${message} `));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "notice-link";
    button.dataset.action = linkAction;
    button.textContent = linkText;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (linkAction === "open-settings") chrome.runtime.openOptionsPage();
    });

    notice.appendChild(button);
    return;
  }

  notice.textContent = message;
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

function getSeenIds(feedCache = {}) {
  return Array.isArray(feedCache.seenIds) ? feedCache.seenIds : [];
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

function renderCard(card, { stale = false } = {}) {
  const meta = [card.breed, card.age, card.sex].filter(Boolean).join(" · ");
  const distance = card.distanceMiles != null ? `${card.distanceMiles.toFixed(1)} mi away` : null;
  const updatedAt = readingFormat(card.updatedAt);
  const chips = [card.isAdoptionPending && { label: "Adoption pending", className: "" }, card.isSpecialNeeds && { label: "Special needs", className: "" }, card.adoptionFee && { label: card.adoptionFee, className: "adoption-fee" }].filter(Boolean);
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
  img.addEventListener("error", () => { showNotice("That photo is no longer available. Refresh to try another cat."); });
  cardContainer.appendChild(img);

  const content = document.createElement("div");
  content.className = "content";

  const h1 = document.createElement("h1");
  h1.textContent = card.name;
  content.appendChild(h1);

  if (meta) {
    const metaP = document.createElement("p");
    metaP.className = "meta";
    metaP.textContent = meta;
    content.appendChild(metaP);
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

  if (chips.length > 0) {
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "chips";
    for (const chip of chips) {
      const chipSpan = document.createElement("span");
      chipSpan.className = `chip${chip.className ? ` ${chip.className}` : ""}`;
      chipSpan.textContent = chip.label;
      chipsDiv.appendChild(chipSpan);
    }
    content.appendChild(chipsDiv);
  }

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

async function locationFromBrowser() {
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 }));
  return { lat: position.coords.latitude, lon: position.coords.longitude };
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

async function refresh(location, settings) {
  const { feedCache } = await storageGet(["feedCache"]);
  const backendUrl = (settings.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  const response = await fetch(`${backendUrl}/api/nearby-cats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not refresh cats.");
  const feed = await response.json();
  const seenIds = getSeenIds(feedCache);
  const nextCache = { cards: feed.cards || [], fetchedAt: Date.now(), radiusMiles: feed.radiusMiles || 0, seenIds };
  await storageSet({ feedCache: nextCache });
  if (!feed.cards?.length) {
    setCardVisible(false);
    $("location-panel").hidden = true;
    showNotice(`No available cats were found within ${nextCache.radiusMiles} miles. Try using a different zip code instead.`, { linkText: "zip code", linkAction: "open-settings" });
    return;
  }
  const { selected, nextSeenIds } = nextCard(feed.cards, seenIds);
  const finalCache = { ...nextCache, seenIds: nextSeenIds };
  await storageSet({ feedCache: finalCache });
  $("location-panel").hidden = true;
  renderCard(selected);
  showNotice(`Showing results within ${feed.radiusMiles} miles.`);
}

async function _start({ requestLocation = false } = {}) {
  setCardVisible(false);
  const { settings = { backendUrl: "http://localhost:8787", postalcode: "", location: null }, feedCache } = await storageGet(["settings", "feedCache"]);
  const resolvedSettings = {
    backendUrl: settings.backendUrl || "http://localhost:8787",
    postalcode: settings.postalcode || "",
    location: settings.location || null
  };
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  if (feedCache?.cards?.length && age < STALE_MS) {
    const { selected, nextSeenIds } = nextCard(feedCache.cards, getSeenIds(feedCache));
    await storageSet({ feedCache: { ...feedCache, seenIds: nextSeenIds } });
    renderCard(selected, { stale: age >= FRESH_MS });
  } else if (feedCache && !feedCache.cards?.length && age < STALE_MS) {
    showNotice(`No available cats were found within ${feedCache.radiusMiles || 0} miles. Try using a different zip code instead.`, { linkText: "zip code", linkAction: "open-settings" });
  }
  const location = await resolveLocation(resolvedSettings, requestLocation);
  if (!location) { $("location-panel").hidden = false; return; }
  $("location-panel").hidden = true;
  if (age >= FRESH_MS || !feedCache?.cards?.length) {
    try { await refresh(location, resolvedSettings); } catch (error) {
      const finalMessage = classifyRefreshError(error.message);
      showNotice(finalMessage, { linkText: "zip code", linkAction: "open-settings" });
      if (!feedCache?.cards?.length) $("location-panel").hidden = false;
    }
  }
}

function start(options = {}) {
  if (inFlight) return inFlight;
  inFlight = _start(options).finally(() => { inFlight = null; });
  return inFlight;
}

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("use-location").addEventListener("click", () => start({ requestLocation: true }));
$("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
start();
