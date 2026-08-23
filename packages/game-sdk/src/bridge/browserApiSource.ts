/**
 * Dependency-free browser adapter injected into every served game entry document. It queues API
 * calls until HOST_INIT arrives and exposes only the public v1 API — no token, user id, session,
 * or API address enters the iframe.
 */
export const OWOGG_BROWSER_API_SOURCE = String.raw`(function () {
  "use strict";
  if (window.OWOGG) return;
  var port = null;
  var queue = [];
  var completed = false;
  var namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  function post(message) {
    try { port.postMessage(message); } catch (_) {}
  }
  function send(message) {
    if (completed && message.type !== "GAME_COMPLETE") return;
    if (port) post(message);
    else queue.push(message);
  }
  var api = {
    start: function () { send({ type: "GAME_STARTED" }); },
    event: function (name, data) {
      if (typeof name !== "string" || !namePattern.test(name)) return;
      var message = { type: "GAME_EVENT", name: name };
      if (data !== undefined) message.data = data;
      send(message);
    },
    complete: function (result) {
      if (completed) return;
      result = result || {};
      var message = { type: "GAME_COMPLETE" };
      if (result.outcome !== undefined) message.outcome = result.outcome;
      if (result.score !== undefined) message.score = result.score;
      if (result.progression !== undefined) message.progression = result.progression;
      if (result.metrics !== undefined) message.metrics = result.metrics;
      completed = true;
      if (port) post(message);
      else queue.push(message);
    },
    cancel: function () { send({ type: "GAME_CANCEL" }); }
  };
  Object.defineProperty(window, "OWOGG", { value: Object.freeze(api), configurable: false });
  function init(event) {
    if (event.source !== window.parent || !event.data || event.data.type !== "HOST_INIT") return;
    var keys = Object.keys(event.data);
    if (keys.some(function (key) { return key !== "type" && key !== "difficultyId"; })) return;
    var nextPort = event.ports && event.ports[0];
    if (!nextPort) return;
    window.removeEventListener("message", init);
    port = nextPort;
    post({ type: "GAME_READY" });
    queue.splice(0).forEach(post);
  }
  window.addEventListener("message", init);
})();`;
