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
  await chrome.storage.local.set({ settings: nextSettings });
  saved.textContent = "Saved.";
});
