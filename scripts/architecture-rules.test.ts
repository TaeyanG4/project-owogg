import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_RULES,
  REQUIRED_TOKEN_RULES,
  TOKEN_RULES,
  checkFileAgainstRule,
  collectModuleReferences,
  matchesForbidden,
  type ImportRule,
} from "./architecture-rules.js";

const CORE_RULE = findRule("packages/core/src");
const ROUTES_RULE = findRule("apps/api/src/routes");

function findRule(scope: string): ImportRule {
  const rule = IMPORT_RULES.find((candidate) => candidate.scope === scope);
  assert.ok(rule, `no import rule scoped to ${scope}`);
  return rule;
}

function specifiersOf(source: string, fileName = "sample.ts"): string[] {
  return collectModuleReferences(source, fileName).map((ref) => ref.specifier);
}

// ── the regression this scanner exists for ───────────────────────────────────
//
// The previous implementation kept lines matching `.trim().startsWith("import")` and searched for
// the quoted specifier on that same line, so a multi-line import — the dominant style in this
// codebase — was invisible to every rule. These first two tests are the ones that would have
// caught that, and they fail on any return to line-based matching.

test("a multi-line import is detected, not just a single-line one", () => {
  assert.deepEqual(specifiersOf(`import {\n  Hono,\n} from "hono";\n`), ["hono"]);
});

test("a multi-line import of a forbidden package violates the rule it belongs to", () => {
  const violations = checkFileAgainstRule(
    "packages/core/src/application/example.ts",
    `import {\n  Hono,\n  type Context,\n} from "hono";\n`,
    CORE_RULE,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.specifier, "hono");
});

test("a single-line import is still detected", () => {
  assert.deepEqual(specifiersOf(`import { Hono } from "hono";`), ["hono"]);
});

// ── every syntax that creates a real dependency ──────────────────────────────

test("a re-export creates the same coupling as an import and is detected", () => {
  assert.deepEqual(specifiersOf(`export * from "@owogg/db";`), ["@owogg/db"]);
  assert.deepEqual(specifiersOf(`export {\n  D1UserRepository,\n} from "@owogg/db";`), [
    "@owogg/db",
  ]);
});

test("a dynamic import() is detected", () => {
  assert.deepEqual(specifiersOf(`const m = await import("react-dom");`), ["react-dom"]);
});

test("a require() call is detected", () => {
  assert.deepEqual(specifiersOf(`const x = require("hono");`), ["hono"]);
});

test("import-equals with an external module reference is detected", () => {
  assert.deepEqual(specifiersOf(`import legacy = require("@owogg/db");`), ["@owogg/db"]);
});

test("a bare side-effect import is detected", () => {
  assert.deepEqual(specifiersOf(`import "react";`), ["react"]);
});

test("an import inside a nested scope is detected, not only top-level ones", () => {
  const source = `
    export async function load() {
      if (Math.random() > 0.5) {
        const mod = await import("@owogg/db");
        return mod;
      }
      return null;
    }
  `;
  assert.deepEqual(specifiersOf(source), ["@owogg/db"]);
});

test("a specifier appearing only in a comment or string is not a dependency", () => {
  const source = `
    // import { Hono } from "hono";
    /* export * from "react"; */
    const doc = 'import { D1UserRepository } from "@owogg/db"';
  `;
  assert.deepEqual(specifiersOf(source), []);
});

test("tsx files parse as TSX, so JSX generics don't derail the scan", () => {
  const source = `
    import { useState } from "react";
    export const C = () => <div className="x">{useState<string>("")[0]}</div>;
  `;
  assert.deepEqual(specifiersOf(source, "component.tsx"), ["react"]);
});

// ── type-only classification ─────────────────────────────────────────────────

test("a type-only import is classified as type-only", () => {
  const [ref] = collectModuleReferences(`import type { A } from "@owogg/db";`, "f.ts");
  assert.equal(ref?.typeOnly, true);
});

test("an import whose every named binding is type-marked is type-only", () => {
  const [ref] = collectModuleReferences(`import { type A, type B } from "@owogg/db";`, "f.ts");
  assert.equal(ref?.typeOnly, true);
});

test("a mixed import is a value import — one binding survives to runtime", () => {
  const [ref] = collectModuleReferences(`import { type A, b } from "@owogg/db";`, "f.ts");
  assert.equal(ref?.typeOnly, false);
});

