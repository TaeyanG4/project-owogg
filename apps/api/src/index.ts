/**
 * Plain-Node-compatible application entrypoint. Cloudflare deploys `worker.ts`, which adds
 * provider-only exports without forcing Node tests to resolve `cloudflare:workers`.
 */
import { app, scheduledHandler } from "./app.js";

export { app } from "./app.js";

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
};
