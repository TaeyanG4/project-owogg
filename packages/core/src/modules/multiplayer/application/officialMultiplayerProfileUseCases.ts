import type { RuntimeGame } from "../../game/domain/runtimeGame.js";
import type { RuntimeGameRegistry } from "../../game/ports/runtimeGameRegistry.js";
import {
  OMOK_RESOLVED_CONFIG_JSON,
  OMOK_RULESET_KEY,
  OMOK_RULESET_REVISION,
} from "../rules/omokRules.js";
import type { ApprovedMultiplayerProfileV1 } from "../domain/multiplayerProfile.js";
import type {
  MultiplayerProfileRecord,
  MultiplayerProfileRepository,
} from "../ports/multiplayerProfileRepository.js";

export const OFFICIAL_OMOK_PROFILE_PRESET = "OMOK_V1" as const;
export const OFFICIAL_OMOK_GAME_SLUG = "official-omok" as const;

export type OfficialMultiplayerProfileFailureCode =
  | "GAME_NOT_FOUND"
  | "OFFICIAL_GAME_REQUIRED"
  | "MULTIPLAYER_MANIFEST_REQUIRED"
  | "LEADERBOARD_FORBIDDEN"
  | "PRESET_GAME_MISMATCH"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_CONFLICT";

export type OfficialMultiplayerProfileResult =
  | {
      readonly ok: true;
      readonly gameSlug: string;
      readonly gameVersionId: number;
      readonly record: MultiplayerProfileRecord | null;
    }
  | { readonly ok: false; readonly code: OfficialMultiplayerProfileFailureCode };

interface OfficialMultiplayerProfileDependencies {
  readonly runtimeGames: RuntimeGameRegistry;
  readonly profiles: MultiplayerProfileRepository;
  readonly now?: () => Date;
}

function isMultiplayerCatalog(runtime: RuntimeGame): boolean {
  return runtime.canonical.catalog.type === "GENRE_MODE"
    ? runtime.canonical.catalog.mode === "multi"
    : runtime.canonical.catalog.modes.includes("online-multi");
}

function isOfficialOmokProfileWithJoinPolicy(
  profile: ApprovedMultiplayerProfileV1,
  gameId: number,
  gameVersionId: number,
  joinPolicy: "OPEN" | "INVITE_ONLY",
): boolean {
  return (
    profile.profileVersion === 1 &&
    profile.gameId === gameId &&
    profile.gameVersionId === gameVersionId &&
    profile.sourceRequestHash === null &&
    profile.protocolVersion === 1 &&
    profile.resolvedClass === "M1" &&
    profile.simulationModel === "turn" &&
    profile.runtimeBackend === "durable-object" &&
    profile.rulesetKey === OMOK_RULESET_KEY &&
    profile.rulesetRevision === OMOK_RULESET_REVISION &&
    profile.resolvedConfigJson === OMOK_RESOLVED_CONFIG_JSON &&
    profile.lifecycle === "match" &&
    profile.persistence === "match" &&
    profile.latencyProfile === "relaxed" &&
    profile.reconnectPolicy === "resume" &&
    profile.minPlayers === 2 &&
    profile.maxPlayers === 2 &&
    profile.allowedVisibility.length === 1 &&
    profile.allowedVisibility[0] === "PRIVATE" &&
    profile.allowedJoinPolicies.length === 1 &&
    profile.allowedJoinPolicies[0] === joinPolicy &&
    profile.maxActionBytes === 512 &&
    profile.maxStateBytes === 4096 &&
    profile.actionRateLimit === 5 &&
    profile.rewardPolicyId === null
  );
}

function isCurrentOfficialOmokProfile(
  profile: ApprovedMultiplayerProfileV1,
  gameId: number,
  gameVersionId: number,
): boolean {
  return isOfficialOmokProfileWithJoinPolicy(profile, gameId, gameVersionId, "OPEN");
}

function isRecognizedOfficialOmokProfile(
  profile: ApprovedMultiplayerProfileV1,
  gameId: number,
  gameVersionId: number,
): boolean {
  return (
    isCurrentOfficialOmokProfile(profile, gameId, gameVersionId) ||
    isOfficialOmokProfileWithJoinPolicy(profile, gameId, gameVersionId, "INVITE_ONLY")
  );
}

