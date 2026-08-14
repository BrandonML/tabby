const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const $ = (id) => document.getElementById(id);

function storageGet(keys) { return chrome.storage.local.get(keys); }
function storageSet(value) { return chrome.storage.local.set(value); }
function randomCard(cards) { return cards[Math.floor(Math.random() * cards.length)]; }

function renderCard(card, { stale = false } = {}) {
  const meta = [card.breed, card.age, card.sex, card.distanceMiles != null ? `${card.distanceMiles.toFixed(1)} mi away` : null].filter(Boolean).join(" · ");
  const chips = [card.isAdoptionPending && "Adoption pending", card.isSpecialNeeds && "Special needs", card.adoptionFee && card.adoptionFee].filter(Boolean);
  $("card").className = "card";
  $("card").innerHTML = `<img class="photo" src="${card.imageUrl}" alt="${escapeHtml(card.name)}" referrerpolicy="no-referrer"><div class="content"><h1>${escapeHtml(card.name)}</h1><p class="meta">${escapeHtml(meta)}</p><p class="rescue">${escapeHtml(card.rescueName)}</p>${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>` : ""}${card.profileUrl ? `<a class="profile" href="${escapeAttribute(card.profileUrl)}" target="_blank" rel="noreferrer">View profile</a>` : ""}</div>`;
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
  const response = await fetch(`${settings.backendUrl.replace(/\/$/, "")}/api/nearby-cats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not refresh cats.");
  const feed = await response.json();
  if (!feed.cards?.length) throw new Error("No photo-ready cats were found in the current search radius.");
  await storageSet({ feedCache: { cards: feed.cards, fetchedAt: Date.now(), radiusMiles: feed.radiusMiles } });
  renderCard(randomCard(feed.cards));
  $("notice").textContent = `Showing results within ${feed.radiusMiles} miles.`;
}

async function start({ requestLocation = false } = {}) {
  const { settings = { backendUrl: "http://localhost:8787", postalcode: "" }, feedCache } = await storageGet(["settings", "feedCache"]);
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  if (feedCache?.cards?.length && age < STALE_MS) renderCard(randomCard(feedCache.cards), { stale: age >= FRESH_MS });
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
