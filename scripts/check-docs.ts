import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type DocsCheckIssueCode =
  | "BROKEN_LINK"
  | "MISSING_INDEX_ENTRY"
  | "MISSING_INDEXED_DOCUMENT"
  | "MIGRATION_METADATA_MISMATCH"
  | "ERD_SCHEMA_MISMATCH";

export interface DocsCheckIssue {
  code: DocsCheckIssueCode;
  file: string;
  message: string;
}

const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "coverage", "dist", "node_modules"]);
const IGNORED_REPOSITORY_DIRECTORIES = new Set(["docs/archive", "docs/logs"]);

export const INDEXED_DOCUMENTS = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/GAME_PLATFORM_ARCHITECTURE.md",
  "docs/DATABASE.md",
  "docs/ERD.md",
  "docs/AUTHORIZATION.md",
  "docs/GAME_CREATION_GUIDE.md",
  "docs/GAME_UPLOAD_GUIDE.md",
  "docs/DISCORD_INTEGRATION.md",
  "docs/DISCORD_BOT_GUIDE.md",
  "docs/STREAMER_SYSTEM.md",
  "docs/I18N.md",
  "docs/i18n-content/README.md",
  "docs/MULTIPLAYER_GAME_DESIGN.md",
  "docs/maintenance/LEGACY_LEDGER.md",
] as const;

function toRepoPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function walkMarkdownFiles(repositoryRoot: string, directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const repositoryPath = toRepoPath(path.relative(repositoryRoot, entryPath));
    if (
      entry.isDirectory() &&
      (IGNORED_DIRECTORIES.has(entry.name) || IGNORED_REPOSITORY_DIRECTORIES.has(repositoryPath))
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      walkMarkdownFiles(repositoryRoot, entryPath, files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }
}

export function findMarkdownFiles(repositoryRoot: string): string[] {
  const files: string[] = [];
  walkMarkdownFiles(repositoryRoot, repositoryRoot, files);
  return files.sort();
}

function withoutFencedCode(markdown: string): string {
  return markdown.replace(/(^|\n)[ \t]*(?:```|~~~)[\s\S]*?(?:```|~~~)[ \t]*(?=\n|$)/g, "$1");
}

export function extractMarkdownLinkTargets(markdown: string): string[] {
  const source = withoutFencedCode(markdown);
  const targets: string[] = [];
  const inlineLink = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  const referenceLink = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;

  for (const pattern of [inlineLink, referenceLink]) {
    for (const match of source.matchAll(pattern)) {
      const rawTarget = match[1];
      if (rawTarget) {
        targets.push(rawTarget.replace(/^<|>$/g, ""));
      }
    }
  }

  return targets;
}

function isRelativeFileTarget(target: string): boolean {
  return (
    target.length > 0 &&
    !target.startsWith("#") &&
    !target.startsWith("/") &&
    !target.startsWith("//") &&
    !/^[a-z][a-z\d+.-]*:/i.test(target)
  );
}

function resolveLinkTarget(markdownFile: string, target: string): string | undefined {
  if (!isRelativeFileTarget(target)) {
    return undefined;
  }

  const pathOnly = target.split("#", 1)[0]?.split("?", 1)[0];
  if (!pathOnly) {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathOnly);
  } catch {
    decodedPath = pathOnly;
  }

  return path.resolve(path.dirname(markdownFile), decodedPath);
}

export function validateRelativeMarkdownLinks(repositoryRoot: string): DocsCheckIssue[] {
  const issues: DocsCheckIssue[] = [];

  for (const markdownFile of findMarkdownFiles(repositoryRoot)) {
    const markdown = readFileSync(markdownFile, "utf8");
    for (const target of extractMarkdownLinkTargets(markdown)) {
      const resolvedTarget = resolveLinkTarget(markdownFile, target);
      if (resolvedTarget && !existsSync(resolvedTarget)) {
        issues.push({
          code: "BROKEN_LINK",
          file: toRepoPath(path.relative(repositoryRoot, markdownFile)),
          message: `Relative link does not resolve: ${target}`,
        });
      }
    }
  }

  return issues;
}

function indexedTargets(repositoryRoot: string): Set<string> {
  const indexPath = path.join(repositoryRoot, "docs", "README.md");
  if (!existsSync(indexPath)) {
    return new Set();
  }

  const markdown = readFileSync(indexPath, "utf8");
  const targets = new Set<string>();
  for (const target of extractMarkdownLinkTargets(markdown)) {
    const resolvedTarget = resolveLinkTarget(indexPath, target);
    if (resolvedTarget) {
      targets.add(toRepoPath(path.relative(repositoryRoot, resolvedTarget)));
    }
  }
  return targets;
}

