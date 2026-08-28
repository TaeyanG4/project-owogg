import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiUrl, shouldRequestWebManifest } from "../lib/api/config.js";

test("explicit VITE_API_URL always wins", () => {
  assert.equal(
    resolveApiUrl("https://api-preview.example.com", "stg.owogg.com"),
    "https://api-preview.example.com",
  );
});

test("Staging never falls back to the Production API when a build variable is absent", () => {
  assert.equal(resolveApiUrl(undefined, "stg.owogg.com"), "https://api-stg.owogg.com");
});

test("local and Production API defaults remain isolated", () => {
  assert.equal(resolveApiUrl(undefined, "localhost"), "http://localhost:8787");
  assert.equal(resolveApiUrl(undefined, "127.0.0.1"), "http://localhost:8787");
  assert.equal(resolveApiUrl(undefined, "owogg.com"), "https://api.owogg.com");
});

test("the protected Staging build omits PWA manifest discovery", () => {
  assert.equal(shouldRequestWebManifest("https://api-stg.owogg.com"), false);
  assert.equal(shouldRequestWebManifest("https://api.owogg.com"), true);
  assert.equal(shouldRequestWebManifest("http://localhost:8787"), true);
});
