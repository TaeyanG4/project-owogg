import { validateMultiplayerDeploymentEnvironment } from "./multiplayer-deployment-contract.js";
import {
  PRODUCTION,
  STAGING_D1_ID_SENTINEL,
  type D1ListEntry,
  type WranglerConfig,
} from "./staging-contract.js";
import { validateStreamerOAuthEnvironment } from "./streamer-provider-contract.js";

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string, errors: string[]): string {
  const value = env[name]?.trim() ?? "";
  if (!value) errors.push(`${name} is required`);
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function unwrapD1List(value: unknown): D1ListEntry[] {
  if (Array.isArray(value)) return value as D1ListEntry[];
  if (value && typeof value === "object" && Array.isArray((value as { result?: unknown }).result)) {
    return (value as { result: D1ListEntry[] }).result;
  }
  throw new Error("Unexpected `wrangler d1 list --json` response shape");
}

/** Validate Repository-scoped Production inputs before the first deployment mutation. */
export function validateProductionDeploymentEnvironment(
  env: Environment,
  apiConfig: WranglerConfig,
): string[] {
  const errors: string[] = [];
  const d1Id = required(env, "PRODUCTION_D1_DATABASE_ID", errors);

  if (d1Id && (!isUuid(d1Id) || d1Id === STAGING_D1_ID_SENTINEL)) {
    errors.push("PRODUCTION_D1_DATABASE_ID must be a real UUID, not a placeholder");
  }

  const databases = apiConfig.d1_databases ?? [];
  if (databases.length !== 1) {
    errors.push("Production API must have exactly one D1 binding");
  }
  const database = databases[0];
  if (database?.binding !== "DB") errors.push("Production D1 binding must be DB");
  if (database?.database_name !== PRODUCTION.d1Name) {
    errors.push(`Production D1 name must be ${PRODUCTION.d1Name}`);
  }
  if (database?.database_id !== PRODUCTION.d1Id) {
    errors.push("Committed Production D1 UUID does not match the Production target contract");
  }
  if (d1Id && database?.database_id !== d1Id) {
    errors.push("PRODUCTION_D1_DATABASE_ID does not match apps/api/wrangler.jsonc");
  }

  if (apiConfig.vars?.MULTIPLAYER_ENABLED !== "false") {
    errors.push("Committed Production multiplayer default must remain false");
  }
  if (apiConfig.vars?.MULTIPLAYER_SOCKET_ORIGIN !== PRODUCTION.apiUrl) {
    errors.push(`Committed Production multiplayer socket origin must be ${PRODUCTION.apiUrl}`);
  }

  errors.push(
    ...validateMultiplayerDeploymentEnvironment(env, {
      deploymentLabel: "Production",
      variablePrefix: "PRODUCTION_",
    }),
  );
  errors.push(
    ...validateStreamerOAuthEnvironment(env, {
      deploymentLabel: "Production",
      apiUrl: PRODUCTION.apiUrl,
      variablePrefix: "PRODUCTION_",
    }),
  );

  return errors;
}

/** Cross-check the independent Repository variable against Cloudflare's read-only D1 list. */
export function verifyProductionD1Target(value: unknown, expectedId: string): D1ListEntry {
  if (!isUuid(expectedId) || expectedId === STAGING_D1_ID_SENTINEL) {
    throw new Error("PRODUCTION_D1_DATABASE_ID is missing or is not a real UUID");
  }
  if (expectedId !== PRODUCTION.d1Id) {
    throw new Error("PRODUCTION_D1_DATABASE_ID does not match the Production target contract");
  }

  const matches = unwrapD1List(value).filter((entry) => entry.name === PRODUCTION.d1Name);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one remote D1 named ${PRODUCTION.d1Name}; found ${matches.length}`,
    );
  }
  const match = matches[0] as D1ListEntry;
  const actualId = match.uuid ?? match.id ?? match.database_id;
  if (actualId !== expectedId) {
    throw new Error(`Remote ${PRODUCTION.d1Name} UUID does not match PRODUCTION_D1_DATABASE_ID`);
  }
  return match;
}
