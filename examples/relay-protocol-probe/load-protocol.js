(() => {
  "use strict";

  const LOAD_PROTOCOL = "relay-probe/load-v1";
  const LOAD_RATES = Object.freeze([1, 5, 20]);
  const LOAD_DURATIONS_MS = Object.freeze([10_000, 60_000, 300_000, 600_000]);
  const LOAD_PAYLOAD_BYTES = Object.freeze([256, 3_072]);
  const IDLE_DURATION_MS = 60_000;
  const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;
  const encoder = new TextEncoder();

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function hasExactKeys(value, expected) {
    const keys = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return (
      keys.length === sortedExpected.length &&
      keys.every((key, index) => key === sortedExpected[index])
    );
  }

  function isSafeIntegerBetween(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }

  function isRunId(value) {
    return typeof value === "string" && RUN_ID_PATTERN.test(value);
  }

  function isLatencySummary(value) {
    if (!isRecord(value) || !hasExactKeys(value, ["count", "min", "p50", "p95", "p99", "max"])) {
      return false;
    }
    return [value.count, value.min, value.p50, value.p95, value.p99, value.max].every((entry) =>
      isSafeIntegerBetween(entry, 0, 3_600_000),
    );
  }

  function parseReceivedBySeat(value) {
    if (!Array.isArray(value) || value.length > 8) return null;
    const seen = new Set();
    const parsed = [];
    for (const entry of value) {
      if (
        !isRecord(entry) ||
        !hasExactKeys(entry, ["seatIndex", "uniqueSamples"]) ||
        !isSafeIntegerBetween(entry.seatIndex, 0, 7) ||
        !isSafeIntegerBetween(entry.uniqueSamples, 0, 1_000_000) ||
        seen.has(entry.seatIndex)
      ) {
        return null;
      }
      seen.add(entry.seatIndex);
      parsed.push({ seatIndex: entry.seatIndex, uniqueSamples: entry.uniqueSamples });
    }
    return parsed;
  }

  function parseLoadMessage(value) {
    if (
      !isRecord(value) ||
      value.protocol !== LOAD_PROTOCOL ||
      typeof value.type !== "string" ||
      !isRunId(value.runId)
    ) {
      return null;
    }

    if (value.type === "load-plan") {
      if (
        !hasExactKeys(value, [
          "protocol",
          "type",
          "runId",
          "rateHz",
          "durationMs",
          "payloadBytes",
        ]) ||
        !LOAD_RATES.includes(value.rateHz) ||
        !LOAD_DURATIONS_MS.includes(value.durationMs) ||
        !LOAD_PAYLOAD_BYTES.includes(value.payloadBytes)
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        rateHz: value.rateHz,
        durationMs: value.durationMs,
        payloadBytes: value.payloadBytes,
      };
    }

    if (value.type === "load-ready" || value.type === "idle-plan" || value.type === "idle-ready") {
      if (!hasExactKeys(value, ["protocol", "type", "runId"])) return null;
      return { protocol: LOAD_PROTOCOL, type: value.type, runId: value.runId };
    }

    if (value.type === "load-start") {
      if (
        !hasExactKeys(value, ["protocol", "type", "runId", "startAt"]) ||
        !isSafeIntegerBetween(value.startAt, 1, 9_007_199_254_740_991)
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        startAt: value.startAt,
      };
    }

    if (value.type === "load-sample") {
      if (
        !hasExactKeys(value, ["protocol", "type", "runId", "sampleSeq", "sentAt", "padding"]) ||
        !isSafeIntegerBetween(value.sampleSeq, 1, 1_000_000) ||
        !isSafeIntegerBetween(value.sentAt, 1, 9_007_199_254_740_991) ||
        typeof value.padding !== "string" ||
        value.padding.length > 4_096
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        sampleSeq: value.sampleSeq,
        sentAt: value.sentAt,
        padding: value.padding,
      };
    }

    if (value.type === "load-stop") {
      if (
        !hasExactKeys(value, ["protocol", "type", "runId", "reason"]) ||
        (value.reason !== "host-stop" && value.reason !== "local-error")
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        reason: value.reason,
      };
    }

    if (value.type === "load-report") {
      if (
        !hasExactKeys(value, [
          "protocol",
          "type",
          "runId",
          "expectedSamples",
          "attemptedSamples",
          "postedSamples",
          "postFailures",
          "schedulerSkipped",
          "rejected",
          "receivedTotal",
          "duplicateSamples",
          "serverSeqGaps",
          "receivedBySeat",
          "selfLatency",
        ]) ||
        ![
          value.expectedSamples,
          value.attemptedSamples,
          value.postedSamples,
          value.postFailures,
          value.schedulerSkipped,
          value.rejected,
          value.receivedTotal,
          value.duplicateSamples,
          value.serverSeqGaps,
        ].every((entry) => isSafeIntegerBetween(entry, 0, 1_000_000)) ||
        !isLatencySummary(value.selfLatency)
      ) {
        return null;
      }
      const receivedBySeat = parseReceivedBySeat(value.receivedBySeat);
      if (!receivedBySeat) return null;
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        expectedSamples: value.expectedSamples,
        attemptedSamples: value.attemptedSamples,
        postedSamples: value.postedSamples,
        postFailures: value.postFailures,
        schedulerSkipped: value.schedulerSkipped,
        rejected: value.rejected,
        receivedTotal: value.receivedTotal,
        duplicateSamples: value.duplicateSamples,
        serverSeqGaps: value.serverSeqGaps,
        receivedBySeat,
        selfLatency: { ...value.selfLatency },
      };
    }

    if (value.type === "idle-start") {
      if (
        !hasExactKeys(value, ["protocol", "type", "runId", "startAt", "durationMs"]) ||
        !isSafeIntegerBetween(value.startAt, 1, 9_007_199_254_740_991) ||
        value.durationMs !== IDLE_DURATION_MS
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        startAt: value.startAt,
        durationMs: value.durationMs,
      };
    }

    if (value.type === "idle-wake") {
      if (
        !hasExactKeys(value, ["protocol", "type", "runId", "startedAt", "wakeSentAt"]) ||
        !isSafeIntegerBetween(value.startedAt, 1, 9_007_199_254_740_991) ||
        !isSafeIntegerBetween(value.wakeSentAt, value.startedAt, 9_007_199_254_740_991)
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        startedAt: value.startedAt,
        wakeSentAt: value.wakeSentAt,
      };
    }

    if (value.type === "idle-report") {
      if (
        !hasExactKeys(value, [
          "protocol",
          "type",
          "runId",
          "observedIdleMs",
          "startServerSeq",
          "wakeServerSeq",
        ]) ||
        !isSafeIntegerBetween(value.observedIdleMs, 0, 600_000) ||
        !isSafeIntegerBetween(value.startServerSeq, 0, 9_007_199_254_740_991) ||
        !isSafeIntegerBetween(value.wakeServerSeq, value.startServerSeq, 9_007_199_254_740_991)
      ) {
        return null;
      }
      return {
        protocol: LOAD_PROTOCOL,
        type: value.type,
        runId: value.runId,
        observedIdleMs: value.observedIdleMs,
        startServerSeq: value.startServerSeq,
        wakeServerSeq: value.wakeServerSeq,
      };
    }

    return null;
  }

  function buildLoadSample(runId, sampleSeq, sentAt, targetBytes) {
    if (
      !isRunId(runId) ||
      !isSafeIntegerBetween(sampleSeq, 1, 1_000_000) ||
      !isSafeIntegerBetween(sentAt, 1, 9_007_199_254_740_991) ||
      !LOAD_PAYLOAD_BYTES.includes(targetBytes)
    ) {
      return null;
    }
    const payload = {
      protocol: LOAD_PROTOCOL,
      type: "load-sample",
      runId,
      sampleSeq,
      sentAt,
      padding: "",
    };
    const baseBytes = encoder.encode(JSON.stringify(payload)).byteLength;
    const paddingBytes = targetBytes - baseBytes;
    if (paddingBytes < 0) return null;
    payload.padding = "x".repeat(paddingBytes);
    return encoder.encode(JSON.stringify(payload)).byteLength === targetBytes ? payload : null;
  }

  function expectedSamples(rateHz, durationMs) {
    if (!LOAD_RATES.includes(rateHz) || !LOAD_DURATIONS_MS.includes(durationMs)) return null;
    const expected = (rateHz * durationMs) / 1_000;
    return Number.isSafeInteger(expected) ? expected : null;
  }

  function summarizeLatencies(values) {
    const sorted = values
      .filter((value) => isSafeIntegerBetween(value, 0, 3_600_000))
      .sort((left, right) => left - right);
    if (sorted.length === 0) return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const at = (percentile) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)];
    return {
      count: sorted.length,
      min: sorted[0],
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: sorted[sorted.length - 1],
    };
  }

  window.RelayProbeLoadProtocol = Object.freeze({
    LOAD_PROTOCOL,
    LOAD_RATES,
    LOAD_DURATIONS_MS,
    LOAD_PAYLOAD_BYTES,
    IDLE_DURATION_MS,
    parseLoadMessage,
    buildLoadSample,
    expectedSamples,
    summarizeLatencies,
  });
})();
