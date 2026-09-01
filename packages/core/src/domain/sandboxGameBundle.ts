/**
 * Sandbox game bundle domain: storage key layout, archive-entry validation, MIME resolution, and
 * the published-version manifest shape. Pure — no D1, no Hono, no storage provider, no zip
 * library. See docs/GAME_CREATION_GUIDE.md §3.2/§3.8.
 *
 * The central idea is that a *published* version is an immutable set of individual objects under
 * a path containing its own version id, so the browser can fetch each file straight from the CDN
 * with a year-long immutable cache and no request-time unzip anywhere. Nothing here knows or
 * cares which object-storage vendor is behind it.
 */

import { SANDBOX_GAME_POLICY } from "./sandboxGames.js";
import type { BundleArchiveReader } from "../ports/sandboxGames.js";

// ── Storage key layout ────────────────────────────────────────────────────────
//
// Storage identity is `gameId` (and, for published objects, `versionId`) — never `slug`. A slug is
// a user-facing name; tying stored bytes to it would make any future rename a data migration.

/**
 * Where a version's original uploaded archive lives. Content-addressed rather than
 * `uploads/<gameId>/<versionId>/source.zip`: the hash is known before the DB row exists, so the
 * upload can stay "store bytes, then insert the row that points at them" (with best-effort
 * cleanup if the insert fails) instead of needing a two-phase insert to learn its own id first.
 * Immutability and "never overwrite" hold either way — a given key always holds the same bytes.
 *
 * Consequence to know about: two versions with byte-identical archives share one source object,
 * so a future version-GC must delete published objects (which are per-version) freely but only
 * drop a source object once no version references that hash. See docs/WORK_PROGRESS.md.
 */
export function sourceArchiveObjectKey(gameId: number, contentHash: string): string {
  return `uploads/${gameId}/${contentHash}.zip`;
}

/** Prefix owning every published object of one version — the unit a future GC deletes. */
export function publishedVersionPrefix(gameId: number, versionId: number): string {
  return `games/${gameId}/${versionId}/`;
}

/** `path` must already be normalized by {@link normalizeBundleEntryPath}. */
export function publishedObjectKey(gameId: number, versionId: number, path: string): string {
  return `${publishedVersionPrefix(gameId, versionId)}${path}`;
}

/** Reserved: sits alongside the published files, so it can never collide with a bundle entry
 * (`manifest.json` at the bundle root would — see PUBLISHED_MANIFEST_FILENAME's use below). */
export function publishedManifestObjectKey(gameId: number, versionId: number): string {
  return `${publishedVersionPrefix(gameId, versionId)}${PUBLISHED_MANIFEST_FILENAME}`;
}

/** Deliberately not a name any real build output uses, so a bundle containing its own
 * `manifest.json` (Godot and some web templates do) can't shadow ours. */
export const PUBLISHED_MANIFEST_FILENAME = ".owogg-manifest.json";

/** The file a bundle must contain, and what `/play/:slug` resolves to. */
export const BUNDLE_ENTRY_PATH = "index.html";

/** Reserved basename (2026-08-18) for a game's catalog-card logo — `owogg.logo.<ext>` at the
 * bundle root, any of {@link LOGO_EXTENSIONS}. Required on every new registration
 * (SandboxGameUseCases.createGameFromBundle rejects a missing one with LOGO_REQUIRED) — a game
 * registered before this requirement simply has no logo object, and the web catalog falls back to
 * the site favicon for it rather than treating that as an error. Stored separately from the
 * per-version published files (see {@link sandboxGameLogoObjectKey}): it belongs to the *game*,
 * not any one version, so a version re-upload doesn't touch it and it isn't served from the
 * immutable per-version path published files use. */
export const LOGO_BASENAME = "owogg.logo";
export const LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"] as const;

/** Finds the logo entry among a prepared bundle's root-level files, or `null` if none of the
 * accepted extensions is present. */
export function findGameLogoFile(files: PreparedBundleFile[]): PreparedBundleFile | null {
  return (
    files.find((f) => LOGO_EXTENSIONS.some((ext) => f.path === `${LOGO_BASENAME}.${ext}`)) ?? null
  );
}

