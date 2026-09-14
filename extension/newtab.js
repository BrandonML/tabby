import { classifyRefreshError, isInvalidZipError } from "./error-messages.js";
import { BACKEND_URL } from "./config.js";
import { locationFromBrowser } from "./location.js";

const FRESH_MS = 5 * 60 * 1000;
// A refresh replaces only the *seen* cards in the pool (kept unseen ones
// survive), so waiting until most of the pool has been shown just means
// fewer, chunkier fetches — there's no accuracy cost to waiting, unlike the
// old time-based cutoff this replaced (see git history on STALE_MS).
const SEEN_REFRESH_RATIO = 0.85;
// RescueGroups' photo height/width ratio is a continuous spread, not two
// clusters (sampled live across 5 metros: ~52% land in 0.9-1.1, but the
// portrait side alone stretches from 1.1 to 2.3+ with no natural gap) — a
// single portrait/non-portrait split either overcrops the mild end or
// undercrops the tall end. These two thresholds graduate the trade-off
// instead: a merely-more-than-square photo (e.g. 500x508) stays on the
// default crop, a moderately tall one gets a modestly taller top-anchored
// box, and only the genuinely tall tail gets the full treatment.
const MILD_PORTRAIT_HEIGHT_RATIO = 1.1;
const TALL_PORTRAIT_HEIGHT_RATIO = 1.35;
// How much denser the winning row-band's edge energy has to be than the
// photo's own average row before it's trusted as a real subject signal
// rather than noise — see applyContentAwareCrop(). Calibrated against a
// dozen real portrait photos pulled live from the API (including issue
// #24's own cited example, a 500x1071 cat-dead-center photo that scored
// 1.12): every other sampled photo scored 1.19+, so 1.10 catches the hard
// case with a small margin while still requiring a real, non-trivial
// signal (a flat/textureless photo scores at or near 1.0).
const PORTRAIT_ANALYSIS_MIN_CONFIDENCE = 1.1;
const PORTRAIT_ANALYSIS_TIMEOUT_MS = 5000;
const PHOTO_SHARE_TIMEOUT_MS = 6000;
const TABBY_CWS_URL = "https://chromewebstore.google.com/detail/tabby-new-tab-for-adoptab/elfpnkoboidkgahmoggodpnmekfodcig";
const TABBY_EDGE_URL = "https://microsoftedge.microsoft.com/addons/detail/fieeoalehgckgnkohkdblljmgaemaiho";
const TABBY_TAGLINE = "Meet an adoptable cat every time you open a new tab.";

// Chromium-based Edge identifies itself with "Edg/" in its user agent (not
// "Edge/", which was the older, pre-Chromium EdgeHTML browser) -- checked
// ahead of the generic case since Edge's UA also contains "Chrome/". An
// Edge user sharing a cat should link to the Edge Add-ons listing, since
// Edge blocks one-click installs from the Chrome Web Store by default.
function tabbyStoreUrl() {
  return navigator.userAgent.includes("Edg/") ? TABBY_EDGE_URL : TABBY_CWS_URL;
}
let inFlight = null;
const $ = (id) => document.getElementById(id);
const ZIP_SETTINGS_LINK = { text: "zip code", action: "open-settings" };
const NO_RESULTS_LINKS = [
  { ...ZIP_SETTINGS_LINK, token: "zip" },
  { text: "explore another city", action: "start-explore", token: "explore" }
];

// Well-known US metro coordinates, chosen for broad RescueGroups coverage.
// Not individually spot-checked against the live API — a location with no
// results degrades gracefully via the existing "no cats found" notice.
const EXPLORE_LOCATIONS = [
  { lat: 40.7128, lon: -74.0060, label: "New York, NY" },
  { lat: 34.0522, lon: -118.2437, label: "Los Angeles, CA" },
  { lat: 41.8781, lon: -87.6298, label: "Chicago, IL" },
  { lat: 29.7604, lon: -95.3698, label: "Houston, TX" },
  { lat: 33.4484, lon: -112.0740, label: "Phoenix, AZ" },
  { lat: 39.9526, lon: -75.1652, label: "Philadelphia, PA" },
  { lat: 29.4241, lon: -98.4936, label: "San Antonio, TX" },
  { lat: 32.7157, lon: -117.1611, label: "San Diego, CA" },
  { lat: 32.7767, lon: -96.7970, label: "Dallas, TX" },
  { lat: 37.3382, lon: -121.8863, label: "San Jose, CA" },
  { lat: 30.2672, lon: -97.7431, label: "Austin, TX" },
  { lat: 30.3322, lon: -81.6557, label: "Jacksonville, FL" },
  { lat: 39.9612, lon: -82.9988, label: "Columbus, OH" },
  { lat: 37.7749, lon: -122.4194, label: "San Francisco, CA" },
  { lat: 39.7684, lon: -86.1581, label: "Indianapolis, IN" },
  { lat: 35.2271, lon: -80.8431, label: "Charlotte, NC" },
  { lat: 47.6062, lon: -122.3321, label: "Seattle, WA" },
  { lat: 39.2904, lon: -76.6122, label: "Baltimore, MD" },
  { lat: 38.9072, lon: -77.0369, label: "Washington, DC" },
  { lat: 25.7617, lon: -80.1918, label: "Miami, FL" },
  { lat: 44.9778, lon: -93.2650, label: "Minneapolis, MN" },
  { lat: 39.0997, lon: -94.5786, label: "Kansas City, MO" },
  { lat: 36.1627, lon: -86.7816, label: "Nashville, TN" },
  { lat: 45.5152, lon: -122.6784, label: "Portland, OR" },
  { lat: 39.7392, lon: -104.9903, label: "Denver, CO" }
];

