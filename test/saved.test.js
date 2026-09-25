import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'saved.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'saved.js'), 'utf-8');

describe('saved.js', () => {
  let dom;
  let window;
  let document;
  let storedSavedCats;

  function mountWith(savedCats) {
    storedSavedCats = savedCats;
    dom = new JSDOM(htmlContent, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;

    window.chrome = {
      storage: {
        local: {
          get: async () => ({ savedCats: storedSavedCats }),
          set: async (val) => { storedSavedCats = val.savedCats; }
        }
      },
      runtime: { getURL: (path) => `chrome-extension://id/${path}` },
      tabs: {
        query: (_query, cb) => cb([]),
        create: (opts, cb) => { if (cb) cb(); },
        remove: (_id) => {}
      }
    };
    window.close = () => {};

    const scriptEl = document.createElement('script');
    scriptEl.textContent = jsContent;
    document.body.appendChild(scriptEl);
  }

  beforeEach(() => {
    mountWith([]);
  });

  it('shows the empty-state message and no items when nothing is saved', async () => {
    await new Promise(r => setTimeout(r, 10));

    assert.equal(document.getElementById('saved-empty').hidden, false);
    assert.equal(document.querySelectorAll('.saved-item').length, 0);
  });

  it('renders a saved cat with photo, meta, and remove button, and hides the empty state', async () => {
    mountWith([{
      id: 'cat-1',
      name: 'Milo',
      breed: 'Tabby',
      age: 'Adult',
      sex: 'Male',
      adoptionFee: '$50',
      imageUrl: 'https://image.org/cat.jpg',
      rescueName: 'Second Chance Rescue',
      rescueUrl: 'https://rescue.org',
      profileUrl: 'https://rescue.org/animals/milo',
      savedAt: new Date().toISOString()
    }]);
    await new Promise(r => setTimeout(r, 10));

    assert.equal(document.getElementById('saved-empty').hidden, true);
    const item = document.querySelector('.saved-item');
    assert.ok(item);
    assert.equal(item.querySelector('.saved-item-photo').src, 'https://image.org/cat.jpg');
    assert.equal(item.querySelector('.saved-item-name').textContent, 'Milo');
    assert.equal(item.querySelector('.saved-item-meta').textContent, 'Tabby · Adult · Male · $50');
    assert.ok(item.querySelector('.saved-item-remove'));
  });

  it('shows only one link when rescueUrl and profileUrl match (issue #51 parity)', async () => {
    mountWith([{
      id: 'cat-1', name: 'Milo', imageUrl: 'https://image.org/cat.jpg',
      rescueName: 'Second Chance Rescue', rescueUrl: 'https://rescue.org', profileUrl: 'https://rescue.org',
      savedAt: new Date().toISOString()
    }]);
    await new Promise(r => setTimeout(r, 10));

    const links = document.querySelectorAll('.saved-item-links a');
    assert.equal(links.length, 1, 'should collapse to a single link when both URLs match');
    assert.equal(links[0].textContent, 'View profile');
  });

  it('shows both links when rescueUrl and profileUrl differ', async () => {
    mountWith([{
      id: 'cat-1', name: 'Milo', imageUrl: 'https://image.org/cat.jpg',
      rescueName: 'Second Chance Rescue', rescueUrl: 'https://rescue.org', profileUrl: 'https://rescue.rescuegroups.org/animals/detail?AnimalID=1',
      savedAt: new Date().toISOString()
    }]);
    await new Promise(r => setTimeout(r, 10));

    const links = document.querySelectorAll('.saved-item-links a');
    assert.equal(links.length, 2);
    assert.equal(links[0].textContent, 'Second Chance Rescue');
    assert.equal(links[1].textContent, 'View profile');
  });

  it('sorts saved cats most-recently-saved first', async () => {
    mountWith([
      { id: 'old', name: 'Older', imageUrl: 'https://image.org/a.jpg', savedAt: new Date(Date.now() - 100000).toISOString() },
      { id: 'new', name: 'Newer', imageUrl: 'https://image.org/b.jpg', savedAt: new Date().toISOString() }
    ]);
    await new Promise(r => setTimeout(r, 10));

    const names = [...document.querySelectorAll('.saved-item-name')].map(el => el.textContent);
    assert.deepEqual(names, ['Newer', 'Older']);
  });

  it('removes a saved cat from storage and re-renders when Remove is clicked', async () => {
    mountWith([{ id: 'cat-1', name: 'Milo', imageUrl: 'https://image.org/cat.jpg', savedAt: new Date().toISOString() }]);
    await new Promise(r => setTimeout(r, 10));

    document.querySelector('.saved-item-remove').dispatchEvent(new window.Event('click'));
    await new Promise(r => setTimeout(r, 10));

    assert.deepEqual(storedSavedCats, []);
    assert.equal(document.querySelectorAll('.saved-item').length, 0);
    assert.equal(document.getElementById('saved-empty').hidden, false);
  });

  it('replaces the active tab with newtab.html when back-to-tabby is clicked', async () => {
    await new Promise(r => setTimeout(r, 10));
    let createArgs;
    let removedTabId;
    window.chrome.tabs.query = (_query, cb) => cb([{ id: 7 }]);
    window.chrome.tabs.create = (opts, cb) => { createArgs = opts; if (cb) cb(); };
    window.chrome.tabs.remove = (id) => { removedTabId = id; };

    document.getElementById('back-to-tabby').dispatchEvent(new window.Event('click'));

    assert.deepEqual(createArgs, { url: 'chrome-extension://id/extension/newtab.html', active: true });
    assert.equal(removedTabId, 7);
  });
});
