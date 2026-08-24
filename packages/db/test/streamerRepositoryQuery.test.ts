import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import type { D1Database } from "../src/d1/D1UserRepository.js";

test("Streamer score ranking binds game IDs instead of interpolating query input", async () => {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const db: D1Database = {
    prepare(query: string) {
      queries.push(query);
      const statement = {
        bind(...values: unknown[]) {
          bindings.push(values);
          return statement;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement as unknown as ReturnType<D1Database["prepare"]>;
    },
    async batch() {
      return [];
    },
  };

  const injected = "reaction-time' OR 1=1 --";
  await new D1StreamerRepository(db).getStreamerRankings({ mode: "score", gameId: injected });

  const scoreQuery = queries.find((query) => query.includes("FROM scores s"));
  assert.ok(scoreQuery);
  assert.equal(scoreQuery.includes(injected), false);
  assert.ok(bindings.some((values) => values.includes(injected)));
});
