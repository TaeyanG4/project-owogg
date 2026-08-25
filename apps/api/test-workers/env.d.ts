import type { MultiplayerInstanceObject } from "../src/multiplayer/MultiplayerInstanceObject.js";

declare global {
  namespace Cloudflare {
    interface Env {
      MULTIPLAYER_INSTANCES: DurableObjectNamespace<MultiplayerInstanceObject>;
    }
  }
}

export {};
