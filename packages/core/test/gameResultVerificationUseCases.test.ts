import assert from "node:assert/strict";
import test from "node:test";
import {
  GameResultVerificationUseCases,
  GameVerifiedResultAcceptanceUseCases,
  parseGameCreatorManifest,
  signVerifiedGameSession,
  type BeginGameResultVerificationClaimResult,
  type GameResultVerificationClaimKey,
  type GameResultVerificationClaimRepository,
  type VerifiedGameSessionPayload,
  type GameVerifier,
  type GameVerifierInput,
  type GameVerifierRegistry,
  type GameVerifiedResultPersistenceRepository,
  type PersistedVerifiedGameResult,
  type RuntimeGame,
} from "../src/index.js";
import { runtimeGameFixture } from "./runtimeGameFixture.js";

const SECRET = "verification-use-case-test-secret";
const NOW_MS = 2_000_000_000_000;
const NOW = new Date(NOW_MS);
const ATTEMPT_ID = "11111111-1111-1111-1111-111111111111";
const CHALLENGE_SEED = "22222222-2222-2222-2222-222222222222";
const VERIFIER_ID = "official:test-reaction-v1";

type StoredClaim = GameResultVerificationClaimKey &
  (
    | { status: "PROCESSING" }
    | { status: "REJECTED"; rejectionCode: string }
    | { status: "VERIFIED"; resultId: number; scoreId: number | null }
  );

class MemoryClaimRepository implements GameResultVerificationClaimRepository {
  claim: StoredClaim | null = null;
  beginCalls = 0;

  async begin(
    input: GameResultVerificationClaimKey & { readonly nowIso: string },
  ): Promise<BeginGameResultVerificationClaimResult> {
    this.beginCalls += 1;
    if (this.claim === null) {
      this.claim = { ...input, status: "PROCESSING" };
      return { status: "ACQUIRED" };
    }
    if (
      this.claim.userId !== input.userId ||
      this.claim.gameId !== input.gameId ||
      this.claim.versionId !== input.versionId
    ) {
      return { status: "CONFLICT", reason: "ATTEMPT_CONTEXT_MISMATCH" };
    }
    if (this.claim.evidenceHash !== input.evidenceHash) {
      return { status: "CONFLICT", reason: "EVIDENCE_MISMATCH" };
    }
    if (this.claim.status === "VERIFIED") {
      return {
        status: "VERIFIED",
        resultId: this.claim.resultId,
        scoreId: this.claim.scoreId,
      };
    }
    if (this.claim.status === "REJECTED") {
      return { status: "REJECTED", rejectionCode: this.claim.rejectionCode };
    }
    return { status: "PROCESSING" };
  }

  async finalizeRejected(
    input: GameResultVerificationClaimKey & {
      readonly rejectionCode: string;
      readonly nowIso: string;
    },
  ): Promise<boolean> {
    if (!this.matchesProcessing(input)) return false;
    this.claim = { ...this.claim, status: "REJECTED", rejectionCode: input.rejectionCode };
    return true;
  }

  private matchesProcessing(input: GameResultVerificationClaimKey): boolean {
    return (
      this.claim?.status === "PROCESSING" &&
      this.claim.attemptId === input.attemptId &&
      this.claim.userId === input.userId &&
      this.claim.gameId === input.gameId &&
      this.claim.versionId === input.versionId &&
      this.claim.evidenceHash === input.evidenceHash
    );
  }
}

class MemoryVerifiedResultPersistence implements GameVerifiedResultPersistenceRepository {
  record: PersistedVerifiedGameResult | null = null;
  writes = 0;

  constructor(private readonly claims: MemoryClaimRepository) {}

