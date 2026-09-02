import test from "node:test";
import assert from "node:assert/strict";
import { redactLogMessage } from "../src/app.js";

test("request logging redacts gp1 preview capabilities embedded in paths", () => {
  const message = "<-- GET /preview/gp1.payload.signature/index.html?token=also-secret";
  const redacted = redactLogMessage(message);
  assert.equal(redacted, "<-- GET /preview/[redacted]/index.html?token=[redacted]");
  assert.ok(!redacted.includes("payload"));
  assert.ok(!redacted.includes("also-secret"));
});
