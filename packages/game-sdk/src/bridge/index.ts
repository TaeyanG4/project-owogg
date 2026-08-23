/**
 * `@owogg/game-sdk/bridge` — the Host <-> Game postMessage/MessageChannel protocol and the
 * game-side client for it. Framework-independent (no React) so it can be imported by any game
 * bundle regardless of what it's built with, matching `@owogg/game-sdk/contracts`'s own posture.
 *
 * The host-side bridge controller is NOT here — it lives in
 * apps/web/app/features/game/runtime/gameBridgeHost.ts, since it is specifically OwOGG's own web
 * app orchestrating an iframe it owns, not something a third-party game bundle would ever import.
 * Both sides import `./protocol.js` from this package, which is what keeps them speaking the
 * exact same message shapes without a second, independently-maintained copy of the schema.
 */

export * from "./protocol.js";
export * from "./client.js";
export * from "./standaloneRuntime.js";
export * from "./browserApiSource.js";
