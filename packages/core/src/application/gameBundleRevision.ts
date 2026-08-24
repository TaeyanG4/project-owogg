import type { OwoggGameCreatorManifest } from "@owogg/game-sdk/contracts";
import {
  findGameLogoFile,
  type PreparedBundle,
  type PreparedBundleFile,
} from "../domain/sandboxGameBundle.js";
import {
  OWOGG_GAME_CREATOR_MANIFEST_FILENAME,
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

  return parseGameCreatorManifest({ ...manifest, game });
}

export function serializeGameCreatorManifest(manifest: OwoggGameCreatorManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** Rebuilds a normalized archive with one manifest and the current game-level logo. Keeping the
 * current logo here prevents a later manifest-only edit from resurrecting an older logo that was
 * embedded in the selected source ZIP. */
export function rebuildGameBundleArchive(input: {
  prepared: PreparedBundle;
  writer: BundleArchiveWriter;
  manifestBytes: Uint8Array;
  currentLogo?: PreparedBundleFile | null | undefined;
}): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  const embeddedLogo = findGameLogoFile(input.prepared.files);

  for (const file of input.prepared.files) {
    if (file.path === OWOGG_GAME_CREATOR_MANIFEST_FILENAME) continue;
    if (embeddedLogo && file.path === embeddedLogo.path) continue;
    entries[file.path] = file.bytes;
  }
  entries[OWOGG_GAME_CREATOR_MANIFEST_FILENAME] = input.manifestBytes;

  const logo = input.currentLogo === undefined ? embeddedLogo : input.currentLogo;
  if (logo) entries[logo.path] = logo.bytes;

  return input.writer.write(entries);
}
