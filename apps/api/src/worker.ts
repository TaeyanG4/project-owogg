/** Cloudflare-only module entrypoint. Keep provider runtime imports out of plain Node tests. */
import { app, scheduledHandler } from "./app.js";

export { MultiplayerInstanceObject } from "./multiplayer/MultiplayerInstanceObject.js";

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
};
