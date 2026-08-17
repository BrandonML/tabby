import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'options.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'options.js'), 'utf-8');
const errorMsgsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'error-messages.js'), 'utf-8').replace('export function', 'function');
const configContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'config.js'), 'utf-8').replace('export const', 'const');
const locationContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'location.js'), 'utf-8').replace('export async function', 'async function');

function inlineScript(source) {
  return source
    .replace(/import \{ classifyRefreshError \} from "\.\/error-messages\.js";/, errorMsgsContent)
    .replace(/import \{ BACKEND_URL \} from "\.\/config\.js";/, configContent)
    .replace(/import \{ locationFromBrowser \} from "\.\/location\.js";/, locationContent);
}

describe('options.js settings logic', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM(htmlContent, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;

    // Mock chrome APIs
    let savedSettings = {};
    window.chrome = {
      storage: {
        local: {
          get: async (keys, cb) => {
            if (cb) {
              return cb({ settings: savedSettings });
            }
            return { settings: savedSettings };
          },
          set: async (val) => {
            if (val.settings !== undefined) savedSettings = val.settings;
          }
        }
      },
      runtime: {
        getURL: (path) => `chrome-extension://id/${path}`
      },
      tabs: {
        query: (query, cb) => cb([]),
        create: (opts, cb) => { if(cb) cb(); },
        remove: (id) => {}
      }
    };

    // Attach close for testing
    window.close = () => {};

    // Mock fetch for settings refresh
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 5 })
    });

    const scriptEl = document.createElement('script');
    scriptEl.textContent = inlineScript(jsContent);
    document.body.appendChild(scriptEl);
  });

  it('populates fields from saved settings on load', async () => {
    // We already injected the script in beforeEach, but we didn't give the get mock the updated settings yet.
    // The top-level get is called immediately on script load. Let's simulate a fresh script load by resetting DOM.
    dom = new JSDOM(htmlContent, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;

    window.chrome = {
      storage: {
        local: {
          get: (keys, cb) => {
            if (cb) cb({ settings: { postalcode: '90210' } });
          }
        }
      }
    };

    const scriptEl = document.createElement('script');
    // Wrap in an IIFE to avoid "Identifier has already been declared" when re-evaluating top-level let/const
    scriptEl.textContent = `(() => { ${inlineScript(jsContent)} })();`;
    document.body.appendChild(scriptEl);

    // Allow get callback to resolve
    await new Promise(r => setTimeout(r, 10));

    assert.equal(document.getElementById('zip').value, '90210');
  });

  it('validates ZIP format on submit', async () => {
    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '123'; // invalid
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Await microtasks
    await new Promise(r => setTimeout(r, 0));
    assert.equal(saved.textContent, 'Enter a five-digit ZIP code.');
  });

  it('ZIP save path writes settings and cache using the configured backend URL', async () => {
    let savedStorage = {};
    window.chrome.storage.local.set = async (val) => { Object.assign(savedStorage, val); };

    let fetchedUrl;
    window.fetch = async (url) => {
      fetchedUrl = url;
      return {
        ok: true,
        json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 5 })
      };
    };

    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '12345';

    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Await microtasks
    await new Promise(r => setTimeout(r, 10));

    assert.equal(fetchedUrl, 'http://localhost:8787/api/nearby-cats');
    assert.deepEqual(savedStorage.settings, { postalcode: '12345' });
    assert.ok(savedStorage.feedCache);
    assert.equal(savedStorage.feedCache.cards.length, 1);
    assert.equal(saved.textContent, 'Saved.');
  });

  it('ZIP save path network error path', async () => {
    window.fetch = async () => { throw new Error("Network error"); };

    let savedStorage = {};
    window.chrome.storage.local.set = async (val) => { Object.assign(savedStorage, val); };

    const loggedErrors = [];
    window.console.error = (...args) => { loggedErrors.push(args); };

    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '12345';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(savedStorage.feedCache, null);
    assert.equal(saved.textContent, 'Unable to refresh nearby cats right now.');
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], '[tabby]');
    assert.equal(loggedErrors[0][1].message, 'Network error');
    assert.equal(form.hidden, false, 'the form should reappear after a failure so the user can retry');
  });

  it('ZIP save path invalid status error path', async () => {
    window.fetch = async () => ({
      ok: false,
      json: async () => ({ error: "Server error" })
    });

    let savedStorage = {};
    window.chrome.storage.local.set = async (val) => { Object.assign(savedStorage, val); };

    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '12345';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(savedStorage.feedCache, null);
    assert.ok(saved.textContent.includes('Server error'));
    assert.equal(form.hidden, false, 'the form should reappear after a failure so the user can retry');
  });

  it('immediately hides the form and shows in-progress text on ZIP submit', async () => {
    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '12345';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Assert synchronously, before any awaited work in the handler resolves,
    // so this only passes if the UI updates before the network call, not after it.
    assert.equal(form.hidden, true);
    assert.equal(saved.textContent, 'Saving…');

    await new Promise(r => setTimeout(r, 10));

    // Success: the form stays hidden — refreshCacheForLocation is about to
    // navigate away, so there's nothing to restore it for.
    assert.equal(form.hidden, true);
    assert.equal(saved.textContent, 'Saved.');
  });

  it('closes settings when close button clicked', async () => {
    let closeCalled = false;
    window.close = () => { closeCalled = true; };
    const closeBtn = document.getElementById('close-settings');
    closeBtn.dispatchEvent(new window.Event('click'));

    await new Promise(r => setTimeout(r, 10));
    assert.ok(closeCalled);
  });

  it('submitting a blank ZIP is a no-op', async () => {
    let setCalled = false;
    window.chrome.storage.local.set = async () => { setCalled = true; };

    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(setCalled, false);
    assert.equal(saved.textContent, '');
    assert.equal(form.hidden, false, 'a no-op submit should never hide the form');
  });

  describe('Use my location', () => {
    it('resolves coordinates and saves settings using them', async () => {
      window.navigator.geolocation = {
        getCurrentPosition: (success) => success({ coords: { latitude: 30, longitude: 40 } })
      };

      let savedStorage = {};
      window.chrome.storage.local.set = async (val) => { Object.assign(savedStorage, val); };

      let fetchedBody;
      window.fetch = async (url, opts) => {
        fetchedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ cards: [{ id: '1', name: 'Cat1' }], radiusMiles: 5 })
        };
      };

      const useLocationBtn = document.getElementById('use-location');
      const form = document.getElementById('settings-form');
      const saved = document.getElementById('saved');

      useLocationBtn.dispatchEvent(new window.Event('click'));

      // Assert synchronously, before the geolocation/fetch chain resolves,
      // so this only passes if the UI updates before the ~3-5s round trip.
      assert.equal(form.hidden, true);
      assert.equal(saved.textContent, 'Finding your location…');

      await new Promise(r => setTimeout(r, 10));

      assert.deepEqual(fetchedBody.location, { lat: 30, lon: 40 });
      assert.deepEqual(savedStorage.settings, { location: { lat: 30, lon: 40 } });
      assert.ok(savedStorage.feedCache);
      assert.equal(saved.textContent, 'Saved.');
      // Success: the form stays hidden — refreshCacheForLocation is about to
      // navigate away, so there's nothing to restore it for.
      assert.equal(form.hidden, true);
    });

    it('shows a fallback message when geolocation permission is denied', async () => {
      window.navigator.geolocation = {
        getCurrentPosition: (success, error) => error(new Error('User denied Geolocation'))
      };

      let setCalled = false;
      window.chrome.storage.local.set = async () => { setCalled = true; };

      const loggedErrors = [];
      window.console.error = (...args) => { loggedErrors.push(args); };

      const useLocationBtn = document.getElementById('use-location');
      const form = document.getElementById('settings-form');
      const saved = document.getElementById('saved');

      useLocationBtn.dispatchEvent(new window.Event('click'));

      await new Promise(r => setTimeout(r, 10));

      assert.equal(setCalled, false);
      assert.equal(saved.textContent, 'Unable to access your location. Try entering a zip code instead.');
      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0][0], '[tabby]');
      assert.equal(form.hidden, false, 'the form should reappear after a failure so the user can retry');
    });
  });

  it('auto-navigates back a brief moment after a successful save', async () => {
    let timeoutDelay;
    let timeoutCallback;
    window.setTimeout = (cb, delay) => { timeoutCallback = cb; timeoutDelay = delay; return 0; };

    let tabsCreated = false;
    let tabsRemoved = false;
    window.chrome.tabs.query = (query, cb) => cb([{ id: 7 }]);
    window.chrome.tabs.create = (opts, cb) => { tabsCreated = true; if (cb) cb(); };
    window.chrome.tabs.remove = () => { tabsRemoved = true; };

    const zip = document.getElementById('zip');
    const form = document.getElementById('settings-form');
    const saved = document.getElementById('saved');

    zip.value = '12345';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(saved.textContent, 'Saved.');
    assert.equal(timeoutDelay, 600);
    assert.equal(tabsCreated, false, 'should not navigate before the delay elapses');

    timeoutCallback();

    assert.equal(tabsCreated, true);
    assert.equal(tabsRemoved, true);
  });
});
