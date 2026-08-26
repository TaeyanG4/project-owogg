import {
  MULTIPLAYER_ACTION_RESULT_CODES,
  type MultiplayerActionResultCode,
} from "../domain/multiplayerMatch.js";
import { parseOmokStateV1, type OmokStateV1 } from "./omokRules.js";

export const OMOK_ACTION_LEDGER_SCHEMA_VERSION = 1 as const;

type OmokRejectedResultCode = Exclude<MultiplayerActionResultCode, "ACCEPTED">;

export type OmokActionLedgerResponseV1 =
  | {
      readonly schemaVersion: typeof OMOK_ACTION_LEDGER_SCHEMA_VERSION;
      readonly kind: "ACCEPTED";
      readonly generation: number;
      readonly serverSeq: number;
      readonly clientActionId: string;
      readonly revision: number;
      readonly state: OmokStateV1;
    }
  | {
      readonly schemaVersion: typeof OMOK_ACTION_LEDGER_SCHEMA_VERSION;
      readonly kind: "REJECTED";
      readonly generation: number;
      readonly serverSeq: number;
      readonly clientActionId: string;
      readonly code: OmokRejectedResultCode;
      readonly currentRevision: number;
    };

const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(source);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRejectedCode(value: unknown): value is OmokRejectedResultCode {
  return (
    typeof value === "string" &&
    value !== "ACCEPTED" &&
    (MULTIPLAYER_ACTION_RESULT_CODES as readonly string[]).includes(value)
  );
}

/** Strictly validates D1 action response JSON before it can restore authoritative DO state. */
export function parseOmokActionLedgerResponse(value: unknown): OmokActionLedgerResponseV1 | null {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== OMOK_ACTION_LEDGER_SCHEMA_VERSION ||
    !isPositiveInteger(value.generation) ||
    !isNonNegativeInteger(value.serverSeq) ||
    typeof value.clientActionId !== "string" ||
    !ACTION_ID_PATTERN.test(value.clientActionId)
  ) {
    return null;
  }

  if (value.kind === "ACCEPTED") {
    if (
      !hasExactKeys(value, [
        "schemaVersion",
        "kind",
        "generation",
        "serverSeq",
        "clientActionId",
        "revision",
        "state",
      ]) ||
      !isPositiveInteger(value.revision)
    ) {
      return null;
    }
    const state = parseOmokStateV1(value.state);
    if (!state || state.revision !== value.revision) return null;
    return {
      schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
      kind: "ACCEPTED",
      generation: value.generation,
      serverSeq: value.serverSeq,
      clientActionId: value.clientActionId,
      revision: value.revision,
      state,
    };
  }

  if (
    value.kind !== "REJECTED" ||
    !hasExactKeys(value, [
      "schemaVersion",
      "kind",
      "generation",
      "serverSeq",
      "clientActionId",
      "code",
      "currentRevision",
    ]) ||
    !isRejectedCode(value.code) ||
    !isNonNegativeInteger(value.currentRevision)
  ) {
    return null;
  }
  return {
    schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
    kind: "REJECTED",
    generation: value.generation,
    serverSeq: value.serverSeq,
    clientActionId: value.clientActionId,
    code: value.code,
    currentRevision: value.currentRevision,
  };
}

export function encodeOmokActionLedgerResponse(response: OmokActionLedgerResponseV1): string {
  const parsed = parseOmokActionLedgerResponse(response);
  if (!parsed) throw new RangeError("invalid Omok action ledger response");
  return JSON.stringify(parsed);
}