function storageGet(keys) { return chrome.storage.local.get(keys); }
function storageSet(value) { return chrome.storage.local.set(value); }
function randomCard(cards) { return cards[Math.floor(Math.random() * cards.length)]; }
function setCardVisible(visible) {
  const card = $("card");
  if (!card) return;
  card.hidden = !visible;
}
function showExploreBanner(label) {
  $("explore-label").textContent = label;
  $("explore-banner").hidden = false;
}
function hideExploreBanner() {
  $("explore-banner").hidden = true;
}
function buildNoticeLinkButton(link) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notice-link";
  button.dataset.action = link.action;
  button.textContent = link.text;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.action === "open-settings") openSettings();
    else if (link.action === "report-issue") window.open("https://github.com/BrandonML/tabby/issues", "_blank", "noopener,noreferrer");
    else if (link.action === "start-explore") startExplore();
  });
  return button;
}

// `links` is `[{ text, action, token? }]`. When a link has a `token` and the
// message contains a matching `{token}`, the button is spliced in at that
// exact spot (needed for a message with more than one link, e.g. "...try a
// different {zip} or {explore}."). Otherwise every link is appended after
// the message in order -- the common single-link case, unchanged from
// before this supported multiple links.
function showNotice(message, { links = [], type = "info" } = {}) {
  const notice = $("notice");
  if (!notice) return;

  notice.textContent = ""; // Clear existing content safely
  notice.classList.toggle("notice-error", type === "error");
  // An empty notice still has box-model presence (min-height, flex layout)
  // even with no text — hide the element itself rather than leaving a
  // visible blank gap when there's nothing to show.
  notice.hidden = !message;
  if (!message) return;

  if (type === "error") {
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";
    notice.appendChild(icon);
  }

  // The message and any links live in one wrapping element so they flow as
  // normal text -- a link mid-sentence, wrapping with the words around it --
  // instead of `.notice`'s flex layout treating each one as its own row item
  // with a fixed gap, which is what made a trailing link look like a
  // detached chip rather than part of the sentence (GitHub issue #29).
  const body = document.createElement("span");
  body.className = "notice-body";

  const hasMatchingToken = links.some((link) => link.token && message.includes(`{${link.token}}`));
  if (links.length > 0 && hasMatchingToken) {
    const tokenPattern = /\{(\w+)\}/g;
    let lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(message))) {
      if (match.index > lastIndex) body.appendChild(document.createTextNode(message.slice(lastIndex, match.index)));
      const link = links.find((l) => l.token === match[1]);
      body.appendChild(link ? buildNoticeLinkButton(link) : document.createTextNode(match[0]));
      lastIndex = tokenPattern.lastIndex;
    }
    if (lastIndex < message.length) body.appendChild(document.createTextNode(message.slice(lastIndex)));
  } else if (links.length > 0) {
    body.appendChild(document.createTextNode(`${message} `));
    links.forEach((link, i) => {
      body.appendChild(buildNoticeLinkButton(link));
      if (i < links.length - 1) body.appendChild(document.createTextNode(" "));
    });
  } else {
    body.appendChild(document.createTextNode(message));
  }

  notice.appendChild(body);
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

