import { validateStreamerOAuthEnvironment } from "./streamer-provider-contract.js";
import { validateMultiplayerDeploymentEnvironment } from "./multiplayer-deployment-contract.js";

export const PRODUCTION = {
  frontendUrl: "https://owogg.com",
  apiUrl: "https://api.owogg.com",
  gameOrigin: "https://play.owogg.com",
  d1Name: "owogg-d1",
  d1Id: "4668dc75-0d25-43fa-9a8b-38bf78271655",
  b2Bucket: "owogg-game-bundles",
  apiWorker: "owogg-api",
  webWorker: "owogg-web",
} as const;

export const STAGING = {
  frontendUrl: "https://stg.owogg.com",
  apiUrl: "https://api-stg.owogg.com",
  gameOrigin: "https://play-stg.owogg.com",
  d1Name: "owogg-d1-staging",
  b2Bucket: "owogg-game-bundles-staging",
  apiWorker: "owogg-api-staging",
  webWorker: "owogg-web-staging",
} as const;

/**
 * A deliberately unusable ID committed in wrangler.jsonc. CI replaces it only after the
 * operator-provided STAGING_D1_DATABASE_ID has been matched against `wrangler d1 list --json`.
 */
export const STAGING_D1_ID_SENTINEL = "00000000-0000-0000-0000-000000000000";

type Environment = Record<string, string | undefined>;

export interface WranglerRoute {
  pattern?: string;
  custom_domain?: boolean;
}

export interface WranglerD1Database {
  binding?: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
}

export interface WranglerRateLimit {
  name?: string;
  namespace_id?: string;
}

export interface WranglerDurableObjectBinding {
  name?: string;
  class_name?: string;
  script_name?: string;
}

export interface WranglerExport {
  type?: string;
  storage?: string;
}

export interface WranglerEnvironment {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: WranglerRoute[];
  d1_databases?: WranglerD1Database[];
  ratelimits?: WranglerRateLimit[];
  durable_objects?: { bindings?: WranglerDurableObjectBinding[] };
  exports?: Record<string, WranglerExport>;
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
}

export interface WranglerConfig extends WranglerEnvironment {
  env?: Record<string, WranglerEnvironment>;
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index++) {
    const current = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }

    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index++;
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        if (input[index] === "\n") output += "\n";
        index++;
      }
      index++;
      continue;
    }

    output += current;
  }

  return output;
}

/** Parse the JSON-with-comments/trailing-commas format Wrangler accepts. */
export function parseJsonc<T>(input: string): T {
  const withoutComments = stripJsonComments(input);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas) as T;
}

