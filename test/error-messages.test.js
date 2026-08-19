import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyRefreshError } from "../extension/error-messages.js";

describe("classifyRefreshError", () => {
  it("recognizes RescueGroups' actual 'not a recognized postalcode' wording (one word)", () => {
    // Literal upstream string RescueGroups returns for an unrecognized ZIP.
    const message = "RescueGroups HTTP 400: 97703 is not a recognized postalcode";
    assert.strictEqual(classifyRefreshError(message), "That ZIP code looks invalid. Please update it.");
  });

  it("still recognizes the two-word 'postal code' wording", () => {
    assert.strictEqual(
      classifyRefreshError("Provide a five-digit postal code or valid latitude and longitude."),
      "That ZIP code looks invalid. Please update it."
    );
  });

  it("falls back to a generic message with a zip-code hint for unrecognized errors", () => {
    assert.strictEqual(
      classifyRefreshError("Unable to refresh nearby cats right now."),
      "Unable to refresh nearby cats right now. Try updating your zip code."
    );
  });

  it("does not double up the hint when the message already says to update it", () => {
    // Deliberately avoids "zip code"/"postal code"/"invalid" so it doesn't
    // take the isInvalidZip branch instead — this exercises the generic
    // branch's own already-mentioned check.
    assert.strictEqual(
      classifyRefreshError("Something went wrong. Please update it and try again."),
      "Something went wrong. Please update it and try again."
    );
  });
});
