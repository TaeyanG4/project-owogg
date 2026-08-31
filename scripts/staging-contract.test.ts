import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION,
  STAGING,
  STAGING_D1_ID_SENTINEL,
  materializeStagingWranglerConfig,
  parseJsonc,
  parsePublicGameDeploymentTargets,
  resolveSmokeTargets,
  validateCloudflareDomainAssignments,
  validateStagingEnvironment,
  validateWranglerStagingContracts,
  verifyStagingD1Target,
  type WranglerConfig,
} from "./staging-contract.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiWranglerText = fs.readFileSync(
  path.join(repoRoot, "apps", "api", "wrangler.jsonc"),
  "utf8",
);
const webWranglerText = fs.readFileSync(
  path.join(repoRoot, "apps", "web", "wrangler.jsonc"),
  "utf8",
);

const STAGING_D1_ID = "123e4567-e89b-42d3-a456-426614174000";

function validStagingEnvironment(): Record<string, string> {
  return {
    FRONTEND_URL: STAGING.frontendUrl,
    GAME_ORIGIN: STAGING.gameOrigin,
    GOOGLE_CLIENT_ID: "staging-google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    VITE_API_URL: STAGING.apiUrl,
    VITE_GAME_ORIGIN: STAGING.gameOrigin,
    VITE_GOOGLE_CLIENT_ID: "staging-google-client",
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_COMMAND_SYNC_ENABLED: "false",
    DISCORD_INSTALL_URL:
      "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot%20applications.commands",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_REDIRECT_URI: `${STAGING.apiUrl}/api/auth/discord/callback`,
    DISCORD_TEST_GUILD_ID: "987654321098765432",
    STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,TWITCH,CHZZK",
    STAGING_YOUTUBE_CLIENT_ID: "staging-youtube-client",
    STAGING_YOUTUBE_CLIENT_SECRET: "staging-youtube-secret",
    STAGING_YOUTUBE_API_KEY: "staging-youtube-api-key",
    STAGING_YOUTUBE_REDIRECT_URI: `${STAGING.apiUrl}/api/streamers/verify/youtube/callback`,
    STAGING_TWITCH_CLIENT_ID: "staging-twitch-client",
    STAGING_TWITCH_CLIENT_SECRET: "staging-twitch-secret",
    STAGING_TWITCH_REDIRECT_URI: `${STAGING.apiUrl}/api/streamers/verify/twitch/callback`,
    STAGING_CHZZK_CLIENT_ID: "staging-chzzk-client",
    STAGING_CHZZK_CLIENT_SECRET: "staging-chzzk-secret",
    STAGING_CHZZK_REDIRECT_URI: `${STAGING.apiUrl}/api/streamers/verify/chzzk/callback`,
    STAGING_ADMIN_USER_IDS: "",
    STAGING_ADMIN_SESSION_TTL_SECONDS: "43200",
    STAGING_D1_DATABASE_ID: STAGING_D1_ID,
    STAGING_MULTIPLAYER_ENABLED: "false",
    STAGING_WEB_SMOKE_ENABLED: "false",
    B2_APPLICATION_KEY: "secret",
    B2_BUCKET_NAME: STAGING.b2Bucket,
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_KEY_ID: "key",
    B2_REGION: "us-west-004",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_CLIENT_SECRET: "discord-secret",
    GAME_SESSION_SECRET: "session-secret",
    STAGING_MULTIPLAYER_TICKET_KEY_ID: "staging_2026_08_a",
    STAGING_MULTIPLAYER_TICKET_SECRET: "m".repeat(32),
  };
}