test("a namespace import binds a runtime object and is never type-only", () => {
  const [ref] = collectModuleReferences(`import * as db from "@owogg/db";`, "f.ts");
  assert.equal(ref?.typeOnly, false);
});

test("a route may name a @owogg/db type but may not import a value from it", () => {
  const typeOnly = checkFileAgainstRule(
    "apps/api/src/routes/devGames.ts",
    `import type { BackblazeB2Config } from "@owogg/db";`,
    ROUTES_RULE,
  );
  assert.deepEqual(typeOnly, [], "a type-only import cannot construct a repository");

  const valueImport = checkFileAgainstRule(
    "apps/api/src/routes/devGames.ts",
    `import { D1UserRepository } from "@owogg/db";`,
    ROUTES_RULE,
  );
  assert.equal(valueImport.length, 1);
});

test("core's react ban covers type-only imports too — the coupling is the point, not the emit", () => {
  const violations = checkFileAgainstRule(
    "packages/core/src/domain/example.ts",
    `import type { ComponentType } from "react";`,
    CORE_RULE,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.specifier, "react");
});

// ── specifier matching ───────────────────────────────────────────────────────

test('a "package" match covers subpaths as well as the bare specifier', () => {
  assert.ok(matchesForbidden("react", { spec: "react" }));
  assert.ok(matchesForbidden("react/jsx-runtime", { spec: "react" }));
});

test('a "package" match does not catch an unrelated package with the same prefix', () => {
  assert.ok(!matchesForbidden("react-router", { spec: "react" }));
  assert.ok(!matchesForbidden("@owogg/db-utils", { spec: "@owogg/db" }));
});

test('an "entry" match covers only the bare specifier, leaving subpaths legal', () => {
  const forbidden = { spec: "@owogg/game-sdk", match: "entry" as const };
  assert.ok(matchesForbidden("@owogg/game-sdk", forbidden));
  assert.ok(!matchesForbidden("@owogg/game-sdk/contracts", forbidden));
});

// ── the boundary this PR establishes ─────────────────────────────────────────

test("core importing the game-sdk root entry is a violation, its contracts subpath is not", () => {
  const rootEntry = checkFileAgainstRule(
    "packages/core/src/application/scoreUseCases.ts",
    `import { formatScore } from "@owogg/game-sdk";`,
    CORE_RULE,
  );
  assert.equal(rootEntry.length, 1);
  assert.match(rootEntry[0]?.hint ?? "", /@owogg\/game-sdk\/contracts/);

  const contractsSubpath = checkFileAgainstRule(
    "packages/core/src/application/scoreUseCases.ts",
    `import { formatScore } from "@owogg/game-sdk/contracts";`,
    CORE_RULE,
  );
  assert.deepEqual(contractsSubpath, []);
});

test("every import rule carries at least one forbidden specifier and a stated rule", () => {
  for (const rule of IMPORT_RULES) {
    assert.ok(rule.scope.length > 0);
    assert.ok(rule.rule.length > 0, `${rule.scope} has no stated rule`);
    assert.ok(rule.forbidden.length > 0, `${rule.scope} forbids nothing`);
  }
});

test("D-1 legacy catalog/runtime removals are protected by source-token architecture guards", () => {
  const api = TOKEN_RULES.find((rule) => rule.scope === "apps/api/src");
  const web = TOKEN_RULES.find(
    (rule) => rule.scope === "apps/web/app" && rule.tokens.includes("LegacyReactRuntime"),
  );
  const host = TOKEN_RULES.find((rule) => rule.scope === "apps/web/app/features/game");
  const deploy = TOKEN_RULES.find((rule) => rule.scope === ".github/workflows");

  assert.ok(api?.tokens.includes("officialGameAssetsRouter"));
  assert.ok(api?.tokens.includes("StaticGameRegistry"));
  assert.ok(api?.tokens.includes("GAME_MANIFESTS"));
  assert.ok(web?.tokens.includes("LegacyReactRuntime"));
  assert.ok(web?.tokens.includes("CreatorGameHost"));
  assert.ok(web?.tokens.includes("sandboxGameAdapter"));
  assert.ok(web?.tokens.includes("GAME_LOADERS"));
  assert.ok(web?.tokens.includes("GAME_MANIFESTS"));
  assert.ok(web?.tokens.includes("gameContent"));
  for (const packageName of [
    "@owogg/game-aim-test",
    "@owogg/game-memory-test",
    "@owogg/game-reaction-time",
    "@owogg/game-typing-test",
  ]) {
    assert.ok(web?.tokens.includes(packageName));
  }
  assert.ok(host?.tokens.includes("submitScoreApi"));
  assert.ok(deploy?.tokens.includes("bootstrap:official-games"));
  assert.ok(deploy?.tokens.includes("publish:official-games"));
  assert.ok(deploy?.tokens.includes("systemGameReleaseMap"));
});

