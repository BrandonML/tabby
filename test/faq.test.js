import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'faq.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'faq.js'), 'utf-8');

describe('faq.js back-navigation logic', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM(htmlContent, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;

    window.chrome = {
      runtime: {
        getURL: (path) => `chrome-extension://id/${path}`
      },
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
  });

  it('renders every FAQ question as a collapsible item with an answer', () => {
    const items = document.querySelectorAll('.faq-item');
    assert.ok(items.length > 0, 'expected at least one FAQ item');
    for (const item of items) {
      assert.ok(item.querySelector('summary')?.textContent.trim().length > 0, 'every item needs a non-empty question');
      assert.ok(item.querySelector('p')?.textContent.trim().length > 0, 'every item needs a non-empty answer');
    }
  });

  it('replaces the active tab with newtab.html (the primary path)', () => {
    let createArgs;
    let removedTabId;
    window.chrome.tabs.query = (_query, cb) => cb([{ id: 7 }]);
    window.chrome.tabs.create = (opts, cb) => { createArgs = opts; if (cb) cb(); };
    window.chrome.tabs.remove = (id) => { removedTabId = id; };

    document.getElementById('back-to-tabby').dispatchEvent(new window.Event('click'));

    assert.deepEqual(createArgs, { url: 'chrome-extension://id/extension/newtab.html', active: true });
    assert.equal(removedTabId, 7);
  });

  it('falls back to window.close() when there is no active tab to replace', () => {
    window.chrome.tabs.query = (_query, cb) => cb([]);
    let closeCalled = false;
    window.close = () => { closeCalled = true; };

    document.getElementById('back-to-tabby').dispatchEvent(new window.Event('click'));

    assert.ok(closeCalled);
  });
});
