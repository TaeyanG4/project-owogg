import {
  MULTIPLAYER_JOIN_TICKET_POLICY,
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  buildMultiplayerWebSocketProtocols,
  signMultiplayerJoinTicket,
  type MultiplayerTicketKeyring,
} from "../domain/multiplayerJoinTicket.js";
import type { GameVersionRepository } from "../../game/ports/gameVersionRepository.js";
import { isApprovedRelayMultiplayerProfileV1 } from "../domain/multiplayerProfile.js";
import type { MultiplayerErrorCode } from "../domain/multiplayerErrors.js";
import type { MultiplayerInstanceRepository } from "../ports/multiplayerInstanceRepository.js";
import type { MultiplayerProfileRepository } from "../ports/multiplayerProfileRepository.js";

const TERMINAL_INSTANCE_STATUSES = new Set(["CLOSED", "ABORTED", "EXPIRED"]);

export interface IssueMultiplayerJoinTicketInput {
  readonly userId: number;
  readonly instanceId: string;
  readonly expectedConnectionGeneration: number;
  readonly keyring: MultiplayerTicketKeyring;
}

export interface MultiplayerJoinBootstrap {
  readonly type: "MULTI_INIT";
  readonly v: 1;
  readonly gameVersionId: number;
  readonly contentHash: string;
  readonly profileRevision: number;
  readonly generation: number;
  readonly runtime: {
    readonly kind: "relay";
    readonly protocolVersion: 1;
    readonly resultTrust: "UNVERIFIED";
  };
  readonly self: MultiplayerJoinBootstrapParticipant;
  readonly roster: readonly MultiplayerJoinBootstrapParticipant[];
  readonly capabilities: {
    readonly reconnect: "none" | "resume";
    readonly broadcast: true;
    readonly directMessages: boolean;
    readonly hostSnapshot: boolean;
  };
}

export interface MultiplayerJoinBootstrapParticipant {
  readonly participantId: string;
  readonly seatIndex: number;
  readonly role: "HOST" | "PLAYER";
}

export type IssueMultiplayerJoinTicketResult =
  | {
      readonly ok: true;
      readonly ticket: string;
      readonly protocols: readonly [string, string];
      readonly expiresAt: string;
      readonly connectionGeneration: number;
      readonly bootstrap: MultiplayerJoinBootstrap;
    }
  | {
      readonly ok: false;
      readonly code: Extract<
        MultiplayerErrorCode,
        | "INVALID_REQUEST"
        | "INSTANCE_NOT_FOUND"
        | "INSTANCE_NOT_JOINABLE"
        | "NOT_PARTICIPANT"
        | "STALE_GENERATION"
        | "PROFILE_DISABLED"
        | "VERSION_MISMATCH"
        | "INTERNAL_RETRYABLE"
      >;
    };

export interface MultiplayerAdmissionUseCaseDependencies {
  readonly instances: MultiplayerInstanceRepository;
  readonly profiles: MultiplayerProfileRepository;
  readonly gameVersions: GameVersionRepository;
  readonly now?: () => Date;
  readonly createJti?: () => string;
}

/**
 * Authenticated control-plane admission. It advances the participant connection generation
 * before signing so every newly issued ticket invalidates all older tickets/sockets for that
 * participant. Profile disable intentionally does not block an already-admitted participant's
 * reconnect; it only drains new joins/invites at the repository boundary.
 */
export class MultiplayerAdmissionUseCases {
  private readonly now: () => Date;
  private readonly createJti: () => string;

  constructor(private readonly dependencies: MultiplayerAdmissionUseCaseDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createJti = dependencies.createJti ?? (() => crypto.randomUUID());
  }