function routePatterns(environment: WranglerEnvironment | undefined): string[] {
  return (environment?.routes ?? [])
    .map((route) => route.pattern)
    .filter((pattern): pattern is string => Boolean(pattern));
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

export function validateWranglerStagingContracts(
  api: WranglerConfig,
  web: WranglerConfig,
): string[] {
  const errors: string[] = [];
  const apiStaging = api.env?.staging;
  const webStaging = web.env?.staging;

  if (!apiStaging) errors.push("apps/api/wrangler.jsonc is missing env.staging");
  if (!webStaging) errors.push("apps/web/wrangler.jsonc is missing env.staging");
  if (!apiStaging || !webStaging) return errors;

  if (api.name !== PRODUCTION.apiWorker) errors.push("API top-level Worker name changed");
  if (web.name !== PRODUCTION.webWorker) errors.push("Web top-level Worker name changed");
  if (apiStaging.name && apiStaging.name !== STAGING.apiWorker) {
    errors.push(`Staging API Worker must be ${STAGING.apiWorker}`);
  }
  if (webStaging.name && webStaging.name !== STAGING.webWorker) {
    errors.push(`Staging Web Worker must be ${STAGING.webWorker}`);
  }

  for (const [label, environment] of [
    ["API", apiStaging],
    ["Web", webStaging],
  ] as const) {
    if (environment.workers_dev !== false)
      errors.push(`${label} staging workers_dev must be false`);
    if (environment.preview_urls !== false) {
      errors.push(`${label} staging preview_urls must be false`);
    }
  }

  const expectedApiRoutes = [
    new URL(STAGING.apiUrl).hostname,
    new URL(STAGING.gameOrigin).hostname,
  ];
  const expectedWebRoutes = [new URL(STAGING.frontendUrl).hostname];
  const apiRoutes = routePatterns(apiStaging);
  const webRoutes = routePatterns(webStaging);
  if (!sameMembers(apiRoutes, expectedApiRoutes)) {
    errors.push(`Staging API routes must be exactly ${expectedApiRoutes.join(", ")}`);
  }
  if (!sameMembers(webRoutes, expectedWebRoutes)) {
    errors.push(`Staging Web routes must be exactly ${expectedWebRoutes.join(", ")}`);
  }
  for (const route of [...apiRoutes, ...webRoutes]) {
    if (["owogg.com", "api.owogg.com", "play.owogg.com", "www.owogg.com"].includes(route)) {
      errors.push(`Staging route overlaps Production: ${route}`);
    }
  }
  for (const route of [...(apiStaging.routes ?? []), ...(webStaging.routes ?? [])]) {
    if (route.custom_domain !== true)
      errors.push(`Staging route is not a custom domain: ${route.pattern}`);
  }

  const databases = apiStaging.d1_databases ?? [];
  if (databases.length !== 1) errors.push("Staging API must have exactly one D1 binding");
  const database = databases[0];
  if (database?.binding !== "DB") errors.push("Staging D1 binding must be DB");
  if (database?.database_name !== STAGING.d1Name) {
    errors.push(`Staging D1 name must be ${STAGING.d1Name}`);
  }
  if (!database?.database_id) errors.push("Staging D1 ID is missing");
  if (database?.database_id === PRODUCTION.d1Id)
    errors.push("Staging D1 ID equals Production D1 ID");

  if ((apiStaging.triggers?.crons ?? []).length !== 0) {
    errors.push("Staging Cron triggers must be explicitly empty");
  }

  const productionNamespaces = new Set(
    (api.ratelimits ?? []).map((binding) => binding.namespace_id).filter(Boolean),
  );
  const stagingNamespaces = (apiStaging.ratelimits ?? [])
    .map((binding) => binding.namespace_id)
    .filter((value): value is string => Boolean(value));
  const expectedRateLimitBindings = [
    "RATE_LIMITER",
    "GAME_UPLOAD_RATE_LIMITER",
    "MULTIPLAYER_RATE_LIMITER",
    "MULTIPLAYER_RECOVERY_RATE_LIMITER",
  ];
  const productionRateLimitNames = (api.ratelimits ?? [])
    .map((binding) => binding.name)
    .filter((value): value is string => Boolean(value));
  const stagingRateLimitNames = (apiStaging.ratelimits ?? [])
    .map((binding) => binding.name)
    .filter((value): value is string => Boolean(value));
  if (!sameMembers(productionRateLimitNames, expectedRateLimitBindings)) {
    errors.push("Production API rate-limit bindings do not match the required set");
  }
  if (!sameMembers(stagingRateLimitNames, expectedRateLimitBindings)) {
    errors.push("Staging API rate-limit bindings do not match the required set");
  }
  if (stagingNamespaces.length !== 4 || new Set(stagingNamespaces).size !== 4) {
    errors.push("Staging must have four distinct rate-limit namespaces");
  }
  for (const namespace of stagingNamespaces) {
    if (productionNamespaces.has(namespace)) {
      errors.push(`Staging rate-limit namespace overlaps Production: ${namespace}`);
    }
  }

  const validateMultiplayerRuntime = (
    label: "Production" | "Staging",
    environment: WranglerEnvironment,
    expectedOrigin: string,
  ): void => {
    const bindings = environment.durable_objects?.bindings ?? [];
    const expectedBindings = [
      { name: "MULTIPLAYER_INSTANCES", className: "MultiplayerInstanceObject" },
      { name: "MULTIPLAYER_LOBBY_SIGNALS", className: "MultiplayerLobbySignalObject" },
    ] as const;
    if (
      bindings.length !== expectedBindings.length ||
      expectedBindings.some(
        (expected) =>
          !bindings.some(
            (binding) =>
              binding.name === expected.name &&
              binding.class_name === expected.className &&
              binding.script_name === undefined,
          ),
      )
    ) {
      errors.push(`${label} multiplayer Durable Objects must be environment-local self bindings`);
    }
    for (const expected of expectedBindings) {
      const exported = environment.exports?.[expected.className];
      if (exported?.type !== "durable-object" || exported.storage !== "sqlite") {
        errors.push(`${label} ${expected.className} must be exported with SQLite storage`);
      }
    }
    if (environment.vars?.MULTIPLAYER_ENABLED !== "false") {
      errors.push(`${label} multiplayer must remain feature-disabled in committed config`);
    }
    if (environment.vars?.MULTIPLAYER_SOCKET_ORIGIN !== expectedOrigin) {
      errors.push(`${label} multiplayer socket origin does not match its API environment`);
    }
  };
  validateMultiplayerRuntime("Production", api, PRODUCTION.apiUrl);
  validateMultiplayerRuntime("Staging", apiStaging, STAGING.apiUrl);

  if (api.vars?.ADMIN_SESSION_TTL_SECONDS !== undefined) {
    errors.push("Production must keep the default admin session lifetime");
  }
  if (apiStaging.vars?.ADMIN_SESSION_TTL_SECONDS !== "43200") {
    errors.push("Staging admin session lifetime must be exactly 43200 seconds");
  }

  return errors;
}

function required(env: Environment, name: string, errors: string[]): string {
  const value = env[name]?.trim() ?? "";
  if (!value) errors.push(`${name} is required`);
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateDiscordInstallUrl(value: string, clientId: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["discord.com", "www.discord.com"].includes(url.hostname) &&
      url.searchParams.get("client_id") === clientId
    );
  } catch {
    return false;
  }
}

