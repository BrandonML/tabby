import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.html'), 'utf-8');
const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'newtab.js'), 'utf-8');

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
    scriptEl.textContent = jsContent;
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
});