export function validateDocumentationIndex(
  repositoryRoot: string,
  requiredDocuments: readonly string[] = INDEXED_DOCUMENTS,
): DocsCheckIssue[] {
  const issues: DocsCheckIssue[] = [];
  const targets = indexedTargets(repositoryRoot);

  for (const document of requiredDocuments) {
    if (!existsSync(path.join(repositoryRoot, document))) {
      issues.push({
        code: "MISSING_INDEXED_DOCUMENT",
        file: "docs/README.md",
        message: `Indexed document does not exist: ${document}`,
      });
    }
    if (!targets.has(document)) {
      issues.push({
        code: "MISSING_INDEX_ENTRY",
        file: "docs/README.md",
        message: `Required document is not linked from the index: ${document}`,
      });
    }
  }

  return issues;
}

export function latestMigrationFilename(migrationsDirectory: string): string | undefined {
  if (!existsSync(migrationsDirectory) || !statSync(migrationsDirectory).isDirectory()) {
    return undefined;
  }

  return readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right, "en"))
    .at(-1);
}

export function validateMigrationMetadata(repositoryRoot: string): DocsCheckIssue[] {
  const databaseDocument = path.join(repositoryRoot, "docs", "DATABASE.md");
  const latestMigration = latestMigrationFilename(
    path.join(repositoryRoot, "packages", "db", "migrations"),
  );
  if (!existsSync(databaseDocument) || !latestMigration) {
    return [];
  }

  const markdown = readFileSync(databaseDocument, "utf8");
  const documentedMigration = markdown.match(/^최신 마이그레이션:\s*`([^`]+)`\s*$/m)?.[1];
  if (documentedMigration === latestMigration) {
    return [];
  }

  return [
    {
      code: "MIGRATION_METADATA_MISMATCH",
      file: "docs/DATABASE.md",
      message: `최신 마이그레이션 metadata는 ${documentedMigration ?? "누락"}이며, 실제 최신 파일은 ${latestMigration}입니다.`,
    },
  ];
}

export interface MigrationSchemaObjects {
  tables: string[];
  views: string[];
}

function withoutSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

/**
 * Projects the final table/view names from the append-only migration chain. This deliberately
 * tracks only schema-object lifecycle operations: columns, indexes and triggers do not affect the
 * ERD catalog, while CREATE/DROP/RENAME order does. The production migration compatibility test
 * remains the authority for whether the SQL itself applies to SQLite/D1.
 */
export function collectMigrationSchemaObjects(migrationsDirectory: string): MigrationSchemaObjects {
  const tables = new Set<string>();
  const views = new Set<string>();
  if (!existsSync(migrationsDirectory) || !statSync(migrationsDirectory).isDirectory()) {
    return { tables: [], views: [] };
  }

  const operationPattern =
    /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?<createKind>TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<createName>[A-Za-z_][A-Za-z0-9_]*)|\bDROP\s+(?<dropKind>TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?(?<dropName>[A-Za-z_][A-Za-z0-9_]*)|\bALTER\s+TABLE\s+(?<renameFrom>[A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+TO\s+(?<renameTo>[A-Za-z_][A-Za-z0-9_]*)/gi;

  for (const filename of readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right, "en"))) {
    const sql = withoutSqlComments(readFileSync(path.join(migrationsDirectory, filename), "utf8"));
    for (const match of sql.matchAll(operationPattern)) {
      const groups = match.groups ?? {};
      if (groups.createKind && groups.createName) {
        (groups.createKind.toUpperCase() === "TABLE" ? tables : views).add(groups.createName);
      } else if (groups.dropKind && groups.dropName) {
        (groups.dropKind.toUpperCase() === "TABLE" ? tables : views).delete(groups.dropName);
      } else if (groups.renameFrom && groups.renameTo) {
        tables.delete(groups.renameFrom);
        tables.add(groups.renameTo);
      }
    }
  }

  return {
    tables: [...tables].sort((left, right) => left.localeCompare(right, "en")),
    views: [...views].sort((left, right) => left.localeCompare(right, "en")),
  };
}

function extractErdCatalog(markdown: string, catalog: "TABLE" | "VIEW"): string[] | undefined {
  const startMarker = `<!-- ERD_${catalog}_CATALOG_START -->`;
  const endMarker = `<!-- ERD_${catalog}_CATALOG_END -->`;
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start < 0 || end <= start) return undefined;

  const block = markdown.slice(start + startMarker.length, end);
  return [...block.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function schemaDifference(actual: string[], documented: string[]): string | undefined {
  const actualSet = new Set(actual);
  const documentedSet = new Set(documented);
  const missing = actual.filter((name) => !documentedSet.has(name));
  const unexpected = documented.filter((name) => !actualSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return undefined;
  return [
    missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
    unexpected.length > 0 ? `실제 schema에 없음: ${unexpected.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

export function validateErdSchemaMetadata(repositoryRoot: string): DocsCheckIssue[] {
  const erdDocument = path.join(repositoryRoot, "docs", "ERD.md");
  const migrationsDirectory = path.join(repositoryRoot, "packages", "db", "migrations");
  const latestMigration = latestMigrationFilename(migrationsDirectory);
  if (!existsSync(erdDocument) || !latestMigration) return [];

  const markdown = readFileSync(erdDocument, "utf8");
  const actual = collectMigrationSchemaObjects(migrationsDirectory);
  const documentedMigration = markdown.match(/^최신 마이그레이션:\s*`([^`]+)`\s*$/m)?.[1];
  const documentedTables = extractErdCatalog(markdown, "TABLE");
  const documentedViews = extractErdCatalog(markdown, "VIEW");
  const summary = markdown.match(
    /^스키마 요약:\s*물리 테이블\s*`(\d+)`,\s*롤링 배포 호환 뷰\s*`(\d+)`\s*$/m,
  );
  const issues: DocsCheckIssue[] = [];

  if (documentedMigration !== latestMigration) {
    issues.push({
      code: "ERD_SCHEMA_MISMATCH",
      file: "docs/ERD.md",
      message: `ERD 최신 migration은 ${documentedMigration ?? "누락"}이며, 실제 최신 파일은 ${latestMigration}입니다.`,
    });
  }

  if (!documentedTables) {
    issues.push({
      code: "ERD_SCHEMA_MISMATCH",
      file: "docs/ERD.md",
      message: "물리 테이블 사전 marker가 누락되었습니다.",
    });
  } else {
    const difference = schemaDifference(actual.tables, documentedTables);
    if (difference) {
      issues.push({
        code: "ERD_SCHEMA_MISMATCH",
        file: "docs/ERD.md",
        message: `물리 테이블 사전이 migration chain과 다릅니다. ${difference}`,
      });
    }
  }

  if (!documentedViews) {
    issues.push({
      code: "ERD_SCHEMA_MISMATCH",
      file: "docs/ERD.md",
      message: "호환 뷰 사전 marker가 누락되었습니다.",
    });
  } else {
    const difference = schemaDifference(actual.views, documentedViews);
    if (difference) {
      issues.push({
        code: "ERD_SCHEMA_MISMATCH",
        file: "docs/ERD.md",
        message: `호환 뷰 사전이 migration chain과 다릅니다. ${difference}`,
      });
    }
  }

  const documentedTableCount = summary?.[1] ? Number(summary[1]) : undefined;
  const documentedViewCount = summary?.[2] ? Number(summary[2]) : undefined;
  if (
    documentedTableCount !== actual.tables.length ||
    documentedViewCount !== actual.views.length
  ) {
    issues.push({
      code: "ERD_SCHEMA_MISMATCH",
      file: "docs/ERD.md",
      message: `스키마 요약은 table/view ${documentedTableCount ?? "누락"}/${documentedViewCount ?? "누락"}이며, migration chain은 ${actual.tables.length}/${actual.views.length}입니다.`,
    });
  }

  return issues;
}

export function checkDocs(repositoryRoot = process.cwd()): DocsCheckIssue[] {
  return [
    ...validateRelativeMarkdownLinks(repositoryRoot),
    ...validateDocumentationIndex(repositoryRoot),
    ...validateMigrationMetadata(repositoryRoot),
    ...validateErdSchemaMetadata(repositoryRoot),
  ];
}

function main(): void {
  const repositoryRoot = process.cwd();
  const issues = checkDocs(repositoryRoot);
  if (issues.length === 0) {
    console.log(
      `Documentation check passed (${findMarkdownFiles(repositoryRoot).length} Markdown files).`,
    );
    return;
  }

  for (const issue of issues) {
    console.error(`${issue.file}: [${issue.code}] ${issue.message}`);
  }
  process.exitCode = 1;
}

const invokedScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedScript === import.meta.url) {
  main();
}
