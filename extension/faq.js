const $ = (id) => document.getElementById(id);

// Mirrors options.js's close-settings navigation: replace the current tab
// with a fresh newtab.html rather than chrome.tabs.update-ing straight to
// it, since the extension's own new-tab override page needs to be opened
// as a genuine new tab to behave like one.
$("back-to-tabby").addEventListener("click", () => {
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