test("Wrangler Staging environments isolate routes, D1, rate limits, Durable Objects and Cron", () => {
  const api = parseJsonc<WranglerConfig>(apiWranglerText);
  const web = parseJsonc<WranglerConfig>(webWranglerText);
  assert.deepEqual(validateWranglerStagingContracts(api, web), []);
  assert.deepEqual(api.env?.staging?.triggers?.crons, []);
  assert.notEqual(api.env?.staging?.d1_databases?.[0]?.database_id, PRODUCTION.d1Id);
  assert.deepEqual(api.durable_objects?.bindings, [
    { name: "MULTIPLAYER_INSTANCES", class_name: "MultiplayerInstanceObject" },
    { name: "MULTIPLAYER_LOBBY_SIGNALS", class_name: "MultiplayerLobbySignalObject" },
  ]);
  assert.deepEqual(api.env?.staging?.durable_objects?.bindings, [
    { name: "MULTIPLAYER_INSTANCES", class_name: "MultiplayerInstanceObject" },
    { name: "MULTIPLAYER_LOBBY_SIGNALS", class_name: "MultiplayerLobbySignalObject" },
  ]);
  assert.equal(api.vars?.MULTIPLAYER_ENABLED, "false");
  assert.equal(api.env?.staging?.vars?.MULTIPLAYER_ENABLED, "false");
  assert.equal(api.vars?.ADMIN_SESSION_TTL_SECONDS, undefined);
  assert.equal(api.env?.staging?.vars?.ADMIN_SESSION_TTL_SECONDS, "43200");
});

test("Staging environment preflight accepts only the exact isolated target tuple", () => {
  assert.deepEqual(validateStagingEnvironment(validStagingEnvironment()), []);

  const crossed = {
    ...validStagingEnvironment(),
    FRONTEND_URL: PRODUCTION.frontendUrl,
    B2_BUCKET_NAME: PRODUCTION.b2Bucket,
    STAGING_D1_DATABASE_ID: PRODUCTION.d1Id,
    DISCORD_COMMAND_SYNC_ENABLED: "true",
    STAGING_ADMIN_SESSION_TTL_SECONDS: "1800",
  };
  const errors = validateStagingEnvironment(crossed).join("\n");
  assert.match(errors, /FRONTEND_URL/);
  assert.match(errors, /B2_BUCKET_NAME/);
  assert.match(errors, /Production D1/);
  assert.match(errors, /DISCORD_COMMAND_SYNC_ENABLED/);
  assert.match(errors, /STAGING_ADMIN_SESSION_TTL_SECONDS/);
});

test("Staging Google code exchange requires a non-blank, whitespace-safe server secret", () => {
  const missingSecret = validStagingEnvironment();
  delete missingSecret.GOOGLE_CLIENT_SECRET;
  assert.match(validateStagingEnvironment(missingSecret).join("\n"), /GOOGLE_CLIENT_SECRET/);

  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      GOOGLE_CLIENT_SECRET: " google-secret ",
    }).join("\n"),
    /must not have surrounding whitespace/,
  );
});

test("Staging Streamer OAuth requires an explicit supported provider set", () => {
  const missingProviders = validStagingEnvironment();
  delete missingProviders.STAGING_STREAMER_ENABLED_PROVIDERS;
  assert.match(
    validateStagingEnvironment(missingProviders).join("\n"),
    /STAGING_STREAMER_ENABLED_PROVIDERS is required/,
  );

  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,SOOP",
    }).join("\n"),
    /SOOP must not be enabled in Staging/,
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,YOUTUBE",
    }).join("\n"),
    /contains duplicate YOUTUBE/,
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,UNKNOWN",
    }).join("\n"),
    /Unsupported Staging Streamer provider UNKNOWN/,
  );
});

