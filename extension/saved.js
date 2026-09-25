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

const SVG_NS = "http://www.w3.org/2000/svg";
function buildCloseIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ["M18 6 6 18", "m6 6 12 12"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// Small hand-built lightbox (no external library) -- shows the
// original-resolution photo full-screen, dismissed by clicking outside the
// image, the close button, or Escape.
function openLightbox(imageUrl, altText) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", altText);

  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.src = imageUrl;
  img.alt = altText;
  img.referrerPolicy = "no-referrer";
  overlay.appendChild(img);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(buildCloseIcon());
  overlay.appendChild(closeBtn);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(event) {
    if (event.key === "Escape") close();
  }
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);
  closeBtn.focus();
}

function buildSavedItem(saved) {
  const item = document.createElement("div");
  item.className = "saved-item";

  const photoBtn = document.createElement("button");
  photoBtn.type = "button";
  photoBtn.className = "saved-item-photo-btn";
  const photoHint = `Click to see a larger photo of ${saved.name}`;
  photoBtn.setAttribute("aria-label", photoHint);
  photoBtn.title = photoHint;
  const img = document.createElement("img");
  img.className = "saved-item-photo";
  img.src = saved.imageUrl;
  img.alt = saved.name;
  img.referrerPolicy = "no-referrer";
  photoBtn.appendChild(img);
  photoBtn.addEventListener("click", () => openLightbox(saved.originalImageUrl || saved.imageUrl, saved.name));
  item.appendChild(photoBtn);

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