export function validateStagingEnvironment(env: Environment): string[] {
  const errors: string[] = [];
  const frontendUrl = required(env, "FRONTEND_URL", errors);
  const apiUrl = required(env, "VITE_API_URL", errors);
  const gameOrigin = required(env, "GAME_ORIGIN", errors);
  const viteGameOrigin = required(env, "VITE_GAME_ORIGIN", errors);
  const b2Bucket = required(env, "B2_BUCKET_NAME", errors);
  const googleClientId = required(env, "GOOGLE_CLIENT_ID", errors);
  const googleClientSecret = required(env, "GOOGLE_CLIENT_SECRET", errors);
  const viteGoogleClientId = required(env, "VITE_GOOGLE_CLIENT_ID", errors);
  const discordClientId = required(env, "DISCORD_CLIENT_ID", errors);
  const discordRedirectUri = required(env, "DISCORD_REDIRECT_URI", errors);
  const discordPublicKey = required(env, "DISCORD_PUBLIC_KEY", errors);
  const discordTestGuildId = required(env, "DISCORD_TEST_GUILD_ID", errors);
  const discordInstallUrl = required(env, "DISCORD_INSTALL_URL", errors);
  const d1Id = required(env, "STAGING_D1_DATABASE_ID", errors);
  const adminSessionTtlSeconds = (env.STAGING_ADMIN_SESSION_TTL_SECONDS ?? "").trim();

  if (frontendUrl !== STAGING.frontendUrl)
    errors.push(`FRONTEND_URL must equal ${STAGING.frontendUrl}`);
  if (apiUrl !== STAGING.apiUrl) errors.push(`VITE_API_URL must equal ${STAGING.apiUrl}`);
  if (gameOrigin !== STAGING.gameOrigin)
    errors.push(`GAME_ORIGIN must equal ${STAGING.gameOrigin}`);
  if (viteGameOrigin !== gameOrigin) errors.push("VITE_GAME_ORIGIN must equal GAME_ORIGIN");
  if (b2Bucket !== STAGING.b2Bucket) errors.push(`B2_BUCKET_NAME must equal ${STAGING.b2Bucket}`);
  if (googleClientId !== viteGoogleClientId) {
    errors.push("GOOGLE_CLIENT_ID must equal VITE_GOOGLE_CLIENT_ID");
  }
  if (env.GOOGLE_CLIENT_SECRET !== googleClientSecret) {
    errors.push("GOOGLE_CLIENT_SECRET must not have surrounding whitespace");
  }
  if ((env.DISCORD_COMMAND_SYNC_ENABLED ?? "").trim() !== "false") {
    errors.push("DISCORD_COMMAND_SYNC_ENABLED must be exactly false in Staging");
  }
  if (discordRedirectUri !== `${STAGING.apiUrl}/api/auth/discord/callback`) {
    errors.push(`DISCORD_REDIRECT_URI must use ${STAGING.apiUrl}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(discordPublicKey)) {
    errors.push("DISCORD_PUBLIC_KEY must be a 64-character hexadecimal key");
  }
  if (!/^\d+$/.test(discordTestGuildId)) {
    errors.push("DISCORD_TEST_GUILD_ID must be a Discord numeric ID");
  }
  if (!validateDiscordInstallUrl(discordInstallUrl, discordClientId)) {
    errors.push("DISCORD_INSTALL_URL must be an HTTPS Discord URL using Staging DISCORD_CLIENT_ID");
  }
  if (d1Id && (!isUuid(d1Id) || d1Id === STAGING_D1_ID_SENTINEL)) {
    errors.push("STAGING_D1_DATABASE_ID must be the operator-provided UUID, not a placeholder");
  }
  if (d1Id === PRODUCTION.d1Id) errors.push("Staging D1 ID must not equal Production D1 ID");

  if (adminSessionTtlSeconds !== "43200") {
    errors.push("STAGING_ADMIN_SESSION_TTL_SECONDS must be exactly 43200");
  }

  errors.push(
    ...validateMultiplayerDeploymentEnvironment(env, {
      deploymentLabel: "Staging",
      variablePrefix: "STAGING_",
    }),
  );

  errors.push(
    ...validateStreamerOAuthEnvironment(env, {
      deploymentLabel: "Staging",
      apiUrl: STAGING.apiUrl,
      variablePrefix: "STAGING_",
    }),
  );

  const adminIds = env.STAGING_ADMIN_USER_IDS?.trim() ?? "";
  if (adminIds && !adminIds.split(",").every((id) => /^[1-9]\d*$/.test(id.trim()))) {
    errors.push("STAGING_ADMIN_USER_IDS must be empty or a comma-separated list of positive IDs");
  }
  for (const secret of [
    "B2_APPLICATION_KEY",
    "B2_ENDPOINT",
    "B2_KEY_ID",
    "B2_REGION",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_SECRET",
    "GAME_SESSION_SECRET",
  ]) {
    required(env, secret, errors);
  }

  const webSmokeEnabled = (env.STAGING_WEB_SMOKE_ENABLED ?? "false").trim();
  if (!["true", "false"].includes(webSmokeEnabled)) {
    errors.push("STAGING_WEB_SMOKE_ENABLED must be true or false");
  }
  if (webSmokeEnabled === "true") {
    required(env, "CF_ACCESS_CLIENT_ID", errors);
    required(env, "CF_ACCESS_CLIENT_SECRET", errors);
  }

  return errors;
}

export function assertNoContractErrors(errors: readonly string[], label: string): void {
  if (errors.length === 0) return;
  throw new Error(`${label} failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

export interface D1ListEntry {
  name?: string;
  uuid?: string;
  id?: string;
  database_id?: string;
}

function unwrapD1List(value: unknown): D1ListEntry[] {
  if (Array.isArray(value)) return value as D1ListEntry[];
  if (value && typeof value === "object" && Array.isArray((value as { result?: unknown }).result)) {
    return (value as { result: D1ListEntry[] }).result;
  }
  throw new Error("Unexpected `wrangler d1 list --json` response shape");
}

export function verifyStagingD1Target(value: unknown, expectedId: string): D1ListEntry {
  if (!isUuid(expectedId) || expectedId === STAGING_D1_ID_SENTINEL) {
    throw new Error("STAGING_D1_DATABASE_ID is missing or is not a real UUID");
  }
  if (expectedId === PRODUCTION.d1Id) throw new Error("Staging D1 ID equals Production D1 ID");

  const matches = unwrapD1List(value).filter((entry) => entry.name === STAGING.d1Name);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one remote D1 named ${STAGING.d1Name}; found ${matches.length}`,
    );
  }
  const match = matches[0] as D1ListEntry;
  const actualId = match.uuid ?? match.id ?? match.database_id;
  if (actualId !== expectedId) {
    throw new Error(`Remote ${STAGING.d1Name} UUID does not match STAGING_D1_DATABASE_ID`);
  }
  if (actualId === PRODUCTION.d1Id) throw new Error("Remote Staging D1 is the Production D1");
  return match;
}

export function materializeStagingWranglerConfig(source: string, d1Id: string): string {
  if (!isUuid(d1Id) || d1Id === STAGING_D1_ID_SENTINEL || d1Id === PRODUCTION.d1Id) {
    throw new Error("Refusing to materialize Wrangler config with an unsafe Staging D1 ID");
  }
  const occurrences = source.split(STAGING_D1_ID_SENTINEL).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one Staging D1 sentinel in Wrangler config; found ${occurrences}`,
    );
  }
  return source.replace(STAGING_D1_ID_SENTINEL, d1Id);
}

export function resolveSmokeTargets(env: Environment): { apiUrl: string; webUrl: string } {
  return {
    apiUrl: resolveSmokeUrl(env.SMOKE_API_URL, PRODUCTION.apiUrl, "SMOKE_API_URL"),
    webUrl: resolveSmokeUrl(env.SMOKE_WEB_URL, PRODUCTION.frontendUrl, "SMOKE_WEB_URL"),
  };
}

export interface PublicGameDeploymentTarget {
  slug: string;
  mediaUrl: string | null;
}

export function parsePublicGameDeploymentTargets(
  value: unknown,
  options: { allowEmpty?: boolean } = {},
): PublicGameDeploymentTarget[] {
  if (!value || typeof value !== "object") {
    throw new Error("GET /api/games returned a malformed public catalog");
  }

  const games = (value as { games?: unknown }).games;
  if (!Array.isArray(games)) {
    throw new Error("GET /api/games returned a malformed public catalog");
  }
  if (games.length === 0 && !options.allowEmpty) {
    throw new Error("GET /api/games returned an empty public catalog");
  }

  const seen = new Set<string>();
  return games.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`GET /api/games item ${index} is not an object`);
    }
    const { slug, mediaUrl } = candidate as { slug?: unknown; mediaUrl?: unknown };
    if (typeof slug !== "string" || !slug.trim() || seen.has(slug)) {
      throw new Error(`GET /api/games item ${index} has an invalid or duplicate slug`);
    }
    if (mediaUrl !== null && typeof mediaUrl !== "string") {
      throw new Error(`GET /api/games item ${index} has an invalid mediaUrl`);
    }
    seen.add(slug);
    return { slug, mediaUrl };
  });
}

