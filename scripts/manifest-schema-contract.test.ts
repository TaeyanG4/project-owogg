import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OWOGG_GAME_CREATOR_MANIFEST_V2_SCHEMA_URL,
  OWOGG_GAME_CREATOR_MANIFEST_V2_VERSION,
  OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS,
  OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
  OWOGG_MULTIPLAYER_REQUEST_VERSION,
} from "../packages/game-sdk/src/contracts/index.js";

interface JsonSchemaNode {
  readonly [key: string]: unknown;
}

function object(value: unknown, path: string): JsonSchemaNode {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${path} object`);
  return value as JsonSchemaNode;
}

function manifestV2Schema(): JsonSchemaNode {
  const url = new URL("../apps/web/public/schemas/manifest/v2.json", import.meta.url);
  return object(JSON.parse(readFileSync(url, "utf8")) as unknown, "schema");
}

test("manifest v2 JSON Schema stays version-aligned with the public SDK", () => {
  const schema = manifestV2Schema();
  assert.equal(schema.$id, OWOGG_GAME_CREATOR_MANIFEST_V2_SCHEMA_URL);
  const properties = object(schema.properties, "properties");
  assert.equal(
    object(properties.schemaVersion, "properties.schemaVersion").const,
    OWOGG_GAME_CREATOR_MANIFEST_V2_VERSION,
  );
  const definitions = object(schema.$defs, "$defs");
  const request = object(definitions.managedMultiplayerRequest, "managedMultiplayerRequest");
  assert.ok(
    (request.required as unknown[]).includes("requestVersion"),
    "requestVersion must be required",
  );
  const requestProperties = object(request.properties, "managedMultiplayerRequest.properties");
  assert.equal(
    object(requestProperties.requestVersion, "requestVersion").const,
    OWOGG_MULTIPLAYER_REQUEST_VERSION,
  );
  const template = object(requestProperties.template, "template");
  const templateProperties = object(template.properties, "template.properties");
  assert.deepEqual(object(templateProperties.id, "template.id").enum, [
    ...OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS,
  ]);
  assert.equal(object(templateProperties.version, "template.version").const, 1);
  const client = object(definitions.multiplayerClient, "multiplayerClient");
  const clientProperties = object(client.properties, "multiplayerClient.properties");
  assert.equal(
    object(clientProperties.protocolVersion, "protocolVersion").const,
    OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
  );
});

test("manifest v2 exposes simulation profiles, never platform-resolved classes or backends", () => {
  const schema = manifestV2Schema();
  const definitions = object(schema.$defs, "$defs");
  const requirements = object(definitions.multiplayerRequirements, "multiplayerRequirements");
  const requirementProperties = object(requirements.properties, "requirements.properties");
  assert.deepEqual(object(requirementProperties.simulation, "simulation").enum, [
    "turn",
    "event",
    "continuous",
    "rollback",
  ]);
  const request = object(definitions.managedMultiplayerRequest, "managedMultiplayerRequest");
  const requestProperties = object(request.properties, "managedMultiplayerRequest.properties");
  for (const forbidden of [
    "resolvedClass",
    "runtimeBackend",
    "rulesetKey",
    "rewardPolicy",
    "websocketUrl",
    "serverCode",
  ]) {
    assert.equal(requestProperties[forbidden], undefined, `${forbidden} must not be public input`);
  }
  assert.equal(request.additionalProperties, false);
  assert.equal((request.allOf as unknown[]).length, OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS.length);
});