test("E-1 generic canonical authority is protected from old Game Creator repository composition", () => {
  const api = TOKEN_RULES.find((rule) => rule.scope === "apps/api/src");
  const coreApplication = TOKEN_RULES.find(
    (rule) => rule.scope === "packages/core/src/application",
  );

  assert.ok(api?.tokens.includes("B2CreatorGameDefinitionRepository"));
  assert.ok(api?.tokens.includes("creator-games/"));
  assert.ok(coreApplication?.tokens.includes("CreatorGameDefinitionRepository"));
  assert.ok(coreApplication?.tokens.includes("creator-games/"));
});

test("broadcast-channel modules are guarded against reintroducing bare Creator terminology", () => {
  const rules = TOKEN_RULES.filter((rule) => rule.rule.startsWith("broadcast-channel"));
  assert.equal(rules.length, 5);
  assert.ok(rules.some((rule) => rule.tokens.some((token) => token.includes("CreatorUseCases"))));
  assert.ok(rules.some((rule) => rule.tokens.includes("creator_profiles")));
  assert.ok(rules.some((rule) => rule.tokens.includes("/wiki/creator")));
});

test("E-2 publication convergence guards both callers and keeps generic core publisher-neutral", () => {
  const user = REQUIRED_TOKEN_RULES.find((rule) => rule.file.endsWith("sandboxGameUseCases.ts"));
  const official = REQUIRED_TOKEN_RULES.find((rule) =>
    rule.file.endsWith("officialGameUploadUseCases.ts"),
  );
  const officialDuplicates = TOKEN_RULES.find((rule) =>
    rule.files?.includes("officialGameUploadUseCases.ts"),
  );
  const genericCore = TOKEN_RULES.find((rule) => rule.files?.includes("gamePublicationService.ts"));

  assert.ok(user?.tokens.includes("GamePublicationService"));
  assert.ok(official?.tokens.includes("GamePublicationService"));
  assert.ok(officialDuplicates?.tokens.includes("buildBundleManifest"));
  assert.ok(officialDuplicates?.tokens.includes("publishedObjectKey"));
  assert.ok(genericCore?.tokens.includes("SandboxGameVersionRecord"));
  assert.ok(genericCore?.tokens.includes("PENDING_REVIEW"));
});

test("E-3 guards exact publication targets and publisher-specific authority boundaries", () => {
  const targetCore = REQUIRED_TOKEN_RULES.find((rule) =>
    rule.file.endsWith("gamePublicationService.ts"),
  );
  const userTarget = REQUIRED_TOKEN_RULES.find((rule) =>
    rule.file.endsWith("sandboxGameVersionPublicationRepository.ts"),
  );
  const officialTarget = REQUIRED_TOKEN_RULES.find((rule) =>
    rule.file.endsWith("D1OfficialGameUploadRepository.ts"),
  );
  const userAuthority = TOKEN_RULES.find((rule) =>
    rule.files?.includes("sandboxGameVersionPublicationRepository.ts"),
  );
  const officialAuthority = TOKEN_RULES.find(
    (rule) =>
      rule.files?.includes("officialGameUploadUseCases.ts") &&
      rule.tokens.includes("sandbox_games"),
  );

  assert.ok(targetCore?.tokens.includes("GamePublicationTarget"));
  assert.ok(targetCore?.tokens.includes("markReady(target, facts)"));
  assert.ok(userTarget?.tokens.includes("version.gameId !== target.gameId"));
  assert.ok(userTarget?.tokens.includes("version.contentHash !== target.contentHash"));
  assert.ok(officialTarget?.tokens.includes("id = ? AND game_id = ? AND content_hash = ?"));
  assert.ok(userAuthority?.tokens.includes('type: "OWOGG"'));
  assert.ok(officialAuthority?.tokens.includes("sandbox_games"));
});
