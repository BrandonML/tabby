const form = document.getElementById("settings-form");
const backend = document.getElementById("backend");
const backendField = document.getElementById("backend-field");
const zip = document.getElementById("zip");
const saved = document.getElementById("saved");
const closeSettings = document.getElementById("close-settings");

function isLocalhost() {
  const hostname = window.location.hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function updateBackendVisibility() {
  const visible = isLocalhost();
  if (backendField) backendField.hidden = !visible;
}

async function refreshCacheForZip(postalcode, nextSettings) {
  const backendUrl = (isLocalhost() ? backend.value.trim() : nextSettings.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  if (!/^\d{5}$/.test(postalcode)) return;
  try {
    const response = await fetch(`${backendUrl}/api/nearby-cats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { postalcode } })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Unable to refresh nearby cats.");
    const feed = await response.json();
    await chrome.storage.local.set({
      settings: nextSettings,
      feedCache: { cards: feed.cards || [], fetchedAt: Date.now(), radiusMiles: feed.radiusMiles || 0, seenIds: [] }
    });
    saved.textContent = "Saved.";
    return;
  } catch (error) {
    await chrome.storage.local.set({ settings: nextSettings, feedCache: null });
    saved.textContent = error.message;
    return;
  }
}

chrome.storage.local.get(["settings"], ({ settings = {} }) => {
  const savedSettings = settings || {};
  backend.value = savedSettings.backendUrl || "http://localhost:8787";
  zip.value = savedSettings.postalcode || "";
  updateBackendVisibility();
});

closeSettings.addEventListener("click", () => {
  if (window.close) window.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postalcode = zip.value.trim();
  if (postalcode && !/^\d{5}$/.test(postalcode)) {
    saved.textContent = "Enter a five-digit ZIP code.";
    return;
  }
  const { settings = {} } = await chrome.storage.local.get(["settings"]);
  const nextSettings = { ...settings, postalcode };
  if (isLocalhost()) {
    nextSettings.backendUrl = backend.value.trim().replace(/\/$/, "") || "http://localhost:8787";
  }
  await refreshCacheForZip(postalcode, nextSettings);
});
