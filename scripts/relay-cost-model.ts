export const RELAY_COST_PRICING_AS_OF = "2026-08-25" as const;

export const RELAY_COST_PRICING = Object.freeze({
  websocketIncomingMessagesPerRequest: 20,
  requestUsdPerMillion: 0.15,
  durationUsdPerMillionGbSeconds: 12.5,
  sqliteRowsWrittenUsdPerMillion: 1,
  durableObjectMemoryGb: 0.128,
});

export interface RelayDenseRoomCostInput {
  readonly players: number;
  readonly messagesPerSecondPerPlayer: number;
  readonly durationSeconds: number;
  /** Explicit `relay_runtime` row updates. Current Relay performs exactly one per accepted send. */
  readonly explicitRowsWrittenPerMessage?: number;
}

export interface RelayDenseRoomCostProjection {
  readonly players: number;
  readonly durationSeconds: number;
  readonly incomingMessages: number;
  readonly outgoingDeliveries: number;
  readonly requestEquivalents: number;
  readonly explicitRowsWritten: number;
  readonly denseDurationGbSeconds: number;
  /** Marginal rates only: included allocations and account-level rounding are intentionally omitted. */
  readonly marginalUsdBeyondIncluded: {
    readonly requests: number;
    readonly explicitRowsWritten: number;
    readonly denseDuration: number;
    readonly total: number;
  };
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
}

export function projectDenseRelayRoomCost(
  input: RelayDenseRoomCostInput,
): RelayDenseRoomCostProjection {
  if (!Number.isInteger(input.players) || input.players < 2 || input.players > 8) {
    throw new Error("players must be an integer from 2 through 8");
  }
  requireFiniteNonNegative(input.messagesPerSecondPerPlayer, "messagesPerSecondPerPlayer");
  requireFiniteNonNegative(input.durationSeconds, "durationSeconds");
  const explicitRowsWrittenPerMessage = input.explicitRowsWrittenPerMessage ?? 1;
  requireFiniteNonNegative(explicitRowsWrittenPerMessage, "explicitRowsWrittenPerMessage");

  const incomingMessages = input.players * input.messagesPerSecondPerPlayer * input.durationSeconds;
  const outgoingDeliveries = incomingMessages * input.players;
  const requestEquivalents =
    input.players + incomingMessages / RELAY_COST_PRICING.websocketIncomingMessagesPerRequest;
  const explicitRowsWritten = incomingMessages * explicitRowsWrittenPerMessage;
  const denseDurationGbSeconds = input.durationSeconds * RELAY_COST_PRICING.durableObjectMemoryGb;
  const requests = (requestEquivalents * RELAY_COST_PRICING.requestUsdPerMillion) / 1_000_000;
  const writes =
    (explicitRowsWritten * RELAY_COST_PRICING.sqliteRowsWrittenUsdPerMillion) / 1_000_000;
  const denseDuration =
    (denseDurationGbSeconds * RELAY_COST_PRICING.durationUsdPerMillionGbSeconds) / 1_000_000;

  return {
    players: input.players,
    durationSeconds: input.durationSeconds,
    incomingMessages,
    outgoingDeliveries,
    requestEquivalents,
    explicitRowsWritten,
    denseDurationGbSeconds,
    marginalUsdBeyondIncluded: {
      requests,
      explicitRowsWritten: writes,
      denseDuration,
      total: requests + writes + denseDuration,
    },
  };
}

const baselineScenarios = [
  { name: "2p-1hz-10m", players: 2, messagesPerSecondPerPlayer: 1, durationSeconds: 600 },
  { name: "4p-5hz-10m", players: 4, messagesPerSecondPerPlayer: 5, durationSeconds: 600 },
  { name: "8p-20hz-5m", players: 8, messagesPerSecondPerPlayer: 20, durationSeconds: 300 },
] as const;

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return (
    typeof entry === "string" &&
    import.meta.url === new URL(`file://${entry.replaceAll("\\", "/")}`).href
  );
}

if (isDirectExecution()) {
  console.log(
    JSON.stringify(
      {
        pricingAsOf: RELAY_COST_PRICING_AS_OF,
        pricing: RELAY_COST_PRICING,
        assumptions: [
          "dense traffic keeps the Durable Object active for the full room duration",
          "broadcast sends to every participant; outgoing WebSocket messages are not request-billed",
          "one explicit relay_runtime row update per accepted message",
          "included monthly allocations, global rounding, Workers/D1/B2, and attachment metadata are excluded",
        ],
        scenarios: baselineScenarios.map(({ name, ...input }) => ({
          name,
          ...projectDenseRelayRoomCost(input),
        })),
      },
      null,
      2,
    ),
  );
}