  async acceptVerifiedResult(
    input: Parameters<GameVerifiedResultPersistenceRepository["acceptVerifiedResult"]>[0],
  ) {
    if (this.claims.claim?.status !== "PROCESSING") {
      return { accepted: false, resultId: null, scoreId: null };
    }
    this.writes += 1;
    this.record = {
      resultId: 31,
      scoreId: 41,
      normalized: input.normalized,
      competitiveScore: input.competitiveScore,
      difficultyId: input.difficultyId,
      variantId: input.variantId,
      rulesetRevision: input.rulesetRevision,
      verifierId: input.verifierId,
    };
    this.claims.claim = { ...this.claims.claim, status: "VERIFIED", resultId: 31, scoreId: 41 };
    return { accepted: true, resultId: 31, scoreId: 41 };
  }

  async findVerifiedResult(): Promise<PersistedVerifiedGameResult | null> {
    return this.record;
  }
}

function verifiedRuntime(): RuntimeGame {
  const runtime = runtimeGameFixture("reaction-time");
  const creatorManifest = parseGameCreatorManifest({
    schemaVersion: 1,
    game: {
      slug: runtime.identity.slug,
      title: "Reaction Time",
      genre: "skill",
      mode: "single",
      playModes: ["single"],
    },
    difficulties: [
      { id: "normal", title: "Normal", default: true },
      { id: "hard", title: "Hard" },
    ],
    playConfig: {
      version: 1,
      rulesetRevision: 3,
      verifierId: VERIFIER_ID,
      variants: [{ id: "standard", title: "Standard" }],
      allowedConfigs: [
        { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
        { difficultyId: "hard", variantId: "standard", rewardFactor: 1.25 },
      ],
    },
    progression: { type: "stage", range: { min: 0, max: 10, outOfRange: "reject" } },
    result: {
      outcome: { values: ["success", "failure"] },
      score: {
        unit: "ms",
        direction: "asc",
        precision: 1,
        range: { min: 0, max: 60_000, outOfRange: "reject" },
      },
      metrics: {
        reactions: { type: "integer", range: { min: 0, max: 100, outOfRange: "reject" } },
      },
    },
    leaderboard: { enabled: true },
    events: { completed: { maxPerAttempt: 1 } },
  });
  return {
    ...runtime,
    canonical: {
      ...runtime.canonical,
      playConfig: {
        version: 1,
        rulesetRevision: 3,
        verifierId: VERIFIER_ID,
        defaultVariantId: "standard",
        variants: [{ id: "standard", label: "Standard" }],
        allowedConfigs: [
          { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
          { difficultyId: "hard", variantId: "standard", rewardFactor: 1.25 },
        ],
      },
      creatorManifest,
    },
  };
}

function payload(
  runtime: RuntimeGame,
  overrides: Partial<VerifiedGameSessionPayload> = {},
): VerifiedGameSessionPayload {
  return {
    userId: 7,
    gameId: runtime.identity.id,
    versionId: runtime.liveVersion.id,
    attemptId: ATTEMPT_ID,
    playMode: "single",
    difficultyId: "hard",
    variantId: "standard",
    rewardFactor: 1.25,
    rulesetRevision: 3,
    verifierId: VERIFIER_ID,
    challengeSeed: CHALLENGE_SEED,
    issuedAtMs: NOW_MS - 5_000,
    exp: Math.floor(NOW_MS / 1_000) + 300,
    ...overrides,
  };
}

function setup(verifier: GameVerifier | null = null) {
  const runtime = verifiedRuntime();
  const claims = new MemoryClaimRepository();
  const registry: GameVerifierRegistry = {
    has: (verifierId) => verifier !== null && verifierId === VERIFIER_ID,
    resolve: (verifierId) => (verifier !== null && verifierId === VERIFIER_ID ? verifier : null),
  };
  const useCases = new GameResultVerificationUseCases(
    {
      findBySlug: async (slug) => (slug === runtime.identity.slug ? runtime : null),
      listPublic: async () => [runtime],
    },
    { isVersionServable: async () => true },
    { getDisabledGameIds: async () => [] },
    registry,
    claims,
    () => NOW,
  );
  return { runtime, claims, useCases };
}

async function signedPayload(
  runtime: RuntimeGame,
  overrides: Partial<VerifiedGameSessionPayload> = {},
): Promise<string> {
  return signVerifiedGameSession(payload(runtime, overrides), SECRET);
}

test("accepted evidence returns a persistence lease and replays terminal result IDs", async () => {
  const inputs: GameVerifierInput[] = [];
  const { runtime, claims, useCases } = setup({
    async verify(input) {
      inputs.push(input);
      return {
        accepted: true,
        facts: {
          outcome: "success",
          score: -0,
          progression: { value: 2 },
          metrics: { reactions: 4 },
          events: { completed: 1 },
        },
      };
    },
  });
  const token = await signedPayload(runtime);
  const evidence = { frames: [{ at: 12 }, { at: 30 }] };

  const prepared = await useCases.prepare({
    slug: runtime.identity.slug,
    userId: 7,
    token,
    secret: SECRET,
    evidence,
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.ok ? prepared.status : null, "READY_TO_PERSIST");
  if (!prepared.ok || prepared.status !== "READY_TO_PERSIST") return;
  assert.deepEqual(prepared.facts, {
    outcome: "success",
    score: 0,
    progression: { value: 2 },
    metrics: { reactions: 4 },
    events: { completed: 1 },
  });
  assert.deepEqual(inputs, [
    {
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      slug: runtime.identity.slug,
      challengeSeed: CHALLENGE_SEED,
      playConfig: { difficultyId: "hard", variantId: "standard" },
      rulesetRevision: 3,
      issuedAtMs: NOW_MS - 5_000,
      submittedAtMs: NOW_MS,
      serverElapsedMs: 5_000,
      evidence,
    },
  ]);
  assert.equal(claims.claim?.status, "PROCESSING");
  claims.claim = { ...prepared.lease, status: "VERIFIED", resultId: 31, scoreId: 41 };

  const replay = await useCases.prepare({
    slug: runtime.identity.slug,
    userId: 7,
    token,
    secret: SECRET,
    evidence,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.ok ? replay.status : null, "ALREADY_VERIFIED");
  if (replay.ok && replay.status === "ALREADY_VERIFIED") {
    assert.equal(replay.resultId, 31);
    assert.equal(replay.scoreId, 41);
  }
  assert.equal(inputs.length, 1, "terminal replays must not execute the verifier again");
});

test("verified acceptance persists the competitive score once and replays stored server facts", async () => {
  let verifierCalls = 0;
  const { runtime, claims, useCases } = setup({
    async verify() {
      verifierCalls += 1;
      return { accepted: true, facts: { outcome: "success", score: 100 } };
    },
  });
  const persistence = new MemoryVerifiedResultPersistence(claims);
  const acceptance = new GameVerifiedResultAcceptanceUseCases(useCases, persistence);
  const request = {
    slug: runtime.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: await signedPayload(runtime),
    secret: SECRET,
    evidence: { frames: [10, 20] },
  };

  const first = await acceptance.accept(request);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.normalized.rawScore, 100);
  assert.equal(first.normalized.normalizedScore, 100);
  assert.equal(first.competitiveScore, 80, "asc scores divide by the hard-mode factor");
  assert.equal(first.replayed, false);

  const replay = await acceptance.accept(request);
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.competitiveScore, 80);
    assert.equal(replay.replayed, true);
  }
  assert.equal(verifierCalls, 1);
  assert.equal(persistence.writes, 1);
});

test("the first evidence hash is immutable while persistence is pending", async () => {
  let verifierCalls = 0;
  const { runtime, useCases } = setup({
    async verify() {
      verifierCalls += 1;
      return { accepted: true, facts: { score: 10 } };
    },
  });
  const token = await signedPayload(runtime);
  const first = { clicks: [1, 2] };

  assert.equal(
    (
      await useCases.prepare({
        slug: runtime.identity.slug,
        userId: 7,
        token,
        secret: SECRET,
        evidence: first,
      })
    ).ok,
    true,
  );
  assert.deepEqual(
    await useCases.prepare({
      slug: runtime.identity.slug,
      userId: 7,
      token,
      secret: SECRET,
      evidence: first,
    }),
    { ok: false, error: "VERIFICATION_IN_PROGRESS" },
  );
  const conflict = await useCases.prepare({
    slug: runtime.identity.slug,
    userId: 7,
    token,
    secret: SECRET,
    evidence: { clicks: [9] },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok ? null : conflict.error, "CLAIM_CONFLICT");
  assert.equal(verifierCalls, 1);
});

test("verifier rejection is terminal and preserves the server rejection code", async () => {
  let verifierCalls = 0;
  const { runtime, useCases } = setup({
    async verify() {
      verifierCalls += 1;
      return { accepted: false, code: "IMPOSSIBLE_REPLAY" };
    },
  });
  const token = await signedPayload(runtime);
  const input = {
    slug: runtime.identity.slug,
    userId: 7,
    token,
    secret: SECRET,
    evidence: { frames: [] },
  };

  assert.deepEqual(await useCases.prepare(input), {
    ok: false,
    error: "VERIFIER_REJECTED",
    reason: "IMPOSSIBLE_REPLAY",
  });
  assert.deepEqual(await useCases.prepare(input), {
    ok: false,
    error: "VERIFIER_REJECTED",
    reason: "IMPOSSIBLE_REPLAY",
  });
  assert.equal(verifierCalls, 1);
});

test("invalid evidence and signed context substitutions fail before claiming", async () => {
  const { runtime, claims, useCases } = setup({
    async verify() {
      return { accepted: true, facts: { score: 1 } };
    },
  });
  const validToken = await signedPayload(runtime);

  assert.deepEqual(
    await useCases.prepare({
      slug: runtime.identity.slug,
      userId: 7,
      token: validToken,
      secret: SECRET,
      evidence: Number.POSITIVE_INFINITY,
    }),
    { ok: false, error: "EVIDENCE_NON_FINITE_NUMBER" },
  );
  for (const overrides of [
    { gameId: runtime.identity.id + 1 },
    { versionId: runtime.liveVersion.id + 1 },
    { rewardFactor: 99 },
    { rulesetRevision: 4 },
    { verifierId: "official:other-v1" },
    { playMode: "local-multi" as const },
    { issuedAtMs: NOW_MS + 1_000 },
  ]) {
    const result = await useCases.prepare({
      slug: runtime.identity.slug,
      userId: 7,
      token: await signedPayload(runtime, overrides),
      secret: SECRET,
      evidence: {},
    });
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.ok ? null : result.error, "CONTEXT_MISMATCH", JSON.stringify(overrides));
  }
  assert.equal(claims.beginCalls, 0);
});

test("unregistered verifiers fail before evidence traversal or claiming", async () => {
  const { runtime, claims, useCases } = setup(null);
  const dangerousEvidence = Object.defineProperty({}, "value", {
    enumerable: true,
    get: () => {
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(
    await useCases.prepare({
      slug: runtime.identity.slug,
      userId: 7,
      token: await signedPayload(runtime),
      secret: SECRET,
      evidence: dangerousEvidence,
    }),
    { ok: false, error: "VERIFIER_NOT_REGISTERED" },
  );
  assert.equal(claims.beginCalls, 0);
});

test("verifier exceptions and malformed facts become stable terminal failures", async () => {
  for (const scenario of [
    {
      expected: "VERIFIER_EXECUTION_FAILED" as const,
      verifier: { verify: async () => Promise.reject(new Error("boom")) },
    },
    {
      expected: "VERIFIER_INVALID_OUTPUT" as const,
      verifier: {
        verify: async () => ({ accepted: true, facts: { score: Number.NaN } }),
      },
    },
  ]) {
    const { runtime, claims, useCases } = setup(scenario.verifier as GameVerifier);
    const result = await useCases.prepare({
      slug: runtime.identity.slug,
      userId: 7,
      token: await signedPayload(runtime),
      secret: SECRET,
      evidence: {},
    });
    assert.deepEqual(result, { ok: false, error: scenario.expected });
    assert.equal(claims.claim?.status, "REJECTED");
    assert.equal(
      claims.claim?.status === "REJECTED" ? claims.claim.rejectionCode : null,
      scenario.expected,
    );
  }
});
