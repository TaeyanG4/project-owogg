import type { RuntimeGameRegistry } from "../../game/ports/runtimeGameRegistry.js";
import type { MultiplayerErrorCode } from "../domain/multiplayerErrors.js";
import type {
  MultiplayerInstanceRecord,
  MultiplayerParticipantRecord,
} from "../domain/multiplayerInstance.js";
import type { MultiplayerMatchRecord } from "../domain/multiplayerMatch.js";
import type { MultiplayerTicketKeyring } from "../domain/multiplayerJoinTicket.js";
import type { MultiplayerJoinPolicy, MultiplayerVisibility } from "../domain/multiplayerProfile.js";
import type { MultiplayerInstanceRepository } from "../ports/multiplayerInstanceRepository.js";
import type { MultiplayerMatchRepository } from "../ports/multiplayerMatchRepository.js";
import type { MultiplayerProfileRepository } from "../ports/multiplayerProfileRepository.js";
import { isSupportedMultiplayerRuntimeProfile } from "../rules/supportedRulesets.js";

const INSTANCE_TTL_MS = 2 * 60 * 60 * 1_000;
const VERSION_LEASE_GRACE_MS = 5 * 60 * 1_000;
const INVITE_TTL_MS = 15 * 60 * 1_000;
const CREATE_IDENTIFIER_ATTEMPTS = 3;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PUBLIC_CODE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const GAME_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const textEncoder = new TextEncoder();

type RoomErrorCode = Extract<
  MultiplayerErrorCode,
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "PROFILE_DISABLED"
  | "VERSION_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "INSTANCE_NOT_FOUND"
  | "INSTANCE_NOT_JOINABLE"
  | "INSTANCE_FULL"
  | "INVITE_INVALID"
  | "INVITE_EXHAUSTED"
  | "ALREADY_JOINED"
  | "NOT_PARTICIPANT"
  | "STALE_GENERATION"
  | "INTERNAL_RETRYABLE"
>;

export interface CreateMultiplayerRoomInput {
  readonly userId: number;
  readonly gameSlug: string;
  readonly visibility: MultiplayerVisibility;
  readonly joinPolicy: MultiplayerJoinPolicy;
  readonly idempotencyKey: string;
}

export type CreateMultiplayerRoomResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly instance: MultiplayerInstanceRecord;
      readonly participant: MultiplayerParticipantRecord;
    }
  | { readonly ok: false; readonly code: RoomErrorCode };

export interface JoinMultiplayerRoomInput {
  readonly userId: number;
  readonly publicCode: string;
  readonly inviteToken: string | null;
}

export type JoinMultiplayerRoomResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly instance: MultiplayerInstanceRecord;
      readonly participant: MultiplayerParticipantRecord;
    }
  | { readonly ok: false; readonly code: RoomErrorCode };

export interface CreateRoomInviteInput {
  readonly userId: number;
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly idempotencyKey: string;
  readonly keyring: MultiplayerTicketKeyring;
}

export type CreateRoomInviteResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      /** Returned only to the authenticated parent. Never log or forward it to the iframe. */
      readonly inviteToken: string;
      readonly expiresAt: string;
      readonly maxUses: 1;
    }
  | { readonly ok: false; readonly code: RoomErrorCode };

export interface ReadyMultiplayerParticipantInput {
  readonly userId: number;
  readonly instanceId: string;
  readonly expectedGeneration: number;
}

export type ReadyMultiplayerParticipantResult =
  | {
      readonly ok: true;
      readonly state: "WAITING" | "ACTIVE";
      readonly instance: MultiplayerInstanceRecord;
      readonly participant: MultiplayerParticipantRecord;
      readonly match: MultiplayerMatchRecord | null;
    }
  | { readonly ok: false; readonly code: RoomErrorCode };

export interface LeaveMultiplayerRoomInput {
  readonly userId: number;
  readonly instanceId: string;
  readonly expectedGeneration: number;
}

export type LeaveMultiplayerRoomResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly instance: MultiplayerInstanceRecord;
      readonly participant: MultiplayerParticipantRecord;
    }
  | { readonly ok: false; readonly code: RoomErrorCode };

export interface MultiplayerRoomUseCaseDependencies {
  readonly runtimeGames: RuntimeGameRegistry;
  readonly profiles: MultiplayerProfileRepository;
  readonly instances: MultiplayerInstanceRepository;
  readonly matches: MultiplayerMatchRepository;
  readonly now?: () => Date;
  /** Injectable solely for collision/retry tests. Values must be canonical base64url strings. */
  readonly randomToken?: (byteLength: number) => string;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function defaultRandomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveInviteToken(input: CreateRoomInviteInput): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(input.keyring.active.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const material = [
    "owogg.multiplayer.invite.v1",
    input.instanceId,
    String(input.expectedGeneration),
    String(input.userId),
    input.idempotencyKey,
  ].join("\u0000");
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(material))),
  );
}