/** Where a game's logo lives — keyed by gameId only (not versionId), since the logo is a
 * game-level asset re-used across every version. `logoPath` must be one of the
 * {@link findGameLogoFile} matches, so its extension is trusted as-is. */
export function sandboxGameLogoObjectKey(gameId: number, logoPath: string): string {
  const ext = logoPath.slice(logoPath.lastIndexOf(".") + 1);
  return `games/${gameId}/logo.${ext}`;
}

/** Normalizes a standalone logo upload to the same reserved bundle filename contract. The caller's
 * original basename is irrelevant; only a supported extension is retained. */
export function standaloneGameLogoPath(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (!(LOGO_EXTENSIONS as readonly string[]).includes(ext)) return null;
  return `${LOGO_BASENAME}.${ext}`;
}

/** Content-addressed logo key used by standalone replacements. Writing a new object before the D1
 * pointer changes keeps the update atomic across B2/D1 and gives the public media URL a fresh
 * revision even when the file extension stays the same. */
export function revisedGameLogoObjectKey(
  gameId: number,
  logoPath: string,
  contentHash: string,
): string {
  const ext = logoPath.slice(logoPath.lastIndexOf(".") + 1);
  return `games/${gameId}/logos/${contentHash}.${ext}`;
}

// ── MIME ─────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  wasm: "application/wasm",
  data: "application/octet-stream", // Unity WebGL streaming data
  unityweb: "application/octet-stream", // Unity WebGL (older compressed builds)
  pck: "application/octet-stream", // Godot pack
  symbols: "application/octet-stream", // Unity symbol map (.symbols.json handled by `json`)
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  cur: "image/x-icon",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  map: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/** `br`/`gz` are transport encodings, not formats: Unity's Brotli WebGL build emits
 * `game.wasm.br`, which must be served as `application/wasm` + `Content-Encoding: br` or the
 * engine refuses it. Anything else (an actual `.br` archive a developer meant as a download)
 * would be misserved by this, which is an acceptable trade for making the dominant engine work. */
const CONTENT_ENCODINGS: Record<string, string> = { br: "br", gz: "gzip" };

export interface BundleContentType {
  contentType: string;
  /** Set only when the filename carried a transport-encoding suffix. */
  contentEncoding?: string | undefined;
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function resolveBundleContentType(path: string): BundleContentType {
  const ext = extensionOf(path);
  const encoding = CONTENT_ENCODINGS[ext];
  if (encoding) {
    const inner = path.slice(0, path.length - ext.length - 1);
    return { contentType: resolveBundleContentType(inner).contentType, contentEncoding: encoding };
  }
  return { contentType: MIME_TYPES[ext] ?? "application/octet-stream", contentEncoding: undefined };
}

// ── Archive entry validation ─────────────────────────────────────────────────

/**
 * Normalizes one archive entry name, or returns null if it must be rejected outright.
 *
 * Rejection is about never *storing* a key we didn't intend, not about escaping a filesystem —
 * there is no filesystem here, entries become object keys. A `../` that slipped through would
 * write outside this version's prefix, which is precisely the boundary the whole immutable-version
 * model rests on.
 */
export function normalizeBundleEntryPath(rawName: string): string | null {
  // Zips written on Windows sometimes use backslashes despite the spec.
  const path = rawName.replace(/\\/g, "/");
  if (path === "" || path.endsWith("/")) return null; // directory entry — skip, not an error
  if (path.startsWith("/")) return null; // absolute
  if (/^[a-zA-Z]:/.test(path)) return null; // drive-letter absolute
  const segments = path.split("/");
  if (segments.length > SANDBOX_GAME_POLICY.MAX_BUNDLE_PATH_DEPTH) return null;
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
  }
  return path;
}

/** True for entries that are directories rather than files (so callers can skip without treating
 * them as invalid). Kept separate from {@link normalizeBundleEntryPath}, which folds both cases
 * into null, because the publisher needs to tell "skip this" from "reject this bundle". */
export function isDirectoryEntry(rawName: string): boolean {
  const path = rawName.replace(/\\/g, "/");
  return path === "" || path.endsWith("/");
}

