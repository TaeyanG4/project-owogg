import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertNoContractErrors,
  parseJsonc,
  validateStagingEnvironment,
  validateWranglerStagingContracts,
  type WranglerConfig,
} from "./staging-contract.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiConfig = parseJsonc<WranglerConfig>(
  fs.readFileSync(path.join(repoRoot, "apps", "api", "wrangler.jsonc"), "utf8"),
);
const webConfig = parseJsonc<WranglerConfig>(
  fs.readFileSync(path.join(repoRoot, "apps", "web", "wrangler.jsonc"), "utf8"),
);

assertNoContractErrors(
  validateWranglerStagingContracts(apiConfig, webConfig),
  "Wrangler Staging contract",
);
assertNoContractErrors(validateStagingEnvironment(process.env), "Staging environment preflight");

console.log(
  "Staging preflight passed: URLs, OAuth/Discord IDs, D1/B2 targets, routes and multiplayer ticket keys are isolated.",
);
