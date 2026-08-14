const form = document.getElementById("settings-form");
const backend = document.getElementById("backend");
const zip = document.getElementById("zip");
const saved = document.getElementById("saved");
chrome.storage.local.get(["settings"], ({ settings = {} }) => { backend.value = settings.backendUrl || "http://localhost:8787"; zip.value = settings.postalcode || ""; });
form.addEventListener("submit", async (event) => { event.preventDefault(); const postalcode = zip.value.trim(); if (postalcode && !/^\d{5}$/.test(postalcode)) { saved.textContent = "Enter a five-digit ZIP code."; return; } await chrome.storage.local.set({ settings: { backendUrl: backend.value.replace(/\/$/, ""), postalcode } }); saved.textContent = "Saved."; });
