import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { locationFromBrowser } from "../extension/location.js";

describe("locationFromBrowser", () => {
  let originalNavigator;

  beforeEach(() => {
    originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  });

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(global, "navigator", originalNavigator);
    else delete global.navigator;
  });

  function stubNavigator(geolocation) {
    // Node's own `navigator` global is a non-configurable-looking getter in
    // recent versions — a plain assignment throws. defineProperty replaces
    // it outright for the duration of the test.
    Object.defineProperty(global, "navigator", { value: { geolocation }, configurable: true });
  }

  it("resolves to { lat, lon } from a successful geolocation result", async () => {
    stubNavigator({
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 40.7128, longitude: -74.006 } });
      }
    });

    const location = await locationFromBrowser();
    assert.deepStrictEqual(location, { lat: 40.7128, lon: -74.006 });
  });

  it("propagates the rejection when geolocation fails", async () => {
    const geoError = new Error("User denied Geolocation");
    stubNavigator({
      getCurrentPosition: (_success, error) => {
        error(geoError);
      }
    });

    await assert.rejects(() => locationFromBrowser(), (err) => err === geoError);
  });
});