test("each enabled Staging Streamer provider requires isolated exact credentials and callback", () => {
  const youtubeOnly: Record<string, string> = {
    ...validStagingEnvironment(),
    STAGING_STREAMER_ENABLED_PROVIDERS: "YOUTUBE",
  };
  delete youtubeOnly.STAGING_TWITCH_CLIENT_ID;
  delete youtubeOnly.STAGING_TWITCH_CLIENT_SECRET;
  delete youtubeOnly.STAGING_TWITCH_REDIRECT_URI;
  delete youtubeOnly.STAGING_CHZZK_CLIENT_ID;
  delete youtubeOnly.STAGING_CHZZK_CLIENT_SECRET;
  delete youtubeOnly.STAGING_CHZZK_REDIRECT_URI;
  assert.deepEqual(validateStagingEnvironment(youtubeOnly), []);

  assert.match(
    validateStagingEnvironment({
      ...youtubeOnly,
      STAGING_TWITCH_CLIENT_ID: "unexpected-disabled-client",
    }).join("\n"),
    /STAGING_TWITCH_CLIENT_ID must be empty unless TWITCH is listed/,
  );

  const missingYoutubeApiKey = { ...youtubeOnly };
  delete missingYoutubeApiKey.STAGING_YOUTUBE_API_KEY;
  assert.match(
    validateStagingEnvironment(missingYoutubeApiKey).join("\n"),
    /STAGING_YOUTUBE_API_KEY is required/,
  );

  assert.match(
    validateStagingEnvironment({
      ...youtubeOnly,
      STAGING_YOUTUBE_CLIENT_SECRET: " staging-youtube-secret ",
      STAGING_YOUTUBE_REDIRECT_URI: "https://api.owogg.com/api/streamers/verify/youtube/callback",
    }).join("\n"),
    /STAGING_YOUTUBE_CLIENT_SECRET must not have surrounding whitespace/,
  );
  assert.match(
    validateStagingEnvironment({
      ...youtubeOnly,
      STAGING_YOUTUBE_REDIRECT_URI: "https://api.owogg.com/api/streamers/verify/youtube/callback",
    }).join("\n"),
    /STAGING_YOUTUBE_REDIRECT_URI must equal https:\/\/api-stg\.owogg\.com/,
  );
});

test("Staging multiplayer ticket keys are strong, paired and rotation-safe", () => {
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_TICKET_SECRET: "too-short",
    }).join("\n"),
    /at least 32 UTF-8 bytes/,
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_07_z",
    }).join("\n"),
    /must be configured together/,
  );
  assert.deepEqual(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_07_z",
      STAGING_MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
    }),
    [],
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_08_a",
      STAGING_MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
    }).join("\n"),
    /key IDs must differ/,
  );
});

test("Staging multiplayer activation is explicit and boolean", () => {
  const missing = validStagingEnvironment();
  delete missing.STAGING_MULTIPLAYER_ENABLED;
  assert.match(
    validateStagingEnvironment(missing).join("\n"),
    /STAGING_MULTIPLAYER_ENABLED is required/,
  );
  assert.deepEqual(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_ENABLED: "true",
    }),
    [],
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_ENABLED: "enabled",
    }).join("\n"),
    /STAGING_MULTIPLAYER_ENABLED must be true or false/,
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      STAGING_MULTIPLAYER_TICKET_KEY_ID: "production_2026_09_a",
    }).join("\n"),
    /STAGING_MULTIPLAYER_TICKET_KEY_ID must start with staging_/,
  );
});

test("Staging Web smoke requires both Cloudflare Access service-token values when enabled", () => {
  const enabled = { ...validStagingEnvironment(), STAGING_WEB_SMOKE_ENABLED: "true" };
  const errors = validateStagingEnvironment(enabled).join("\n");
  assert.match(errors, /CF_ACCESS_CLIENT_ID/);
  assert.match(errors, /CF_ACCESS_CLIENT_SECRET/);
  assert.deepEqual(
    validateStagingEnvironment({
      ...enabled,
      CF_ACCESS_CLIENT_ID: "access-id",
      CF_ACCESS_CLIENT_SECRET: "access-secret",
    }),
    [],
  );
});

test("D1 target verification requires exact remote name and operator UUID", () => {
  const list = [{ name: STAGING.d1Name, uuid: STAGING_D1_ID }];
  assert.equal(verifyStagingD1Target(list, STAGING_D1_ID).name, STAGING.d1Name);
  assert.throws(
    () => verifyStagingD1Target(list, "223e4567-e89b-42d3-a456-426614174000"),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyStagingD1Target([{ name: PRODUCTION.d1Name, uuid: PRODUCTION.d1Id }], STAGING_D1_ID),
    /found 0/,
  );
});

test("verified D1 UUID replaces the fail-closed sentinel exactly once", () => {
  const generated = materializeStagingWranglerConfig(apiWranglerText, STAGING_D1_ID);
  assert.equal(generated.includes(STAGING_D1_ID_SENTINEL), false);
  const config = parseJsonc<WranglerConfig>(generated);
  assert.equal(config.env?.staging?.d1_databases?.[0]?.database_id, STAGING_D1_ID);
  assert.equal(config.d1_databases?.[0]?.database_id, PRODUCTION.d1Id);
});