/**
 * Many engines (and anyone who zips the folder rather than its contents) wrap everything in one
 * top-level directory: `MyGame/index.html` instead of `index.html`. Returns the prefix to strip,
 * or null when the paths are already rooted. Only unwraps when *every* entry shares the single
 * top-level directory, so a bundle that legitimately has one folder plus a root `index.html` is
 * left alone.
 */
export function singleRootFolderPrefix(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const roots = new Set<string>();
  for (const path of paths) {
    const slash = path.indexOf("/");
    if (slash <= 0) return null; // a root-level file exists — nothing to unwrap
    roots.add(path.slice(0, slash));
    if (roots.size > 1) return null;
  }
  const [root] = roots;
  return root === undefined ? null : `${root}/`;
}

export const SANDBOX_BUNDLE_REJECTIONS = [
  "BUNDLE_MALFORMED",
  "BUNDLE_INVALID_PATH",
  "BUNDLE_TOO_MANY_FILES",
  "BUNDLE_EXTRACTED_TOO_LARGE",
  "BUNDLE_MISSING_ENTRY",
] as const;
export type SandboxBundleRejection = (typeof SANDBOX_BUNDLE_REJECTIONS)[number];

export interface PreparedBundleFile {
  /** Root-relative, already normalized and unwrapped. */
  path: string;
  bytes: Uint8Array;
  contentType: string;
  contentEncoding?: string | undefined;
}

export interface PreparedBundle {
  files: PreparedBundleFile[];
  entry: string;
  totalSize: number;
}

export interface PreparedArchiveFiles {
  files: PreparedBundleFile[];
  totalSize: number;
}

/** One archive entry's name and its *declared* (not yet decompressed) sizes, as read from a zip's
 * central directory. See {@link validateBundleEntryMetadata}. */
export interface BundleEntryMetadata {
  path: string;
  declaredSize: number;
  /** Compressed size as declared in the same central directory record. Used only for the
   * compression-ratio sanity check — never trusted for the total-size cap, which is
   * `declaredSize`-based (uncompressed is what ends up in memory/storage). */
  compressedSize: number;
}

/**
 * DEFLATE's realistic maximum single-stream expansion ratio — the well-documented ceiling for how
 * much a crafted (but non-recursive, non-nested-archive) compressed stream can expand by, roughly
 * 1032:1 for the strongest known constructions. Set with headroom above that so genuinely
 * well-compressed legitimate assets (e.g. a large solid-color texture, which can compress
 * extremely well) are never mistaken for an attack — this check exists to catch entries claiming a
 * ratio beyond what DEFLATE can physically produce, not to second-guess normal compression.
 */
const MAX_PLAUSIBLE_COMPRESSION_RATIO = 1200;

/**
 * Validates entry paths, count, total declared size, and per-entry compression ratio — cheap
 * enough to run on metadata alone, before any entry is actually decompressed. This is the zip-bomb
 * defense: a central directory can be read in full without touching a single byte of compressed
 * *content*, so these limits can all be enforced before the (potentially much larger) decompressed
 * bytes ever exist in memory. See {@link prepareBundleEntries}, which re-validates the total-size
 * limit against the real bytes as defense in depth once decompression has actually happened.
 *
 * On memory safety specifically: this total-size check is not just advisory. fflate allocates each
 * entry's decompression output buffer at exactly its declared size, and silently drops any
 * decoded bytes past that — see infrastructure/games/FflateBundleArchiveReader.ts's header comment
 * for the verified mechanics. That is what makes summing `declaredSize` here a sound bound on
 * actual memory, not just a check on what an entry *claims*. The compression-ratio check below
 * catches the residual risk that isn't about memory: an entry whose compressed bytes are crafted
 * to make the decode loop run for a long time is still bounded by MAX_BUNDLE_BYTES on the total
 * compressed upload, but rejecting an implausible ratio up front avoids paying even that cost.
 *
 * Directory entries (trailing `/`) are skipped, matching prepareBundleEntries.
 */