function roomCreateHashInput(input: CreateMultiplayerRoomInput): string {
  return ["owogg.multiplayer.room.create.v1", String(input.userId), input.idempotencyKey].join(
    "\u0000",
  );
}

/** Transport-neutral room lifecycle orchestration used by HTTP control routes and the DO. */
export class MultiplayerRoomUseCases {
  private readonly now: () => Date;
  private readonly randomToken: (byteLength: number) => string;

  constructor(private readonly dependencies: MultiplayerRoomUseCaseDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.randomToken = dependencies.randomToken ?? defaultRandomToken;
  }

  async createRoom(input: CreateMultiplayerRoomInput): Promise<CreateMultiplayerRoomResult> {
    if (
      !isPositiveInteger(input.userId) ||
      input.gameSlug.length > 64 ||
      !GAME_SLUG_PATTERN.test(input.gameSlug) ||
      !["PUBLIC", "UNLISTED", "PRIVATE"].includes(input.visibility) ||
      !["OPEN", "INVITE_ONLY"].includes(input.joinPolicy) ||
      !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }

    try {
      const runtime = await this.dependencies.runtimeGames.findBySlug(input.gameSlug);
      if (!runtime) return { ok: false, code: "PROFILE_DISABLED" };
      const profileRecord = await this.dependencies.profiles.findEnabledForExactVersion(
        runtime.identity.id,
        runtime.liveVersion.id,
      );
      if (!profileRecord || !isSupportedMultiplayerRuntimeProfile(profileRecord.profile)) {
        return { ok: false, code: "PROFILE_DISABLED" };
      }
      const profile = profileRecord.profile;
      if (
        !profile.allowedVisibility.includes(input.visibility) ||
        !profile.allowedJoinPolicies.includes(input.joinPolicy)
      ) {
        return { ok: false, code: "FORBIDDEN" };
      }

      const now = this.now();
      const nowIso = now.toISOString();
      const instanceExpiresAt = new Date(now.getTime() + INSTANCE_TTL_MS).toISOString();
      const leaseExpiresAt = new Date(
        now.getTime() + INSTANCE_TTL_MS + VERSION_LEASE_GRACE_MS,
      ).toISOString();
      const createIdempotencyHash = await sha256Hex(roomCreateHashInput(input));

      for (let attempt = 0; attempt < CREATE_IDENTIFIER_ATTEMPTS; attempt += 1) {
        const created = await this.dependencies.instances.createWithHostAndLease({
          instanceId: `instance_${this.randomToken(18)}`,
          publicCode: this.randomToken(9),
          createdByUserId: input.userId,
          createIdempotencyHash,
          gameId: runtime.identity.id,
          gameVersionId: runtime.liveVersion.id,
          profileId: profileRecord.id,
          profileRevision: profile.profileRevision,
          visibility: input.visibility,
          joinPolicy: input.joinPolicy,
          lifecycle: profile.lifecycle,
          maxPlayers: profile.maxPlayers,
          instanceExpiresAt,
          hostParticipantId: `participant_${this.randomToken(18)}`,
          leaseExpiresAt,
          nowIso,
        });
        if (!("instance" in created)) {
          if (created.status === "IDEMPOTENCY_CONFLICT") {
            return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
          }
          continue;
        }

        let instance = created.instance;
        if (instance.status === "CREATED") {
          await this.dependencies.instances.transition({
            instanceId: instance.id,
            expectedStatus: "CREATED",
            expectedGeneration: instance.generation,
            nextStatus: "LOBBY",
            nextGeneration: instance.generation,
            closedAt: null,
            abortCode: null,
            nowIso,
          });
          const current = await this.dependencies.instances.findById(instance.id);
          if (!current || current.status !== "LOBBY") {
            return { ok: false, code: "INTERNAL_RETRYABLE" };
          }
          instance = current;
        }
        return {
          ok: true,
          replayed: created.status === "REPLAYED",
          instance,
          participant: created.host,
        };
      }
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    } catch {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }

  async joinRoom(input: JoinMultiplayerRoomInput): Promise<JoinMultiplayerRoomResult> {
    if (
      !isPositiveInteger(input.userId) ||
      !PUBLIC_CODE_PATTERN.test(input.publicCode) ||
      (input.inviteToken !== null && !INVITE_TOKEN_PATTERN.test(input.inviteToken))
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }

    try {
      const instance = await this.dependencies.instances.findByPublicCode(input.publicCode);
      if (!instance) return { ok: false, code: "INSTANCE_NOT_FOUND" };
      const inviteTokenHash =
        input.inviteToken === null ? null : await sha256Hex(input.inviteToken);
      const joined = await this.dependencies.instances.join({
        participantId: `participant_${this.randomToken(18)}`,
        instanceId: instance.id,
        userId: input.userId,
        expectedGeneration: instance.generation,
        inviteTokenHash,
        nowIso: this.now().toISOString(),
      });
      if (joined.status === "REJECTED") return { ok: false, code: joined.code };
      const current = await this.dependencies.instances.findById(instance.id);
      if (!current) return { ok: false, code: "INTERNAL_RETRYABLE" };
      return {
        ok: true,
        replayed: joined.status === "REPLAYED",
        instance: current,
        participant: joined.participant,
      };
    } catch {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }

  async createInvite(input: CreateRoomInviteInput): Promise<CreateRoomInviteResult> {
    if (
      !isPositiveInteger(input.userId) ||
      !INSTANCE_ID_PATTERN.test(input.instanceId) ||
      !isPositiveInteger(input.expectedGeneration) ||
      !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }

    try {
      const instance = await this.dependencies.instances.findById(input.instanceId);
      if (!instance) return { ok: false, code: "INSTANCE_NOT_FOUND" };
      if (instance.generation !== input.expectedGeneration) {
        return { ok: false, code: "STALE_GENERATION" };
      }
      const participant = await this.dependencies.instances.findParticipant(
        instance.id,
        input.userId,
      );
      if (!participant || (participant.status !== "JOINED" && participant.status !== "READY")) {
        return { ok: false, code: "NOT_PARTICIPANT" };
      }
      if (participant.role !== "HOST") return { ok: false, code: "FORBIDDEN" };

      const inviteToken = await deriveInviteToken(input);
      const tokenHash = await sha256Hex(inviteToken);
      const now = this.now();
      const expiresAt = new Date(
        Math.min(now.getTime() + INVITE_TTL_MS, Date.parse(instance.expiresAt)),
      ).toISOString();
      const created = await this.dependencies.instances.createInvite({
        instanceId: instance.id,
        expectedGeneration: instance.generation,
        tokenHash,
        createdByUserId: input.userId,
        maxUses: 1,
        expiresAt,
        nowIso: now.toISOString(),
      });
      if (created.status === "REJECTED") return { ok: false, code: created.code };
      return {
        ok: true,
        replayed: created.status === "REPLAYED",
        inviteToken,
        expiresAt: created.invite.expiresAt,
        maxUses: 1,
      };
    } catch {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }

  async readyParticipant(
    input: ReadyMultiplayerParticipantInput,
  ): Promise<ReadyMultiplayerParticipantResult> {
    if (
      !isPositiveInteger(input.userId) ||
      !INSTANCE_ID_PATTERN.test(input.instanceId) ||
      !isPositiveInteger(input.expectedGeneration)
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }

    try {
      let instance = await this.dependencies.instances.findById(input.instanceId);
      if (!instance) return { ok: false, code: "INSTANCE_NOT_FOUND" };
      if (instance.generation !== input.expectedGeneration) {
        return { ok: false, code: "STALE_GENERATION" };
      }
      let participant = await this.dependencies.instances.findParticipant(
        instance.id,
        input.userId,
      );
      if (!participant || (participant.status !== "JOINED" && participant.status !== "READY")) {
        return { ok: false, code: "NOT_PARTICIPANT" };
      }

      if (instance.status === "ACTIVE") {
        const match = await this.dependencies.matches.findMatchByInstanceGeneration(
          instance.id,
          instance.generation,
        );
        return match
          ? { ok: true, state: "ACTIVE", instance, participant, match }
          : { ok: false, code: "INTERNAL_RETRYABLE" };
      }
      if (instance.status !== "LOBBY" && instance.status !== "STARTING") {
        return { ok: false, code: "INSTANCE_NOT_JOINABLE" };
      }

      const nowIso = this.now().toISOString();
      if (participant.status === "JOINED") {
        const ready = await this.dependencies.instances.transitionParticipant({
          instanceId: instance.id,
          expectedInstanceGeneration: instance.generation,
          userId: input.userId,
          expectedStatus: "JOINED",
          nextStatus: "READY",
          readyAt: nowIso,
          leftAt: null,
          nowIso,
        });
        participant =
          ready ?? (await this.dependencies.instances.findParticipant(instance.id, input.userId));
        if (!participant || participant.status !== "READY") {
          return { ok: false, code: "STALE_GENERATION" };
        }
      }

      instance = (await this.dependencies.instances.findById(instance.id)) ?? instance;
      if (instance.status === "LOBBY") {
        const [participants, profileRecord] = await Promise.all([
          this.dependencies.instances.listParticipants(instance.id),
          this.dependencies.profiles.findById(instance.profileId),
        ]);
        if (!profileRecord || !isSupportedMultiplayerRuntimeProfile(profileRecord.profile)) {
          return { ok: false, code: "PROFILE_DISABLED" };
        }
        const activeParticipants = participants.filter(
          (candidate) => candidate.status === "JOINED" || candidate.status === "READY",
        );
        if (
          activeParticipants.length < profileRecord.profile.minPlayers ||
          activeParticipants.some((candidate) => candidate.status !== "READY")
        ) {
          return { ok: true, state: "WAITING", instance, participant, match: null };
        }
        await this.dependencies.instances.transition({
          instanceId: instance.id,
          expectedStatus: "LOBBY",
          expectedGeneration: instance.generation,
          nextStatus: "STARTING",
          nextGeneration: instance.generation,
          closedAt: null,
          abortCode: null,
          nowIso,
        });
        instance = (await this.dependencies.instances.findById(instance.id)) ?? instance;
      }

      if (instance.status === "STARTING") {
        const matchId = `match_${(
          await sha256Hex(
            ["owogg.multiplayer.match.v1", instance.id, String(instance.generation)].join("\u0000"),
          )
        ).slice(0, 48)}`;
        const createdMatch = await this.dependencies.matches.createPendingWithPlayers({
          matchId,
          instanceId: instance.id,
          expectedGeneration: instance.generation,
          nowIso,
        });
        if (createdMatch.status === "REJECTED") {
          if (createdMatch.code === "PLAYERS_NOT_READY") {
            const current = (await this.dependencies.instances.findById(instance.id)) ?? instance;
            return { ok: true, state: "WAITING", instance: current, participant, match: null };
          }
          return { ok: false, code: "INTERNAL_RETRYABLE" };
        }
        await this.dependencies.instances.transition({
          instanceId: instance.id,
          expectedStatus: "STARTING",
          expectedGeneration: instance.generation,
          nextStatus: "ACTIVE",
          nextGeneration: instance.generation,
          closedAt: null,
          abortCode: null,
          nowIso,
        });
      }

      instance = (await this.dependencies.instances.findById(instance.id)) ?? instance;
      const match = await this.dependencies.matches.findMatchByInstanceGeneration(
        instance.id,
        instance.generation,
      );
      if (instance.status !== "ACTIVE" || !match || match.status !== "ACTIVE") {
        return { ok: false, code: "INTERNAL_RETRYABLE" };
      }
      return { ok: true, state: "ACTIVE", instance, participant, match };
    } catch {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }

  async leaveRoom(input: LeaveMultiplayerRoomInput): Promise<LeaveMultiplayerRoomResult> {
    if (
      !isPositiveInteger(input.userId) ||
      !INSTANCE_ID_PATTERN.test(input.instanceId) ||
      !isPositiveInteger(input.expectedGeneration)
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    try {
      let instance = await this.dependencies.instances.findById(input.instanceId);
      if (!instance) return { ok: false, code: "INSTANCE_NOT_FOUND" };
      if (instance.generation !== input.expectedGeneration) {
        return { ok: false, code: "STALE_GENERATION" };
      }
      let participant = await this.dependencies.instances.findParticipant(
        instance.id,
        input.userId,
      );
      if (!participant) return { ok: false, code: "NOT_PARTICIPANT" };
      if (participant.status === "LEFT") {
        return { ok: true, replayed: true, instance, participant };
      }
      if (participant.status !== "JOINED" && participant.status !== "READY") {
        return { ok: false, code: "NOT_PARTICIPANT" };
      }

      const nowIso = this.now().toISOString();
      const previousStatus = participant.status;
      const left = await this.dependencies.instances.transitionParticipant({
        instanceId: instance.id,
        expectedInstanceGeneration: instance.generation,
        userId: input.userId,
        expectedStatus: previousStatus,
        nextStatus: "LEFT",
        readyAt: null,
        leftAt: nowIso,
        nowIso,
      });
      participant =
        left ?? (await this.dependencies.instances.findParticipant(instance.id, input.userId));
      if (!participant || participant.status !== "LEFT") {
        return { ok: false, code: "STALE_GENERATION" };
      }

      if (
        ["ACTIVE", "STARTING"].includes(instance.status) ||
        (participant.role === "HOST" && ["CREATED", "LOBBY"].includes(instance.status))
      ) {
        await this.dependencies.instances.transition({
          instanceId: instance.id,
          expectedStatus: instance.status,
          expectedGeneration: instance.generation,
          nextStatus: "ABORTED",
          nextGeneration: instance.generation,
          closedAt: nowIso,
          abortCode:
            instance.status === "ACTIVE" || instance.status === "STARTING"
              ? "PARTICIPANT_LEFT"
              : "INSUFFICIENT_PLAYERS",
          nowIso,
        });
      }
      instance = (await this.dependencies.instances.findById(instance.id)) ?? instance;
      return { ok: true, replayed: false, instance, participant };
    } catch {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
  }
}
