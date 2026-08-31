import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateProductionDeploymentEnvironment,
  verifyProductionD1Target,
} from "./production-deployment-contract.js";
import { parseJsonc, PRODUCTION, type WranglerConfig } from "./staging-contract.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiConfig = parseJsonc<WranglerConfig>(
  fs.readFileSync(path.join(repoRoot, "apps", "api", "wrangler.jsonc"), "utf8"),
);

function validProductionEnvironment(): Record<string, string> {
  return {
    PRODUCTION_D1_DATABASE_ID: PRODUCTION.d1Id,
    PRODUCTION_MULTIPLAYER_ENABLED: "false",
    PRODUCTION_MULTIPLAYER_TICKET_KEY_ID: "production_2026_09_a",
    PRODUCTION_MULTIPLAYER_TICKET_SECRET: "m".repeat(32),
    PRODUCTION_STREAMER_ENABLED_PROVIDERS: "YOUTUBE,TWITCH,CHZZK",
    PRODUCTION_YOUTUBE_CLIENT_ID: "production-youtube-client",
    PRODUCTION_YOUTUBE_CLIENT_SECRET: "production-youtube-secret",
    PRODUCTION_YOUTUBE_API_KEY: "production-youtube-api-key",
    PRODUCTION_YOUTUBE_REDIRECT_URI: `${PRODUCTION.apiUrl}/api/streamers/verify/youtube/callback`,
    PRODUCTION_TWITCH_CLIENT_ID: "production-twitch-client",
    PRODUCTION_TWITCH_CLIENT_SECRET: "production-twitch-secret",
    PRODUCTION_TWITCH_REDIRECT_URI: `${PRODUCTION.apiUrl}/api/streamers/verify/twitch/callback`,
    PRODUCTION_CHZZK_CLIENT_ID: "production-chzzk-client",
    PRODUCTION_CHZZK_CLIENT_SECRET: "production-chzzk-secret",
    PRODUCTION_CHZZK_REDIRECT_URI: `${PRODUCTION.apiUrl}/api/streamers/verify/chzzk/callback`,
  };
}

test("Production deployment contract accepts the exact prefixed Repository inputs", () => {
  assert.deepEqual(
    validateProductionDeploymentEnvironment(validProductionEnvironment(), apiConfig),
    [],
  );
});

test("Production deployment contract rejects missing, generic, or malformed multiplayer inputs", () => {
  const genericOnly = validProductionEnvironment();
  delete genericOnly.PRODUCTION_MULTIPLAYER_TICKET_KEY_ID;
  delete genericOnly.PRODUCTION_MULTIPLAYER_TICKET_SECRET;
  genericOnly.MULTIPLAYER_TICKET_KEY_ID = "generic-key";
  genericOnly.MULTIPLAYER_TICKET_SECRET = "g".repeat(32);
  const missingErrors = validateProductionDeploymentEnvironment(genericOnly, apiConfig).join("\n");
  assert.match(missingErrors, /PRODUCTION_MULTIPLAYER_TICKET_KEY_ID is required/);
  assert.match(missingErrors, /PRODUCTION_MULTIPLAYER_TICKET_SECRET is required/);

  assert.match(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_ENABLED: "enabled",
        PRODUCTION_MULTIPLAYER_TICKET_SECRET: "too-short",
      },
      apiConfig,
    ).join("\n"),
    /PRODUCTION_MULTIPLAYER_ENABLED must be true or false/,
  );
  assert.match(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_ENABLED: "enabled",
        PRODUCTION_MULTIPLAYER_TICKET_SECRET: "too-short",
      },
      apiConfig,
    ).join("\n"),
    /PRODUCTION_MULTIPLAYER_TICKET_SECRET must be at least 32 UTF-8 bytes/,
  );
  assert.match(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_TICKET_KEY_ID: "staging_2026_09_a",
      },
      apiConfig,
    ).join("\n"),
    /PRODUCTION_MULTIPLAYER_TICKET_KEY_ID must start with production_/,
  );
});

