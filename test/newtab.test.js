import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.js'), 'utf-8');
const errorMsgsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'error-messages.js'), 'utf-8').replace('export function', 'function');
const configContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'config.js'), 'utf-8').replace('export const', 'const');
const locationContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'location.js'), 'utf-8').replace('export async function', 'async function');

function inlineScript(source) {
  return source
    .replace(/import \{ classifyRefreshError \} from "\.\/error-messages\.js";/, errorMsgsContent)
    .replace(/import \{ BACKEND_URL \} from "\.\/config\.js";/, configContent)
    .replace(/import \{ locationFromBrowser \} from "\.\/location\.js";/, locationContent);
}

describe('newtab.js DOM manipulation', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM(htmlContent, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;

    // Mock chrome APIs
    window.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => ({})
        }
      },
      runtime: {
        openOptionsPage: () => {},
        getURL: (path) => `chrome-extension://fake-id/${path}`
      },
      tabs: {
        query: (_query, callback) => callback([{ id: 1 }]),
        update: () => {}
      }
    };

    // Inject the js
    const scriptEl = document.createElement('script');
    scriptEl.textContent = inlineScript(jsContent);
    document.body.appendChild(scriptEl);
  });

  it('showNotice creates safe DOM elements without innerHTML', () => {
    // Call showNotice on the window context
    window.showNotice("Hello World", { linkText: "Click Me", linkAction: "open-settings" });

    const notice = document.getElementById("notice");
    assert.equal(notice.childNodes.length, 2);

    const textNode = notice.childNodes[0];
    assert.equal(textNode.nodeType, 3); // TEXT_NODE
    assert.equal(textNode.textContent, "Hello World ");

    const button = notice.childNodes[1];
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.textContent, "Click Me");
    assert.equal(button.className, "notice-link");
    assert.equal(button.dataset.action, "open-settings");

    // Attempt an XSS
    window.showNotice("<img src=x onerror=alert(1)>", { linkText: "<script>alert(2)</script>", linkAction: '">XSS' });
    assert.equal(notice.childNodes[0].textContent, "<img src=x onerror=alert(1)> ");
    assert.equal(notice.childNodes[1].textContent, "<script>alert(2)</script>");
    assert.equal(notice.childNodes[1].dataset.action, '\">XSS');

    // Ensure no HTML elements were created by accident
    assert.equal(notice.querySelector('img'), null);
    assert.equal(notice.querySelector('script'), null);
  });

  it('renderCard creates safe DOM elements without innerHTML', () => {
    const cardData = {
      name: "<script>alert('name')</script>",
      breed: "Tabby",
      age: "Adult",
      sex: "Male",
      distanceMiles: 5.5,
      updatedAt: new Date().toISOString(),
      rescueName: "<img src=x onerror=alert('rescue')>",
      rescueUrl: "https://rescue.org",
      profileUrl: "https://profile.org",
      imageUrl: "https://image.org/cat.jpg",
      isAdoptionPending: true,
      isSpecialNeeds: true,
      adoptionFee: "$50"
    };

    window.renderCard(cardData, { stale: false });

    const card = document.getElementById("card");
    const h1 = card.querySelector('h1');
    assert.equal(h1.textContent, "<script>alert('name')</script>");

    const rescueP = card.querySelector('.rescue');
    const rescueA = rescueP.querySelector('a');
    assert.equal(rescueA.textContent, "<img src=x onerror=alert('rescue')>");

    // Ensure scripts and images weren't actually injected as HTML
    assert.equal(card.querySelectorAll('script').length, 0);
    // There should be exactly 1 image (the main cat photo)
    assert.equal(card.querySelectorAll('img').length, 1);

    const chips = card.querySelectorAll('.chip');
    assert.equal(chips.length, 2, "adoption fee is its own line now, not a chip");
    assert.equal(chips[0].textContent, "Adoption pending");
    assert.ok(chips[0].classList.contains('pending'));
    assert.equal(chips[1].textContent, "Special needs");
    assert.ok(chips[1].classList.contains('special-needs'));

    const fee = card.querySelector('.fee');
    assert.equal(fee.textContent, "$50");
  });
  describe('renderCard long-name handling', () => {
    it('adds the name-long modifier once the name passes 18 characters', () => {
      window.renderCard({ name: "Sir Reginald Fluffington III" });
      const h1 = document.querySelector('#card h1');
      assert.ok(h1.classList.contains('name'));
      assert.ok(h1.classList.contains('name-long'));
    });

    it('leaves short names on the default size', () => {
      window.renderCard({ name: "Milo" });
      const h1 = document.querySelector('#card h1');
      assert.ok(h1.classList.contains('name'));
      assert.equal(h1.classList.contains('name-long'), false);
    });
  });
  describe('showNotice error vs. informational tone', () => {
    it('defaults to informational: no notice-error class, no warning icon', () => {
      window.showNotice("Finding your location…");
      const notice = document.getElementById("notice");
      assert.equal(notice.classList.contains('notice-error'), false);
      assert.equal(notice.textContent, "Finding your location…");
    });

    it('marks error notices with notice-error and a visible warning icon', () => {
      window.showNotice("Unable to refresh nearby cats right now.", { type: "error" });
      const notice = document.getElementById("notice");
      assert.ok(notice.classList.contains('notice-error'));
      const icon = notice.querySelector('[aria-hidden="true"]');
      assert.ok(icon, "expected an aria-hidden icon element");
      assert.ok(notice.textContent.includes("Unable to refresh nearby cats right now."));
    });

    it('clears the notice-error class when a later info notice replaces an error one', () => {
      window.showNotice("Something went wrong.", { type: "error" });
      window.showNotice("Finding your location…");
      const notice = document.getElementById("notice");
      assert.equal(notice.classList.contains('notice-error'), false);
    });
  });
  describe('Settings buttons', () => {
    it('#settings replaces the current tab with the options page instead of opening a new one', () => {
      let updatedTabId, updatedProps;
      window.chrome.tabs.update = (tabId, props) => { updatedTabId = tabId; updatedProps = props; };
      let openedOptionsPage = false;
      window.chrome.runtime.openOptionsPage = () => { openedOptionsPage = true; };

      document.getElementById("settings").click();

      assert.equal(updatedTabId, 1);
      assert.equal(updatedProps.url, "chrome-extension://fake-id/extension/options.html");
      assert.equal(openedOptionsPage, false);
    });

    it('#open-settings (shown in the "no cats found" notice) also replaces the current tab', () => {
      let updatedProps;
      window.chrome.tabs.update = (_tabId, props) => { updatedProps = props; };

      document.getElementById("open-settings").click();

      assert.equal(updatedProps.url, "chrome-extension://fake-id/extension/options.html");
    });

    it('falls back to openOptionsPage when there is no active tab to replace', () => {
      window.chrome.tabs.query = (_query, callback) => callback([]);
      let openedOptionsPage = false;
      window.chrome.runtime.openOptionsPage = () => { openedOptionsPage = true; };

      document.getElementById("settings").click();

      assert.equal(openedOptionsPage, true);
    });
  });
  describe('renderCard location label (normal mode)', () => {
    it('shows the saved ZIP as the distance basis when locationLabel is "from <zip>"', () => {
      window.renderCard({ name: "Milo", distanceMiles: 5.5 }, { locationLabel: "from 97703" });
      assert.equal(document.querySelector('.distance').textContent, "5.5 mi away from 97703");
    });

    it('shows a "near you" fallback when locationLabel is set that way', () => {
      window.renderCard({ name: "Milo", distanceMiles: 5.5 }, { locationLabel: "near you" });
      assert.equal(document.querySelector('.distance').textContent, "5.5 mi away near you");
    });

    it('exploreLabel takes priority over locationLabel if both are somehow passed', () => {
      window.renderCard({ name: "Milo", distanceMiles: 5.5 }, { locationLabel: "near you", exploreLabel: "Chicago, IL" });
      assert.equal(document.querySelector('.distance').textContent, "5.5 mi away from Chicago, IL");
    });

    it('omits the basis entirely when no label is passed', () => {
      window.renderCard({ name: "Milo", distanceMiles: 5.5 });
      assert.equal(document.querySelector('.distance').textContent, "5.5 mi away");
    });
  });
  it('switches a strongly portrait-oriented photo to the tall, top-anchored crop once it loads', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    assert.equal(img.classList.contains('photo-portrait'), false, 'should not switch before natural dimensions are known');

    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.ok(img.classList.contains('photo-portrait'));
    assert.equal(img.classList.contains('photo-portrait-mild'), false);
  });
  it('leaves a landscape or square photo on the default box and crop', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.equal(img.classList.contains('photo-portrait'), false);
    assert.equal(img.classList.contains('photo-portrait-mild'), false);
  });
  it('leaves a near-square photo (technically taller than wide, but not by much) on the default crop', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    // Real-world example: 500x508 intrinsic size, reported as looking too
    // close to square to be worth the portrait treatment.
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 508, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.equal(img.classList.contains('photo-portrait'), false);
    assert.equal(img.classList.contains('photo-portrait-mild'), false);
  });
  it('switches to the mild portrait treatment once a photo clears the near-square tolerance', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    // Just over the 1.1x mild tolerance (500 * 1.1 = 550) — pins the exact cutoff.
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 560, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.ok(img.classList.contains('photo-portrait-mild'));
    assert.equal(img.classList.contains('photo-portrait'), false, 'a mild portrait should not also get the tall treatment');
  });
  it('stays on the mild portrait treatment just under the tall-portrait threshold', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    // Just under the 1.35x tall threshold (500 * 1.35 = 675).
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 674, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.ok(img.classList.contains('photo-portrait-mild'));
    assert.equal(img.classList.contains('photo-portrait'), false);
  });
  it('switches to the tall portrait treatment once a photo clears the tall-portrait threshold', () => {
    window.renderCard({ name: "Milo", imageUrl: "https://image.org/cat.jpg" });

    const img = document.querySelector('.photo');
    // Just over the 1.35x tall threshold (500 * 1.35 = 675).
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 676, configurable: true });
    img.dispatchEvent(new window.Event('load'));

    assert.ok(img.classList.contains('photo-portrait'));
    assert.equal(img.classList.contains('photo-portrait-mild'), false, 'a tall portrait should not also carry the mild class');
  });
  it('getSeenIds treats a null or missing feedCache as no seen ids', () => {
    assert.deepEqual(window.getSeenIds(null), []);
    assert.deepEqual(window.getSeenIds(undefined), []);
    assert.deepEqual(window.getSeenIds({}), []);
    assert.deepEqual(window.getSeenIds({ seenIds: ['1', '2'] }), ['1', '2']);
  });
  it('nextCard selects unseen cards and updates seenIds correctly', () => {
    const cards = [
      { id: '1', name: 'Cat 1' },
      { id: '2', name: 'Cat 2' },
      { id: '3', name: 'Cat 3' }
    ];

    // 1. Normal unseen-pool selection
    let { selected, nextSeenIds } = window.nextCard(cards, []);
    assert.ok(['1', '2', '3'].includes(selected.id));
    assert.deepEqual(nextSeenIds, [selected.id]);

    let { selected: selected2, nextSeenIds: nextSeenIds2 } = window.nextCard(cards, nextSeenIds);
    assert.ok(['1', '2', '3'].includes(selected2.id));
    assert.notEqual(selected.id, selected2.id);
    assert.equal(nextSeenIds2.length, 2);
    assert.ok(nextSeenIds2.includes(selected.id));
    assert.ok(nextSeenIds2.includes(selected2.id));

    let { selected: selected3, nextSeenIds: nextSeenIds3 } = window.nextCard(cards, nextSeenIds2);
    assert.ok(['1', '2', '3'].includes(selected3.id));
    assert.notEqual(selected.id, selected3.id);
    assert.notEqual(selected2.id, selected3.id);
    assert.equal(nextSeenIds3.length, 3);
    assert.ok(nextSeenIds3.includes(selected.id));
    assert.ok(nextSeenIds3.includes(selected2.id));
    assert.ok(nextSeenIds3.includes(selected3.id));

    // 2. The reset case: all cards have been seen
    // At this point, nextSeenIds3 has all ids.
    let { selected: resetSelected, nextSeenIds: resetSeenIds } = window.nextCard(cards, nextSeenIds3);
    assert.ok(['1', '2', '3'].includes(resetSelected.id));
    assert.deepEqual(resetSeenIds, [resetSelected.id], "reset seenIds should only contain the newly selected id");

    // Ensure the next card selected after reset is not the same as the reset card
    let { selected: afterResetSelected, nextSeenIds: afterResetSeenIds } = window.nextCard(cards, resetSeenIds);
    assert.notEqual(resetSelected.id, afterResetSelected.id, "selected card differs from what would repeat a stale id");
    assert.deepEqual(afterResetSeenIds.sort(), [resetSelected.id, afterResetSelected.id].sort());
  });

  describe('resolveLocation', () => {
    it('returns saved location if valid', async () => {
      const result = await window.resolveLocation({ location: { lat: 10, lon: 20 } }, true);
      assert.deepEqual(result, { lat: 10, lon: 20 });
    });

    it('prompts browser if requested and no saved location', async () => {
      window.navigator.geolocation = {
        getCurrentPosition: (success) => success({ coords: { latitude: 30, longitude: 40 } })
      };
      let savedSettings;
      window.chrome.storage.local.set = async (val) => { savedSettings = val; };

      const result = await window.resolveLocation({}, true);
      assert.deepEqual(result, { lat: 30, lon: 40 });
      assert.deepEqual(savedSettings, { settings: { location: { lat: 30, lon: 40 } } });
    });

    it('falls back to ZIP if prompt fails', async () => {
      window.navigator.geolocation = {
        getCurrentPosition: (success, error) => error(new Error("denied"))
      };
      const result = await window.resolveLocation({ postalcode: '12345' }, true);
      assert.deepEqual(result, { postalcode: '12345' });
    });

    it('falls back to ZIP if not prompting and no saved location', async () => {
      const result = await window.resolveLocation({ postalcode: '12345' }, false);
      assert.deepEqual(result, { postalcode: '12345' });
    });

    it('returns null if no location can be resolved', async () => {
      const result = await window.resolveLocation({}, false);
      assert.strictEqual(result, null);
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      window.chrome.storage.local.get = async () => ({ feedCache: {} });
    });

    it('does not throw when stored feedCache is null (e.g. after a prior failed refresh)', async () => {
      window.chrome.storage.local.get = async () => ({ feedCache: null });
      let savedCache;
      window.chrome.storage.local.set = async (val) => {
        if (val.feedCache) savedCache = val.feedCache;
      };
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 10 })
      });

      await window.refresh({ postalcode: '12345' });

      assert.ok(savedCache);
      assert.deepEqual(savedCache.seenIds, ['1']);
    });

    it('updates cache and renders card on success', async () => {
      let savedCache;
      window.chrome.storage.local.set = async (val) => {
        if (val.feedCache) savedCache = val.feedCache;
      };
      let fetchedUrl;
      window.fetch = async (url) => {
        fetchedUrl = url;
        return {
          ok: true,
          json: async () => ({
            cards: [{ id: '1', name: 'Cat1' }],
            radiusMiles: 10
          })
        };
      };

      await window.refresh({ postalcode: '12345' });
      assert.equal(fetchedUrl, 'http://localhost:8787/api/nearby-cats');
      assert.ok(savedCache);
      assert.equal(savedCache.cards.length, 1);
      assert.equal(savedCache.radiusMiles, 10);
      assert.deepEqual(savedCache.seenIds, ['1']);

      const card = document.getElementById("card");
      assert.equal(card.hidden, false);
      assert.equal(card.querySelector('h1').textContent, 'Cat1');

      const notice = document.getElementById("notice");
      assert.equal(notice.textContent, "");
    });

    it('shows notice and hides card on empty results', async () => {
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [], radiusMiles: 5 })
      });

      await window.refresh({ postalcode: '12345' });
      const card = document.getElementById("card");
      const notice = document.getElementById("notice");
      assert.equal(card.hidden, true);
      assert.ok(notice.textContent.includes('No available cats'));
      assert.ok(notice.classList.contains('notice-error'), "an empty-results notice needs the user to act, so it should read as an error");
    });

    it('resets to page 1 when a later page comes back exhausted and empty', async () => {
      window.chrome.storage.local.get = async () => ({
        feedCache: { cards: [{ id: '1' }], fetchedAt: Date.now(), location: { postalcode: '12345' }, page: 4, seenIds: ['1'] }
      });
      let savedCache;
      window.chrome.storage.local.set = async (val) => { if (val.feedCache) savedCache = val.feedCache; };
      const requestedPages = [];
      window.fetch = async (url, opts) => {
        const { page } = JSON.parse(opts.body);
        requestedPages.push(page);
        if (page === 5) return { ok: true, json: async () => ({ cards: [], radiusMiles: 250, exhausted: true }) };
        return { ok: true, json: async () => ({ cards: [{ id: 'p1cat', name: 'Cat1' }], radiusMiles: 250, exhausted: true }) };
      };

      await window.refresh({ postalcode: '12345' });

      assert.deepEqual(requestedPages, [5, 1], 'page 5 came back empty+exhausted, so it should retry at page 1');
      assert.equal(savedCache.page, 1);
      assert.equal(savedCache.cards.length, 1);
      const card = document.getElementById("card");
      assert.equal(card.hidden, false, 'a successful page-1 retry should render a card, not the dead-end notice');
    });

    it('does not retry and shows the dead-end notice when page 1 itself is exhausted and empty', async () => {
      window.chrome.storage.local.get = async () => ({ feedCache: null });
      const requestedPages = [];
      window.fetch = async (url, opts) => {
        requestedPages.push(JSON.parse(opts.body).page);
        return { ok: true, json: async () => ({ cards: [], radiusMiles: 250, exhausted: true }) };
      };

      await window.refresh({ postalcode: '99999' });

      assert.deepEqual(requestedPages, [1], 'page 1 empty+exhausted means no cats anywhere nearby, not a pagination overrun — no retry');
      const card = document.getElementById("card");
      const notice = document.getElementById("notice");
      assert.equal(card.hidden, true);
      assert.ok(notice.textContent.includes('No available cats'));
    });

    it('does not retry when a later page is empty but not exhausted', async () => {
      window.chrome.storage.local.get = async () => ({
        feedCache: { cards: [{ id: '1' }], fetchedAt: Date.now(), location: { postalcode: '12345' }, page: 2, seenIds: ['1'] }
      });
      const requestedPages = [];
      window.fetch = async (url, opts) => {
        requestedPages.push(JSON.parse(opts.body).page);
        return { ok: true, json: async () => ({ cards: [], radiusMiles: 250, exhausted: false }) };
      };

      await window.refresh({ postalcode: '12345' });

      assert.deepEqual(requestedPages, [3], 'not exhausted means this is just a gap page, not the end of pagination — no retry');
      const notice = document.getElementById("notice");
      assert.ok(notice.textContent.includes('No available cats'));
    });

    it('throws error on failure', async () => {
      window.fetch = async () => ({
        ok: false,
        json: async () => ({ error: "Server error" })
      });

      try {
        await window.refresh({ postalcode: '12345' });
        assert.fail('should have thrown');
      } catch (e) {
        assert.equal(e.message, "Server error");
      }
    });

    it('requests page 1 for a brand-new location with no prior cache', async () => {
      window.chrome.storage.local.get = async () => ({ feedCache: null });
      let fetchedBody;
      window.fetch = async (url, opts) => {
        fetchedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 10 }) };
      };

      await window.refresh({ postalcode: '12345' });
      assert.deepEqual(fetchedBody, { location: { postalcode: '12345' }, page: 1 });
    });

    it('advances to the next page on a repeat refresh for the same location', async () => {
      window.chrome.storage.local.get = async () => ({
        feedCache: { cards: [{ id: '1' }], fetchedAt: Date.now(), location: { postalcode: '12345' }, page: 1, seenIds: ['1'] }
      });
      let fetchedBody;
      window.fetch = async (url, opts) => {
        fetchedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ cards: [{ id: '2', name: 'Cat2' }], radiusMiles: 10 }) };
      };

      await window.refresh({ postalcode: '12345' });
      assert.deepEqual(fetchedBody, { location: { postalcode: '12345' }, page: 2 });
    });

    it('resets to page 1 when the location has changed since the last cache', async () => {
      window.chrome.storage.local.get = async () => ({
        feedCache: { cards: [{ id: '1' }], fetchedAt: Date.now(), location: { postalcode: '12345' }, page: 3, seenIds: ['1'] }
      });
      let fetchedBody;
      window.fetch = async (url, opts) => {
        fetchedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ cards: [{ id: '2', name: 'Cat2' }], radiusMiles: 10 }) };
      };

      await window.refresh({ postalcode: '99999' });
      assert.deepEqual(fetchedBody, { location: { postalcode: '99999' }, page: 1 });
    });

    it('stores the fetched location and page on the resulting feedCache', async () => {
      window.chrome.storage.local.get = async () => ({ feedCache: null });
      let savedCache;
      window.chrome.storage.local.set = async (val) => { if (val.feedCache) savedCache = val.feedCache; };
      window.fetch = async () => ({ ok: true, json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 10 }) });

      await window.refresh({ postalcode: '12345' });
      assert.deepEqual(savedCache.location, { postalcode: '12345' });
      assert.equal(savedCache.page, 1);
    });
  });

  describe('start', () => {
    let mockStart;

    beforeEach(() => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345' },
        feedCache: null
      });
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 10 })
      });
    });

    it('handles fresh cache', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: '1', name: 'Cat1' }],
          fetchedAt: Date.now() - (1000 * 60), // 1 min old (fresh)
          seenIds: []
        }
      });

      let fetchCalled = false;
      window.fetch = async () => { fetchCalled = true; };

      await window.start();

      assert.equal(fetchCalled, false);
      const card = document.getElementById("card");
      assert.equal(card.hidden, false);
      assert.equal(card.querySelector('h1').textContent, 'Cat1');
    });

    it('handles stale-while-revalidate', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: '1', name: 'CatStale' }],
          fetchedAt: Date.now() - (1000 * 60 * 10), // 10 mins old (stale but valid)
          seenIds: ['1'] // fully seen, so the seen-ratio gate allows a refresh
        }
      });

      let fetchCalled = false;
      window.fetch = async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ cards: [{ id: '2', name: 'CatFresh' }], radiusMiles: 10 })
        };
      };

      // We await the returned promise from start()
      await window.start();

      assert.equal(fetchCalled, true);
      const card = document.getElementById("card");
      assert.equal(card.hidden, false);
      // Because we awaited start(), refresh has finished and we see the fresh cat.
      // (Wait, actually in _start the stale card is rendered *first*, then refresh is awaited and renders the fresh one.)
      assert.equal(card.querySelector('h1').textContent, 'CatFresh');
    });

    it('does not refresh when stale-by-time but under half the cache has been seen', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: '1', name: 'CatA' }, { id: '2', name: 'CatB' }],
          fetchedAt: Date.now() - (1000 * 60 * 10), // 10 mins old (stale but valid, under STALE_MS)
          seenIds: [] // 0 of 2 seen — under the 50% refresh threshold
        }
      });

      let fetchCalled = false;
      window.fetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({ cards: [], radiusMiles: 10 }) };
      };

      await window.start();

      assert.equal(fetchCalled, false, 'a stale-by-time cache with a low seen ratio should not trigger a background refresh');
      const card = document.getElementById("card");
      assert.equal(card.hidden, false);
      assert.ok(['CatA', 'CatB'].includes(card.querySelector('h1').textContent));
      // No refresh is actually happening, so the "while we refresh" notice must not show.
      assert.equal(document.getElementById("notice").textContent, "");
    });

    it('refreshes once the hard STALE_MS cutoff is hit, even with a low seen ratio', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: '1', name: 'CatA' }, { id: '2', name: 'CatB' }],
          fetchedAt: Date.now() - (1000 * 60 * 31), // 31 mins old — past STALE_MS
          seenIds: [] // 0 of 2 seen, but the hard cutoff must still force a refresh
        }
      });

      let fetchCalled = false;
      window.fetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({ cards: [{ id: '3', name: 'CatFresh' }], radiusMiles: 10 }) };
      };

      await window.start();

      assert.equal(fetchCalled, true, 'the hard STALE_MS cutoff should force a refresh regardless of seen ratio');
    });

    it('shows the saved ZIP as the distance basis in normal mode after a refresh', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '97703', location: { lat: 1, lon: 2 } },
        feedCache: null
      });
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: '1', name: 'Cat1', distanceMiles: 4.2 }], radiusMiles: 10 })
      });

      await window.start();

      assert.equal(document.querySelector('.distance').textContent, "4.2 mi away from 97703");
    });

    it('falls back to "near you" in normal mode when only browser-geolocation coordinates are on file', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '', location: { lat: 1, lon: 2 } },
        feedCache: null
      });
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: '1', name: 'Cat1', distanceMiles: 4.2 }], radiusMiles: 10 })
      });

      await window.start();

      assert.equal(document.querySelector('.distance').textContent, "4.2 mi away near you");
    });

    it('shows the saved ZIP as the distance basis for a card served straight from cache', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '97703', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: '1', name: 'Cat1', distanceMiles: 4.2 }],
          fetchedAt: Date.now() - (1000 * 60), // 1 min old (fresh)
          seenIds: []
        }
      });

      await window.start();

      assert.equal(document.querySelector('.distance').textContent, "4.2 mi away from 97703");
    });

    it('shows no-location panel if no location', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: {}, feedCache: null
      });

      await window.start();

      const locPanel = document.getElementById("location-panel");
      assert.equal(locPanel.hidden, false);
    });

    it('immediately hides the location panel and shows in-progress text on click', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: {}, feedCache: null
      });
      window.navigator.geolocation = {
        getCurrentPosition: (success) => success({ coords: { latitude: 30, longitude: 40 } })
      };

      // Let the initial page-load start() call finish so the location panel
      // (and its "Use my location" button) is showing, as it would be on a
      // fresh install with no saved location.
      await new Promise(r => setTimeout(r, 10));

      const useLocationBtn = document.getElementById('use-location');
      const locationPanel = document.getElementById('location-panel');
      const notice = document.getElementById('notice');
      assert.equal(locationPanel.hidden, false);

      useLocationBtn.dispatchEvent(new window.Event('click'));

      // Assert synchronously, before the geolocation/fetch chain resolves,
      // so this only passes if the UI updates before the ~3-5s round trip.
      assert.equal(locationPanel.hidden, true);
      assert.equal(notice.textContent, 'Finding your location…');

      await new Promise(r => setTimeout(r, 10));

      const card = document.getElementById("card");
      assert.equal(card.querySelector('h1').textContent, 'Cat1');
      // Success: the panel stays hidden and the transient message was
      // overwritten by renderCard()'s own notice clear.
      assert.equal(locationPanel.hidden, true);
      assert.equal(notice.textContent, '');
    });

    it('shows a message and re-shows the panel when no location can be determined', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: {}, feedCache: null
      });
      window.navigator.geolocation = {
        getCurrentPosition: (success, error) => error(new Error('User denied Geolocation'))
      };

      await new Promise(r => setTimeout(r, 10));

      const useLocationBtn = document.getElementById('use-location');
      const locationPanel = document.getElementById('location-panel');
      const notice = document.getElementById('notice');

      useLocationBtn.dispatchEvent(new window.Event('click'));

      await new Promise(r => setTimeout(r, 10));

      assert.equal(locationPanel.hidden, false);
      assert.ok(notice.textContent.includes('Unable to determine your location'));
    });

    it('logs and shows a notice when refresh fails', async () => {
      window.fetch = async () => ({
        ok: false,
        json: async () => ({ error: "Server error" })
      });

      const loggedErrors = [];
      window.console.error = (...args) => { loggedErrors.push(args); };

      await window.start();

      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0][0], '[tabby]');
      assert.equal(loggedErrors[0][1].message, 'Server error');

      const notice = document.getElementById("notice");
      assert.ok(notice.textContent.length > 0);
    });

    it('prevents multiple concurrent executions', async () => {
      const p1 = window.start();
      const p2 = window.start();

      assert.strictEqual(p1, p2, "start() should return the same promise if one is in flight");
      await p1;
    });
  });

  describe('explore another area', () => {
    beforeEach(() => {
      window.chrome.storage.local.get = async () => ({
        settings: { postalcode: '12345', location: { lat: 1, lon: 2 } },
        feedCache: {
          cards: [{ id: 'home-1', name: 'HomeCat' }],
          fetchedAt: Date.now(), // fresh — a return trip shouldn't need a new fetch
          location: { postalcode: '12345' },
          page: 1,
          seenIds: []
        }
      });
    });

    it('fetches a random location at page 1 and shows the explore banner', async () => {
      let fetchedBody;
      window.fetch = async (url, opts) => {
        fetchedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ cards: [{ id: 'explore-1', name: 'ExploreCat' }], radiusMiles: 25 }) };
      };

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fetchedBody.page, 1);
      assert.ok(Number.isFinite(fetchedBody.location.lat) && fetchedBody.location.lat >= -90 && fetchedBody.location.lat <= 90);
      assert.ok(Number.isFinite(fetchedBody.location.lon) && fetchedBody.location.lon >= -180 && fetchedBody.location.lon <= 180);

      const card = document.getElementById('card');
      assert.equal(card.querySelector('h1').textContent, 'ExploreCat');

      const banner = document.getElementById('explore-banner');
      assert.equal(banner.hidden, false);
      assert.ok(document.getElementById('explore-label').textContent.length > 0);
    });

    it('never writes to settings while exploring, so the saved location is untouched', async () => {
      let settingsWrites = 0;
      window.chrome.storage.local.set = async (val) => { if (val.settings) settingsWrites++; };
      window.fetch = async () => ({ ok: true, json: async () => ({ cards: [{ id: 'explore-1', name: 'ExploreCat' }], radiusMiles: 25 }) });

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(settingsWrites, 0);
    });

    it('never writes to feedCache while exploring, so "back to my area" restores the original cached feed without a new fetch', async () => {
      let feedCacheWrites = 0;
      window.chrome.storage.local.set = async (val) => { if (val.feedCache) feedCacheWrites++; };
      window.fetch = async () => ({ ok: true, json: async () => ({ cards: [{ id: 'explore-1', name: 'ExploreCat' }], radiusMiles: 25 }) });

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(feedCacheWrites, 0, 'exploring must not write to the feedCache storage key');
      const exploreCard = document.getElementById('card');
      assert.equal(exploreCard.querySelector('h1').textContent, 'ExploreCat');

      let fetchCalledAgain = false;
      window.fetch = async () => { fetchCalledAgain = true; return { ok: true, json: async () => ({ cards: [], radiusMiles: 0 }) }; };

      document.getElementById('back-to-my-area').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fetchCalledAgain, false, 'a fresh home cache should not need a new fetch when returning from explore');
      assert.equal(document.getElementById('explore-banner').hidden, true);
      assert.equal(document.getElementById('card').querySelector('h1').textContent, 'HomeCat');
    });

    it('shows a friendly notice and hides the banner when the explored area has no cats', async () => {
      window.fetch = async () => ({ ok: true, json: async () => ({ cards: [], radiusMiles: 100 }) });

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(document.getElementById('explore-banner').hidden, true);
      assert.ok(document.getElementById('notice').textContent.includes('No available cats'));
    });

    it('logs and shows a notice when the explore fetch fails', async () => {
      window.fetch = async () => ({ ok: false, json: async () => ({ error: "Server error" }) });
      const loggedErrors = [];
      window.console.error = (...args) => { loggedErrors.push(args); };

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      assert.equal(document.getElementById('explore-banner').hidden, true);
      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0][0], '[tabby]');
      assert.ok(document.getElementById('notice').textContent.length > 0);
    });

    it('shows the distance relative to the explored city, not the user, while exploring', async () => {
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: 'explore-1', name: 'ExploreCat', distanceMiles: 3.14 }], radiusMiles: 25 })
      });

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      const distanceText = document.querySelector('.distance').textContent;
      const label = document.getElementById('explore-label').textContent;
      assert.equal(distanceText, `3.1 mi away from ${label}`);
    });

    it('"Show another cat" cycles through the already-fetched batch without a new fetch', async () => {
      let fetchCalls = 0;
      window.fetch = async () => {
        fetchCalls++;
        return {
          ok: true,
          json: async () => ({
            cards: [{ id: 'e1', name: 'ExploreCatOne' }, { id: 'e2', name: 'ExploreCatTwo' }],
            radiusMiles: 25
          })
        };
      };

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));
      assert.equal(fetchCalls, 1);

      const firstName = document.getElementById('card').querySelector('h1').textContent;
      assert.ok(['ExploreCatOne', 'ExploreCatTwo'].includes(firstName));

      document.getElementById('show-another-explore-cat').dispatchEvent(new window.Event('click'));

      const secondName = document.getElementById('card').querySelector('h1').textContent;
      assert.ok(['ExploreCatOne', 'ExploreCatTwo'].includes(secondName));
      assert.notEqual(firstName, secondName, 'the second card should be the other unseen cat in the batch');
      assert.equal(fetchCalls, 1, 'cycling to another explored cat must not trigger a new fetch');
      assert.equal(document.getElementById('explore-banner').hidden, false);
    });

    it('"Back to my area" clears the explore batch so "Show another cat" is a no-op afterward', async () => {
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ cards: [{ id: 'explore-1', name: 'ExploreCat' }], radiusMiles: 25 })
      });

      document.getElementById('explore').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      document.getElementById('back-to-my-area').dispatchEvent(new window.Event('click'));
      await new Promise(r => setTimeout(r, 10));

      document.getElementById('show-another-explore-cat').dispatchEvent(new window.Event('click'));
      assert.equal(document.getElementById('card').querySelector('h1').textContent, 'HomeCat');
    });
  });
});
