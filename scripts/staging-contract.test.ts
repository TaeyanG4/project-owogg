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
    MULTIPLAYER_TICKET_KEY_ID: "staging_2026_08_a",
    MULTIPLAYER_TICKET_SECRET: "m".repeat(32),
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

test("Staging multiplayer ticket keys are strong, paired and rotation-safe", () => {
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      MULTIPLAYER_TICKET_SECRET: "too-short",
    }).join("\n"),
    /at least 32 UTF-8 bytes/,
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_07_z",
    }).join("\n"),
    /must be configured together/,
  );
  assert.deepEqual(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_07_z",
      MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
    }),
    [],
  );
  assert.match(
    validateStagingEnvironment({
      ...validStagingEnvironment(),
      MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "staging_2026_08_a",
      MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
    }).join("\n"),
    /key IDs must differ/,
  );
});

test("Staging multiplayer activation is explicit and boolean", () => {
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
  assert.doesNotMatch(deploy, /^\s+ADMIN_USER_IDS:\s*\$\{\{ vars\.ADMIN_USER_IDS/gm);
  assert.doesNotMatch(deploy, /vars\.(?:YOUTUBE|TWITCH|CHZZK|SOOP)_/);
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
  assert.match(
    deploy,
    /MULTIPLAYER_ENABLED:\$\{\{ vars\.STAGING_MULTIPLAYER_ENABLED \|\| 'false' \}\}/,
  );
  assert.match(deploy, /MULTIPLAYER_SOCKET_ORIGIN:https:\/\/api-stg\.owogg\.com/);
  assert.match(deploy, /MULTIPLAYER_TICKET_KEY_ID:\$\{\{ vars\.MULTIPLAYER_TICKET_KEY_ID \}\}/);
  assert.match(deploy, /GOOGLE_CLIENT_SECRET: \$\{\{ secrets\.GOOGLE_CLIENT_SECRET \}\}/);
  assert.match(deploy, /put_secret GOOGLE_CLIENT_SECRET/);
  assert.match(deploy, /put_secret MULTIPLAYER_TICKET_SECRET/);
  assert.match(deploy, /put_optional_secret MULTIPLAYER_TICKET_PREVIOUS_SECRET/);
  assert.match(deploy, /smoke:prod --api-only --allow-empty-catalog/);
  assert.match(deploy, /smoke:prod --web-only --allow-empty-catalog/);
  assert.doesNotMatch(productionDeploy, /allow-empty-catalog/);
});
