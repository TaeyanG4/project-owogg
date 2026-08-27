import type { MultiplayerInstanceObject } from "../src/multiplayer/MultiplayerInstanceObject.js";
import type { MultiplayerLobbySignalObject } from "../src/multiplayer/MultiplayerLobbySignalObject.js";
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MULTIPLAYER_INSTANCES: DurableObjectNamespace<MultiplayerInstanceObject>;
      MULTIPLAYER_LOBBY_SIGNALS: DurableObjectNamespace<MultiplayerLobbySignalObject>;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
