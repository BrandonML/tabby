import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.js'), 'utf-8');
const errorMsgsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'error-messages.js'), 'utf-8').replace('export function', 'function');
const configContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'config.js'), 'utf-8').replace('export const', 'const');

function inlineScript(source) {
  return source
    .replace(/import \{ classifyRefreshError \} from "\.\/error-messages\.js";/, errorMsgsContent)
    .replace(/import \{ BACKEND_URL \} from "\.\/config\.js";/, configContent);
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
        openOptionsPage: () => {}
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
    assert.equal(chips.length, 3);
    assert.equal(chips[0].textContent, "Adoption pending");
    assert.equal(chips[1].textContent, "Special needs");
    assert.equal(chips[2].textContent, "$50");
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
          seenIds: []
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

    it('shows no-location panel if no location', async () => {
      window.chrome.storage.local.get = async () => ({
        settings: {}, feedCache: null
      });

      await window.start();

      const locPanel = document.getElementById("location-panel");
      assert.equal(locPanel.hidden, false);
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
});
