import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router";
import { useIsGameDisabled } from "../catalog/gameAvailability";
import {
  formatScore,
  type GameRuntimeContext,
  type GameResult,
  type GamePresentation,
  type OwoggCompletionPayload,
  type ScoreConfig,
} from "@owogg/game-sdk";
import {
  saveLocalBestScore,
  extractPlayTokenFromLocation,
  consumeActivePlayToken,
  fetchLeaderboardApi,
} from "../scores/api";
import { getReactionTierById } from "@owogg/shared";
import { useAuth } from "../auth";
import { usePersonalization } from "../personalization";
import { useI18n } from "../i18n/I18nContext";
import { localizedDifficultyLabel } from "../catalog/difficultyLabels";
import { GameThumbnail } from "../../components/ui/GameThumbnail";
import { GamePlayActionBar } from "../../components/game/GamePlayActionBar";
import { GamePlayAdSlot } from "../../components/game/GamePlayAdSlot";
import { GameRecommendations } from "../../components/game/GameRecommendations";
import { XIcon } from "../../components/ui/XIcon";
import { IframeRuntime } from "./runtime/IframeRuntime";
import { fetchGameSession } from "./gameSessionApi";
import { acceptGameResult } from "./gameResultAcceptApi";
import { createGameResultFlow } from "./gameResultFlow";
import { resolvePresentationLayout } from "./presentationLayoutResolver";
import {
  shouldShowFullscreenControl,
  resolveMobileAdvisory,
  resolveOrientationAdvisory,
} from "./presentationAdvisory";
import { gamePlayUrl } from "../../lib/api/config";
import type { Dictionary } from "../i18n/dictionary";
import type { LeaderRecord, PublicGame } from "@owogg/contracts";
import { fetchPublicGame, usePublicGames } from "../publicGamesApi";
import { publicGameToCard } from "../catalog/publicGameAdapter";
import { selectRecommendedGameCards } from "./gameRecommendations";
import {
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  UserCheck,
  Copy,
  Trophy,
  RotateCcw,
  Bookmark,
  CalendarDays,
  Smartphone,
  Users,
  X,
} from "lucide-react";

export type SubmissionState = "idle" | "guest" | "submitting" | "success" | "error";

/** Exported for direct unit testing (apps/web/app/test/gameHostMetadata.test.ts) — the web test
 * suite has no DOM renderer, so these pure formatting helpers are the part of the result-overlay
 * logic that can actually be regression-tested without one. */
export function formatMetadataKey(key: string, dict: Dictionary["gamePlay"]): string {
  const map: Record<string, string> = {
    wpm: dict.metadataWpm,
    cpm: dict.metadataCpm,
    accuracy: dict.metadataAccuracy,
    correctChars: dict.metadataCorrectChars,
    incorrectChars: dict.metadataIncorrectChars,
    totalTypedChars: dict.metadataTotalTypedChars,
    durationMs: dict.metadataDurationMs,
    targetsHit: dict.metadataTargetsHit,
    misses: dict.metadataMisses,
    level: dict.metadataLevel,
    // Aim games can report hit/miss accuracy through runtime.complete metadata.
    targets: dict.metadataTargets,
    avgPerTargetMs: dict.metadataAvgPerTargetMs,
    // Memory games can report their reached level through runtime.complete metadata.
    sequenceLength: dict.metadataSequenceLength,
    grade: dict.metadataGrade,
  };
  return map[key] ?? key;
}

export function formatMetadataValue(key: string, value: unknown): string {
  if (key === "accuracy" && typeof value === "number") {
    return `${value}%`;
  }
  return String(value);
}

/**
 * Provider-neutral runtime URL. The API's generic resolver owns the numeric live version for
 * both OWOGG and USER games.
 */
export function resolveGameRuntimeUrl(slug: string): string {
  return gamePlayUrl(slug);
}

/**
 * Whether a difficulty-selector change should force IframeRuntime to remount (a fresh
 * `attemptKey`, and therefore a fresh HOST_INIT carrying the new `difficultyId`) — the Game
 * Bridge's bootstrap is a one-time handshake, so an already-connected iframe has no way to learn
 * a NEW difficulty short of a full reload (see the effect in GameHost that calls this).
 *
 * `previousDifficultyId` is `undefined` specifically for "no iframe attempt has been tracked yet
 * for this slug" (a fresh mount, or just navigated here) — that case always returns `false`: the
 * very first mount already reads the CURRENT `selectedDifficultyId` via the `difficultyId` prop,
 * so forcing an extra remount before anything has even loaded once would be pure waste.
 * `hasDifficultyTiers` gates every other game (memory-test, typing-test, and reaction-time today)
 * out entirely — an iframe-runtime game with no difficulty tiers has no selector to change in the
 * first place, so this must never fire for it even if some caller mistakenly passed a difficulty
 * value.
 */
export function shouldRemountIframeOnDifficultyChange(
  previousDifficultyId: string | undefined,
  nextDifficultyId: string,
  context: { hasDifficultyTiers: boolean },
): boolean {
  if (!context.hasDifficultyTiers) return false;
  if (previousDifficultyId === undefined) return false;
  return previousDifficultyId !== nextDifficultyId;
}

/**
 * Adapts the Game Bridge's reduced GAME_COMPLETE payload ({score?, metadata?}) into the full
 * GameResult shape runtime.complete (below) already expects, so the iframe path can feed the exact
 * same score/local-best/leaderboard/share pipeline GameHost owns — no duplicated submission
 * logic.
 *
 * Returns null for a completion with no score: runtime.complete's downstream (saveLocalBestScore,
 * handleScoreSubmission) has nothing meaningful to do with an absent score, so GameHost simply
 * doesn't call it rather than synthesizing a fake one (mirrors GameHost's own `result.score
 * !== undefined` guard around its score-submission call).
 *
 * gameId/sessionId/durationMs/clientStartedAt/clientEndedAt are all placeholder-filled where the
 * Bridge doesn't carry them: GameHost's runtime.complete only ever reads `.score`/`.metadata` off
 * its argument (see the result-overlay JSX and handleScoreSubmission below) — nothing consumes the
 * placeholders, so synthesizing them here has zero behavioral effect while still satisfying
 * GameResult's required shape.
 */
export function buildGameResultFromBridgeComplete(
  bridgeResult: OwoggCompletionPayload & { metadata?: Record<string, unknown> },
  context: { slug: string; sessionId: string },
): GameResult {
  const now = Date.now();
  return {
    gameId: context.slug,
    sessionId: context.sessionId,
    ...(bridgeResult.outcome !== undefined ? { outcome: bridgeResult.outcome } : {}),
    ...(bridgeResult.score !== undefined ? { score: bridgeResult.score } : {}),
    ...(bridgeResult.progression !== undefined ? { progression: bridgeResult.progression } : {}),
    ...(bridgeResult.metrics !== undefined ? { metrics: bridgeResult.metrics } : {}),
    durationMs: 0,
    ...(bridgeResult.metadata !== undefined ? { metadata: bridgeResult.metadata } : {}),
    clientStartedAt: now,
    clientEndedAt: now,
  };
}