function resolveSmokeUrl(value: string | undefined, fallback: string, name: string): string {
  const candidate = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free HTTPS base URL`);
  }
  if (url.pathname !== "/") throw new Error(`${name} must not contain a path`);
  return url.origin;
}

export interface WorkerDomain {
  hostname?: string;
  service?: string;
  environment?: string;
}

function isStagingAssignment(
  domain: WorkerDomain,
  baseService: string,
  stagingService: string,
): boolean {
  return (
    domain.service === stagingService ||
    (domain.service === baseService && domain.environment === "staging")
  );
}

export function validateCloudflareDomainAssignments(domains: readonly WorkerDomain[]): string[] {
  const errors: string[] = [];
  const stagingAssignments = new Map<string, { base: string; staging: string }>([
    [new URL(STAGING.apiUrl).hostname, { base: PRODUCTION.apiWorker, staging: STAGING.apiWorker }],
    [
      new URL(STAGING.gameOrigin).hostname,
      { base: PRODUCTION.apiWorker, staging: STAGING.apiWorker },
    ],
    [
      new URL(STAGING.frontendUrl).hostname,
      { base: PRODUCTION.webWorker, staging: STAGING.webWorker },
    ],
  ]);
  const productionAssignments = new Map<string, { base: string; staging: string }>([
    [
      new URL(PRODUCTION.apiUrl).hostname,
      { base: PRODUCTION.apiWorker, staging: STAGING.apiWorker },
    ],
    [
      new URL(PRODUCTION.gameOrigin).hostname,
      { base: PRODUCTION.apiWorker, staging: STAGING.apiWorker },
    ],
    [
      new URL(PRODUCTION.frontendUrl).hostname,
      { base: PRODUCTION.webWorker, staging: STAGING.webWorker },
    ],
  ]);

  for (const [hostname, expected] of stagingAssignments) {
    const matches = domains.filter((domain) => domain.hostname === hostname);
    if (matches.length > 1)
      errors.push(`Cloudflare returned duplicate Worker domains for ${hostname}`);
    for (const domain of matches) {
      if (!isStagingAssignment(domain, expected.base, expected.staging)) {
        errors.push(`${hostname} is already assigned to a non-Staging Worker`);
      }
    }
  }

  for (const [hostname, expected] of productionAssignments) {
    for (const domain of domains.filter((candidate) => candidate.hostname === hostname)) {
      if (isStagingAssignment(domain, expected.base, expected.staging)) {
        errors.push(`Production domain ${hostname} is assigned to a Staging Worker`);
      }
    }
  }

  return errors;
}
