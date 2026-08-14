const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const $ = (id) => document.getElementById(id);

function storageGet(keys) { return chrome.storage.local.get(keys); }
function storageSet(value) { return chrome.storage.local.set(value); }
function randomCard(cards) { return cards[Math.floor(Math.random() * cards.length)]; }
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
  const unseenCards = cards.filter((card) => !seenIds.includes(card.id));
  if (unseenCards.length) {
    const selected = randomCard(unseenCards);
    return { selected, nextSeenIds: [...new Set([...seenIds, selected.id])] };
  }
  return { selected: randomCard(cards), nextSeenIds: [] };
}

function renderCard(card, { stale = false } = {}) {
  const meta = [card.breed, card.age, card.sex].filter(Boolean).join(" · ");
  const distance = card.distanceMiles != null ? `${card.distanceMiles.toFixed(1)} mi away` : null;
  const updatedAt = readingFormat(card.updatedAt);
  const chips = [card.isAdoptionPending && { label: "Adoption pending", className: "" }, card.isSpecialNeeds && { label: "Special needs", className: "" }, card.adoptionFee && { label: card.adoptionFee, className: "adoption-fee" }].filter(Boolean);
  const rescueUrl = card.rescueUrl || card.profileUrl;
  $("card").className = "card";
  $("card").innerHTML = `<img class="photo" src="${card.imageUrl}" alt="${escapeHtml(card.name)}" referrerpolicy="no-referrer"><div class="content"><h1>${escapeHtml(card.name)}</h1>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}${distance ? `<p class="distance">${escapeHtml(distance)}</p>` : ""}${updatedAt ? `<p class="updated">Updated ${escapeHtml(updatedAt)}</p>` : ""}${rescueUrl ? `<p class="rescue"><a href="${escapeAttribute(rescueUrl)}" target="_blank" rel="noreferrer">${escapeHtml(card.rescueName)}</a></p>` : `<p class="rescue">${escapeHtml(card.rescueName)}</p>`}${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip${chip.className ? ` ${chip.className}` : ""}">${escapeHtml(chip.label)}</span>`).join("")}</div>` : ""}${card.profileUrl ? `<a class="profile" href="${escapeAttribute(card.profileUrl)}" target="_blank" rel="noreferrer">View profile</a>` : ""}</div>`;
  $("notice").textContent = stale ? "Showing a recent saved match while we refresh." : "";
  $("card").querySelector("img").addEventListener("error", () => { $("notice").textContent = "That photo is no longer available. Refresh to try another cat."; });
}

function escapeHtml(value = "") { const el = document.createElement("span"); el.textContent = value; return el.innerHTML; }
function escapeAttribute(value = "") { return escapeHtml(value).replaceAll('"', "&quot;"); }

async function locationFromBrowser() {
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 }));
  return { lat: position.coords.latitude, lon: position.coords.longitude };
}

async function resolveLocation(settings, promptForLocation) {
  if (promptForLocation) {
    try { return await locationFromBrowser(); } catch { /* ZIP fallback below */ }
  }
  return /^\d{5}$/.test(settings.postalcode || "") ? { postalcode: settings.postalcode } : null;
}

async function refresh(location, settings) {
  const { feedCache } = await storageGet(["feedCache"]);
  const response = await fetch(`${settings.backendUrl.replace(/\/$/, "")}/api/nearby-cats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not refresh cats.");
  const feed = await response.json();
  if (!feed.cards?.length) throw new Error("No photo-ready cats were found in the current search radius.");
  const seenIds = getSeenIds(feedCache);
  const { selected, nextSeenIds } = nextCard(feed.cards, seenIds);
  const nextCache = { cards: feed.cards, fetchedAt: Date.now(), radiusMiles: feed.radiusMiles, seenIds: nextSeenIds };
  await storageSet({ feedCache: nextCache });
  renderCard(selected);
  $("notice").textContent = `Showing results within ${feed.radiusMiles} miles.`;
}

async function start({ requestLocation = false } = {}) {
  const { settings = { backendUrl: "http://localhost:8787", postalcode: "" }, feedCache } = await storageGet(["settings", "feedCache"]);
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  if (feedCache?.cards?.length && age < STALE_MS) {
    const { selected, nextSeenIds } = nextCard(feedCache.cards, getSeenIds(feedCache));
    await storageSet({ feedCache: { ...feedCache, seenIds: nextSeenIds } });
    renderCard(selected, { stale: age >= FRESH_MS });
  }
  const location = await resolveLocation(settings, requestLocation);
  if (!location) { $("location-panel").hidden = false; $("card").hidden = Boolean(feedCache?.cards?.length); return; }
  if (age >= FRESH_MS || !feedCache?.cards?.length) {
    try { await refresh(location, settings); } catch (error) { $("notice").textContent = error.message; if (!feedCache?.cards?.length) $("location-panel").hidden = false; }
  }
}

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("use-location").addEventListener("click", () => start({ requestLocation: true }));
$("zip-form").addEventListener("submit", async (event) => { event.preventDefault(); const postalcode = $("zip").value.trim(); if (!/^\d{5}$/.test(postalcode)) return; const { settings = {} } = await storageGet(["settings"]); await storageSet({ settings: { ...settings, postalcode } }); $("location-panel").hidden = true; await start(); });
start();
