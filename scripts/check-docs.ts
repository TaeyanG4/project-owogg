import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type DocsCheckIssueCode =
  | "BROKEN_LINK"
  | "MISSING_INDEX_ENTRY"
  | "MISSING_INDEXED_DOCUMENT"
  | "MIGRATION_METADATA_MISMATCH";

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

export function checkDocs(repositoryRoot = process.cwd()): DocsCheckIssue[] {
  return [
    ...validateRelativeMarkdownLinks(repositoryRoot),
    ...validateDocumentationIndex(repositoryRoot),
    ...validateMigrationMetadata(repositoryRoot),
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
