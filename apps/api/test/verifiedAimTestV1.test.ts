import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { GameVerifierInput, GameVerifierResult } from "@owogg/core";
import {
  VERIFIED_AIM_TEST_RULESET_REVISION,
  VERIFIED_AIM_TEST_SLUG,
  VERIFIED_AIM_TEST_TIMING,
  createVerifiedAimTestTargets,
  verifiedAimTestV1,
  type VerifiedAimDifficultyId,
  type VerifiedAimVariantId,
} from "../src/infrastructure/games/verifiers/VerifiedAimTestV1.js";

const CHALLENGE_SEED = "reference-seed-0000000000001";
const TARGET_VECTORS = JSON.parse(
  fs.readFileSync(
    new URL("../../../examples/verified-aim-test/test-vectors.json", import.meta.url),
    "utf8",
  ),
) as readonly {
  readonly challengeSeed: string;
  readonly difficultyId: VerifiedAimDifficultyId;
  readonly variantId: VerifiedAimVariantId;
  readonly targets: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
}[];

function validEvidence(
  difficultyId: VerifiedAimDifficultyId = "normal",
  variantId: VerifiedAimVariantId = "standard",
) {
  const targets = createVerifiedAimTestTargets({
    challengeSeed: CHALLENGE_SEED,
    difficultyId,
    variantId,
  });
  const events = targets.map((target, index) => ({
    seq: index + 1,
    tMs: VERIFIED_AIM_TEST_TIMING.minFirstHitMs + index * VERIFIED_AIM_TEST_TIMING.minHitIntervalMs,
    x: target.x,
    y: target.y,
  }));
  return {
    version: 1,
    completedAtMs: events.at(-1)?.tMs ?? 0,
    events,
  };
}

function input(
  evidence: unknown = validEvidence(),
  overrides: Partial<GameVerifierInput> = {},
): GameVerifierInput {
  const completedAtMs =
    typeof evidence === "object" &&
    evidence !== null &&
    "completedAtMs" in evidence &&
    typeof evidence.completedAtMs === "number"
      ? evidence.completedAtMs
      : 1_000;
  return {
    gameId: 101,
    versionId: 202,
    slug: VERIFIED_AIM_TEST_SLUG,
    challengeSeed: CHALLENGE_SEED,
    playConfig: { difficultyId: "normal", variantId: "standard" },
    rulesetRevision: VERIFIED_AIM_TEST_RULESET_REVISION,
    issuedAtMs: 1_000_000,
    submittedAtMs: 1_000_000 + completedAtMs + 250,
    serverElapsedMs: completedAtMs + 250,
    evidence,
    ...overrides,
  };
}

async function rejectionCode(
  evidence: unknown,
  overrides: Partial<GameVerifierInput> = {},
): Promise<string | null> {
  const result = await verifiedAimTestV1.verify(input(evidence, overrides));
  return result.accepted ? null : result.code;
}

test("verified aim target generation is deterministic and config-sensitive", () => {
  const normalStandard = createVerifiedAimTestTargets({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "normal",
    variantId: "standard",
  });
  assert.deepEqual(
    createVerifiedAimTestTargets({
      challengeSeed: CHALLENGE_SEED,
      difficultyId: "normal",
      variantId: "standard",
    }),
    normalStandard,
  );
  assert.notDeepEqual(
    createVerifiedAimTestTargets({
      challengeSeed: `${CHALLENGE_SEED}-different`,
      difficultyId: "normal",
      variantId: "standard",
    }),
    normalStandard,
  );

  const hardPrecision = createVerifiedAimTestTargets({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "hard",
    variantId: "precision",
  });
  assert.equal(normalStandard.length, 6);
  assert.equal(hardPrecision.length, 10);
  assert.ok((hardPrecision[0]?.radius ?? 1) < (normalStandard[0]?.radius ?? 0));
});

test("server target generation matches the standalone game's shared test vectors", () => {
  for (const vector of TARGET_VECTORS) {
    assert.deepEqual(
      createVerifiedAimTestTargets({
        challengeSeed: vector.challengeSeed,
        difficultyId: vector.difficultyId,
        variantId: vector.variantId,
      }),
      vector.targets,
    );
  }
});

