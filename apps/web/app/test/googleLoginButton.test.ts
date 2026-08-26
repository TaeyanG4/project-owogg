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
const authServiceSource = readFileSync(
  fileURLToPath(new URL("../features/auth/authService.ts", import.meta.url)),
  "utf8",
);

test("normal Google login uses the popup code client from an explicit OwOGG button click", () => {
  assert.match(loginModalSource, /googleOAuth\.initCodeClient\(\{/);
  assert.match(loginModalSource, /scope: "openid email profile"/);
  assert.match(loginModalSource, /googleCodeClientRef\.current\.requestCode\(\)/);
  assert.match(loginModalSource, /loginWithGoogleCode\(response\.code\)/);
  assert.match(loginModalSource, /dict\.loginModal\.googleButton/);
  assert.doesNotMatch(loginModalSource, /renderButton\(/);
  assert.doesNotMatch(loginModalSource, /\.prompt\(/);
  assert.doesNotMatch(authContextSource, /googleAuth\.prompt\(/);
  assert.doesNotMatch(
    loginModalSource,
    /tempDiv|querySelector\("div\[role=button\]"\)|btn\.click\(\)/,
  );
});

test("the browser sends only the one-time code with a preflight-forcing header", () => {
  assert.match(authServiceSource, /\/api\/auth\/google\/code/);
  assert.match(authServiceSource, /"X-Requested-With": "XmlHttpRequest"/);
  assert.match(authServiceSource, /JSON\.stringify\(\{ code \}\)/);
  assert.doesNotMatch(authServiceSource, /loginGoogle\(credential/);
});

test("Google and Discord controls share the original full-width centered OwOGG style", () => {
  const sharedClass =
    /className="flex items-center justify-center gap-3 w-full py-4 px-4[^"]*font-extrabold rounded-2xl[^"]*"/g;
  assert.equal(loginModalSource.match(sharedClass)?.length, 2);
  assert.doesNotMatch(loginModalSource, /<iframe|googleButtonContainerRef/);
});