  async issueJoinTicket(
    input: IssueMultiplayerJoinTicketInput,
  ): Promise<IssueMultiplayerJoinTicketResult> {
    if (
      !Number.isSafeInteger(input.userId) ||
      input.userId <= 0 ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(input.instanceId) ||
      !Number.isSafeInteger(input.expectedConnectionGeneration) ||
      input.expectedConnectionGeneration < 0
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const instance = await this.dependencies.instances.findById(input.instanceId);
    if (!instance) return { ok: false, code: "INSTANCE_NOT_FOUND" };
    if (
      TERMINAL_INSTANCE_STATUSES.has(instance.status) ||
      Number.isNaN(Date.parse(instance.expiresAt)) ||
      instance.expiresAt <= nowIso
    ) {
      return { ok: false, code: "INSTANCE_NOT_JOINABLE" };
    }

    const participant = await this.dependencies.instances.findParticipant(
      instance.id,
      input.userId,
    );
    if (!participant || (participant.status !== "JOINED" && participant.status !== "READY")) {
      return { ok: false, code: "NOT_PARTICIPANT" };
    }
    if (participant.connectionGeneration !== input.expectedConnectionGeneration) {
      return { ok: false, code: "STALE_GENERATION" };
    }

    const [profileRecord, version, lease, participants] = await Promise.all([
      this.dependencies.profiles.findById(instance.profileId),
      this.dependencies.gameVersions.findForGame(instance.gameId, instance.gameVersionId),
      this.dependencies.instances.findLease(instance.id),
      this.dependencies.instances.listParticipants(instance.id),
    ]);
    if (!profileRecord || !isApprovedRelayMultiplayerProfileV1(profileRecord.profile)) {
      return { ok: false, code: "PROFILE_DISABLED" };
    }
    const profile = profileRecord.profile;
    if (
      profile.gameId !== instance.gameId ||
      profile.gameVersionId !== instance.gameVersionId ||
      profile.profileRevision !== instance.profileRevision ||
      profile.contentHash !== instance.contentHash ||
      !version ||
      version.publishStatus !== "READY" ||
      version.contentHash !== instance.contentHash
    ) {
      return { ok: false, code: "VERSION_MISMATCH" };
    }
    if (
      !lease ||
      lease.status !== "ACTIVE" ||
      lease.gameVersionId !== instance.gameVersionId ||
      lease.generation !== instance.generation ||
      Number.isNaN(Date.parse(lease.expiresAt)) ||
      lease.expiresAt <= nowIso
    ) {
      return { ok: false, code: "VERSION_MISMATCH" };
    }

    const roster = participants
      .filter((candidate) => candidate.status === "JOINED" || candidate.status === "READY")
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((candidate) => ({
        participantId: candidate.id,
        seatIndex: candidate.seatIndex,
        role: candidate.role,
      }));
    if (
      roster.length < 2 ||
      roster.length > 8 ||
      roster.length !== instance.participantCount ||
      new Set(roster.map((candidate) => candidate.participantId)).size !== roster.length ||
      new Set(roster.map((candidate) => candidate.seatIndex)).size !== roster.length ||
      roster.filter((candidate) => candidate.role === "HOST").length !== 1 ||
      !roster.some((candidate) => candidate.participantId === participant.id)
    ) {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }

    const expiresSeconds = Math.min(
      nowSeconds + MULTIPLAYER_JOIN_TICKET_POLICY.EXPIRY_SECONDS,
      Math.floor(Date.parse(instance.expiresAt) / 1000),
      Math.floor(Date.parse(lease.expiresAt) / 1000),
    );
    if (expiresSeconds <= nowSeconds) return { ok: false, code: "INSTANCE_NOT_JOINABLE" };

    const advanced = await this.dependencies.instances.advanceConnectionGeneration({
      instanceId: instance.id,
      expectedInstanceGeneration: instance.generation,
      userId: input.userId,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      nowIso,
    });
    if (!advanced) return { ok: false, code: "STALE_GENERATION" };

    try {
      const ticket = await signMultiplayerJoinTicket(
        {
          iss: MULTIPLAYER_TICKET_ISSUER,
          aud: MULTIPLAYER_TICKET_AUDIENCE,
          kid: input.keyring.active.kid,
          iat: nowSeconds,
          exp: expiresSeconds,
          jti: this.createJti(),
          instanceId: instance.id,
          participantId: advanced.id,
          userId: input.userId,
          gameVersionId: instance.gameVersionId,
          contentHash: instance.contentHash,
          profileId: instance.profileId,
          profileRevision: instance.profileRevision,
          runtime: {
            kind: "relay",
            protocolVersion: profile.protocolVersion,
            reconnect: profile.reconnectPolicy,
            directMessages: profile.directMessages,
            hostSnapshot: profile.hostSnapshot,
            maxMessageBytes: profile.maxMessageBytes,
            maxSnapshotBytes: profile.maxSnapshotBytes,
            messagesPerSecond: profile.messagesPerSecond,
            roomBytesPerSecond: profile.roomBytesPerSecond,
            roomTtlSeconds: profile.roomTtlSeconds,
            hostDeparturePolicy: profile.hostDeparturePolicy,
            resultTrust: profile.resultTrust,
          },
          generation: instance.generation,
          connectionGeneration: advanced.connectionGeneration,
          seatIndex: advanced.seatIndex,
          role: advanced.role,
        },
        input.keyring,
      );
      return {
        ok: true,
        ticket,
        protocols: buildMultiplayerWebSocketProtocols(ticket),
        expiresAt: new Date(expiresSeconds * 1000).toISOString(),
        connectionGeneration: advanced.connectionGeneration,
        bootstrap: {
          type: "MULTI_INIT",
          v: 1,
          gameVersionId: instance.gameVersionId,
          contentHash: instance.contentHash,
          profileRevision: instance.profileRevision,
          generation: instance.generation,
          runtime: {
            kind: "relay",
            protocolVersion: 1,
            resultTrust: "UNVERIFIED",
          },
          self: {
            participantId: advanced.id,
            seatIndex: advanced.seatIndex,
            role: advanced.role,
          },
          roster,
          capabilities: {
            reconnect: profile.reconnectPolicy === "resume" ? "resume" : "none",
            broadcast: true,
            directMessages: profile.directMessages,
            hostSnapshot: profile.hostSnapshot,
          },
        },
      };
    } catch {
      // The connection generation was intentionally consumed. Retrying with the old expected
      // generation must fail rather than risk issuing two simultaneously-valid tickets after an
      // ambiguous signing failure.
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }
}
