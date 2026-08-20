import { classifyRefreshError } from "./error-messages.js";
import { BACKEND_URL } from "./config.js";
import { locationFromBrowser } from "./location.js";

const form = document.getElementById("settings-form");
const zip = document.getElementById("zip");
const useLocation = document.getElementById("use-location");
const saved = document.getElementById("saved");
const closeSettings = document.getElementById("close-settings");

// Same reasoning as newtab.js's showNotice(): #saved reserves visible box
// space (min-height + flex, via the shared .notice class) even with no
// text, so hide the element itself rather than leaving a blank gap.
function setSaved(message) {
  saved.hidden = !message;
  saved.textContent = message;
}

async function refreshCacheForLocation(location, nextSettings) {
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  const safeSettings = { ...nextSettings };
  try {
    const response = await fetch(`${backendUrl}/api/nearby-cats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location, page: 1 }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || "Unable to refresh nearby cats right now.";
      await chrome.storage.local.set({ settings: safeSettings, feedCache: null });
      setSaved(classifyRefreshError(message));
      form.hidden = false;
      return;
    }
    await chrome.storage.local.set({
      settings: safeSettings,
      feedCache: { cards: payload.cards || [], fetchedAt: Date.now(), radiusMiles: payload.radiusMiles || 0, location, page: 1, seenIds: [] }
    });
    setSaved("Saved.");
    setTimeout(() => closeSettings.click(), 600);
    return;
  } catch (error) {
    console.error("[tabby]", error);
    await chrome.storage.local.set({ settings: safeSettings, feedCache: null });
    setSaved("Unable to refresh nearby cats right now.");
    form.hidden = false;
    return;
  }
}

chrome.storage.local.get(["settings"], ({ settings = {} }) => {
  const savedSettings = settings || {};
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
    setSaved("Enter a five-digit ZIP code.");
    return;
  }
  if (!postalcode) return;

  form.hidden = true;
  setSaved("Saving…");

  const { settings = {} } = await chrome.storage.local.get(["settings"]);
  const nextSettings = { ...settings, postalcode };
  delete nextSettings.location;

  await refreshCacheForLocation({ postalcode }, nextSettings);
});

useLocation.addEventListener("click", async () => {
  form.hidden = true;
  setSaved("Finding your location…");
  try {
    const coords = await locationFromBrowser();
    const { settings = {} } = await chrome.storage.local.get(["settings"]);
    const nextSettings = { ...settings, location: coords };
    delete nextSettings.postalcode;

    await refreshCacheForLocation(coords, nextSettings);
  } catch (error) {
    console.error("[tabby]", error);
    setSaved("Unable to access your location. Try entering a zip code instead.");
    form.hidden = false;
  }
});
