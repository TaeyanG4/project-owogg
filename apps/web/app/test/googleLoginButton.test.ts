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
  assert.match(loginModalSource, /const container = googleButtonContainerRef\.current;/);
  assert.match(loginModalSource, /googleAuth\.renderButton\(container,/);
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

test("Google and Discord login controls share the modal width and large-button height", () => {
  assert.match(loginModalSource, /width: String\(buttonWidth\)/);
  assert.match(loginModalSource, /Math\.min\(400,/);
  assert.match(loginModalSource, /ref=\{googleButtonContainerRef\}[\s\S]*?"w-full"/);
  assert.match(loginModalSource, /className="flex h-10 w-full[^"]*rounded-full/);
});
