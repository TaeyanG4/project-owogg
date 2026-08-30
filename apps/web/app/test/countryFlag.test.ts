import test from "node:test";
import assert from "node:assert/strict";
import { countryCodeToFlag } from "../components/ui/CountryFlag";

test("countryCodeToFlag converts ISO alpha-2 values to regional indicator flags", () => {
  assert.equal(countryCodeToFlag("kr"), "🇰🇷");
  assert.equal(countryCodeToFlag("US"), "🇺🇸");
});

test("countryCodeToFlag leaves unset, hidden, and unknown values to the question-mark fallback", () => {
  assert.equal(countryCodeToFlag(null), null);
  assert.equal(countryCodeToFlag(""), null);
  assert.equal(countryCodeToFlag("UNKNOWN"), null);
});