// Content-aware crop for portrait photos (GitHub issue #24): the fixed
// object-position: top anchor (see photo-portrait/-mild in newtab.css)
// assumes the subject is near the top of the frame, which is often true
// but not always — a centered or lower subject gets cropped out entirely.
// This computes a per-photo vertical anchor instead, from a row-wise
// edge/contrast-energy profile (a crude proxy for "where's the subject":
// fur, faces, and toys carry more local contrast than a plain floor or
// wall). Requires reading pixel data, which RescueGroups' CDN images can't
// give us directly — they send no CORS headers, so a canvas drawn from one
// via <img> is tainted and getImageData() throws unconditionally. Fetching
// a small analysis-only thumbnail through our own backend (which does send
// CORS headers) sidesteps that. Any failure — network, decode, a low-
// confidence profile — leaves the CSS default (object-position: top)
// untouched, so the worst case is exactly today's behavior.
async function applyContentAwareCrop(img, imageUrl) {
  try {
    const backendUrl = BACKEND_URL.replace(/\/$/, "");
    const response = await fetch(`${backendUrl}/api/photo-thumb?url=${encodeURIComponent(imageUrl)}`, {
      signal: AbortSignal.timeout(PORTRAIT_ANALYSIS_TIMEOUT_MS)
    });
    if (!response.ok) return;

    const bitmap = await createImageBitmap(await response.blob());
    const { width, height } = bitmap;
    if (width < 4 || height < 4) return;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);

    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }

    // Per-row gradient-magnitude sum — a crude Sobel-style edge/contrast
    // energy profile. Rows 0 and height-1 are left at 0 (no neighbor on one
    // side); negligible for a >=4px-tall image.
    const rowEnergy = new Float64Array(height);
    for (let y = 1; y < height - 1; y++) {
      let energy = 0;
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        energy += Math.abs(gray[idx + 1] - gray[idx - 1]) + Math.abs(gray[idx + width] - gray[idx - width]);
      }
      rowEnergy[y] = energy;
    }

    // Slide a band roughly a third of the photo's height (a plausible
    // subject-fill assumption) down the energy profile and keep the
    // highest-energy position — smooths out single-row noise spikes into a
    // contiguous "subject band" instead of chasing one pixel-thin peak.
    const bandHeight = Math.max(1, Math.round(height * 0.35));
    let bandSum = 0;
    for (let y = 0; y < bandHeight; y++) bandSum += rowEnergy[y];
    let bestSum = bandSum;
    let bestStart = 0;
    for (let y = 1; y <= height - bandHeight; y++) {
      bandSum += rowEnergy[y + bandHeight - 1] - rowEnergy[y - 1];
      if (bandSum > bestSum) {
        bestSum = bandSum;
        bestStart = y;
      }
    }

    // Confidence check: is the winning band meaningfully denser than the
    // photo's own average row, or is this just a flat/noisy image with no
    // real localized signal to act on? Below the threshold, do nothing —
    // acting on a weak signal risks being *worse* than the current fixed
    // top anchor, which the "no worse than today" bar doesn't allow.
    let totalEnergy = 0;
    for (let y = 0; y < height; y++) totalEnergy += rowEnergy[y];
    const meanRowEnergy = totalEnergy / height;
    const bandMeanEnergy = bestSum / bandHeight;
    if (meanRowEnergy <= 0 || bandMeanEnergy / meanRowEnergy < PORTRAIT_ANALYSIS_MIN_CONFIDENCE) return;

    const centerPercent = Math.min(100, Math.max(0, ((bestStart + bandHeight / 2) / height) * 100));
    img.style.objectPosition = `50% ${centerPercent.toFixed(1)}%`;
  } catch {
    // Network failure, decode failure, timeout — leave the CSS default.
  }
}

function getSeenIds(feedCache) {
  return Array.isArray(feedCache?.seenIds) ? feedCache.seenIds : [];
}

function nextCard(cards, seenIds = []) {
  const seenSet = new Set(seenIds);
  const unseenCards = cards.filter((card) => !seenSet.has(card.id));
  if (unseenCards.length) {
    const selected = randomCard(unseenCards);
    seenSet.add(selected.id);
    return { selected, nextSeenIds: [...seenSet] };
  }
  const selected = randomCard(cards);
  return { selected, nextSeenIds: [selected.id] };
}

