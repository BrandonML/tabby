const form = document.getElementById("settings-form");
const backend = document.getElementById("backend");
const backendField = document.getElementById("backend-field");
const zip = document.getElementById("zip");
const saved = document.getElementById("saved");
const closeSettings = document.getElementById("close-settings");

async function refreshCacheForZip(postalcode, nextSettings) {
  const backendUrl = (nextSettings.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  if (!/^\d{5}$/.test(postalcode)) return;
  const safeSettings = { ...nextSettings };
  delete safeSettings.location;
  try {
    const response = await fetch(`${backendUrl}/api/nearby-cats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { postalcode } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || "Unable to refresh nearby cats right now.";
      const invalid = /five-digit|postal code|zip code|invalid/i.test(message);
      await chrome.storage.local.set({ settings: safeSettings, feedCache: null });
      saved.textContent = invalid ? "That ZIP code looks invalid. Please update it." : "Unable to refresh nearby cats right now. Try updating your zip code.";
      return;
    }
    await chrome.storage.local.set({
      settings: safeSettings,
      feedCache: { cards: payload.cards || [], fetchedAt: Date.now(), radiusMiles: payload.radiusMiles || 0, seenIds: [] }
    });
    saved.textContent = "Saved.";
    return;
  } catch (error) {
    await chrome.storage.local.set({ settings: safeSettings, feedCache: null });
    saved.textContent = "Unable to refresh nearby cats right now. Try updating your zip code.";
    return;
  }
}

chrome.storage.local.get(["settings"], ({ settings = {} }) => {
  const savedSettings = settings || {};
  backend.value = savedSettings.backendUrl || "http://localhost:8787";
  zip.value = savedSettings.postalcode || "";
});

closeSettings.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;
    if (tab?.id) {
      const extensionUrl = chrome.runtime.getURL("extension/newtab.html");
      chrome.tabs.create({ url: extensionUrl, active: true }, () => {
        chrome.tabs.remove(tab.id);
      });
      return;
    }
    window.close();
  });
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
  delete nextSettings.location;
  nextSettings.backendUrl = backend.value.trim().replace(/\/$/, "") || "http://localhost:8787";

  await refreshCacheForZip(postalcode, nextSettings);
});
