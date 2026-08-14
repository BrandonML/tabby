chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["settings"], ({ settings }) => {
    if (!settings) chrome.storage.local.set({ settings: { backendUrl: "http://localhost:8787", postalcode: "" } });
  });
});
