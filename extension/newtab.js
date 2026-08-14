const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
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
  if (linkText && linkAction) {
    notice.innerHTML = `${escapeHtml(message)} <button type="button" class="notice-link" data-action="${escapeAttribute(linkAction)}">${escapeHtml(linkText)}</button>`;
    const button = notice.querySelector("button[data-action]");
    button?.addEventListener("click", (event) => {
      event.preventDefault();
      if (linkAction === "open-settings") chrome.runtime.openOptionsPage();
    });
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
  const rescueUrl = normalizeUrl(card.rescueUrl || card.profileUrl);
  const profileUrl = normalizeUrl(card.profileUrl);
  $("card").className = "card";
  $("card").hidden = false;
  $("card").innerHTML = `<img class="photo" src="${card.imageUrl}" alt="${escapeHtml(card.name)}" referrerpolicy="no-referrer"><div class="content"><h1>${escapeHtml(card.name)}</h1>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}${distance ? `<p class="distance">${escapeHtml(distance)}</p>` : ""}${updatedAt ? `<p class="updated">Updated ${escapeHtml(updatedAt)}</p>` : ""}${rescueUrl ? `<p class="rescue">${escapeHtml(card.rescueName)}</p>` : `<p class="rescue">${escapeHtml(card.rescueName)}</p>`}${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip${chip.className ? ` ${chip.className}` : ""}">${escapeHtml(chip.label)}</span>`).join("")}</div>` : ""}${profileUrl ? `<a class="profile" href="${escapeAttribute(profileUrl)}" target="_blank" rel="noreferrer">View profile</a>` : ""}</div>`;
  showNotice(stale ? "Showing a recent saved match while we refresh." : "");
  $("card").querySelector("img").addEventListener("error", () => { showNotice("That photo is no longer available. Refresh to try another cat."); });
}

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
  const seenIds = getSeenIds(feedCache);
  const nextCache = { cards: feed.cards || [], fetchedAt: Date.now(), radiusMiles: feed.radiusMiles || 0, seenIds };
  await storageSet({ feedCache: nextCache });
  if (!feed.cards?.length) {
    setCardVisible(false);
    $("location-panel").hidden = true;
    showNotice(`No available cats were found within ${nextCache.radiusMiles} miles. Try using a different ${"zip code"} instead.`, { linkText: "zip code", linkAction: "open-settings" });
    return;
  }
  const { selected, nextSeenIds } = nextCard(feed.cards, seenIds);
  const finalCache = { ...nextCache, seenIds: nextSeenIds };
  await storageSet({ feedCache: finalCache });
  $("location-panel").hidden = true;
  renderCard(selected);
  showNotice(`Showing results within ${feed.radiusMiles} miles.`);
}

async function start({ requestLocation = false } = {}) {
  setCardVisible(false);
  const { settings = { backendUrl: "http://localhost:8787", postalcode: "" }, feedCache } = await storageGet(["settings", "feedCache"]);
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  if (feedCache?.cards?.length && age < STALE_MS) {
    const { selected, nextSeenIds } = nextCard(feedCache.cards, getSeenIds(feedCache));
    await storageSet({ feedCache: { ...feedCache, seenIds: nextSeenIds } });
    renderCard(selected, { stale: age >= FRESH_MS });
  } else if (feedCache && !feedCache.cards?.length && age < STALE_MS) {
    showNotice(`No available cats were found within ${feedCache.radiusMiles || 0} miles. Try using a different ${"zip code"} instead.`, { linkText: "zip code", linkAction: "open-settings" });
  }
  const location = await resolveLocation(settings, requestLocation);
  if (!location) { $("location-panel").hidden = false; return; }
  $("location-panel").hidden = true;
  if (age >= FRESH_MS || !feedCache?.cards?.length) {
    try { await refresh(location, settings); } catch (error) {
      const message = /five-digit|postal code|zip code|invalid/i.test(error.message) ? "That ZIP code looks invalid. Please update it." : error.message || "Unable to refresh nearby cats right now.";
      const finalMessage = /try updating your zip code|update it|zip code/i.test(message) ? message : `${message}${message.endsWith(".") ? "" : "."} Try updating your zip code.`;
      showNotice(finalMessage, { linkText: "zip code", linkAction: "open-settings" });
      if (!feedCache?.cards?.length) $("location-panel").hidden = false;
    }
  }
}

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("use-location").addEventListener("click", () => start({ requestLocation: true }));
$("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
start();