function renderCard(card, { stale = false, exploreLabel = null, locationLabel = null } = {}) {
  closeShareMenu(); // a card rebuild (e.g. "Show another cat") orphans any open menu -- close it first
  const meta = [card.breed, card.age, card.sex].filter(Boolean).join(" · ");
  // While exploring, distanceMiles is measured from the explored city, not
  // the user — naming that city avoids the number reading as "from you".
  // In normal mode, locationLabel names what the distance is measured from
  // instead (a saved ZIP, or "from you" when only browser geolocation is on
  // file) — it arrives pre-phrased so callers can pick either wording.
  const distanceSuffix = exploreLabel ? ` from ${exploreLabel}` : locationLabel ? ` ${locationLabel}` : "";
  const distance = card.distanceMiles != null ? `${card.distanceMiles.toFixed(1)} mi away${distanceSuffix}` : null;
  const updatedAt = readingFormat(card.updatedAt);
  const chips = [card.isAdoptionPending && { label: "Adoption pending", className: "pending" }, card.isSpecialNeeds && { label: "Special needs", className: "special-needs" }].filter(Boolean);
  const rescueUrl = card.rescueUrl || card.profileUrl;
  const profileUrl = card.profileUrl;

  const cardContainer = $("card");
  cardContainer.className = "card";
  cardContainer.hidden = false;
  cardContainer.textContent = ""; // Clear securely

  const img = document.createElement("img");
  img.className = "photo";
  img.src = card.imageUrl;
  img.alt = card.name;
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => { showNotice("That photo is no longer available. Refresh to try another cat.", { type: "error" }); });
  img.addEventListener("load", () => {
    // A portrait-oriented photo (taller than wide) can't fill the card's
    // full width without either cropping or shrinking down to fit beside
    // empty letterbox space — there isn't a box tall enough to avoid both
    // (RescueGroups' CDN only resizes proportionally, it can't hand us a
    // pre-cropped or face-centered variant). Trading some width for a
    // taller box and a top-anchored crop keeps the photo large and the
    // subject's face/torso in frame, at the cost of some legs/tail. See the
    // MILD/TALL_PORTRAIT_HEIGHT_RATIO comment above for why this is two
    // graduated tiers rather than one.
    const isPortrait = img.naturalHeight > img.naturalWidth * MILD_PORTRAIT_HEIGHT_RATIO;
    if (img.naturalHeight > img.naturalWidth * TALL_PORTRAIT_HEIGHT_RATIO) {
      img.classList.add("photo-portrait");
    } else if (isPortrait) {
      img.classList.add("photo-portrait-mild");
    }
    if (isPortrait) applyContentAwareCrop(img, card.imageUrl);
  });
  cardContainer.appendChild(img);

  const content = document.createElement("div");
  content.className = "content";

  const h1 = document.createElement("h1");
  // Long names (or names with extra text) can't be caught by CSS alone --
  // wrapping and the vw-based clamp() in .name already absorb most of them,
  // but a genuinely long one still reads better a size down than
  // balance-wrapped at full size.
  h1.className = card.name.length > 18 ? "name name-long" : "name";
  h1.textContent = card.name;
  content.appendChild(h1);

  if (meta) {
    const metaP = document.createElement("p");
    metaP.className = "meta";
    metaP.textContent = meta;
    content.appendChild(metaP);
  }

  if (chips.length > 0) {
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "chips";
    for (const chip of chips) {
      const chipSpan = document.createElement("span");
      chipSpan.className = `chip ${chip.className}`;
      chipSpan.textContent = chip.label;
      chipsDiv.appendChild(chipSpan);
    }
    content.appendChild(chipsDiv);
  }

  if (card.adoptionFee) {
    const feeP = document.createElement("p");
    feeP.className = "fee";
    feeP.textContent = card.adoptionFee;
    content.appendChild(feeP);
  }

  if (distance) {
    const distP = document.createElement("p");
    distP.className = "distance";
    distP.textContent = distance;
    content.appendChild(distP);
  }

  if (updatedAt) {
    const updatedP = document.createElement("p");
    updatedP.className = "updated";
    updatedP.textContent = `Updated ${updatedAt}`;
    content.appendChild(updatedP);
  }

  const rescueP = document.createElement("p");
  rescueP.className = "rescue";
  if (rescueUrl) {
    const rescueA = document.createElement("a");
    rescueA.href = rescueUrl;
    rescueA.target = "_blank";
    rescueA.rel = "noreferrer";
    rescueA.textContent = card.rescueName;
    rescueP.appendChild(rescueA);
  } else {
    rescueP.textContent = card.rescueName;
  }
  content.appendChild(rescueP);

  const shareUrl = profileUrl || rescueUrl;
  if (profileUrl || shareUrl) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    if (profileUrl) {
      const profileA = document.createElement("a");
      profileA.className = "profile";
      profileA.href = profileUrl;
      profileA.target = "_blank";
      profileA.rel = "noreferrer";
      profileA.textContent = "View profile";
      actions.appendChild(profileA);
    }

    if (shareUrl) {
      actions.appendChild(buildShareControl(card, shareUrl));
    }

    content.appendChild(actions);
  }

  cardContainer.appendChild(content);

  showNotice(stale ? "Showing a recent saved match while we refresh." : "");
}