function buildOfficialOmokProfile(
  runtime: RuntimeGame,
  profileRevision: number,
): ApprovedMultiplayerProfileV1 {
  return {
    profileVersion: 1,
    gameId: runtime.identity.id,
    gameVersionId: runtime.liveVersion.id,
    sourceRequestHash: null,
    profileRevision,
    protocolVersion: 1,
    resolvedClass: "M1",
    simulationModel: "turn",
    runtimeBackend: "durable-object",
    rulesetKey: OMOK_RULESET_KEY,
    rulesetRevision: OMOK_RULESET_REVISION,
    resolvedConfigJson: OMOK_RESOLVED_CONFIG_JSON,
    lifecycle: "match",
    persistence: "match",
    latencyProfile: "relaxed",
    reconnectPolicy: "resume",
    minPlayers: 2,
    maxPlayers: 2,
    allowedVisibility: ["PRIVATE"],
    // A PRIVATE room is never listed. Its 72-bit random public code is the single capability
    // users exchange, while authenticated membership, rate limiting, and server authority remain
    // unchanged. Generic profiles may still opt into one-use INVITE_ONLY credentials.
    allowedJoinPolicies: ["OPEN"],
    maxActionBytes: 512,
    maxStateBytes: 4096,
    actionRateLimit: 5,
    // Match history is canonical, but managed multiplayer never has a score leaderboard.
    // XP/rewards stay off until the separate exactly-once outbox consumer passes its Staging gate.
    rewardPolicyId: null,
    enabled: false,
  };
}

/** Trusted admin boundary for the OWOGG-owned M1 reference profile. The ZIP only describes a
 * coarse multiplayer client; this use case—not manifest metadata—creates server authority. */
export class OfficialMultiplayerProfileUseCases {
  private readonly now: () => Date;

