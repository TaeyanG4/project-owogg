import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_GAME_EVIDENCE_ARRAY_LENGTH,
  MAX_GAME_EVIDENCE_DEPTH,
  MAX_GAME_EVIDENCE_NODES,
  canonicalizeGameEvidence,
} from "../src/index.js";

test("evidence canonicalization sorts keys, normalizes negative zero, and hashes deterministically", async () => {
  const first = await canonicalizeGameEvidence({ z: -0, nested: { b: 2, a: 1 }, a: true });
  const second = await canonicalizeGameEvidence({ a: true, nested: { a: 1, b: 2 }, z: 0 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.canonicalJson, '{"a":true,"nested":{"a":1,"b":2},"z":0}');
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal(first.evidenceHash.length, 64);
});

test("evidence canonicalization rejects non-JSON values, cycles, and non-finite numbers", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  assert.deepEqual(await canonicalizeGameEvidence(undefined), {
    ok: false,
    code: "EVIDENCE_NOT_JSON_SAFE",
  });
  assert.deepEqual(await canonicalizeGameEvidence(new Date()), {
    ok: false,
    code: "EVIDENCE_NOT_JSON_SAFE",
  });
  assert.deepEqual(await canonicalizeGameEvidence(Number.POSITIVE_INFINITY), {
    ok: false,
    code: "EVIDENCE_NON_FINITE_NUMBER",
  });
  assert.deepEqual(await canonicalizeGameEvidence(cyclic), {
    ok: false,
    code: "EVIDENCE_CYCLIC",
  });
});

test("evidence canonicalization enforces independent depth, array, node, and byte limits", async () => {
  let deep: unknown = true;
  for (let index = 0; index <= MAX_GAME_EVIDENCE_DEPTH; index += 1) deep = [deep];

  assert.deepEqual(await canonicalizeGameEvidence(deep), {
    ok: false,
    code: "EVIDENCE_TOO_DEEP",
  });
  assert.deepEqual(
    await canonicalizeGameEvidence(new Array(MAX_GAME_EVIDENCE_ARRAY_LENGTH + 1).fill(null)),
    { ok: false, code: "EVIDENCE_ARRAY_TOO_LONG" },
  );
  assert.deepEqual(
    await canonicalizeGameEvidence(
      Array.from({ length: 256 }, () => new Array(MAX_GAME_EVIDENCE_NODES / 256).fill(null)),
    ),
    { ok: false, code: "EVIDENCE_TOO_MANY_NODES" },
  );
  assert.deepEqual(await canonicalizeGameEvidence("한".repeat(6_000)), {
    ok: false,
    code: "EVIDENCE_TOO_LARGE",
  });
});

test("evidence canonicalization copies input so later mutation cannot change verified evidence", async () => {
  const input = { events: [{ seq: 1 }] };
  const result = await canonicalizeGameEvidence(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  input.events[0] = { seq: 2 };
  assert.equal(result.canonicalJson, '{"events":[{"seq":1}]}');
  assert.deepEqual(result.value, { events: [{ seq: 1 }] });
});

test("evidence canonicalization rejects properties JSON would silently drop or execute", async () => {
  const withSymbol = { ok: true, [Symbol("hidden")]: true };
  const withGetter = Object.defineProperty({}, "value", {
    enumerable: true,
    get: () => 1,
  });

  assert.deepEqual(await canonicalizeGameEvidence(withSymbol), {
    ok: false,
    code: "EVIDENCE_NOT_JSON_SAFE",
  });
  assert.deepEqual(await canonicalizeGameEvidence(withGetter), {
    ok: false,
    code: "EVIDENCE_NOT_JSON_SAFE",
  });
});