test("Production multiplayer ticket rotation requires a complete distinct previous pair", () => {
  assert.match(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "production_2026_08_z",
      },
      apiConfig,
    ).join("\n"),
    /must be configured together/,
  );
  assert.deepEqual(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "production_2026_08_z",
        PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
      },
      apiConfig,
    ),
    [],
  );
  assert.match(
    validateProductionDeploymentEnvironment(
      {
        ...validProductionEnvironment(),
        PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_KEY_ID: "production_2026_09_a",
        PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_SECRET: "p".repeat(32),
      },
      apiConfig,
    ).join("\n"),
    /active and previous multiplayer ticket key IDs must differ/,
  );
});

test("Production D1 guard matches committed config and the exact remote name/UUID", () => {
  assert.equal(
    verifyProductionD1Target([{ name: PRODUCTION.d1Name, uuid: PRODUCTION.d1Id }], PRODUCTION.d1Id)
      .name,
    PRODUCTION.d1Name,
  );
  assert.throws(
    () =>
      verifyProductionD1Target(
        [{ name: PRODUCTION.d1Name, uuid: "11111111-1111-4111-8111-111111111111" }],
        PRODUCTION.d1Id,
      ),
    /does not match PRODUCTION_D1_DATABASE_ID/,
  );

  const crossedConfig = structuredClone(apiConfig);
  if (crossedConfig.d1_databases?.[0]) {
    crossedConfig.d1_databases[0].database_id = "11111111-1111-4111-8111-111111111111";
  }
  assert.match(
    validateProductionDeploymentEnvironment(validProductionEnvironment(), crossedConfig).join("\n"),
    /Committed Production D1 UUID/,
  );
});

test("Production workflow preflights prefixed D1 and multiplayer values before any mutation", () => {
  const deploy = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "deploy.yml"), "utf8");
  const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");

  assert.doesNotMatch(deploy, /^\s+environment:\s+production$/m);
  assert.match(packageJson, /"production:preflight"/);
  assert.match(packageJson, /d1 migrations apply DB --remote --env=\\"\\"/);
  assert.match(deploy, /wrangler d1 list --json/);
  assert.match(deploy, /PRODUCTION_D1_DATABASE_ID: \$\{\{ vars\.PRODUCTION_D1_DATABASE_ID \}\}/);
  assert.ok(deploy.indexOf("wrangler d1 list --json") < deploy.indexOf("production:preflight"));
  assert.ok(
    deploy.indexOf("production:preflight") < deploy.indexOf("Apply D1 Migrations to Production"),
  );

  assert.doesNotMatch(deploy, /\$\{\{ vars\.MULTIPLAYER_(?:ENABLED|TICKET)/);
  assert.doesNotMatch(deploy, /\$\{\{ secrets\.MULTIPLAYER_TICKET/);
  assert.match(deploy, /MULTIPLAYER_ENABLED:\$\{\{ vars\.PRODUCTION_MULTIPLAYER_ENABLED \}\}/);
  assert.match(deploy, /MULTIPLAYER_SOCKET_ORIGIN:https:\/\/api\.owogg\.com/);
  assert.match(
    deploy,
    /MULTIPLAYER_TICKET_KEY_ID:\$\{\{ vars\.PRODUCTION_MULTIPLAYER_TICKET_KEY_ID \}\}/,
  );
  assert.match(
    deploy,
    /PRODUCTION_MULTIPLAYER_TICKET_SECRET: \$\{\{ secrets\.PRODUCTION_MULTIPLAYER_TICKET_SECRET \}\}/,
  );
  assert.match(
    deploy,
    /put_secret MULTIPLAYER_TICKET_SECRET "\$PRODUCTION_MULTIPLAYER_TICKET_SECRET"/,
  );
  assert.match(deploy, /wrangler secret put "\$name" --env="" --config wrangler\.jsonc/);
  assert.match(deploy, /^\s+command: deploy --env=""$/m);
  assert.match(
    deploy,
    /put_optional_secret MULTIPLAYER_TICKET_PREVIOUS_SECRET "\$PRODUCTION_MULTIPLAYER_TICKET_PREVIOUS_SECRET"/,
  );
});
