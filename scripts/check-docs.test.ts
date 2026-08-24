import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  collectMigrationSchemaObjects,
  findMarkdownFiles,
  latestMigrationFilename,
  validateDocumentationIndex,
  validateErdSchemaMetadata,
  validateMigrationMetadata,
  validateRelativeMarkdownLinks,
} from "./check-docs.js";

const temporaryDirectories: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), "owogg-docs-check-"));
  temporaryDirectories.push(root);
  return root;
}

function write(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("relative Markdown links must resolve", () => {
  const root = createRepository();
  write(root, "docs/README.md", "[exists](ARCHITECTURE.md)\n[missing](MISSING.md)\n");
  write(root, "docs/ARCHITECTURE.md", "# Architecture\n");

  assert.deepEqual(validateRelativeMarkdownLinks(root), [
    {
      code: "BROKEN_LINK",
      file: "docs/README.md",
      message: "Relative link does not resolve: MISSING.md",
    },
  ]);
});

test("ignored local logs and archives are excluded from repository documentation checks", () => {
  const root = createRepository();
  write(root, "README.md", "# Root\n");
  write(root, "docs/GUIDE.md", "# Guide\n");
  write(root, "docs/logs/local.md", "[example](evil.url)\n");
  write(root, "docs/archive/old.md", "[example](missing.md)\n");

  assert.deepEqual(
    findMarkdownFiles(root).map((file) => path.relative(root, file).replaceAll(path.sep, "/")),
    ["README.md", "docs/GUIDE.md"],
  );
  assert.deepEqual(validateRelativeMarkdownLinks(root), []);
});

test("the documentation index must link existing required documents", () => {
  const root = createRepository();
  write(root, "docs/README.md", "[Architecture](ARCHITECTURE.md)\n");
  write(root, "docs/ARCHITECTURE.md", "# Architecture\n");

  assert.deepEqual(validateDocumentationIndex(root, ["docs/ARCHITECTURE.md", "docs/DATABASE.md"]), [
    {
      code: "MISSING_INDEXED_DOCUMENT",
      file: "docs/README.md",
      message: "Indexed document does not exist: docs/DATABASE.md",
    },
    {
      code: "MISSING_INDEX_ENTRY",
      file: "docs/README.md",
      message: "Required document is not linked from the index: docs/DATABASE.md",
    },
  ]);
});

test("database metadata follows the latest migration filename", () => {
  const root = createRepository();
  write(root, "packages/db/migrations/0001_first.sql", "-- first\n");
  write(root, "packages/db/migrations/0010_latest.sql", "-- latest\n");
  write(root, "docs/DATABASE.md", "최신 마이그레이션: `0001_first.sql`\n");

  assert.equal(
    latestMigrationFilename(path.join(root, "packages/db/migrations")),
    "0010_latest.sql",
  );
  assert.deepEqual(validateMigrationMetadata(root), [
    {
      code: "MIGRATION_METADATA_MISMATCH",
      file: "docs/DATABASE.md",
      message:
        "최신 마이그레이션 metadata는 0001_first.sql이며, 실제 최신 파일은 0010_latest.sql입니다.",
    },
  ]);
});

test("migration schema projection follows create, drop and table rename order", () => {
  const root = createRepository();
  write(
    root,
    "packages/db/migrations/0001_first.sql",
    `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE obsolete (id INTEGER PRIMARY KEY);
      CREATE VIEW old_users AS SELECT * FROM users;
    `,
  );
  write(
    root,
    "packages/db/migrations/0002_latest.sql",
    `
      -- CREATE TABLE comment_only (id INTEGER);
      DROP TABLE obsolete;
      ALTER TABLE users RENAME TO accounts;
      DROP VIEW IF EXISTS old_users;
      CREATE VIEW users AS SELECT * FROM accounts;
      CREATE TABLE _migration_guard (must_be_zero INTEGER);
      DROP TABLE _migration_guard;
    `,
  );

  assert.deepEqual(collectMigrationSchemaObjects(path.join(root, "packages", "db", "migrations")), {
    tables: ["accounts"],
    views: ["users"],
  });
});

test("ERD metadata and catalogs must match the final migration schema", () => {
  const root = createRepository();
  write(root, "packages/db/migrations/0001_first.sql", "CREATE TABLE users (id INTEGER);\n");
  write(
    root,
    "packages/db/migrations/0002_latest.sql",
    "CREATE TABLE sessions (id TEXT);\nCREATE VIEW current_users AS SELECT * FROM users;\n",
  );
  write(
    root,
    "docs/ERD.md",
    `
최신 마이그레이션: \`0002_latest.sql\`
스키마 요약: 물리 테이블 \`2\`, 롤링 배포 호환 뷰 \`1\`
<!-- ERD_TABLE_CATALOG_START -->
| 테이블 | 설명 |
| --- | --- |
| \`sessions\` | sessions |
| \`users\` | users |
<!-- ERD_TABLE_CATALOG_END -->
<!-- ERD_VIEW_CATALOG_START -->
| 뷰 | 설명 |
| --- | --- |
| \`current_users\` | users view |
<!-- ERD_VIEW_CATALOG_END -->
`,
  );

  assert.deepEqual(validateErdSchemaMetadata(root), []);

  write(
    root,
    "packages/db/migrations/0003_new.sql",
    "DROP VIEW current_users;\nCREATE TABLE audit_log (id INTEGER);\n",
  );
  const issues = validateErdSchemaMetadata(root);
  assert.equal(issues.length, 4);
  assert.match(issues[0]?.message ?? "", /0003_new\.sql/);
  assert.match(issues[1]?.message ?? "", /audit_log/);
  assert.match(issues[2]?.message ?? "", /current_users/);
  assert.match(issues[3]?.message ?? "", /3\/0/);
});