test("smoke targets keep Production defaults and support explicit Staging overrides", () => {
  assert.deepEqual(resolveSmokeTargets({}), {
    apiUrl: PRODUCTION.apiUrl,
    webUrl: PRODUCTION.frontendUrl,
  });
  assert.deepEqual(
    resolveSmokeTargets({ SMOKE_API_URL: STAGING.apiUrl, SMOKE_WEB_URL: STAGING.frontendUrl }),
    { apiUrl: STAGING.apiUrl, webUrl: STAGING.frontendUrl },
  );
  assert.throws(() => resolveSmokeTargets({ SMOKE_API_URL: "http://api-stg.owogg.com" }), /HTTPS/);
});

test("empty public catalogs require an explicit smoke allowance and malformed catalogs still fail", () => {
  assert.throws(() => parsePublicGameDeploymentTargets({ games: [] }), /empty public catalog/);
  assert.deepEqual(parsePublicGameDeploymentTargets({ games: [] }, { allowEmpty: true }), []);
  assert.throws(
    () => parsePublicGameDeploymentTargets({}, { allowEmpty: true }),
    /malformed public catalog/,
  );
  assert.throws(
    () =>
      parsePublicGameDeploymentTargets(
        {
          games: [
            { slug: "duplicate", mediaUrl: null },
            { slug: "duplicate", mediaUrl: null },
          ],
        },
        { allowEmpty: true },
      ),
    /invalid or duplicate slug/,
  );
});

test("Cloudflare domain preflight permits empty/already-correct Staging mappings and blocks conflicts", () => {
  assert.deepEqual(validateCloudflareDomainAssignments([]), []);
  assert.deepEqual(
    validateCloudflareDomainAssignments([
      { hostname: "api-stg.owogg.com", service: PRODUCTION.apiWorker, environment: "staging" },
      { hostname: "play-stg.owogg.com", service: STAGING.apiWorker },
      { hostname: "stg.owogg.com", service: STAGING.webWorker },
      { hostname: "api.owogg.com", service: PRODUCTION.apiWorker, environment: "production" },
    ]),
    [],
  );
  assert.match(
    validateCloudflareDomainAssignments([
      { hostname: "api-stg.owogg.com", service: PRODUCTION.apiWorker, environment: "production" },
    ]).join("\n"),
    /non-Staging/,
  );
  assert.match(
    validateCloudflareDomainAssignments([
      { hostname: "api.owogg.com", service: STAGING.apiWorker },
    ]).join("\n"),
    /Production domain/,
  );
});

