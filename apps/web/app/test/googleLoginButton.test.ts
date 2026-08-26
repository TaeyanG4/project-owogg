import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const authContextSource = readFileSync(
  fileURLToPath(new URL("../features/auth/AuthContext.tsx", import.meta.url)),
  "utf8",
);
const loginModalSource = readFileSync(
  fileURLToPath(new URL("../components/ui/LoginModal.tsx", import.meta.url)),
  "utf8",
);

test("normal Google login exposes a real GIS button and never synthesizes a hidden click", () => {
  assert.match(loginModalSource, /googleAuth\.renderButton\(googleButtonContainerRef\.current,/);
  assert.match(loginModalSource, /ref=\{googleButtonContainerRef\}/);
  assert.doesNotMatch(authContextSource, /googleAuth\.prompt\(/);
  assert.doesNotMatch(
    authContextSource,
    /tempDiv|querySelector\("div\[role=button\]"\)|btn\.click\(\)/,
  );
});

test("the Google button container stays mounted while the GIS script loads", () => {
  assert.match(loginModalSource, /<div\s+ref=\{googleButtonContainerRef\}/);
  assert.doesNotMatch(
    loginModalSource,
    /googleButtonReady\s*\?\s*\(\s*<div\s+ref=\{googleButtonContainerRef\}/,
  );
});