export function validateBundleEntryMetadata(entries: BundleEntryMetadata[]): void {
  const files = entries.filter((e) => !isDirectoryEntry(e.path));

  if (files.length > SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT) {
    throw new SandboxBundleRejectionError(
      "BUNDLE_TOO_MANY_FILES",
      `${files.length} > ${SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT}`,
    );
  }

  let totalDeclaredSize = 0;
  for (const file of files) {
    if (normalizeBundleEntryPath(file.path) === null) {
      throw new SandboxBundleRejectionError("BUNDLE_INVALID_PATH", file.path);
    }

    const compressedSize = Math.max(0, file.compressedSize);
    // A negative/garbage declared size can't reduce the running total below what's already been
    // counted — clamping to 0 means a malformed header can only ever make this check stricter,
    // never let a large entry hide behind a bogus negative one.
    const declaredSize = Math.max(0, file.declaredSize);

    if (declaredSize > compressedSize * MAX_PLAUSIBLE_COMPRESSION_RATIO) {
      throw new SandboxBundleRejectionError(
        "BUNDLE_EXTRACTED_TOO_LARGE",
        `${file.path}: declared ${declaredSize}B from ${compressedSize}B compressed exceeds a plausible DEFLATE ratio`,
      );
    }

    totalDeclaredSize += declaredSize;
    if (totalDeclaredSize > SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES) {
      throw new SandboxBundleRejectionError(
        "BUNDLE_EXTRACTED_TOO_LARGE",
        `> ${SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES} declared bytes`,
      );
    }
  }
}

/**
 * Full archive-to-PreparedBundle pipeline: metadata pass (zip-bomb guard, no decompression) →
 * validate → full decompression → prepare. Shared by GamePublicationService and official builds so the
 * official generic bootstrap can reuse the exact validation sequence; nothing here is
 * publisher-specific — it takes a {@link BundleArchiveReader} and raw bytes, and callers pass a real archive
 * reader implementation of the same port. See GamePublicationService.prepare's own doc comment for why
 * the two passes must stay in this order (metadata-only before paying for full decompression).
 */
export function prepareBundleFromArchive(
  archives: BundleArchiveReader,
  archive: ArrayBuffer,
): PreparedBundle {
  let metadata: BundleEntryMetadata[];
  try {
    metadata = archives.readMetadata(archive);
  } catch {
    throw new SandboxBundleRejectionError("BUNDLE_MALFORMED");
  }
  validateBundleEntryMetadata(metadata);

  let entries: Record<string, Uint8Array>;
  try {
    entries = archives.read(archive);
  } catch {
    throw new SandboxBundleRejectionError("BUNDLE_MALFORMED");
  }
  return prepareBundleEntries(entries);
}

/**
 * Turns raw, already-decompressed archive entries into the exact set of objects to publish, or
 * throws the matching rejection code. Callers are expected to have already run
 * {@link validateBundleEntryMetadata} against the archive's declared sizes *before* decompressing
 * (see {@link prepareBundleFromArchive}) — the checks here run again against the real bytes as
 * defense in depth, not as the primary zip-bomb guard.
 */
export function prepareBundleEntries(entries: Record<string, Uint8Array>): PreparedBundle {
  const prepared = prepareArchiveFileEntries(entries);
  if (!prepared.files.some((file) => file.path === BUNDLE_ENTRY_PATH)) {
    throw new SandboxBundleRejectionError("BUNDLE_MISSING_ENTRY", BUNDLE_ENTRY_PATH);
  }
  return { ...prepared, entry: BUNDLE_ENTRY_PATH };
}

/** Validates and normalizes a ZIP file set without requiring the playable index.html entry.
 * Used only by tightly-scoped partial uploads whose caller applies its own file allowlist. */
export function prepareArchiveFileEntries(
  entries: Record<string, Uint8Array>,
): PreparedArchiveFiles {
  const named: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const [rawName, bytes] of Object.entries(entries)) {
    if (isDirectoryEntry(rawName)) continue;
    const path = normalizeBundleEntryPath(rawName);
    if (path === null) throw new SandboxBundleRejectionError("BUNDLE_INVALID_PATH", rawName);
    named.push({ path, bytes });
  }

  validateBundleEntryMetadata(
    named.map((f) => ({
      path: f.path,
      declaredSize: f.bytes.byteLength,
      // No compressed size to compare against post-decompression — the real byte length here
      // already *is* ground truth, so the ratio check has nothing meaningful to catch at this
      // point. Passing declaredSize as compressedSize gives a ratio of 1, a no-op for this pass.
      compressedSize: f.bytes.byteLength,
    })),
  );

  let totalSize = 0;
  for (const file of named) {
    totalSize += file.bytes.byteLength;
  }

  const prefix = singleRootFolderPrefix(named.map((f) => f.path));
  const rooted = prefix
    ? named.map((f) => ({ ...f, path: f.path.slice(prefix.length) }))
    : named.slice();

  return {
    totalSize,
    files: rooted.map((file) => {
      const { contentType, contentEncoding } = resolveBundleContentType(file.path);
      return { path: file.path, bytes: file.bytes, contentType, contentEncoding };
    }),
  };
}

