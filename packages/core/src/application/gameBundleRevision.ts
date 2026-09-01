import type { OwoggDescriptionFile, OwoggGameCreatorManifest } from "@owogg/game-sdk/contracts";
import {
  findGameLogoFile,
  resolveBundleContentType,
  type PreparedBundle,
  type PreparedBundleFile,
} from "../domain/sandboxGameBundle.js";
import {
  GAME_DESCRIPTION_FILE_LOCALES,
  OWOGG_GAME_CREATOR_MANIFEST_FILENAME,
  gameDescriptionFilePaths,
  gameDescriptionImagePaths,
  parseGameCreatorManifest,
} from "../domain/gameCreatorManifest.js";
import type { BundleArchiveWriter, SandboxGameBasicMetadataInput } from "../ports/sandboxGames.js";

/** Applies the safe editable subset and re-validates the complete manifest so a UI patch can never
 * manufacture a state that a normal `owogg.json` upload would reject. */
export function patchGameCreatorManifestBasicMetadata(
  manifest: OwoggGameCreatorManifest,
  input: SandboxGameBasicMetadataInput,
): OwoggGameCreatorManifest {
  const game: Record<string, unknown> = {
    ...manifest.game,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.genre !== undefined ? { genre: input.genre } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
  };

  if (input.shortDescription !== undefined) {
    if (input.shortDescription === null || input.shortDescription === "") {
      delete game.shortDescription;
    } else {
      game.shortDescription = input.shortDescription;
    }
  }
  if (input.description !== undefined) {
    if (input.description === null || input.description === "") {
      delete game.description;
    } else {
      game.description = input.description;
    }
  }

  const presentation: Record<string, unknown> = {
    ...(manifest.presentation ?? {}),
    ...(input.defaultScreenMode !== undefined ? { defaultMode: input.defaultScreenMode } : {}),
  };
  return parseGameCreatorManifest({
    ...manifest,
    game,
    ...(Object.keys(presentation).length > 0 ? { presentation } : {}),
  });
}

export function serializeGameCreatorManifest(manifest: OwoggGameCreatorManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

export interface GameDescriptionRevision {
  manifest: OwoggGameCreatorManifest;
  replacementFiles: readonly PreparedBundleFile[];
  removePaths: readonly string[];
}

const DESCRIPTION_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

function isDescriptionFile(path: string): path is OwoggDescriptionFile {
  return Object.prototype.hasOwnProperty.call(GAME_DESCRIPTION_FILE_LOCALES, path);
}

/** Builds the manifest/file delta for either one Markdown document or a complete ZIP package.
 * ZIP packages are intentionally replacement sets: omitted old description files and images are
 * removed, so owogg.json can never retain a stale reference that was not part of the submission. */
export function buildGameDescriptionRevision(input: {
  manifest: OwoggGameCreatorManifest;
  packageFiles: readonly PreparedBundleFile[];
  replaceAll: boolean;
}): GameDescriptionRevision {
  if (input.packageFiles.length === 0) throw new Error("description package is empty");
  const markdownFiles = input.packageFiles.filter((file) => isDescriptionFile(file.path));
  const imageFiles = input.packageFiles.filter((file) =>
    DESCRIPTION_IMAGE_CONTENT_TYPES.has(resolveBundleContentType(file.path).contentType),
  );
  if (markdownFiles.length + imageFiles.length !== input.packageFiles.length) {
    throw new Error("description package contains an unsupported file");
  }
  if (!input.replaceAll && (input.packageFiles.length !== 1 || markdownFiles.length !== 1)) {
    throw new Error("a single description upload must be one supported Markdown file");
  }

  const previousDescriptionPaths = gameDescriptionFilePaths(input.manifest);
  const previousImagePaths = gameDescriptionImagePaths(input.manifest);
  const nextDescriptionPaths = input.replaceAll
    ? markdownFiles.map((file) => file.path as OwoggDescriptionFile)
    : Array.from(
        new Set([
          ...previousDescriptionPaths,
          ...(markdownFiles.map((file) => file.path) as OwoggDescriptionFile[]),
        ]),
      );
  if (!nextDescriptionPaths.includes("description.md")) {
    throw new Error("description.md is required as the English default");
  }
  const orderedDescriptionPaths = (
    Object.keys(GAME_DESCRIPTION_FILE_LOCALES) as OwoggDescriptionFile[]
  ).filter((path) => nextDescriptionPaths.includes(path));
  const nextImagePaths = input.replaceAll
    ? imageFiles.map((file) => file.path)
    : [...previousImagePaths];

  const game: Record<string, unknown> = {
    ...input.manifest.game,
    description: orderedDescriptionPaths,
    description_images: nextImagePaths,
  };
  if (nextImagePaths.length === 0) delete game.description_images;

  return {
    manifest: parseGameCreatorManifest({ ...input.manifest, game }),
    replacementFiles: input.packageFiles,
    removePaths: input.replaceAll
      ? [...previousDescriptionPaths, ...previousImagePaths]
      : markdownFiles.map((file) => file.path),
  };
}

/** Rebuilds a normalized archive with one manifest and the current game-level logo. Keeping the
 * current logo here prevents a later manifest-only edit from resurrecting an older logo that was
 * embedded in the selected source ZIP. */
export function rebuildGameBundleArchive(input: {
  prepared: PreparedBundle;
  writer: BundleArchiveWriter;
  manifestBytes: Uint8Array;
  currentLogo?: PreparedBundleFile | null | undefined;
  removePaths?: readonly string[] | undefined;
  replacementFiles?: readonly PreparedBundleFile[] | undefined;
}): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  const embeddedLogo = findGameLogoFile(input.prepared.files);
  const removePaths = new Set(input.removePaths ?? []);
  const replacementPaths = new Set((input.replacementFiles ?? []).map((file) => file.path));

  for (const file of input.prepared.files) {
    if (file.path === OWOGG_GAME_CREATOR_MANIFEST_FILENAME) continue;
    if (embeddedLogo && file.path === embeddedLogo.path) continue;
    if (removePaths.has(file.path) || replacementPaths.has(file.path)) continue;
    entries[file.path] = file.bytes;
  }
  entries[OWOGG_GAME_CREATOR_MANIFEST_FILENAME] = input.manifestBytes;
  for (const file of input.replacementFiles ?? []) entries[file.path] = file.bytes;

  const logo = input.currentLogo === undefined ? embeddedLogo : input.currentLogo;
  if (logo) entries[logo.path] = logo.bytes;

  return input.writer.write(entries);
}
