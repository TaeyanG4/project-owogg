import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateStreamerOAuthEnvironment } from "./streamer-provider-contract.js";

const PRODUCTION_API_URL = "https://api.owogg.com";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function validProductionEnvironment(): Record<string, string> {
  return {
    PRODUCTION_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,TWITCH,CHZZK",
    PRODUCTION_YOUTUBE_CLIENT_ID: "production-youtube-client",
    PRODUCTION_YOUTUBE_CLIENT_SECRET: "production-youtube-secret",
    PRODUCTION_YOUTUBE_API_KEY: "production-youtube-api-key",
    PRODUCTION_YOUTUBE_REDIRECT_URI: `${PRODUCTION_API_URL}/api/streamers/verify/youtube/callback`,
    PRODUCTION_TWITCH_CLIENT_ID: "production-twitch-client",
    PRODUCTION_TWITCH_CLIENT_SECRET: "production-twitch-secret",
    PRODUCTION_TWITCH_REDIRECT_URI: `${PRODUCTION_API_URL}/api/streamers/verify/twitch/callback`,
    PRODUCTION_CHZZK_CLIENT_ID: "production-chzzk-client",
    PRODUCTION_CHZZK_CLIENT_SECRET: "production-chzzk-secret",
    PRODUCTION_CHZZK_REDIRECT_URI: `${PRODUCTION_API_URL}/api/streamers/verify/chzzk/callback`,
  };
}

function validate(env: Record<string, string | undefined>): string[] {
  return validateStreamerOAuthEnvironment(env, {
    deploymentLabel: "Production",
    apiUrl: PRODUCTION_API_URL,
    variablePrefix: "PRODUCTION_",
  });
}

test("Production Streamer OAuth accepts the isolated exact configuration", () => {
  assert.deepEqual(validate(validProductionEnvironment()), []);
});

test("Production Streamer OAuth requires an explicit supported provider set", () => {
  const missing = validProductionEnvironment();
  delete missing.PRODUCTION_STREAMER_ENABLED_PROVIDERS;
  assert.match(validate(missing).join("\n"), /PRODUCTION_STREAMER_ENABLED_PROVIDERS is required/);

  assert.match(
    validate({
      ...validProductionEnvironment(),
      PRODUCTION_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,SOOP",
    }).join("\n"),
    /SOOP must not be enabled in Production/,
  );
  assert.match(
    validate({
      ...validProductionEnvironment(),
      PRODUCTION_STREAMER_ENABLED_PROVIDERS: "TWITCH,TWITCH",
    }).join("\n"),
    /contains duplicate TWITCH/,
  );
});

test("Production and Staging credentials cannot substitute for each other", () => {
  assert.match(
    validate({
      STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE",
      STAGING_YOUTUBE_CLIENT_ID: "staging-client",
      STAGING_YOUTUBE_CLIENT_SECRET: "staging-secret",
      STAGING_YOUTUBE_API_KEY: "staging-key",
      STAGING_YOUTUBE_REDIRECT_URI:
        "https://api-stg.owogg.com/api/streamers/verify/youtube/callback",
    }).join("\n"),
    /PRODUCTION_STREAMER_ENABLED_PROVIDERS is required/,
  );
});

test("Production callbacks and disabled-provider credentials fail closed", () => {
  const youtubeOnly: Record<string, string> = {
    ...validProductionEnvironment(),
    PRODUCTION_STREAMER_ENABLED_PROVIDERS: "YOUTUBE",
  };
  for (const name of [
    "PRODUCTION_TWITCH_CLIENT_ID",
    "PRODUCTION_TWITCH_CLIENT_SECRET",
    "PRODUCTION_TWITCH_REDIRECT_URI",
    "PRODUCTION_CHZZK_CLIENT_ID",
    "PRODUCTION_CHZZK_CLIENT_SECRET",
    "PRODUCTION_CHZZK_REDIRECT_URI",
  ]) {
    delete youtubeOnly[name];
  }
  assert.deepEqual(validate(youtubeOnly), []);

  assert.match(
    validate({
      ...youtubeOnly,
      PRODUCTION_YOUTUBE_REDIRECT_URI:
        "https://api-stg.owogg.com/api/streamers/verify/youtube/callback",
    }).join("\n"),
    /PRODUCTION_YOUTUBE_REDIRECT_URI must equal https:\/\/api\.owogg\.com/,
  );
  assert.match(
    validate({
      ...youtubeOnly,
      PRODUCTION_TWITCH_CLIENT_SECRET: "unexpected-disabled-secret",
    }).join("\n"),
    /PRODUCTION_TWITCH_CLIENT_SECRET must be empty unless TWITCH is listed/,
  );
  assert.match(
    validate({
      ...youtubeOnly,
      PRODUCTION_YOUTUBE_API_KEY: " production-youtube-api-key ",
    }).join("\n"),
    /PRODUCTION_YOUTUBE_API_KEY must not have surrounding whitespace/,
  );
});

test("Production workflow maps prefixed Streamer Repository values after the combined preflight", () => {
  const deploy = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "deploy.yml"), "utf8");
  const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");

  assert.doesNotMatch(deploy, /^\s+environment:\s+production$/m);
  assert.match(
    deploy,
    /Actions scope contract: every new deployment-specific value lives at Repository scope/,
  );
  assert.match(deploy, /run: pnpm production:preflight --d1-list/);
  assert.ok(
    deploy.indexOf("production:preflight") < deploy.indexOf("Apply D1 Migrations to Production"),
  );
  assert.match(packageJson, /"production:preflight"/);
  assert.doesNotMatch(deploy, /vars\.(?:YOUTUBE|TWITCH|CHZZK|SOOP)_/);
  assert.doesNotMatch(deploy, /secrets\.(?:YOUTUBE|TWITCH|CHZZK|SOOP)_/);
  assert.doesNotMatch(deploy, /(?:vars|secrets)\.STREAMER_ENABLED_PROVIDERS/);
  assert.doesNotMatch(deploy, /SOOP_(?:CLIENT|REDIRECT)/);

  assert.match(
    deploy,
    /PRODUCTION_STREAMER_ENABLED_PROVIDERS: \$\{\{ vars\.PRODUCTION_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
  assert.match(
    deploy,
    /STREAMER_ENABLED_PROVIDERS:\$\{\{ vars\.PRODUCTION_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
  for (const platform of ["YOUTUBE", "TWITCH", "CHZZK"]) {
    assert.match(
      deploy,
      new RegExp(`${platform}_CLIENT_ID:\\\$\\{\\{ vars\\.PRODUCTION_${platform}_CLIENT_ID \\}\\}`),
    );
    assert.match(
      deploy,
      new RegExp(
        `${platform}_REDIRECT_URI:\\\$\\{\\{ vars\\.PRODUCTION_${platform}_REDIRECT_URI \\}\\}`,
      ),
    );
    assert.match(
      deploy,
      new RegExp(
        `PRODUCTION_${platform}_CLIENT_SECRET: \\\$\\{\\{ secrets\\.PRODUCTION_${platform}_CLIENT_SECRET \\}\\}`,
      ),
    );
    assert.match(deploy, new RegExp(`put_optional_secret ${platform}_CLIENT_SECRET`));
  }
  assert.match(
    deploy,
    /PRODUCTION_YOUTUBE_API_KEY: \$\{\{ secrets\.PRODUCTION_YOUTUBE_API_KEY \}\}/,
  );
  assert.match(
    deploy,
    /STREAMER_ENABLED_PROVIDERS: \$\{\{ vars\.PRODUCTION_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
});