function buildShareIntro(card) {
  const meta = [card.breed, card.age, card.sex].filter(Boolean).join(", ");
  return meta ? `${card.name} (${meta}) is looking for a home at ${card.rescueName}.` : `${card.name} is looking for a home at ${card.rescueName}.`;
}

function buildShareText(card) {
  return `${buildShareIntro(card)}\n\n${TABBY_TAGLINE} Get Tabby: ${tabbyStoreUrl()}`;
}

// The profile link is embedded directly in the message (ahead of the Tabby
// plug, both on their own blank-separated line) so every text-based channel
// below shows the same, deliberately ordered copy (GitHub issue #35).
// Native share (see shareCard()) can't use this -- it hands `text` and `url`
// to the target app as two separate fields, and it's the target app, not
// Tabby, that decides how/where to rejoin them.
function buildShareMessage(card, shareUrl) {
  return `${buildShareIntro(card)}\n\n${shareUrl}\n\n${TABBY_TAGLINE} Get Tabby: ${tabbyStoreUrl()}`;
}

function openShareTarget(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// window.open('mailto:...') is unreliable in Chrome -- it silently does
// nothing in a lot of real-world configurations. A real anchor click is what
// browsers actually special-case for handing a non-http(s) scheme off to the
// OS/registered app without navigating this page.
function openMailto(url) {
  const link = document.createElement("a");
  link.href = url;
  link.click();
}

async function copyShareLink(card, shareUrl) {
  try {
    await navigator.clipboard.writeText(buildShareMessage(card, shareUrl));
    showNotice("Copied to clipboard.");
  } catch (error) {
    console.error("[tabby]", error);
    showNotice("Unable to copy the link. Try again.", { type: "error" });
  }
}

function sharePhotoUrl(card) {
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  return `${backendUrl}/api/photo-share?url=${encodeURIComponent(card.imageUrl)}`;
}

// Facebook only ever takes a URL -- it builds its own preview card by
// scraping that page's Open Graph tags, not from anything Tabby sends, and
// most rescues' RescueGroups-hosted pages don't have (correct) OG tags, so
// this one channel is stuck showing generic/missing content until the
// cat-details share page (tracked separately) replaces the raw profile link.
// Reddit and Pinterest sidestep that entirely -- their intents accept the
// title/image/description directly as params, so they show real cat details
// regardless of the rescue's own site. Text-composer channels (WhatsApp,
// email, Nextdoor, copy) get the fully composed message so their
// content/ordering is exact (issue #35), not left to how a native share
// target happens to join separate text/url fields back together.
const SHARE_CHANNELS = [
  { label: "WhatsApp", activate: (card, shareUrl) => openShareTarget(`https://wa.me/?text=${encodeURIComponent(buildShareMessage(card, shareUrl))}`) },
  { label: "Email", activate: (card, shareUrl) => openMailto(`mailto:?subject=${encodeURIComponent(`Meet ${card.name}`)}&body=${encodeURIComponent(buildShareMessage(card, shareUrl))}`) },
  { label: "X / Twitter", activate: (card, shareUrl) => openShareTarget(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareIntro(card))}&url=${encodeURIComponent(shareUrl)}`) },
  { label: "Facebook", activate: (_card, shareUrl) => openShareTarget(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`) },
  { label: "Reddit", activate: (card, shareUrl) => openShareTarget(`https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Meet ${card.name}`)}`) },
  { label: "Pinterest", activate: (card, shareUrl) => openShareTarget(`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&media=${encodeURIComponent(sharePhotoUrl(card))}&description=${encodeURIComponent(buildShareIntro(card))}`) },
  { label: "Nextdoor", activate: (card, shareUrl) => openShareTarget(`https://nextdoor.com/sharekit/?source=tabby&body=${encodeURIComponent(buildShareMessage(card, shareUrl))}`) },
  { label: "Copy link", activate: (card, shareUrl) => copyShareLink(card, shareUrl) }
];

const IMAGE_CONTENT_TYPE_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// RescueGroups' CDN has no CORS headers (see applyContentAwareCrop's comment
// above), so a client-side fetch of the photo itself would be opaque/blocked
// the same way a canvas read would be -- routing through our own
// /api/photo-share proxy (CORS-safe, hostname-locked, forced to a
// share-appropriate size server-side) is what makes a real File object
// obtainable here at all.
async function fetchSharePhoto(imageUrl) {
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  const response = await fetch(`${backendUrl}/api/photo-share?url=${encodeURIComponent(imageUrl)}`, { signal: AbortSignal.timeout(PHOTO_SHARE_TIMEOUT_MS) });
  if (!response.ok) throw new Error("Could not fetch photo for sharing.");
  const blob = await response.blob();
  const extension = IMAGE_CONTENT_TYPE_EXTENSIONS[blob.type] || "jpg";
  return new File([blob], `cat.${extension}`, { type: blob.type || "image/jpeg" });
}

