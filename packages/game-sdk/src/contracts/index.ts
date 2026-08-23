/**
 * `@owogg/game-sdk/contracts` — the framework-independent half of the SDK.
 *
 * Everything reachable from here describes a game as *data*: what it is (GameManifest), how it is
 * scored (ScoreConfig, ScoreStrategy, formatScore), what it reports (GameResult, GameClientEvent).
 * Nothing here knows how a game is rendered, so this entry can be imported by code that has no
 * business depending on a UI framework — `packages/core` in particular, which runs inside a
 * Cloudflare Worker and is where score policy and the game registry live.
 *
 * The React-bound half (GameModule, GameProps, GameRuntimeContext — all of which reference React's
 * `ComponentType`) lives at `@owogg/game-sdk/react` and is re-exported from the package root, so
 * `apps/web` and standalone game build projects can import `@owogg/game-sdk`. The split exists so
 * that "core must not depend on React" is a rule a machine can check (see
 * scripts/architecture-rules.ts) rather than a convention that quietly eroded — before it, the
 * chain `@owogg/core → @owogg/game-sdk → @types/react` was real and invisible to the guard.
 *
 * Adding a React (or any other framework) import to a file under this directory is a build
 * failure by design: `pnpm architecture:check` scopes a rule to exactly this path.
 */

export * from "./manifest.js";
export * from "./creatorManifest.js";
export * from "./presentation.js";
export * from "./result.js";
export * from "../events/index.js";
export * from "../scoring/index.js";
