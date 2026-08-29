import type {
  GamePresentation,
  OwoggGameCreatorManifest,
  ScoreConfig,
} from "@owogg/game-sdk/contracts";
import {
  GAME_CANONICAL_SCHEMA_VERSION,
  projectManifestPlayConfigToCanonical,
  type GameCanonicalDocument,
} from "../modules/game/domain/gameCanonicalDocument.js";

function scoreConfig(manifest: OwoggGameCreatorManifest): ScoreConfig | null {
  const score = manifest.result.score;
  if (score === null) return null;
  return {
    unit: score.unit,
    direction: score.direction,
    min: score.range.min,
    max: score.range.max,
    ...(score.precision !== undefined ? { precision: score.precision } : {}),
    outOfRange: score.range.outOfRange,
  };
}

function presentation(manifest: OwoggGameCreatorManifest): GamePresentation | undefined {
  const declared = manifest.presentation;
  if (declared === undefined) return undefined;

  let preferredDimensions: { preferredWidth: number; preferredHeight: number } | undefined;
  if (declared.aspectRatio) {
    const [widthText, heightText] = declared.aspectRatio.split(":");
    const width = Number(widthText);
    const height = Number(heightText);
    const scale = 1600 / Math.max(width, height);
    preferredDimensions = {
      preferredWidth: Math.max(1, Math.round(width * scale)),
      preferredHeight: Math.max(1, Math.round(height * scale)),
    };
  }

  return {
    viewport: { mode: "responsive", ...preferredDimensions },
    fullscreen: { supported: true },
    mobile: {
      support: manifest.input?.includes("touch") ? "supported" : "unsupported",
      ...(declared.orientation !== undefined ? { orientation: declared.orientation } : {}),
    },
  };
}

/** Builds server-owned canonical state from a validated Game Creator manifest. */
export function mapGameCreatorManifestToCanonical(input: {
  manifest: OwoggGameCreatorManifest;
  publisherOfficial: boolean;
  updatedAt: string;
  previous?: GameCanonicalDocument | null | undefined;
}): GameCanonicalDocument {
  const { manifest, previous } = input;
  const score = scoreConfig(manifest);
  const declaredPresentation = presentation(manifest);
  const defaultDifficulty = manifest.difficulties?.find((difficulty) => difficulty.default)?.id;
  const firstDifficulty = manifest.difficulties?.[0];
  const difficulty = firstDifficulty
    ? {
        levels: manifest.difficulties?.map(({ id, title }) => ({ id, label: title })) ?? [],
        defaultLevelId: defaultDifficulty ?? firstDifficulty.id,
      }
    : undefined;
  const playConfig = projectManifestPlayConfigToCanonical(manifest);

  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug: manifest.game.slug,
    title: manifest.game.title,
    shortDescription: manifest.game.shortDescription ?? "",
    description: manifest.game.description ?? "",
    publisher: { official: input.publisherOfficial },
    policy: {
      score,
      leaderboard: manifest.leaderboard?.enabled ?? false,
      xpPerCompletion: previous?.policy.xpPerCompletion ?? 0,
      requiresAuth: previous?.policy.requiresAuth ?? false,
    },
    ...(declaredPresentation !== undefined ? { presentation: declaredPresentation } : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(playConfig !== undefined ? { playConfig } : {}),
    supportsReplay: previous?.supportsReplay ?? false,
    catalog: {
      type: "GENRE_MODE",
      genre: manifest.game.genre,
      mode: manifest.game.mode,
      tags: manifest.game.tags ?? [],
      inputMethods: manifest.input ?? [],
    },
    creatorManifest: manifest,
    updatedAt: input.updatedAt,
  };
}