  constructor(private readonly dependencies: OfficialMultiplayerProfileDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  private async resolveRuntime(
    gameSlug: string,
  ): Promise<
    | { readonly ok: true; readonly runtime: RuntimeGame }
    | { readonly ok: false; readonly code: OfficialMultiplayerProfileFailureCode }
  > {
    const runtime = await this.dependencies.runtimeGames.findBySlug(gameSlug);
    if (!runtime) return { ok: false, code: "GAME_NOT_FOUND" };
    if (runtime.identity.slug !== OFFICIAL_OMOK_GAME_SLUG) {
      return { ok: false, code: "PRESET_GAME_MISMATCH" };
    }
    if (runtime.identity.publisher.type !== "OWOGG") {
      return { ok: false, code: "OFFICIAL_GAME_REQUIRED" };
    }
    if (!isMultiplayerCatalog(runtime)) {
      return { ok: false, code: "MULTIPLAYER_MANIFEST_REQUIRED" };
    }
    if (
      runtime.canonical.policy.score !== null ||
      runtime.canonical.policy.leaderboard ||
      runtime.canonical.policy.xpPerCompletion !== 0
    ) {
      return { ok: false, code: "LEADERBOARD_FORBIDDEN" };
    }
    return { ok: true, runtime };
  }

  async get(gameSlug: string): Promise<OfficialMultiplayerProfileResult> {
    const resolved = await this.resolveRuntime(gameSlug);
    if (!resolved.ok) return resolved;
    const runtime = resolved.runtime;
    const record = await this.dependencies.profiles.findLatestForExactVersion(
      runtime.identity.id,
      runtime.liveVersion.id,
    );
    if (
      record &&
      !isRecognizedOfficialOmokProfile(record.profile, runtime.identity.id, runtime.liveVersion.id)
    ) {
      return { ok: false, code: "PROFILE_CONFLICT" };
    }
    return {
      ok: true,
      gameSlug: runtime.identity.slug,
      gameVersionId: runtime.liveVersion.id,
      record,
    };
  }

  async setEnabled(input: {
    readonly gameSlug: string;
    readonly enabled: boolean;
    readonly changedByAdminId: number;
    readonly disabledReasonCode: string | null;
  }): Promise<OfficialMultiplayerProfileResult> {
    const resolved = await this.resolveRuntime(input.gameSlug);
    if (!resolved.ok) return resolved;
    const runtime = resolved.runtime;
    const nowIso = this.now().toISOString();

    if (!input.enabled) {
      const enabled = await this.dependencies.profiles.findEnabledForExactVersion(
        runtime.identity.id,
        runtime.liveVersion.id,
      );
      if (!enabled) return { ok: false, code: "PROFILE_NOT_FOUND" };
      const disabled = await this.dependencies.profiles.setEnabled({
        profileId: enabled.id,
        enabled: false,
        changedByAdminId: input.changedByAdminId,
        reasonCode: input.disabledReasonCode ?? "ADMIN_DISABLED",
        nowIso,
      });
      if (disabled.status === "NOT_FOUND" || disabled.status === "CONFLICT") {
        return { ok: false, code: "PROFILE_CONFLICT" };
      }
      return {
        ok: true,
        gameSlug: runtime.identity.slug,
        gameVersionId: runtime.liveVersion.id,
        record: disabled.record,
      };
    }

    if (input.disabledReasonCode !== null) {
      return { ok: false, code: "PROFILE_CONFLICT" };
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let enabled = await this.dependencies.profiles.findEnabledForExactVersion(
        runtime.identity.id,
        runtime.liveVersion.id,
      );
      if (enabled) {
        if (
          isCurrentOfficialOmokProfile(enabled.profile, runtime.identity.id, runtime.liveVersion.id)
        ) {
          return {
            ok: true,
            gameSlug: runtime.identity.slug,
            gameVersionId: runtime.liveVersion.id,
            record: enabled,
          };
        }
        if (
          !isRecognizedOfficialOmokProfile(
            enabled.profile,
            runtime.identity.id,
            runtime.liveVersion.id,
          )
        ) {
          return { ok: false, code: "PROFILE_CONFLICT" };
        }

        // Preset semantics are immutable. Upgrade the historical one-use-invite revision by
        // disabling it with an audited reason and creating a fresh room-code revision below.
        const disabled = await this.dependencies.profiles.setEnabled({
          profileId: enabled.id,
          enabled: false,
          changedByAdminId: input.changedByAdminId,
          reasonCode: "ACCESS_POLICY_UPGRADE",
          nowIso,
        });
        if (disabled.status === "NOT_FOUND" || disabled.status === "CONFLICT") {
          return { ok: false, code: "PROFILE_CONFLICT" };
        }
        enabled = null;
      }

      const latest = await this.dependencies.profiles.findLatestForExactVersion(
        runtime.identity.id,
        runtime.liveVersion.id,
      );
      let candidate = latest;
      if (
        !candidate ||
        !isCurrentOfficialOmokProfile(
          candidate.profile,
          runtime.identity.id,
          runtime.liveVersion.id,
        )
      ) {
        const created = await this.dependencies.profiles.createApprovedRevision({
          sourceRequestId: null,
          profile: buildOfficialOmokProfile(runtime, (latest?.profile.profileRevision ?? 0) + 1),
          createdByAdminId: input.changedByAdminId,
          nowIso,
        });
        if (created.status === "REJECTED") {
          if (created.code === "REVISION_CONFLICT") continue;
          return { ok: false, code: "PROFILE_CONFLICT" };
        }
        candidate = created.record;
      }

      const activated = await this.dependencies.profiles.setEnabled({
        profileId: candidate.id,
        enabled: true,
        changedByAdminId: input.changedByAdminId,
        reasonCode: null,
        nowIso,
      });
      if (activated.status === "NOT_FOUND" || activated.status === "CONFLICT") {
        return { ok: false, code: "PROFILE_CONFLICT" };
      }
      return {
        ok: true,
        gameSlug: runtime.identity.slug,
        gameVersionId: runtime.liveVersion.id,
        record: activated.record,
      };
    }
    return { ok: false, code: "PROFILE_CONFLICT" };
  }
}
