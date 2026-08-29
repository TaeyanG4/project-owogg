import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL,
  OWOGG_GAME_CREATOR_MANIFEST_VERSION,
  OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
  OWOGG_MULTIPLAYER_RECONNECT_MODES,
  OWOGG_MULTIPLAYER_REQUEST_VERSION,
  OWOGG_MULTIPLAYER_RUNTIME_KINDS,
  OWOGG_MULTIPLAYER_TRANSPORT_KINDS,
  OWOGG_PLAY_CONFIG_VERSION,
} from "../packages/game-sdk/src/contracts/index.js";

interface JsonSchemaNode {
  readonly [key: string]: unknown;
}

function object(value: unknown, path: string): JsonSchemaNode {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${path} object`);
  return value as JsonSchemaNode;
}

function manifestV1Schema(): JsonSchemaNode {
  const url = new URL("../apps/web/public/schemas/manifest/v1.json", import.meta.url);
  return object(JSON.parse(readFileSync(url, "utf8")) as unknown, "schema");
}

test("the single manifest v1 JSON Schema stays aligned with the public SDK", () => {
  const schema = manifestV1Schema();
  assert.equal(schema.$id, OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL);
  const properties = object(schema.properties, "properties");
  assert.equal(
    object(properties.schemaVersion, "properties.schemaVersion").const,
    OWOGG_GAME_CREATOR_MANIFEST_VERSION,
  );
  const game = object(properties.game, "game");
  assert.ok((game.required as unknown[]).includes("playModes"), "playModes must be required");
  assert.equal(
    object(properties.multiplayer, "multiplayer").$ref,
    "#/$defs/multiplayerRuntimeRequest",
  );
  assert.equal(object(properties.playConfig, "playConfig").$ref, "#/$defs/playConfig");

  const definitions = object(schema.$defs, "$defs");
  const request = object(definitions.multiplayerRuntimeRequest, "multiplayerRuntimeRequest");
  assert.deepEqual(request.required, ["version", "transport", "runtime", "players", "features"]);
  const requestProperties = object(request.properties, "multiplayerRuntimeRequest.properties");
  assert.equal(
    object(requestProperties.version, "multiplayer.version").const,
    OWOGG_MULTIPLAYER_REQUEST_VERSION,
  );

  const transport = object(definitions.multiplayerTransport, "multiplayerTransport");
  const transportProperties = object(transport.properties, "multiplayerTransport.properties");
  assert.deepEqual(
    [object(transportProperties.kind, "transport.kind").const],
    [...OWOGG_MULTIPLAYER_TRANSPORT_KINDS],
  );
  assert.equal(
    object(transportProperties.protocolVersion, "transport.protocolVersion").const,
    OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
  );

  const runtime = object(definitions.multiplayerRuntime, "multiplayerRuntime");
  assert.deepEqual(
    object(object(runtime.properties, "runtime.properties").kind, "runtime.kind").enum,
    [...OWOGG_MULTIPLAYER_RUNTIME_KINDS],
  );
  const features = object(definitions.multiplayerFeatures, "multiplayerFeatures");
  assert.deepEqual(
    object(object(features.properties, "features.properties").reconnect, "reconnect").enum,
    [...OWOGG_MULTIPLAYER_RECONNECT_MODES],
  );
  const players = object(definitions.multiplayerPlayers, "multiplayerPlayers");
  const playerProperties = object(players.properties, "players.properties");
  assert.equal(object(playerProperties.min, "players.min").maximum, 8);
  assert.equal(object(playerProperties.max, "players.max").maximum, 8);
});

test("manifest v1 exposes runtime needs without game-specific server policy", () => {
  const schema = manifestV1Schema();
  const definitions = object(schema.$defs, "$defs");
  const request = object(definitions.multiplayerRuntimeRequest, "multiplayerRuntimeRequest");
  const requestProperties = object(request.properties, "multiplayerRuntimeRequest.properties");
  for (const forbidden of [
    "resolvedClass",
    "rulesetKey",
    "rulesetRevision",
    "template",
    "config",
    "rewardPolicy",
    "websocketUrl",
    "serverCode",
  ]) {
    assert.equal(requestProperties[forbidden], undefined, `${forbidden} must not be public input`);
  }
  assert.equal(request.additionalProperties, false);
  assert.equal(definitions.managedMultiplayerRequest, undefined);
  assert.equal(definitions.turnGridConfig, undefined);
  assert.equal(definitions.reactionArenaConfig, undefined);
  assert.equal(definitions.realtimePaddleConfig, undefined);
});

test("manifest v1 exposes the strict PlayConfig declaration shape", () => {
  const schema = manifestV1Schema();
  const definitions = object(schema.$defs, "$defs");
  const playConfig = object(definitions.playConfig, "playConfig");
  assert.equal(playConfig.additionalProperties, false);
  assert.deepEqual(playConfig.required, [
    "version",
    "rulesetRevision",
    "verifierId",
    "variants",
    "allowedConfigs",
  ]);
  const properties = object(playConfig.properties, "playConfig.properties");
  assert.equal(object(properties.version, "playConfig.version").const, OWOGG_PLAY_CONFIG_VERSION);
  assert.equal(object(properties.rulesetRevision, "rulesetRevision").minimum, 1);
  assert.equal(object(properties.variants, "variants").minItems, 1);
  assert.equal(object(properties.allowedConfigs, "allowedConfigs").minItems, 1);
});

test("manifest v1 permits PlayConfig beside Relay only for a hybrid topology", () => {
  const schema = manifestV1Schema();
  const rules = (schema.allOf as unknown[]).map((entry, index) => object(entry, `allOf[${index}]`));
  const ruleFor = (property: "multiplayer" | "playConfig") => {
    const rule = rules.find((entry, index) => {
      const condition = object(entry.if, `allOf[${index}].if`);
      return Array.isArray(condition.required) && condition.required.includes(property);
    });
    assert.ok(rule, `${property} rule`);
    return rule;
  };

  const multiplayerThen = object(ruleFor("multiplayer").then, "multiplayer.then");
  assert.equal(multiplayerThen.not, undefined, "Relay must not exclude PlayConfig");
  const multiplayerNestedRules = multiplayerThen.allOf as unknown[];
  assert.equal(multiplayerNestedRules.length, 1);
  const noPlayConfigRule = object(multiplayerNestedRules[0], "multiplayer.then.allOf[0]");
  const noPlayConfigCondition = object(noPlayConfigRule.if, "multiplayer fallback.if");
  assert.deepEqual(object(noPlayConfigCondition.not, "multiplayer fallback.if.not").required, [
    "playConfig",
  ]);
  const noPlayConfigThen = object(noPlayConfigRule.then, "multiplayer fallback.then");
  const fallbackProperties = object(noPlayConfigThen.properties, "multiplayer fallback.properties");
  const fallbackLeaderboard = object(fallbackProperties.leaderboard, "fallback leaderboard");
  assert.equal(
    object(
      object(fallbackLeaderboard.properties, "fallback leaderboard.properties").enabled,
      "enabled",
    ).const,
    false,
  );

  const playConfigThen = object(ruleFor("playConfig").then, "playConfig.then");
  assert.equal(playConfigThen.not, undefined, "PlayConfig must not exclude Relay");
  const playConfigProperties = object(playConfigThen.properties, "playConfig.then.properties");
  const game = object(playConfigProperties.game, "playConfig.then.game");
  const gameProperties = object(game.properties, "playConfig.then.game.properties");
  const playModes = object(gameProperties.playModes, "playConfig.then.game.playModes");
  assert.deepEqual(object(playModes.contains, "playModes.contains").enum, [
    "single",
    "local-multi",
  ]);
  assert.equal(playModes.minContains, 1);
});
