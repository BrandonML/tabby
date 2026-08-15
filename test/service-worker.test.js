import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const jsContent = fs.readFileSync(path.join(process.cwd(), 'extension', 'service-worker.js'), 'utf-8');

describe('service-worker.js', () => {
  it('seeds default settings on installed if missing', async () => {
    let installedListener;
    let savedSettings = undefined;
    let setSettings = null;

    global.chrome = {
      runtime: {
        onInstalled: {
          addListener: (cb) => { installedListener = cb; }
        }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            if (keys.includes('settings')) {
              cb({ settings: savedSettings });
            }
          },
          set: (val) => {
            setSettings = val;
          }
        }
      }
    };

    // Execute script
    eval(jsContent);

    assert.ok(installedListener, "Should have registered an onInstalled listener");

    // Trigger listener
    installedListener();

    // Check seeded values
    assert.deepEqual(setSettings, { settings: { backendUrl: "http://localhost:8787", postalcode: "" } });
  });

  it('does not overwrite existing settings on installed', async () => {
    let installedListener;
    let savedSettings = { backendUrl: "https://custom.com", postalcode: "12345" };
    let setSettings = null;

    global.chrome = {
      runtime: {
        onInstalled: {
          addListener: (cb) => { installedListener = cb; }
        }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            if (keys.includes('settings')) {
              cb({ settings: savedSettings });
            }
          },
          set: (val) => {
            setSettings = val;
          }
        }
      }
    };

    // Execute script
    eval(jsContent);

    assert.ok(installedListener, "Should have registered an onInstalled listener");

    // Trigger listener
    installedListener();

    // Check set wasn't called
    assert.equal(setSettings, null);
  });
});
