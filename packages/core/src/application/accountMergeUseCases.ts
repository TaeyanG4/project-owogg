import type {
  AccountMergeRepository,
  MergeChallenge,
  MergePreview,
  OAuthAccount,
  UserRepository,
} from "../ports/repositories.js";
import type { AdminAccountRepository } from "../ports/adminAccounts.js";

export type MergeConfirmResult =
  | { ok: true; primaryId: number; secondaryId: number }
  | {
      ok: false;
      code:
        | "MERGE_CHALLENGE_EXPIRED"
        | "MERGE_CHALLENGE_CONSUMED"
        | "MERGE_CHALLENGE_MISMATCH"
        | "MERGE_PROVIDER_CONFLICT"
        | "MERGE_STREAMER_CONFLICT"
        | "MERGE_MULTIPLAYER_CONFLICT"
        | "MERGE_GAME_CREATOR_CONFLICT"
        | "MERGE_ADMIN_CONFLICT"
        | "USER_NOT_FOUND";
    };

export interface MergePreviewPair {
  userA: MergePreview;
  userB: MergePreview;
}

export class AccountMergeUseCases {
  constructor(
    private mergeRepo: AccountMergeRepository,
    private userRepo: UserRepository,
    /** Only `findByUserId` is needed here — accepting the full port keeps this class from having
     * to know about admin_accounts' other operations. */
    private adminAccountRepo: Pick<AdminAccountRepository, "findByUserId">,
  ) {}

  static readonly CHALLENGE_TTL_SECONDS = 600;

  async startMergeChallenge(
    userA: number,
    userB: number,
    provider: string,
    providerUserId: string,
  ): Promise<{ challengeId: string; expiresAt: string }> {
    const existing = await this.mergeRepo.findPendingMergeChallenge(userA, userB);
    if (existing && new Date(existing.expiresAt) > new Date()) {
      return { challengeId: existing.id, expiresAt: existing.expiresAt };
    }
    const created = await this.mergeRepo.createMergeChallenge({
      userA,
      userB,
      provider,
      providerUserId,
      ttlSeconds: AccountMergeUseCases.CHALLENGE_TTL_SECONDS,
    });
    return { challengeId: created.id, expiresAt: created.expiresAt };
  }

  async getMergePreviewPair(challengeId: string): Promise<MergePreviewPair | null> {
    const challenge = await this.mergeRepo.findMergeChallenge(challengeId);
    if (!challenge) return null;

    const [userA, userB] = await Promise.all([
      this.mergeRepo.getAccountMergePreview(challenge.userA),
      this.mergeRepo.getAccountMergePreview(challenge.userB),
    ]);

    return { userA, userB };
  }

  async findMergeChallenge(challengeId: string): Promise<MergeChallenge | null> {
    return this.mergeRepo.findMergeChallenge(challengeId);
  }

  async findPendingMergeChallenge(userA: number, userB: number): Promise<MergeChallenge | null> {
    return this.mergeRepo.findPendingMergeChallenge(userA, userB);
  }

  async confirmMerge(
    challengeId: string,
    keepUserId: number,
    currentUserId: number,
  ): Promise<MergeConfirmResult> {
    const challenge = await this.mergeRepo.findMergeChallenge(challengeId);
    if (!challenge) {
      return { ok: false, code: "MERGE_CHALLENGE_EXPIRED" };
    }
    if (challenge.consumedAt) {
      return { ok: false, code: "MERGE_CHALLENGE_CONSUMED" };
    }
    if (new Date(challenge.expiresAt) <= new Date()) {
      return { ok: false, code: "MERGE_CHALLENGE_EXPIRED" };
    }

    // The chosen Primary must be one of the two candidates.
    if (keepUserId !== challenge.userA && keepUserId !== challenge.userB) {
      return { ok: false, code: "MERGE_CHALLENGE_MISMATCH" };
    }
    // The current authenticated session must prove ownership of one of the candidates.
    if (currentUserId !== challenge.userA && currentUserId !== challenge.userB) {
      return { ok: false, code: "MERGE_CHALLENGE_MISMATCH" };
    }
    if (challenge.userA === challenge.userB) {
      return { ok: false, code: "MERGE_CHALLENGE_MISMATCH" };
    }

    const primaryId = keepUserId;
    const secondaryId = primaryId === challenge.userA ? challenge.userB : challenge.userA;

    // Both users must still exist.
    const [primaryUser, secondaryUser] = await Promise.all([
      this.userRepo.findById(primaryId),
      this.userRepo.findById(secondaryId),
    ]);
    if (!primaryUser || !secondaryUser) {
      return { ok: false, code: "USER_NOT_FOUND" };
    }

    // Administrator privilege must never silently move from Secondary to Primary, or simply
    // vanish, as a side effect of an account merge — admin_accounts.user_id is a real identity
    // binding (§ managed admin accounts), not data that "Primary Wins" is safe to discard.
    // Block the merge outright and require explicit administrator resolution first.
    const secondaryAdminAccount = await this.adminAccountRepo.findByUserId(secondaryId);
    if (secondaryAdminAccount && secondaryAdminAccount.status === "ACTIVE") {
      return { ok: false, code: "MERGE_ADMIN_CONFLICT" };
    }

    // Verify the second provider proof identity still belongs to one of the two candidates.
    const proofAccount = await this.userRepo.findOAuthAccount(
      challenge.provider,
      challenge.providerUserId,
    );
    if (
      !proofAccount ||
      (proofAccount.user_id !== primaryId && proofAccount.user_id !== secondaryId)
    ) {
      return { ok: false, code: "MERGE_CHALLENGE_MISMATCH" };
    }

    // Same-provider conflict: a provider cannot move onto an account that already has it.
    const [primaryAccounts, secondaryAccounts] = await Promise.all([
      this.userRepo.getOAuthAccounts(primaryId),
      this.userRepo.getOAuthAccounts(secondaryId),
    ]);
    const primaryProviders = new Set(primaryAccounts.map((a: OAuthAccount) => a.provider));
    const providerConflict = secondaryAccounts.some((a: OAuthAccount) =>
      primaryProviders.has(a.provider),
    );
    if (providerConflict) {
      return { ok: false, code: "MERGE_PROVIDER_CONFLICT" };
    }

    // Streamer platform ownership is identity-like. If both profiles contain an
    // external account on the same platform, there is no safe way to choose one.
    const integrityConflict = await this.mergeRepo.findMergeIntegrityConflict(
      primaryId,
      secondaryId,
    );
    if (integrityConflict === "STREAMER_PLATFORM_CONFLICT") {
      return { ok: false, code: "MERGE_STREAMER_CONFLICT" };
    }
    if (integrityConflict === "MULTIPLAYER_PARTICIPATION_CONFLICT") {
      return { ok: false, code: "MERGE_MULTIPLAYER_CONFLICT" };
    }
    if (integrityConflict === "GAME_CREATOR_REVIEW_CONFLICT") {
      return { ok: false, code: "MERGE_GAME_CREATOR_CONFLICT" };
    }
    if (integrityConflict === "OAUTH_REGISTRATION_CONFLICT") {
      return { ok: false, code: "MERGE_PROVIDER_CONFLICT" };
    }

    // Atomic Primary-Wins merge: secondary data deleted, secondary OAuth moved to primary,
    // secondary user deleted. Performed as a single transaction by the repository.
    await this.mergeRepo.mergeAccounts(primaryId, secondaryId, challengeId);

    return { ok: true, primaryId, secondaryId };
  }
}
