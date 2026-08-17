import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'options.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'options.js'), 'utf-8');
const errorMsgsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'error-messages.js'), 'utf-8').replace('export function', 'function');
const configContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'config.js'), 'utf-8').replace('export const', 'const');

function inlineScript(source) {
  return source
    .replace(/import \{ classifyRefreshError \} from "\.\/error-messages\.js";/, errorMsgsContent)
    .replace(/import \{ BACKEND_URL \} from "\.\/config\.js";/, configContent);
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

  it('refreshCacheForZip success path writes settings and cache using the configured backend URL', async () => {
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

  it('refreshCacheForZip network error path', async () => {
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
    assert.equal(saved.textContent, 'Unable to refresh nearby cats right now. Try updating your zip code.');
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], '[tabby]');
    assert.equal(loggedErrors[0][1].message, 'Network error');
  });

  it('refreshCacheForZip invalid status error path', async () => {
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
  });

  it('closes settings when close button clicked', async () => {
    let closeCalled = false;
    window.close = () => { closeCalled = true; };
    const closeBtn = document.getElementById('close-settings');
    closeBtn.dispatchEvent(new window.Event('click'));

    await new Promise(r => setTimeout(r, 10));
    assert.ok(closeCalled);
  });
});
