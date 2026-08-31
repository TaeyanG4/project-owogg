import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  validateProductionDeploymentEnvironment,
  verifyProductionD1Target,
} from "./production-deployment-contract.js";
import { assertNoContractErrors, parseJsonc, type WranglerConfig } from "./staging-contract.js";

function readOption(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiConfig = parseJsonc<WranglerConfig>(
  fs.readFileSync(path.join(repoRoot, "apps", "api", "wrangler.jsonc"), "utf8"),
);

assertNoContractErrors(
  validateProductionDeploymentEnvironment(process.env, apiConfig),
  "Production deployment preflight",
);

const d1List = JSON.parse(fs.readFileSync(readOption("--d1-list"), "utf8")) as unknown;
verifyProductionD1Target(d1List, process.env.PRODUCTION_D1_DATABASE_ID?.trim() ?? "");

console.log(
  "Production deployment preflight passed: D1, multiplayer, and Streamer OAuth inputs are isolated and mapped explicitly.",
);