test("verified aim accepts a complete seeded run and derives every authoritative fact", async () => {
  const evidence = validEvidence("hard", "precision");
  const result = await verifiedAimTestV1.verify(
    input(evidence, {
      playConfig: { difficultyId: "hard", variantId: "precision" },
    }),
  );
  assert.deepEqual(result, {
    accepted: true,
    facts: {
      outcome: "success",
      score: evidence.completedAtMs,
      progression: { value: 10 },
      metrics: { hits: 10 },
      events: { target_hit: 10, completed: 1 },
    },
  } satisfies GameVerifierResult);
  assert.ok(new TextEncoder().encode(JSON.stringify(evidence)).byteLength < 16 * 1024);
});

test("verified aim binds its slug, revision, difficulty, and variant", async () => {
  const evidence = validEvidence();
  for (const overrides of [
    { slug: "lookalike-aim-test" },
    { rulesetRevision: 2 },
    { playConfig: { difficultyId: "easy", variantId: "standard" } },
    { playConfig: { difficultyId: "normal", variantId: "assist" } },
  ] satisfies Partial<GameVerifierInput>[]) {
    assert.equal(await rejectionCode(evidence, overrides), "AIM_CONFIG_UNSUPPORTED");
  }
});

test("verified aim rejects extra fields, invalid coordinates, and incomplete evidence", async () => {
  const valid = validEvidence();
  assert.equal(await rejectionCode({ ...valid, clientScore: 1 }), "AIM_EVIDENCE_INVALID");
  assert.equal(
    await rejectionCode({
      ...valid,
      events: valid.events.map((event, index) =>
        index === 0 ? { ...event, x: Number.NaN } : event,
      ),
    }),
    "AIM_EVIDENCE_INVALID",
  );
  assert.equal(
    await rejectionCode({ ...valid, events: valid.events.slice(0, -1) }),
    "AIM_INCOMPLETE",
  );
});

test("verified aim rejects skipped, duplicate, non-monotonic, and inconsistent time", async () => {
  const valid = validEvidence();
  assert.equal(
    await rejectionCode({
      ...valid,
      events: valid.events.map((event, index) =>
        index === 2 ? { ...event, seq: event.seq + 1 } : event,
      ),
    }),
    "AIM_SEQUENCE_INVALID",
  );
  assert.equal(
    await rejectionCode({
      ...valid,
      events: valid.events.map((event, index) => (index === 1 ? { ...event, seq: 1 } : event)),
    }),
    "AIM_SEQUENCE_INVALID",
  );
  assert.equal(
    await rejectionCode({
      ...valid,
      events: valid.events.map((event, index) =>
        index === 1 ? { ...event, tMs: valid.events[0]?.tMs ?? 0 } : event,
      ),
    }),
    "AIM_TIME_INVALID",
  );
  assert.equal(
    await rejectionCode({ ...valid, completedAtMs: valid.completedAtMs + 1 }),
    "AIM_TIME_INVALID",
  );
});

test("verified aim rejects impossible hits and evidence/server elapsed mismatch", async () => {
  const valid = validEvidence();
  assert.equal(
    await rejectionCode({
      ...valid,
      events: valid.events.map((event, index) => (index === 0 ? { ...event, x: 0, y: 0 } : event)),
    }),
    "AIM_TARGET_MISSED",
  );
  assert.equal(
    await rejectionCode(valid, {
      serverElapsedMs: valid.completedAtMs + VERIFIED_AIM_TEST_TIMING.maxSubmissionLagMs + 1,
    }),
    "AIM_ELAPSED_MISMATCH",
  );
  assert.equal(
    await rejectionCode(valid, {
      serverElapsedMs: valid.completedAtMs - VERIFIED_AIM_TEST_TIMING.maxClockLeadMs - 1,
    }),
    "AIM_ELAPSED_MISMATCH",
  );
});