// Metadata keys that get their own dedicated presentation elsewhere in the result screen (e.g.
// "tier" renders as a colored badge below the score, "rounds" is the raw per-round ms array used
// only for the tier calculation) or aren't meaningful to show as a raw key/value pair ("mode" is
// an internal typing-test mode id, e.g. "ko-short"; "difficultyId" is aim-test's own internal tier
// id, e.g. "hard" — already visible via the difficulty selector in the header, not something a
// second raw grid row adds anything to) — kept out of the generic key/value grid.
export const METADATA_GRID_EXCLUDED_KEYS = new Set(["tier", "rounds", "mode", "difficultyId"]);

// Today's fallback for every shipped game (none declares `presentation` yet — see
// presentationLayoutResolver.ts's own doc comment): the exact `frameClassName` restored in #44,
// unchanged. Kept as a named constant rather than inlined so the one call site building the
// iframe's actual layout props (below) can't drift from it by accident.
const LEGACY_IFRAME_FRAME_CLASS_NAME = "h-[70vh] min-h-[480px] max-h-[720px] w-full";

/**
 * Measures a DOM element's content box, live across resizes. The one piece of DOM measurement
 * `resolvePresentationLayout` itself deliberately has none of (pure function, no DOM — see its
 * own doc comment); this is the thin wiring around it, same split as
 * old publisher-specific resolver paths.
 *
 * Returns a callback ref rather than accepting a `useRef` object: the element this measures
 * (the iframe area, below) is conditionally rendered — not present on GameHost's very first
 * render, since `isLoading` starts `true` even for the iframe runtime kind. An object ref's
 * `.current` mutation is invisible to `useEffect`'s dependency array, so an effect keyed on a
 * stable ref object would only ever attach a ResizeObserver if the element happened to already
 * exist on the first render. A callback ref fires on every actual attach/detach, which is what
 * lets the `node` state (and therefore the effect below) update correctly whenever the element
 * later mounts.
 */
function useElementSize(): [
  (node: HTMLElement | null) => void,
  { width: number; height: number } | null,
] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, size];
}

// The #44 fallback's own UX target, reused (not re-derived) as the platform height constraint
// for a presentation-active game — see useViewportHeight's own doc comment for why this can't
// just be "whatever the iframe area's box measures". No min-height floor here on purpose: unlike
// the legacy CSS (`min-h-[480px]`), forcing a floor on `available.height` is exactly what would
// let a genuinely short viewport be overridden and overflow the page — a presentation-active game
// simply gets what 70vh/720px actually allows, same as resolvePresentationLayout's own "available
// always wins" rule for width.
const PLATFORM_HEIGHT_TARGET_RATIO = 0.7;
const PLATFORM_HEIGHT_CAP_PX = 720;

/** Exported for direct unit testing (apps/web/app/test/gameHostPlatformHeight.test.ts) — the
 * pure half of the height-independence fix this PR makes: target ~70% of the actual viewport
 * height, capped at 720px, with deliberately no floor (unlike the legacy CSS's
 * `min-h-[480px]`) — see PLATFORM_HEIGHT_TARGET_RATIO's own doc comment for why forcing one here
 * would be exactly the bug this function exists to avoid. */
export function computePlatformHeight(viewportHeight: number): number {
  return Math.min(viewportHeight * PLATFORM_HEIGHT_TARGET_RATIO, PLATFORM_HEIGHT_CAP_PX);
}

/**
 * The actual visible viewport height — `visualViewport` where available (correct on mobile with
 * on-screen keyboards/browser chrome; falls back to `window.innerHeight` otherwise) — tracked
 * live across resizes.
 *
 * Deliberately NOT a measurement of anything GameHost itself renders. The iframe area's own box
 * (see `useElementSize` / `iframeAreaRef` below) is a block element with `height: auto` — its
 * height is *derived from its content*, i.e. from the iframe GameHost is about to size using
 * `available.height`. Measuring that same box for height would close a feedback loop (child
 * height → measured parent height → resolver `available.height` → child height again) that, on a
 * height-only viewport change, might never even see the new value: the box's height wouldn't
 * change until something re-renders it with a different `available.height` in the first place.
 * `window`/`visualViewport` has no such relationship to what this component renders, so it is
 * always a real, independent read of the platform constraint (see this module's own "Game
 * preference ∩ Platform constraints ∩ Actual device viewport" principle). Width has no such
 * problem — the iframe area's box is a plain block element, whose *width* comes from its own
 * parent's layout, never from its children — so `useElementSize`'s measurement stays correct for
 * width unchanged.
 */
function useViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setHeight(window.visualViewport?.height ?? window.innerHeight);
    read();
    const target = window.visualViewport ?? window;
    target.addEventListener("resize", read);
    return () => target.removeEventListener("resize", read);
  }, []);

  return height;
}

/**
 * The actual, live fullscreen state — tracked via `document.fullscreenElement`/
 * `fullscreenchange`, never assumed from React state alone: an ESC-triggered browser exit (or any
 * other UA-driven exit) must correctly flip the UI back, and only the DOM's own event tells us
 * that happened.
 *
 * `targetRef` is a plain object ref, unlike `useElementSize`'s callback ref — `requestFullscreen`/
 * the `fullscreenchange` listener only ever run inside a user-gesture click handler or a
 * document-level effect, both of which read `.current` synchronously at the moment they fire, so
 * there's no "element mounted after this ran" timing gap to worry about here the way there was
 * for a ResizeObserver.
 *
 * `isFullscreenApiAvailable` gates whether GameHost shows the control at all — see this PR's own
 * requirement to prefer "don't show it" over a disabled button in an environment with no
 * Fullscreen API (some in-app browsers, `document.fullscreenEnabled === false` under a
 * permissions-policy restriction, ...). A rejected `requestFullscreen()`/`exitFullscreen()` is
 * logged and otherwise ignored — never fails the game itself.
 */
function useFullscreen(targetRef: React.RefObject<HTMLElement | null>): {
  isFullscreen: boolean;
  isFullscreenApiAvailable: boolean;
  toggleFullscreen: () => void;
} {
  const isFullscreenApiAvailable =
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function";
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreenApiAvailable) return;
    const handleChange = () => setIsFullscreen(document.fullscreenElement === targetRef.current);
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [isFullscreenApiAvailable, targetRef]);

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreenApiAvailable) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((err: unknown) => {
        console.error("Failed to exit fullscreen:", err);
      });
      return;
    }
    const el = targetRef.current;
    if (!el) return;
    el.requestFullscreen().catch((err: unknown) => {
      console.error("Failed to enter fullscreen:", err);
    });
  }, [isFullscreenApiAvailable, targetRef]);

  return { isFullscreen, isFullscreenApiAvailable, toggleFullscreen };
}

/** A coarse/touch-primary pointer (`matchMedia("(pointer: coarse)")`) — the one platform
 * heuristic mobile/orientation advisories are based on; see presentationAdvisory.ts's own doc
 * comment for why this and not `inputMethods` or User-Agent parsing. Tracked live via the
 * MediaQueryList's own `change` event, not just read once. */