export class SandboxBundleRejectionError extends Error {
  constructor(
    public readonly code: SandboxBundleRejection,
    /** Short, non-sensitive detail for the developer-facing message (an offending path, a count).
     * Never carries bundle contents. */
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export interface SandboxGameBundleManifestFile {
  path: string;
  size: number;
  contentType: string;
  contentEncoding?: string | undefined;
}

/**
 * Written alongside a version's published objects. Exists so that later operations don't need to
 * list the bucket (an operation whose cost and consistency vary by provider): version deletion,
 * publish verification, storage-usage accounting, and debugging can all read this one object and
 * know exactly which keys belong to the version.
 */
export interface SandboxGameBundleManifest {
  gameId: number;
  versionId: number;
  /** Hash of the source archive these files were extracted from. */
  contentHash: string;
  entry: string;
  fileCount: number;
  totalSize: number;
  publishedAt: string;
  files: SandboxGameBundleManifestFile[];
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256ContentHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Strictly validates the one existing published-bundle manifest shape. This is deliberately kept
 * beside {@link buildBundleManifest}: readers and writers share one domain contract rather than
 * growing a second storage-specific schema.
 */
export function isValidSandboxGameBundleManifest(
  value: unknown,
): value is SandboxGameBundleManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const manifest = value as Partial<SandboxGameBundleManifest>;

  if (!isPositiveInteger(manifest.gameId) || !isPositiveInteger(manifest.versionId)) return false;
  if (!isSha256ContentHash(manifest.contentHash)) return false;
  if (
    typeof manifest.entry !== "string" ||
    normalizeBundleEntryPath(manifest.entry) !== manifest.entry
  ) {
    return false;
  }
  if (
    !isPositiveInteger(manifest.fileCount) ||
    manifest.fileCount > SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT ||
    !isNonNegativeInteger(manifest.totalSize) ||
    manifest.totalSize > SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES ||
    typeof manifest.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.publishedAt)) ||
    new Date(manifest.publishedAt).toISOString() !== manifest.publishedAt ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== manifest.fileCount
  ) {
    return false;
  }

  const paths = new Set<string>();
  let totalSize = 0;
  for (const candidate of manifest.files) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return false;
    }
    const file = candidate as Partial<SandboxGameBundleManifestFile>;
    if (
      typeof file.path !== "string" ||
      normalizeBundleEntryPath(file.path) !== file.path ||
      file.path === PUBLISHED_MANIFEST_FILENAME ||
      paths.has(file.path) ||
      !isNonNegativeInteger(file.size) ||
      typeof file.contentType !== "string" ||
      file.contentType.length === 0 ||
      (file.contentEncoding !== undefined &&
        (typeof file.contentEncoding !== "string" || file.contentEncoding.length === 0))
    ) {
      return false;
    }
    paths.add(file.path);
    totalSize += file.size;
    if (totalSize > SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES) return false;
  }

  return paths.has(manifest.entry) && totalSize === manifest.totalSize;
}

export function buildBundleManifest(input: {
  gameId: number;
  versionId: number;
  contentHash: string;
  prepared: PreparedBundle;
  publishedAt: string;
}): SandboxGameBundleManifest {
  return {
    gameId: input.gameId,
    versionId: input.versionId,
    contentHash: input.contentHash,
    entry: input.prepared.entry,
    fileCount: input.prepared.files.length,
    totalSize: input.prepared.totalSize,
    publishedAt: input.publishedAt,
    files: input.prepared.files.map((f) => ({
      path: f.path,
      size: f.bytes.byteLength,
      contentType: f.contentType,
      contentEncoding: f.contentEncoding,
    })),
  };
}