test("Staging workflow is push-after-CI only and contains no Production variable or global Discord fallback", () => {
  const ci = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const deploy = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "deploy-staging.yml"),
    "utf8",
  );
  const productionDeploy = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "deploy.yml"),
    "utf8",
  );
  const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
  assert.match(ci, /branches: \[main, staging\]/);
  assert.match(ci, /github\.event_name == 'push'/);
  assert.match(ci, /needs: ci/);
  assert.match(deploy, /environment: staging/);
  assert.match(deploy, /group: owogg-staging/);
  assert.doesNotMatch(deploy, /secrets:\s*inherit/);
  // `vars.ADMIN_USER_IDS` would resolve the repository-level Production variable when the
  // Staging Environment intentionally has no variable by that name. Never reference it here;
  // Staging uses its explicitly scoped name and maps it only at the Worker boundary below.
  assert.doesNotMatch(deploy, /vars\.ADMIN_USER_IDS/);
  assert.doesNotMatch(deploy, /vars\.MULTIPLAYER_ENABLED/);
  assert.doesNotMatch(deploy, /vars\.MULTIPLAYER_TICKET/);
  assert.doesNotMatch(deploy, /secrets\.MULTIPLAYER_TICKET/);
  assert.doesNotMatch(deploy, /^\s+ADMIN_USER_IDS:\s*\$\{\{ vars\.ADMIN_USER_IDS/gm);
  assert.doesNotMatch(deploy, /vars\.(?:YOUTUBE|TWITCH|CHZZK|SOOP)_/);
  assert.doesNotMatch(deploy, /secrets\.(?:YOUTUBE|TWITCH|CHZZK|SOOP)_/);
  assert.doesNotMatch(deploy, /publish:official-games/);
  assert.doesNotMatch(deploy, /bootstrap:official-games/);
  assert.doesNotMatch(deploy, /pnpm discord:commands:register(?:\s|$)/m);
  assert.match(deploy, /pnpm discord:commands:register:guild/);
  assert.match(
    packageJson,
    /owogg-d1-staging --remote --env staging --config apps\/api\/wrangler\.staging\.generated\.jsonc --x-provision=false --x-auto-create=false/,
  );
  assert.match(deploy, /STAGING_ADMIN_USER_IDS/);
  assert.match(deploy, /STAGING_ADMIN_SESSION_TTL_SECONDS: "43200"/);
  assert.match(deploy, /ADMIN_SESSION_TTL_SECONDS:43200/);
  assert.doesNotMatch(productionDeploy, /ADMIN_SESSION_TTL_SECONDS/);
  assert.match(deploy, /MULTIPLAYER_ENABLED:\$\{\{ vars\.STAGING_MULTIPLAYER_ENABLED \}\}/);
  assert.match(deploy, /MULTIPLAYER_SOCKET_ORIGIN:https:\/\/api-stg\.owogg\.com/);
  assert.match(
    deploy,
    /MULTIPLAYER_TICKET_KEY_ID:\$\{\{ vars\.STAGING_MULTIPLAYER_TICKET_KEY_ID \}\}/,
  );
  assert.match(
    deploy,
    /STAGING_MULTIPLAYER_TICKET_SECRET: \$\{\{ secrets\.STAGING_MULTIPLAYER_TICKET_SECRET \}\}/,
  );
  assert.match(deploy, /GOOGLE_CLIENT_SECRET: \$\{\{ secrets\.GOOGLE_CLIENT_SECRET \}\}/);
  assert.match(deploy, /put_secret GOOGLE_CLIENT_SECRET/);
  assert.match(
    deploy,
    /STAGING_STREAMER_ENABLED_PROVIDERS: \$\{\{ vars\.STAGING_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
  assert.match(
    deploy,
    /STREAMER_ENABLED_PROVIDERS:\$\{\{ vars\.STAGING_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
  for (const platform of ["YOUTUBE", "TWITCH", "CHZZK"]) {
    assert.match(
      deploy,
      new RegExp(`${platform}_CLIENT_ID:\\\$\\{\\{ vars\\.STAGING_${platform}_CLIENT_ID \\}\\}`),
    );
    assert.match(
      deploy,
      new RegExp(
        `${platform}_REDIRECT_URI:\\\$\\{\\{ vars\\.STAGING_${platform}_REDIRECT_URI \\}\\}`,
      ),
    );
    assert.match(
      deploy,
      new RegExp(
        `STAGING_${platform}_CLIENT_SECRET: \\\$\\{\\{ secrets\\.STAGING_${platform}_CLIENT_SECRET \\}\\}`,
      ),
    );
    assert.match(deploy, new RegExp(`put_optional_secret ${platform}_CLIENT_SECRET`));
  }
  assert.match(deploy, /STAGING_YOUTUBE_API_KEY: \$\{\{ secrets\.STAGING_YOUTUBE_API_KEY \}\}/);
  assert.match(deploy, /put_optional_secret YOUTUBE_API_KEY/);
  assert.doesNotMatch(deploy, /STAGING_SOOP_/);
  assert.match(
    deploy,
    /put_secret MULTIPLAYER_TICKET_SECRET "\$STAGING_MULTIPLAYER_TICKET_SECRET"/,
  );
  assert.match(
    deploy,
    /put_optional_secret MULTIPLAYER_TICKET_PREVIOUS_SECRET "\$STAGING_MULTIPLAYER_TICKET_PREVIOUS_SECRET"/,
  );
  assert.match(deploy, /smoke:prod --api-only --allow-empty-catalog/);
  assert.match(
    deploy,
    /STREAMER_ENABLED_PROVIDERS: \$\{\{ vars\.STAGING_STREAMER_ENABLED_PROVIDERS \}\}/,
  );
  assert.match(deploy, /smoke:prod --web-only --allow-empty-catalog/);
  assert.doesNotMatch(productionDeploy, /allow-empty-catalog/);
});