// Tries to attach the actual photo (issue #27 calls this the most important
// part of the share), then degrades in two steps if that's not possible:
// first to a link-only native share, then -- if navigator.share itself
// fails or was never available -- to copying the details to the clipboard.
async function shareCard(card, shareUrl) {
  const text = buildShareText(card);
  const shareData = { title: `Meet ${card.name}`, text, url: shareUrl };

  try {
    const photoFile = await fetchSharePhoto(card.imageUrl);
    if (navigator.canShare?.({ files: [photoFile] })) {
      shareData.files = [photoFile];
    }
  } catch (error) {
    console.error("[tabby]", error); // Photo unavailable -- share the link and text without it.
  }

  try {
    await navigator.share(shareData);
  } catch (error) {
    if (error?.name === "AbortError") return; // The user closed the share sheet -- not a failure.
    console.error("[tabby]", error);
    await copyShareLink(card, shareUrl);
  }
}

// Reassigned to a real cleanup closure whenever a menu is open, and reset to
// a no-op once it closes -- renderCard() calls this unconditionally on every
// rebuild so a stale menu from a previous card never lingers.
let closeShareMenu = () => {};

function buildShareMenuItem(label, onActivate) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "share-menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", () => {
    closeShareMenu();
    onActivate();
  });
  return item;
}

// Opens below the button by default, but flips above it when there isn't
// enough room left in the viewport -- the Share button sits near the bottom
// of the card, which is often already near the bottom of the screen, so an
// always-downward menu regularly left its lower items unreachable without
// scrolling.
function positionShareMenu(menu, toggleButton) {
  const rect = toggleButton.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  const fitsBelow = rect.bottom + 6 + menuRect.height <= window.innerHeight - 8;
  const top = fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menuRect.height);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));

  menu.style.top = `${Math.min(top, window.innerHeight - menuRect.height - 8)}px`;
  menu.style.left = `${left}px`;
}

// Rendered into document.body at a fixed position computed from the toggle
// button's own rect, rather than nested inside it -- .card clips its
// contents with overflow: hidden (for the photo's rounded corners), which
// would silently cut off a menu positioned inside that subtree.
function openShareMenu(card, shareUrl, toggleButton) {
  const menu = document.createElement("div");
  menu.className = "share-menu";
  menu.setAttribute("role", "menu");

  for (const channel of SHARE_CHANNELS) {
    menu.appendChild(buildShareMenuItem(channel.label, () => channel.activate(card, shareUrl)));
  }
  // The one channel that can't be built from a plain URL/mailto -- it needs
  // whatever's actually registered as a share target on this device (and,
  // when supported, the photo file itself), which only the Web Share API
  // has access to.
  if (typeof navigator.share === "function") {
    menu.appendChild(buildShareMenuItem("More options…", () => shareCard(card, shareUrl)));
  }

  document.body.appendChild(menu);
  positionShareMenu(menu, toggleButton);
  toggleButton.setAttribute("aria-expanded", "true");

  const onOutsideClick = (event) => {
    if (!menu.contains(event.target) && event.target !== toggleButton) closeShareMenu();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") closeShareMenu();
  };
  // Deferred so the same click that opened the menu doesn't immediately
  // close it again via this listener.
  setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
  document.addEventListener("keydown", onKeydown);

  closeShareMenu = () => {
    menu.remove();
    toggleButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("keydown", onKeydown);
    closeShareMenu = () => {};
  };
}

function buildShareControl(card, shareUrl) {
  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.className = "share";
  shareButton.textContent = `Share ${card.name}`;
  shareButton.setAttribute("aria-haspopup", "true");
  shareButton.setAttribute("aria-expanded", "false");
  shareButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = shareButton.getAttribute("aria-expanded") === "true";
    closeShareMenu();
    if (!wasOpen) openShareMenu(card, shareUrl, shareButton);
  });
  return shareButton;
}

async function resolveLocation(settings, promptForLocation) {
  const savedLocation = settings?.location;
  if (savedLocation && Number.isFinite(savedLocation.lat) && Number.isFinite(savedLocation.lon)) {
    return { lat: savedLocation.lat, lon: savedLocation.lon };
  }
  if (promptForLocation) {
    try {
      const browserLocation = await locationFromBrowser();
      const nextSettings = { ...settings, location: browserLocation };
      await storageSet({ settings: nextSettings });
      return browserLocation;
    } catch { /* ZIP fallback below */ }
  }
  return /^\d{5}$/.test(settings.postalcode || "") ? { postalcode: settings.postalcode } : null;
}

