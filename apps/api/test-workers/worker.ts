export { MultiplayerInstanceObject } from "../src/multiplayer/MultiplayerInstanceObject.js";

export default {
  fetch(): Response {
    return new Response("Worker test harness", { status: 404 });
  },
};