function useIsMobileLikeEnvironment(): boolean {
  const [isMobileLike, setIsMobileLike] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const handleChange = () => setIsMobileLike(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isMobileLike;
}

/** The device's actual current orientation, from the native `matchMedia("(orientation:
 * portrait)")` signal rather than computed from `window.innerWidth`/`innerHeight` arithmetic.
 * Only meaningful where `useIsMobileLikeEnvironment` is true — a desktop window's aspect ratio
 * isn't a device orientation, which is why the caller only ever reads this inside that gate. */
function useActualOrientation(): "portrait" | "landscape" {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(() =>
    typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
      ? "portrait"
      : "landscape",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(orientation: portrait)");
    const handleChange = () => setOrientation(mql.matches ? "portrait" : "landscape");
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return orientation;
}

export interface GameHostProps {
  slug: string;
}

function publicGameAccent(game: PublicGame | null): string | undefined {
  return game?.catalog.type === "TAXONOMY" ? game.catalog.accent : undefined;
}

export function formatPublishedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

/** Wire schemas permit explicit `undefined` on optional properties; the SDK domain types use
 * exact-optional properties. Normalize at this boundary instead of weakening either contract. */
function toGamePresentation(input: PublicGame["presentation"]): GamePresentation | undefined {
  if (!input) return undefined;
  const viewport = input.viewport;
  const bounds = {
    ...(viewport.minWidth !== undefined ? { minWidth: viewport.minWidth } : {}),
    ...(viewport.minHeight !== undefined ? { minHeight: viewport.minHeight } : {}),
    ...(viewport.maxWidth !== undefined ? { maxWidth: viewport.maxWidth } : {}),
    ...(viewport.maxHeight !== undefined ? { maxHeight: viewport.maxHeight } : {}),
  };
  return {
    viewport:
      viewport.mode === "fixed"
        ? {
            mode: "fixed",
            preferredWidth: viewport.preferredWidth,
            preferredHeight: viewport.preferredHeight,
            ...bounds,
          }
        : {
            mode: "responsive",
            ...(viewport.preferredWidth !== undefined
              ? { preferredWidth: viewport.preferredWidth }
              : {}),
            ...(viewport.preferredHeight !== undefined
              ? { preferredHeight: viewport.preferredHeight }
              : {}),
            ...bounds,
          },
    fullscreen: {
      supported: input.fullscreen.supported,
      ...(input.fullscreen.recommended !== undefined
        ? { recommended: input.fullscreen.recommended }
        : {}),
    },
    mobile: {
      support: input.mobile.support,
      ...(input.mobile.orientation !== undefined ? { orientation: input.mobile.orientation } : {}),
    },
  };
}

function toScoreConfig(input: PublicGame["policy"]["score"]): ScoreConfig | undefined {
  if (!input) return undefined;
  return {
    unit: input.unit,
    direction: input.direction,
    min: input.min,
    max: input.max,
    ...(input.precision !== undefined ? { precision: input.precision } : {}),
    ...(input.outOfRange !== undefined ? { outOfRange: input.outOfRange } : {}),
    ...(input.displayPrefix !== undefined ? { displayPrefix: input.displayPrefix } : {}),
    ...(input.displaySuffix !== undefined ? { displaySuffix: input.displaySuffix } : {}),
  };
}

/**
 * Owns the full provider-neutral game lifecycle — loading, difficulty, parent-held signed Game
 * Session, iframe Bridge, score submission, result/leaderboard/share overlay, and retry.
 *
 * Split out of routes/game-slug.tsx (formerly one 740-line route component) so the route file is
 * just param extraction; this is everything else, unchanged. No behavior or UI changed by the
 * split itself — see the PR this shipped in for the equivalence tests that pin that down.
 */
export function GameHost({ slug }: GameHostProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading, openLoginModal } = useAuth();
  const { dict } = useI18n();
  const { recordRecentPlay, isFavorite, toggleFavorite } = usePersonalization();
  const { games: publicGames } = usePublicGames();

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [result, setResult] = useState<GameResult | null>(null);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isMobilePlayOpen, setIsMobilePlayOpen] = useState(false);
  const [gameShareState, setGameShareState] = useState<"idle" | "shared">("idle");
  const [mobileLinkCopied, setMobileLinkCopied] = useState(false);
  // Reaction-time games may provide a display badge through metadata.tier.
  // Other games don't set this metadata key, so this stays undefined for them.
  const resultTier = useMemo(() => {
    const tierId = result?.metadata?.tier;
    return typeof tierId === "string" ? getReactionTierById(tierId) : undefined;
  }, [result]);

  // Attempt Lifecycle State & Auth Eligibility
  const [attemptKey, setAttemptKey] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Result-screen leaderboard preview — only fetched for games that opt in
  // (game.policy.leaderboard), so casual games where rank doesn't matter can skip it.
  const [resultLeaderboard, setResultLeaderboard] = useState<LeaderRecord[] | null>(null);

  const [game, setGame] = useState<PublicGame | null>(null);
  const localizedTitle = game?.title;
  const catalogCards = useMemo(() => publicGames.map(publicGameToCard), [publicGames]);
  const currentGameCard = useMemo(
    () =>
      catalogCards.find((candidate) => candidate.slug === slug) ??
      (game ? publicGameToCard(game) : undefined),
    [catalogCards, game, slug],
  );
  const recommendedGames = useMemo(
    () => selectRecommendedGameCards(catalogCards, currentGameCard, 7),
    [catalogCards, currentGameCard],
  );
  const presentation = useMemo(() => toGamePresentation(game?.presentation), [game?.presentation]);
  const scoreConfig = useMemo(
    () => toScoreConfig(game?.policy.score ?? null),
    [game?.policy.score],
  );
  const isDisabled = useIsGameDisabled(slug);

  // Presentation layout — see presentationLayoutResolver.ts's own doc comment for the math, and
  // useElementSize's/useViewportHeight's for why width and height each come from the source they
  // do. `iframeAreaRef` goes on the edge-to-edge player viewport that actually bounds the iframe,
  // not some outer container: that's the one measurement that needs no hardcoded knowledge of
  // the recommendation rail or player chrome around it — and it is only ever
  // used for *width*, never height (see useViewportHeight's doc comment for the feedback loop
  // that would create).
  const [iframeAreaRef, measuredArea] = useElementSize();
  const viewportHeight = useViewportHeight();
  const gameSurfaceRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, isFullscreenApiAvailable, toggleFullscreen } =
    useFullscreen(gameSurfaceRef);
  const platformHeight =
    viewportHeight !== null
      ? isFullscreen
        ? Math.max(240, viewportHeight - 72)
        : computePlatformHeight(viewportHeight)
      : null;

  // `available` is `null` until both an independent width and height measurement exist —
  // resolvePresentationLayout's own fail-safe additionally treats a 0/negative value the same
  // way (never a collapsed 0px iframe), so this callback only has to combine the two sources.
  const available =
    measuredArea !== null && platformHeight !== null
      ? { width: measuredArea.width, height: platformHeight }
      : null;
  // `available` is a fresh object every render; the memo below depends on its primitive fields
  // instead so this only recomputes when they actually change, not on every render.
  const presentationLayout = useMemo(
    () => resolvePresentationLayout(presentation, available),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presentation, available?.width, available?.height],
  );
  // Game preference ∩ Platform constraints ∩ Actual available viewport → Host decides (see
  // GamePresentation's own doc comment). "legacy" is every shipped game today: the exact
  // frameClassName restored in #44, untouched — no frameStyle/iframeStyle at all, so GameFrame's
  // rendering for this branch is byte-identical to before this PR.
  const iframeFrameClassName =
    presentationLayout.kind === "legacy" ? LEGACY_IFRAME_FRAME_CLASS_NAME : "mx-auto max-w-full";
  const iframeFrameStyle =
    presentationLayout.kind === "legacy"
      ? undefined
      : { width: presentationLayout.displayWidth, height: presentationLayout.displayHeight };
  // Only "fixed" mode needs this: the iframe element itself is sized to the game's own logical
  // design resolution (so its document sees that as its viewport) and then visually scaled down
  // to fit iframeFrameStyle's box — see GameFrame.tsx's own iframeStyle doc comment.
  const iframeElementStyle =
    presentationLayout.kind === "fixed"
      ? {
          width: presentationLayout.logicalWidth,
          height: presentationLayout.logicalHeight,
          transform: `scale(${presentationLayout.scale})`,
          transformOrigin: "top left" as const,
        }
      : undefined;

  // Fullscreen — see useFullscreen's own doc comment. `gameSurfaceRef` is the fullscreen target —
  // never the iframe/GameFrame itself, and never anything inside it, so requestFullscreen always
  // targets Host-owned chrome, not a cross-origin document. It is attached to the complete player
  // shell (viewport plus the action footer), so the exit button remains inside the fullscreen
  // subtree and accessible after entry. presentation === undefined
  // (every shipped game today) always resolves showFullscreenControl to false, via
  // shouldShowFullscreenControl's own doc comment.
  const showFullscreenControl = shouldShowFullscreenControl(presentation, isFullscreenApiAvailable);
  const renderedIframeFrameClassName = isFullscreen
    ? "h-[calc(100vh-4.5rem)] w-full"
    : iframeFrameClassName;
  // Mobile/orientation advisories — see presentationAdvisory.ts's own doc comment. Both resolvers
  // return "no advisory" outright whenever isMobileLikeEnvironment is false, so nothing here ever
  // shows on desktop regardless of what a game's presentation.mobile declares.
  const isMobileLikeEnvironment = useIsMobileLikeEnvironment();
  const actualOrientation = useActualOrientation();
  const mobileAdvisory = resolveMobileAdvisory(presentation, isMobileLikeEnvironment);
  const orientationAdvisory = resolveOrientationAdvisory(
    presentation,
    isMobileLikeEnvironment,
    actualOrientation,
  );
  const presentationAdvisoryBanner =
    mobileAdvisory !== "none" || orientationAdvisory.kind !== "none" ? (
      <div className="flex w-full flex-col gap-1.5">
        {mobileAdvisory === "unsupported" && (
          <div
            data-testid="mobile-advisory-unsupported"
            className="flex items-center gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs font-semibold text-accent-red"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {dict.gamePlay.mobileUnsupportedNotice}
          </div>
        )}
        {mobileAdvisory === "experimental" && (
          <div
            data-testid="mobile-advisory-experimental"
            className="flex items-center gap-2 rounded-lg border border-accent-yellow/30 bg-accent-yellow/10 px-3 py-2 text-xs font-semibold text-accent-yellow"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {dict.gamePlay.mobileExperimentalNotice}
          </div>
        )}
        {orientationAdvisory.kind === "mismatch" && (
          <div
            data-testid="orientation-advisory"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-semibold text-text-secondary"
          >
            <RotateCcw className="h-4 w-4 shrink-0" />
            {orientationAdvisory.preferred === "portrait"
              ? dict.gamePlay.orientationPortraitHint
              : dict.gamePlay.orientationLandscapeHint}
          </div>
        )}
      </div>
    ) : null;

  // Difficulty selection — only meaningful for games with canonical difficulty. Resets to the
  // game's default whenever navigating between games. A change here only affects the NEXT
  // attempt: "next attempt" means the next iframe mount — see the
  // iframeAttemptDifficultyRef effect below for why an already-mounted iframe can't be updated
  // live.
  const [selectedDifficultyId, setSelectedDifficultyId] = useState<string>("normal");
  // Tracks the difficulty the CURRENTLY-mounted iframe attempt was actually bootstrapped with.
  // undefined means "no iframe attempt tracked yet for this slug" — see the effect below, which is
  // the only other place this ref is written.
  const iframeAttemptDifficultyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    setSelectedDifficultyId(game?.difficulty?.defaultLevelId ?? "normal");
    iframeAttemptDifficultyRef.current = undefined;
  }, [game]);

  // The generic Game Session is acquired before each attempt and held only in this parent-side
  // controller. It is never included in HOST_INIT or any iframe bridge message.
  const resultFlow = useMemo(
    () =>
      createGameResultFlow(
        {
          slug,
          fetchGameSession,
          acceptResult: (gameSlug, input) => {
            const playToken = consumeActivePlayToken();
            return acceptGameResult(gameSlug, {
              ...input,
              ...(playToken ? { playToken } : {}),
            });
          },
        },
        {
          onStatusChange: (state, message) => {
            setSubmissionState(state);
            setSubmissionError(message ?? null);
          },
        },
      ),
    [slug],
  );

  useEffect(() => {
    if (authLoading) return;
    void resultFlow.startAttempt(isAuthenticated, selectedDifficultyId);
  }, [authLoading, isAuthenticated, resultFlow, selectedDifficultyId, attemptKey]);

  // One generic detail fetch supplies canonical policy/presentation/media for both publishers.
  // No static manifest or sandbox-specific resolver is consulted on the primary play path.
  useEffect(() => {
    let cancelled = false;
    extractPlayTokenFromLocation();
    setIsLoading(true);
    setGame(null);
    setError(null);
    setResult(null);
    setIsTheaterMode(false);
    setIsMobilePlayOpen(false);
    fetchPublicGame(slug)
      .then((resolved) => {
        if (!cancelled) setGame(resolved);
      })
      .catch(() => {
        if (!cancelled) setError(dict.gamePlay.errorGameNotFound);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, dict.gamePlay.errorGameNotFound]);

  // Handle Score Submission (Authenticated Attempts Only)
  const handleResultSubmission = useCallback(
    async (completion: OwoggCompletionPayload) => {
      await resultFlow.handleComplete(isAuthenticated, completion);
    },
    [isAuthenticated, resultFlow],
  );

  // Reset / Retry Game Attempt
  const handleRetryGame = useCallback(() => {
    setResult(null);
    setSubmissionState("idle");
    setSubmissionError(null);
    setResultLeaderboard(null);
    setSessionId(crypto.randomUUID());
    setAttemptKey((prev) => prev + 1);
  }, []);

  // Forces a fresh iframe mount when the difficulty selector changes for a game that has real
  // difficulty tiers (aim-test today). The Game Bridge's HOST_INIT bootstrap is a one-time
  // handshake, so an already-connected iframe has no way to learn a NEW difficulty short of a
  // full reload. Reusing handleRetryGame's own reset
  // (new sessionId, cleared result/leaderboard, bumped attemptKey) is what remounts IframeRuntime
  // — see its `key={attemptKey}` in GameFrame — with the new value baked into its next HOST_INIT.
  //
  // Skips the very first render for a slug (iframeAttemptDifficultyRef.current still undefined,
  // reset by the manifest effect above): the FIRST iframe mount already reads the current
  // selectedDifficultyId via the `difficultyId` prop passed to IframeRuntime below, so forcing an
  // extra remount before anything has even loaded once would be pure waste.
  useEffect(() => {
    const hasDifficultyTiers = Boolean(game?.difficulty);
    if (
      shouldRemountIframeOnDifficultyChange(
        iframeAttemptDifficultyRef.current,
        selectedDifficultyId,
        {
          hasDifficultyTiers,
        },
      )
    ) {
      handleRetryGame();
    }
    if (hasDifficultyTiers) {
      iframeAttemptDifficultyRef.current = selectedDifficultyId;
    }
  }, [selectedDifficultyId, game, handleRetryGame]);

  // Fetch a compact leaderboard preview as soon as the game ends (not gated on score
  // submission succeeding — guests and rejected submissions still get competitive context).
  // Skipped entirely for games with supportsLeaderboard: false.
  useEffect(() => {
    if (!result || result.score === undefined || !game?.policy.leaderboard) return;
    let isMounted = true;
    fetchLeaderboardApi(slug, selectedDifficultyId)
      .then((records) => {
        if (isMounted) setResultLeaderboard(records.slice(0, 5));
      })
      .catch(() => {
        if (isMounted) setResultLeaderboard([]);
      });
    return () => {
      isMounted = false;
    };
  }, [result, game, slug, selectedDifficultyId]);

  // Share Result — scoped to X (official web intent) and a screenshot-copy of the result card.
  // A dedicated Discord button used to sit here too, but it only ever copied the same text a
  // Discord message would need — functionally identical to the screenshot-copy button once that
  // button started including the share text alongside the image, so it was dropped as redundant
  // rather than kept as a second "copy" action with a different icon. Web Share API / Instagram
  // / TikTok remain out of scope (operator decision). X still attaches the screenshot by default
  // (see captureScreenshotBlob) — X has no API for a page to attach an arbitrary image to its
  // compose window, so "attach by default" means "copy it to the clipboard so the user can
  // paste it in", which is the most a web page is allowed to do.
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [xShareState, setXShareState] = useState<"idle" | "sharing" | "shared">("idle");
  const [screenshotState, setScreenshotState] = useState<
    "idle" | "copying" | "copied" | "downloaded" | "error"
  >("idle");

  const buildShareText = useCallback(() => {
    if (!result || result.score === undefined || !game) return null;
    const scoreText = formatScore(result.score, scoreConfig);
    const title = localizedTitle ?? game.title;
    return dict.gamePlay.shareText.replace("{title}", title).replace("{score}", scoreText);
  }, [result, game, localizedTitle, scoreConfig, dict]);

  const captureScreenshotBlob = useCallback(async (): Promise<Blob | null> => {
    if (!shareCardRef.current) return null;
    const { toBlob } = await import("html-to-image");
    return await toBlob(shareCardRef.current, { pixelRatio: 2 });
  }, []);

  const handleShareX = useCallback(async () => {
    const shareText = buildShareText();
    if (!shareText) return;
    setXShareState("sharing");

    // Best-effort — X's web intent has no parameter for attaching an image, so this is the
    // closest a web page can get to "attach a screenshot": copy it to the clipboard and let the
    // user paste it into the compose window that's about to open. Never blocks the share itself.
    if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
      try {
        const blob = await captureScreenshotBlob();
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        }
      } catch (err) {
        console.error("Screenshot copy before X share failed (non-fatal):", err);
      }
    }

    const shareUrl = `${window.location.origin}/games/${slug}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
    setXShareState("shared");
    setTimeout(() => setXShareState("idle"), 4000);
  }, [buildShareText, captureScreenshotBlob, slug]);

  const handleCopyScreenshot = useCallback(async () => {
    setScreenshotState("copying");
    try {
      const blob = await captureScreenshotBlob();
      if (!blob) throw new Error("html-to-image returned no blob");

      if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
        // A single ClipboardItem can carry multiple representations of the same copy — Discord's
        // (and most chat apps') paste handler picks the image when one is present (attaches it
        // as a file) while still making the share text available to anything that reads
        // text/plain instead, so one copy covers both "paste an image" and "paste a message"
        // without the user needing a second, separate action for text.
        const shareText = buildShareText();
        const shareUrl = `${window.location.origin}/games/${slug}`;
        const items: Record<string, Blob> = { "image/png": blob };
        if (shareText) {
          items["text/plain"] = new Blob([`${shareText} ${shareUrl}`], { type: "text/plain" });
        }
        await navigator.clipboard.write([new ClipboardItem(items)]);
        setScreenshotState("copied");
      } else {
        // Clipboard image writes aren't universally supported (older browsers, some mobile
        // in-app browsers) — fall back to a plain download instead of failing silently.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `owogg-${slug}-result.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setScreenshotState("downloaded");
      }
    } catch (err) {
      console.error("Screenshot copy failed:", err);
      setScreenshotState("error");
    } finally {
      setTimeout(() => setScreenshotState("idle"), 2500);
    }
  }, [captureScreenshotBlob, buildShareText, slug]);

  const currentGameUrl = useCallback(
    () => `${window.location.origin}/games/${encodeURIComponent(slug)}`,
    [slug],
  );

  const markGameShareComplete = useCallback(() => {
    setGameShareState("shared");
    window.setTimeout(() => setGameShareState("idle"), 2500);
  }, []);

  const handleShareGame = useCallback(async () => {
    const url = currentGameUrl();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: localizedTitle ?? slug, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      markGameShareComplete();
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        markGameShareComplete();
      } catch {
        // The URL remains visible in the mobile-play dialog even when browser clipboard policy
        // blocks programmatic writes, so this action fails without disrupting the game.
      }
    }
  }, [currentGameUrl, localizedTitle, markGameShareComplete, slug]);

  const handleCopyMobileLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentGameUrl());
      setMobileLinkCopied(true);
      window.setTimeout(() => setMobileLinkCopied(false), 2500);
    } catch {
      setMobileLinkCopied(false);
    }
  }, [currentGameUrl]);

  useEffect(() => {
    if (!isMobilePlayOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobilePlayOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobilePlayOpen]);

  // Game Runtime Context
  const runtime = useMemo<GameRuntimeContext>(
    () => ({
      sessionId,
      user: user ? { id: String(user.id), displayName: user.nickname } : null,
      difficultyId: selectedDifficultyId,
      emit: (event) => {
        if (event && event.type === "game_started") {
          void recordRecentPlay(slug);
        }
      },
      complete: async (gameResult) => {
        setResult(gameResult);

        if (gameResult.score !== undefined) {
          const lowerIsBetter = scoreConfig?.direction === "asc";
          saveLocalBestScore(slug, gameResult.score, lowerIsBetter);
        }

        // Read isAuthenticated live at completion time rather than a value frozen at round
        // start — a frozen snapshot (the previous approach) went stale whenever the session
        // check hadn't resolved yet at mount, permanently showing the guest notice to an
        // already-logged-in player until their next retry happened to re-capture it correctly.
        if (isAuthenticated) {
          await handleResultSubmission(gameResult);
        } else {
          setSubmissionState("guest");
        }
      },
      cancel: () => {
        void navigate("/games");
      },
    }),
    [
      sessionId,
      user,
      isAuthenticated,
      selectedDifficultyId,
      navigate,
      slug,
      scoreConfig,
      handleResultSubmission,
      recordRecentPlay,
    ],
  );

  // IframeRuntime callbacks deliberately funnel into the same
  // `runtime.complete`/`recordRecentPlay`/`navigate` calls so score submission, local-best
  // tracking, leaderboard preview, and sharing have one path.
  const handleIframeStarted = useCallback(() => {
    void recordRecentPlay(slug);
  }, [recordRecentPlay, slug]);

  const handleIframeEvent = useCallback(
    (name: string) => {
      resultFlow.recordEvent(name);
    },
    [resultFlow],
  );

  const handleIframeComplete = useCallback(
    (bridgeResult: OwoggCompletionPayload & { metadata?: Record<string, unknown> }) => {
      const gameResult = buildGameResultFromBridgeComplete(bridgeResult, { slug, sessionId });
      void runtime.complete(gameResult);
    },
    [runtime, slug, sessionId],
  );

  const handleIframeError = useCallback(
    (message?: string) => {
      console.error("Game bridge error:", slug, message);
      setError(dict.gamePlay.errorLoadFailed);
    },
    [slug, dict.gamePlay.errorLoadFailed],
  );

  // Game Result & Score Submission Overlay — shared verbatim between the iframe and legacy
  // branches below (result/submissionState/resultLeaderboard/share state are all populated
  // identically by either runtime's own path into runtime.complete, so the overlay itself has no
  // reason to differ). overflow-y-auto + min-h-full (rather than a fixed-height flex-center with
  // no scroll) is what actually fixes two things at once: the result staying visually centered
  // when it fits, and the retry/back-to-list buttons no longer clipping off the bottom edge when
  // the content (card + status + leaderboard + share row) is taller than the viewport —
  // previously there was nowhere for that overflow to go.
  const resultOverlay = result ? (
    <div className="absolute inset-0 z-50 overflow-y-auto bg-black/90">
      <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center md:p-8">
        <h3 className="text-3xl font-extrabold text-white">{dict.gamePlay.resultTitle}</h3>

        {/* The score card is now its own self-contained box — everything inside this
            ref is what handleCopyScreenshot captures, and owogg.com is genuinely its
            last/bottom element now that submission status, leaderboard, and share
            buttons live in a separate section below instead of the same bordered box. */}
        <div
          ref={shareCardRef}
          className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6"
        >
          <div className="mb-3 flex items-center justify-center gap-2">
            <GameThumbnail
              thumbnail={game?.mediaUrl ?? ""}
              title={localizedTitle ?? ""}
              accent={publicGameAccent(game)}
              className="h-6 w-6"
              rounded="rounded-md"
            />
            <span className="text-sm font-bold text-text-secondary">{localizedTitle}</span>
          </div>
          {result.score !== undefined ? (
            <>
              <p className="text-text-secondary text-sm mb-1">
                {isAuthenticated ? dict.gamePlay.finalScoreLabel : dict.gamePlay.deviceBestLabel}
              </p>
              <p className="text-5xl font-black text-brand mb-1">
                {formatScore(result.score, scoreConfig)}
              </p>
            </>
          ) : (
            <p className="text-2xl font-black text-brand mb-1">
              {result.outcome ?? dict.gamePlay.resultTitle}
            </p>
          )}

          {resultTier && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-black text-white shadow-md"
              style={{
                backgroundImage: `linear-gradient(to right, ${resultTier.colorFrom}, ${resultTier.colorTo})`,
              }}
            >
              {resultTier.label}
            </span>
          )}

          {/* Metadata Formatters */}
          {result.metadata &&
            Object.entries(result.metadata).filter(([key]) => !METADATA_GRID_EXCLUDED_KEYS.has(key))
              .length > 0 && (
              <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-border/80">
                {Object.entries(result.metadata)
                  .filter(([key]) => !METADATA_GRID_EXCLUDED_KEYS.has(key))
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="bg-surface/50 p-2.5 rounded-xl border border-border/40"
                    >
                      <p className="text-xs text-text-muted font-bold mb-0.5">
                        {formatMetadataKey(key, dict.gamePlay)}
                      </p>
                      <p className="font-extrabold text-text-primary text-sm">
                        {formatMetadataValue(key, value)}
                      </p>
                    </div>
                  ))}
              </div>
            )}

          <p className="mt-6 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            owogg.com
          </p>
        </div>

        {/* Everything below is deliberately outside shareCardRef (not part of the
            screenshot) — submission status, leaderboard, share actions. Only shown to
            guests (submissionState only ever becomes "guest" when signed out — see
            runtime.complete), so an already-logged-in player never sees it. */}
        <div className="w-full max-w-md flex flex-col gap-4">
          {submissionState === "guest" && (
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs font-bold text-text-secondary">
                {dict.gamePlay.guestNoticeTitle}
              </span>
              <span className="text-[11px] text-text-muted">{dict.gamePlay.guestNoticeBody}</span>
              <button
                type="button"
                onClick={openLoginModal}
                className="mt-1 px-4 py-1.5 bg-brand/10 hover:bg-brand/20 text-brand text-xs font-extrabold rounded-xl transition-colors cursor-pointer"
              >
                {dict.gamePlay.guestLoginCta}
              </button>
            </div>
          )}
          {submissionState === "submitting" && (
            <span className="inline-flex items-center justify-center gap-2 text-xs font-bold text-brand animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {dict.gamePlay.submittingLabel}
            </span>
          )}
          {submissionState === "success" && (
            <span className="inline-flex items-center justify-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              {dict.gamePlay.successLabel}
            </span>
          )}
          {submissionState === "error" && (
            <div className="flex flex-col items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400">
                <AlertCircle className="w-4 h-4" />
                {submissionError || dict.gamePlay.errorSubmitFallback}
              </span>
            </div>
          )}

          {/* Leaderboard preview — skipped for games with supportsLeaderboard: false */}
          {game?.policy.leaderboard && resultLeaderboard && (
            <div className="rounded-2xl border border-border bg-surface-raised p-4 text-left">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-text-muted">
                <Trophy className="h-3.5 w-3.5 text-accent-yellow" />
                {dict.gamePlay.leaderboardTitle}
              </p>
              {resultLeaderboard.length === 0 ? (
                <p className="py-3 text-center text-xs text-text-muted">
                  {dict.gamePlay.leaderboardEmpty}
                </p>
              ) : (
                <ol className="space-y-1">
                  {resultLeaderboard.map((record, i) => (
                    <li
                      key={record.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-xs"
                    >
                      {record.userId !== null && record.userId !== undefined ? (
                        <Link
                          to={`/users/${record.userId}`}
                          className="flex items-center gap-2 truncate font-semibold text-brand-light hover:underline"
                        >
                          <span className="w-4 shrink-0 text-text-muted">#{i + 1}</span>
                          <span className="truncate">{record.playerName}</span>
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 truncate font-semibold text-text-secondary">
                          <span className="w-4 shrink-0 text-text-muted">#{i + 1}</span>
                          <span className="truncate">{record.playerName}</span>
                        </span>
                      )}
                      <span className="shrink-0 font-black text-brand-light">
                        {record.formattedScore}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <Link
                to={`/games/${slug}/ranking`}
                className="mt-2 inline-block text-[11px] font-bold text-brand-light hover:underline"
              >
                {dict.gamePlay.viewFullRanking}
              </Link>
            </div>
          )}

          {/* Share row — icon-only (X's official wordmark, a plain copy icon for the
              screenshot+text action) with a native title tooltip standing in for the
              text labels these used to carry. A brief checkmark swap is the only
              per-button feedback now that there's no label text to change; the X
              button additionally gets a one-line hint below the row since "screenshot
              copied, paste it yourself" needs actual explaining. */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void handleShareX()}
              title={dict.gamePlay.shareXCta}
              aria-label={dict.gamePlay.shareXCta}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary cursor-pointer"
            >
              {xShareState === "shared" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <XIcon className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyScreenshot()}
              disabled={screenshotState === "copying"}
              title={dict.gamePlay.screenshotCopyCta}
              aria-label={dict.gamePlay.screenshotCopyCta}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary cursor-pointer disabled:opacity-50"
            >
              {screenshotState === "copying" ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : screenshotState === "copied" || screenshotState === "downloaded" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : screenshotState === "error" ? (
                <AlertCircle className="h-5 w-5 text-rose-400" />
              ) : (
                <Copy className="h-5 w-5" />
              )}
            </button>
          </div>
          {xShareState === "shared" && (
            <p className="-mt-2 text-[11px] font-semibold text-text-muted">
              {dict.gamePlay.shareXScreenshotHint}
            </p>
          )}
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleRetryGame}
            className="px-8 py-3 bg-brand text-white rounded-xl font-extrabold hover:bg-brand-light shadow-lg shadow-brand/25 transition-all cursor-pointer"
          >
            {dict.gamePlay.retryGameCta}
          </button>
          <button
            type="button"
            onClick={() => void navigate("/games")}
            className="px-8 py-3 bg-surface text-text-primary border border-border rounded-xl font-extrabold hover:bg-surface-raised transition-colors cursor-pointer"
          >
            {dict.gamePlay.backToListResult}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (error) {
    return (
      <div className="container mx-auto px-4 py-20 flex flex-col items-center justify-center flex-1 select-none">
        <AlertCircle className="w-16 h-16 text-accent-red mb-6" />
        <h2 className="text-2xl font-bold mb-4">{error}</h2>
        <button
          type="button"
          onClick={() => void navigate("/games")}
          className="px-6 py-3 bg-surface-raised border border-border rounded-lg hover:bg-surface-overlay transition-colors cursor-pointer"
        >
          {dict.gamePlay.backToList}
        </button>
      </div>
    );
  }

  // Admin kill switch (see adminGames.ts) — blocks play even if the client already finished
  // loading the game bundle before an admin disabled it mid-session.
  if (isDisabled) {
    return (
      <div className="container mx-auto px-4 py-20 flex flex-col items-center justify-center flex-1 select-none text-center">
        <AlertCircle className="w-16 h-16 text-accent-yellow mb-6" />
        <h2 className="text-2xl font-bold mb-2">{dict.gamePlay.gameDisabledTitle}</h2>
        <p className="mb-6 max-w-sm text-sm text-text-muted">{dict.gamePlay.gameDisabledBody}</p>
        <button
          type="button"
          onClick={() => void navigate("/games")}
          className="px-6 py-3 bg-surface-raised border border-border rounded-lg hover:bg-surface-overlay transition-colors cursor-pointer"
        >
          {dict.gamePlay.backToList}
        </button>
      </div>
    );
  }

  // Auth Protection Enforcer
  const isAuthBlocked = game?.policy.requiresAuth && !isAuthenticated;
  const gameTags = currentGameCard
    ? Array.from(
        new Set([
          ...(currentGameCard.genre ? [currentGameCard.genre] : []),
          ...currentGameCard.categories,
          ...currentGameCard.tags,
          ...currentGameCard.modes,
        ]),
      )
    : [];
  const playerCount = currentGameCard?.playerCount ?? game?.stats.playerCount ?? 0;
  const bookmarkCount = currentGameCard?.bookmarkCount ?? game?.stats.bookmarkCount ?? 0;
  const feedbackHref = `/contact?topic=game-feedback&game=${encodeURIComponent(slug)}`;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex-1 bg-[#09090b] select-none">
      <div className="mx-auto w-full max-w-[1800px] px-2 pb-10 pt-2 sm:px-4 sm:pt-4 lg:px-5">
        <div
          className={`grid min-w-0 items-start gap-5 ${
            isTheaterMode ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]"
          }`}
        >
          <main className="flex min-w-0 flex-col gap-5">
            {presentationAdvisoryBanner}

            <section
              ref={gameSurfaceRef}
              aria-label={localizedTitle ?? dict.gamePlay.loadingTitle}
              className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-2xl shadow-black/30 [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none [&:fullscreen]:border-0"
            >
              <div className="relative flex w-full items-center justify-center overflow-hidden bg-black">
                {resultOverlay}
                {isLoading ? (
                  <div className="flex h-[70vh] min-h-[480px] max-h-[720px] w-full flex-col items-center justify-center gap-4">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand/30 border-t-brand" />
                    <p className="font-medium text-text-secondary animate-pulse">
                      {dict.gamePlay.loadingBody}
                    </p>
                  </div>
                ) : isAuthBlocked ? (
                  <div className="flex h-[70vh] min-h-[480px] max-h-[720px] w-full items-center justify-center p-6">
                    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border border-border bg-surface-raised p-8 text-center shadow-2xl">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
                        <UserCheck className="h-7 w-7" />
                      </div>
                      <h3 className="text-2xl font-black text-text-primary">
                        {dict.gamePlay.authRequiredTitle}
                      </h3>
                      <p className="text-sm text-text-secondary">
                        {dict.gamePlay.authRequiredBody}
                      </p>
                      <button
                        type="button"
                        onClick={openLoginModal}
                        className="mt-2 w-full cursor-pointer rounded-2xl bg-brand py-3 font-extrabold text-white shadow-lg shadow-brand/30 transition-all hover:scale-[1.02]"
                      >
                        {dict.gamePlay.authRequiredCta}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex w-full items-center justify-center overflow-hidden"
                    ref={iframeAreaRef}
                  >
                    <IframeRuntime
                      src={resolveGameRuntimeUrl(slug)}
                      title={localizedTitle ?? slug}
                      autoStart
                      attemptKey={attemptKey}
                      frameClassName={renderedIframeFrameClassName}
                      frameStyle={iframeFrameStyle}
                      iframeStyle={iframeElementStyle}
                      {...(game?.difficulty ? { difficultyId: selectedDifficultyId } : {})}
                      onStarted={handleIframeStarted}
                      onEvent={handleIframeEvent}
                      onComplete={handleIframeComplete}
                      onCancel={runtime.cancel}
                      onError={handleIframeError}
                    />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-3 border-t border-border/80 bg-surface px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void navigate("/games")}
                    title={dict.gamePlay.backToList}
                    aria-label={dict.gamePlay.backToList}
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <GameThumbnail
                    thumbnail={game?.mediaUrl ?? ""}
                    title={localizedTitle ?? ""}
                    accent={publicGameAccent(game)}
                    className="h-9 w-9 shrink-0"
                    rounded="rounded-xl"
                  />
                  <div className="min-w-0">
                    <h1 className="truncate text-sm font-black text-text-primary sm:text-base">
                      {localizedTitle ?? dict.gamePlay.loadingTitle}
                    </h1>
                    {game && (
                      <p className="truncate text-[10px] font-semibold text-text-muted sm:text-[11px]">
                        {dict.gamePlay.publisherLabel} {game.publisherName}
                      </p>
                    )}
                  </div>

                  {game?.difficulty && (
                    <div className="ml-1 hidden shrink-0 items-center gap-1 rounded-full border border-border/80 bg-surface-raised p-1 sm:flex">
                      {game.difficulty.levels.map((level) => {
                        const isSelected = level.id === selectedDifficultyId;
                        return (
                          <button
                            key={level.id}
                            type="button"
                            onClick={() => setSelectedDifficultyId(level.id)}
                            aria-pressed={isSelected}
                            className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-bold transition-all ${
                              isSelected
                                ? "bg-brand text-white shadow-sm"
                                : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
                            }`}
                          >
                            {localizedDifficultyLabel(level.id, level.label, dict.gamePlay)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <GamePlayActionBar
                  labels={{
                    bookmark: dict.gamePlay.bookmarkCta,
                    bookmarked: dict.gamePlay.bookmarkedCta,
                    share:
                      gameShareState === "shared"
                        ? dict.gamePlay.shareGameCopied
                        : dict.gamePlay.shareGameCta,
                    feedback: dict.gamePlay.feedbackCta,
                    mobile: dict.gamePlay.mobilePlayCta,
                    theaterEnter: dict.gamePlay.theaterModeEnterCta,
                    theaterExit: dict.gamePlay.theaterModeExitCta,
                    fullscreenEnter: dict.gamePlay.fullscreenEnterCta,
                    fullscreenExit: dict.gamePlay.fullscreenExitCta,
                  }}
                  feedbackHref={feedbackHref}
                  isFavorite={isFavorite(slug)}
                  isShareComplete={gameShareState === "shared"}
                  isTheater={isTheaterMode}
                  isFullscreen={isFullscreen}
                  canFullscreen={showFullscreenControl}
                  onToggleFavorite={() => void toggleFavorite(slug)}
                  onShare={() => void handleShareGame()}
                  onMobilePlay={() => setIsMobilePlayOpen(true)}
                  onToggleTheater={() => setIsTheaterMode((current) => !current)}
                  onToggleFullscreen={toggleFullscreen}
                />
              </div>

              {game?.difficulty && (
                <div className="flex items-center gap-1 border-t border-border/60 bg-surface px-3 py-2 sm:hidden">
                  {game.difficulty.levels.map((level) => {
                    const isSelected = level.id === selectedDifficultyId;
                    return (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => setSelectedDifficultyId(level.id)}
                        aria-pressed={isSelected}
                        className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold ${
                          isSelected
                            ? "bg-brand text-white"
                            : "bg-surface-raised text-text-secondary"
                        }`}
                      >
                        {localizedDifficultyLabel(level.id, level.label, dict.gamePlay)}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {game && (
              <section
                aria-labelledby="game-information-title"
                className="rounded-2xl border border-border/70 bg-surface-raised/70 p-5 sm:p-6"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h2
                        id="game-information-title"
                        className="text-xl font-black text-text-primary"
                      >
                        {dict.gamePlay.gameInfoTitle}
                      </h2>
                      <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-1 text-[10px] font-black text-brand-light">
                        {game.publisherType === "OWOGG"
                          ? dict.gamePlay.officialGameBadge
                          : dict.gamePlay.userGameBadge}
                      </span>
                    </div>
                    <p className="text-sm font-semibold leading-relaxed text-text-secondary">
                      {game.shortDescription}
                    </p>
                  </div>

                  {game.policy.leaderboard && (
                    <Link
                      to={`/games/${slug}/ranking`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-xs font-extrabold text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary"
                    >
                      <Trophy className="h-4 w-4 text-accent-yellow" />
                      {dict.gameRanking.eyebrow}
                    </Link>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-border/60 py-3 text-xs font-bold text-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {dict.gamePlay.playerStatsLabel} {playerCount.toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Bookmark className="h-3.5 w-3.5" />
                    {dict.gamePlay.bookmarkStatsLabel} {bookmarkCount.toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {dict.gamePlay.publishedLabel} {formatPublishedDate(game.publishedAt)}
                  </span>
                </div>

                {game.description && (
                  <p className="mt-4 whitespace-pre-line text-sm leading-7 text-text-secondary">
                    {game.description}
                  </p>
                )}

                {gameTags.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {gameTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            <GamePlayAdSlot
              label={dict.gamePlay.adLabel}
              body={dict.gamePlay.adPlaceholder}
              variant="banner"
            />
          </main>

          <aside
            aria-label={dict.gamePlay.recommendedGamesTitle}
            className={`min-w-0 space-y-5 ${
              isTheaterMode
                ? "grid gap-5 space-y-0 md:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]"
                : "xl:sticky xl:top-20"
            }`}
          >
            <GamePlayAdSlot
              label={dict.gamePlay.adLabel}
              body={dict.gamePlay.adPlaceholder}
              variant="rectangle"
            />
            <GameRecommendations
              title={dict.gamePlay.recommendedGamesTitle}
              emptyLabel={dict.gamePlay.recommendedGamesEmpty}
              games={recommendedGames}
            />
          </aside>
        </div>
      </div>

      {isMobilePlayOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label={dict.gamePlay.closeDialogCta}
            className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
            onClick={() => setIsMobilePlayOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-play-title"
            className="relative z-10 w-full max-w-md rounded-3xl border border-border bg-surface-raised p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setIsMobilePlayOpen(false)}
              title={dict.gamePlay.closeDialogCta}
              aria-label={dict.gamePlay.closeDialogCta}
              className="absolute right-4 top-4 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-surface-overlay hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand-light">
              <Smartphone className="h-7 w-7" />
            </div>
            <h2 id="mobile-play-title" className="pr-10 text-2xl font-black text-text-primary">
              {dict.gamePlay.mobilePlayTitle}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              {dict.gamePlay.mobilePlayBody}
            </p>
            <div className="mt-5 rounded-2xl border border-border bg-surface p-3 text-xs font-semibold text-text-muted break-all">
              {currentGameUrl()}
            </div>
            <button
              type="button"
              onClick={() => void handleCopyMobileLink()}
              className="mt-3 w-full cursor-pointer rounded-2xl bg-brand px-4 py-3 text-sm font-black text-white transition-colors hover:bg-brand-light"
            >
              {mobileLinkCopied ? dict.gamePlay.gameLinkCopied : dict.gamePlay.copyGameLinkCta}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
