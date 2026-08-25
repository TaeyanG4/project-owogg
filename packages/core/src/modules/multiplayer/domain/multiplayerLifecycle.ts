export const MULTIPLAYER_INSTANCE_STATUSES = [
  "CREATED",
  "LOBBY",
  "STARTING",
  "ACTIVE",
  "CLOSING",
  "CLOSED",
  "ABORTED",
  "EXPIRED",
] as const;

export type MultiplayerInstanceStatus = (typeof MULTIPLAYER_INSTANCE_STATUSES)[number];

export const MULTIPLAYER_MATCH_STATUSES = [
  "PENDING",
  "ACTIVE",
  "FINALIZING",
  "COMMITTED",
  "ABORTED",
] as const;

export type MultiplayerMatchStatus = (typeof MULTIPLAYER_MATCH_STATUSES)[number];

const INSTANCE_TRANSITIONS: Readonly<
  Record<MultiplayerInstanceStatus, readonly MultiplayerInstanceStatus[]>
> = {
  CREATED: ["LOBBY", "ABORTED", "EXPIRED"],
  LOBBY: ["STARTING", "ABORTED", "EXPIRED"],
  STARTING: ["ACTIVE", "ABORTED", "EXPIRED"],
  ACTIVE: ["CLOSING", "ABORTED", "EXPIRED"],
  CLOSING: ["LOBBY", "CLOSED", "ABORTED", "EXPIRED"],
  CLOSED: [],
  ABORTED: [],
  EXPIRED: [],
};

const MATCH_TRANSITIONS: Readonly<
  Record<MultiplayerMatchStatus, readonly MultiplayerMatchStatus[]>
> = {
  PENDING: ["ACTIVE", "ABORTED"],
  ACTIVE: ["FINALIZING", "ABORTED"],
  FINALIZING: ["COMMITTED", "ABORTED"],
  COMMITTED: [],
  ABORTED: [],
};

export function canTransitionMultiplayerInstance(
  from: MultiplayerInstanceStatus,
  to: MultiplayerInstanceStatus,
): boolean {
  return INSTANCE_TRANSITIONS[from].includes(to);
}

export function canTransitionMultiplayerMatch(
  from: MultiplayerMatchStatus,
  to: MultiplayerMatchStatus,
): boolean {
  return MATCH_TRANSITIONS[from].includes(to);
}
