import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  fileURLToPath(new URL("../../packages/db/migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./test-workers/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ["test-workers/**/*.test.ts"],
    maxWorkers: 1,
  },
});