function sameLocation(a, b) {
  return Boolean(a) && Boolean(b) && JSON.stringify(a) === JSON.stringify(b);
}

async function fetchCatsPage(location, page) {
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  const response = await fetch(`${backendUrl}/api/nearby-cats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, page }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not refresh cats.");
  return response.json();
}

// Appends the cards from `incomingCards` that aren't already in `keptCards`
// or in `excludeIds` (cards the user has already seen and dropped) — used to
// merge a freshly-fetched page into the kept unseen remainder without
// duplicating anything or letting a seen card quietly sneak back in.
function mergeCards(keptCards, incomingCards, excludeIds = []) {
  const knownIds = new Set([...keptCards.map((card) => card.id), ...excludeIds]);
  const freshCards = incomingCards.filter((card) => !knownIds.has(card.id));
  return [...keptCards, ...freshCards];
}

async function refresh(location, locationLabel) {
  const { feedCache } = await storageGet(["feedCache"]);
  const isRepeatLocation = sameLocation(feedCache?.location, location) && Boolean(feedCache?.cards?.length);
  const priorSeenIds = isRepeatLocation ? getSeenIds(feedCache) : [];
  // Only the *seen* cards are dropped on a refresh — whatever the user
  // hasn't looked at yet survives and is topped up with new cards below,
  // rather than being discarded wholesale.
  const priorSeenIdSet = new Set(priorSeenIds);
  const keptUnseenCards = isRepeatLocation ? feedCache.cards.filter((card) => !priorSeenIdSet.has(card.id)) : [];
  let page = isRepeatLocation ? (feedCache.page || 1) + 1 : 1;
  let feed = await fetchCatsPage(location, page);
  let mergedCards = mergeCards(keptUnseenCards, feed.cards || [], priorSeenIds);

  // `exhausted` means this page's cumulative unique count (across the radius
  // ladder) fell short of the target — it can still carry a non-empty page.
  // Only an exhausted page that's also empty means we've paged past the end
  // of what this location has, as opposed to this location having nothing at
  // all (which page 1 coming back empty+exhausted would mean). In that case,
  // restart pagination at page 1 rather than dead-ending on "no cats found"
  // — the location isn't out of cats, just out of new pages. Previously-seen
  // cards are allowed to resurface here (only the still-unseen leftovers are
  // excluded, to avoid an immediate duplicate).
  if (!feed.cards?.length && feed.exhausted && page > 1) {
    page = 1;
    feed = await fetchCatsPage(location, page);
    mergedCards = mergeCards(keptUnseenCards, feed.cards || []);
  }

  const nextCache = { cards: mergedCards, fetchedAt: Date.now(), radiusMiles: feed.radiusMiles || feedCache?.radiusMiles || 0, location, page, seenIds: [] };
  await storageSet({ feedCache: nextCache });
  if (!mergedCards.length) {
    setCardVisible(false);
    $("location-panel").hidden = true;
    showNotice(`No available cats were found within ${nextCache.radiusMiles} miles. Try using a different {zip} or {explore}.`, { links: NO_RESULTS_LINKS, type: "error" });
    return;
  }
  // Every card in mergedCards is guaranteed unseen (seen ones were dropped,
  // and the fetch was deduped against the prior seenIds), so seenIds starts
  // empty here — carrying forward stale ids that no longer match any card in
  // the pool would inflate _start()'s seen-ratio math against a phantom count.
  const { selected, nextSeenIds } = nextCard(mergedCards, []);
  const finalCache = { ...nextCache, seenIds: nextSeenIds };
  await storageSet({ feedCache: finalCache });
  $("location-panel").hidden = true;
  renderCard(selected, { locationLabel });
}

async function _start({ requestLocation = false } = {}) {
  setCardVisible(false);
  const { settings = { postalcode: "", location: null }, feedCache } = await storageGet(["settings", "feedCache"]);
  const resolvedSettings = {
    postalcode: settings.postalcode || "",
    location: settings.location || null
  };
  const locationLabel = resolvedSettings.postalcode ? `from ${resolvedSettings.postalcode}` : "from you";
  const age = feedCache ? Date.now() - feedCache.fetchedAt : Infinity;
  const seenRatio = feedCache?.cards?.length ? getSeenIds(feedCache).length / feedCache.cards.length : 1;
  const shouldRefresh = !feedCache?.cards?.length || (age >= FRESH_MS && seenRatio >= SEEN_REFRESH_RATIO);
  if (feedCache?.cards?.length) {
    const { selected, nextSeenIds } = nextCard(feedCache.cards, getSeenIds(feedCache));
    await storageSet({ feedCache: { ...feedCache, seenIds: nextSeenIds } });
    renderCard(selected, { stale: shouldRefresh, locationLabel });
  } else if (feedCache && !feedCache.cards?.length) {
    showNotice(`No available cats were found within ${feedCache.radiusMiles || 0} miles. Try using a different {zip} or {explore}.`, { links: NO_RESULTS_LINKS, type: "error" });
  }
  const location = await resolveLocation(resolvedSettings, requestLocation);
  if (!location) {
    $("location-panel").hidden = false;
    if (requestLocation) {
      showNotice("Unable to determine your location. Try entering a {zip} instead.", { links: [{ ...ZIP_SETTINGS_LINK, token: "zip" }], type: "error" });
    }
    return;
  }
  $("location-panel").hidden = true;
  if (shouldRefresh) {
    try { await refresh(location, locationLabel); } catch (error) {
      console.error("[tabby]", error);
      const finalMessage = classifyRefreshError(error.message);
      // A ZIP-validation failure already carries enough detail to know it's
      // a user issue, so it keeps the settings shortcut instead — the
      // report-issue link is for failures that might actually be our bug.
      const noticeOptions = isInvalidZipError(error.message)
        ? { links: [ZIP_SETTINGS_LINK], type: "error" }
        : { links: [{ text: "Report an issue", action: "report-issue" }], type: "error" };
      showNotice(finalMessage, noticeOptions);
      if (!feedCache?.cards?.length) $("location-panel").hidden = false;
    }
  }
}

function start(options = {}) {
  if (inFlight) return inFlight;
  inFlight = _start(options).finally(() => { inFlight = null; });
  return inFlight;
}

// Exploring never touches the `feedCache` storage key, so it can't clobber
// the user's real cache. State lives only in this tab's memory (exploreBatch
// plus the DOM's hidden explore-banner) — reloading the new tab always
// returns to the user's own location, which is the desired "transient"
// behavior. The full fetched batch (not just the one shown card) is kept so
// "Show another cat" can cycle through it without a second network call.
let exploreBatch = null; // { label, cards, seenIds } while exploring, else null

async function exploreArea() {
  const entry = EXPLORE_LOCATIONS[Math.floor(Math.random() * EXPLORE_LOCATIONS.length)];
  const backendUrl = BACKEND_URL.replace(/\/$/, "");
  try {
    const response = await fetch(`${backendUrl}/api/nearby-cats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { lat: entry.lat, lon: entry.lon }, page: 1 }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not explore that area.");
    const feed = await response.json();
    if (!feed.cards?.length) {
      exploreBatch = null;
      hideExploreBanner();
      showNotice(`No available cats were found near ${entry.label}. Try exploring again.`, { type: "error" });
      return;
    }
    const { selected, nextSeenIds } = nextCard(feed.cards, []);
    exploreBatch = { label: entry.label, cards: feed.cards, seenIds: nextSeenIds };
    $("location-panel").hidden = true;
    renderCard(selected, { exploreLabel: entry.label });
    showExploreBanner(entry.label);
  } catch (error) {
    console.error("[tabby]", error);
    exploreBatch = null;
    hideExploreBanner();
    showNotice("Unable to explore that area right now. Try again.", { type: "error" });
  }
}

async function startExplore() {
  showNotice("Exploring a new area…");
  await exploreArea();
}

function showAnotherExploreCard() {
  if (!exploreBatch) return;
  const { selected, nextSeenIds } = nextCard(exploreBatch.cards, exploreBatch.seenIds);
  exploreBatch = { ...exploreBatch, seenIds: nextSeenIds };
  renderCard(selected, { exploreLabel: exploreBatch.label });
}

function openSettings() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("extension/options.html") });
      return;
    }
    chrome.runtime.openOptionsPage();
  });
}

$("settings").addEventListener("click", openSettings);
$("use-location").addEventListener("click", async () => {
  $("location-panel").hidden = true;
  showNotice("Finding your location…");
  await start({ requestLocation: true });
});
$("open-settings").addEventListener("click", openSettings);
$("explore").addEventListener("click", startExplore);
$("show-another-explore-cat").addEventListener("click", () => showAnotherExploreCard());
$("back-to-my-area").addEventListener("click", async () => {
  exploreBatch = null;
  hideExploreBanner();
  await start();
});
start();
