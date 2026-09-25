const $ = (id) => document.getElementById(id);

// Mirrors faq.js's close/back navigation.
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

async function getSavedCats() {
  const { savedCats } = await chrome.storage.local.get(["savedCats"]);
  return Array.isArray(savedCats) ? savedCats : [];
}

async function removeSavedCat(id) {
  const savedCats = await getSavedCats();
  await chrome.storage.local.set({ savedCats: savedCats.filter((saved) => saved.id !== id) });
}

function buildSavedItem(saved) {
  const item = document.createElement("div");
  item.className = "saved-item";

  const img = document.createElement("img");
  img.className = "saved-item-photo";
  img.src = saved.imageUrl;
  img.alt = saved.name;
  img.referrerPolicy = "no-referrer";
  item.appendChild(img);

  const info = document.createElement("div");
  info.className = "saved-item-info";

  const name = document.createElement("p");
  name.className = "saved-item-name";
  name.textContent = saved.name;
  info.appendChild(name);

  const meta = [saved.breed, saved.age, saved.sex].filter(Boolean).join(" · ");
  if (meta || saved.adoptionFee) {
    const metaP = document.createElement("p");
    metaP.className = "saved-item-meta";
    metaP.textContent = [meta, saved.adoptionFee].filter(Boolean).join(" · ");
    info.appendChild(metaP);
  }

  // Same redundancy logic as newtab.js's renderCard (issue #51): when the
  // rescue and profile URLs are the same page, link only the rescue name
  // here instead of showing two links to one destination.
  const rescueUrl = saved.rescueUrl || saved.profileUrl;
  const showRescueLink = Boolean(rescueUrl) && rescueUrl !== saved.profileUrl;
  if (rescueUrl || saved.profileUrl) {
    const linksP = document.createElement("p");
    linksP.className = "saved-item-links";
    if (showRescueLink) {
      const rescueA = document.createElement("a");
      rescueA.href = rescueUrl;
      rescueA.target = "_blank";
      rescueA.rel = "noreferrer";
      rescueA.textContent = saved.rescueName || "Rescue";
      linksP.appendChild(rescueA);
    } else {
      linksP.appendChild(document.createTextNode(saved.rescueName || "Rescue"));
    }
    if (saved.profileUrl) {
      if (linksP.hasChildNodes()) linksP.appendChild(document.createTextNode(" · "));
      const profileA = document.createElement("a");
      profileA.href = saved.profileUrl;
      profileA.target = "_blank";
      profileA.rel = "noreferrer";
      profileA.textContent = "View profile";
      linksP.appendChild(profileA);
    }
    info.appendChild(linksP);
  }

  item.appendChild(info);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "saved-item-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", async () => {
    removeBtn.disabled = true;
    await removeSavedCat(saved.id);
    await render();
  });
  item.appendChild(removeBtn);

  return item;
}

async function render() {
  const savedCats = await getSavedCats();
  const list = $("saved-list");
  list.textContent = ""; // Clear securely

  $("saved-empty").hidden = savedCats.length > 0;

  // Most recently saved first.
  const sorted = [...savedCats].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  for (const saved of sorted) {
    list.appendChild(buildSavedItem(saved));
  }
}

render();
