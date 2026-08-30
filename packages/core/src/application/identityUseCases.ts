import type { OAuthAccount, UserRepository } from "../ports/repositories.js";
import { OAuthIdentityConflictError } from "../errors/index.js";

export type LinkProviderResult =
  | { ok: true; provider: string; alreadyLinked: boolean }
  | { ok: false; code: "ACCOUNT_ALREADY_LINKED"; conflictUserId: number }
  | { ok: false; code: "ACCOUNT_PREVIOUSLY_REGISTERED" }
  | { ok: false; code: "PROVIDER_ALREADY_LINKED" };

export type UnlinkProviderResult =
  { ok: true; provider: string } | { ok: false; code: "LAST_AUTH_PROVIDER" };

export interface ConnectedProvider {
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  avatarUrl: string | null;
  isAvatarSelected: boolean;
}

export class IdentityUseCases {
  constructor(private userRepo: UserRepository) {}

  async getConnectedProviders(userId: number): Promise<ConnectedProvider[]> {
    const [user, accounts] = await Promise.all([
      this.userRepo.findById(userId),
      this.userRepo.getOAuthAccounts(userId),
    ]);
    return accounts.map((a) => ({
      provider: a.provider,
      providerUserId: a.provider_user_id,
      providerEmail: a.provider_email,
      avatarUrl: a.avatar_url ?? null,
      isAvatarSelected: user?.avatar_provider === a.provider,
    }));
  }

  async linkProvider(
    userId: number,
    provider: string,
    providerUserId: string,
    providerEmail: string | null,
    avatarUrl: string | null,
  ): Promise<LinkProviderResult> {
    const [existing, currentAccounts] = await Promise.all([
      this.userRepo.findOAuthAccount(provider, providerUserId),
      this.userRepo.getOAuthAccounts(userId),
    ]);

    // Re-authenticating the exact identity already attached to this user is idempotent and may
    // refresh provider-owned profile fields.
    if (existing?.user_id === userId) {
      await this.userRepo.linkOAuthAccount(
        userId,
        provider,
        providerUserId,
        providerEmail,
        avatarUrl,
      );
      return { ok: true, provider, alreadyLinked: true };
    }

    // Check the current account first. Otherwise choosing a test identity that belongs to a
    // different user incorrectly opens an account-merge flow even though this account already has
    // its one allowed identity for the provider.
    const hasProvider = currentAccounts.some((a) => a.provider === provider);
    if (hasProvider) {
      return { ok: false, code: "PROVIDER_ALREADY_LINKED" };
    }

    if (existing) {
      // Never offer an account merge for an actively connected OAuth identity: accepting a second
      // provider proof must not turn into a way to move it to another OwOGG user. An explicit
      // disconnect removes this row and releases the identity for a later link.
      return { ok: false, code: "ACCOUNT_PREVIOUSLY_REGISTERED" };
    }

    // The persistence adapter repeats the active ownership checks against D1. That closes the
    // check-then-insert race; disconnect releases the corresponding registration reservation.
    try {
      await this.userRepo.linkOAuthAccount(
        userId,
        provider,
        providerUserId,
        providerEmail,
        avatarUrl,
      );
    } catch (error) {
      if (error instanceof OAuthIdentityConflictError) {
        if (error.code === "ACCOUNT_ALREADY_LINKED" && error.conflictUserId !== undefined) {
          return {
            ok: false,
            code: "ACCOUNT_ALREADY_LINKED",
            conflictUserId: error.conflictUserId,
          };
        }
        if (error.code === "ACCOUNT_PREVIOUSLY_REGISTERED") {
          return { ok: false, code: "ACCOUNT_PREVIOUSLY_REGISTERED" };
        }
        if (error.code === "PROVIDER_ALREADY_LINKED") {
          return { ok: false, code: "PROVIDER_ALREADY_LINKED" };
        }
      }
      throw error;
    }
    return { ok: true, provider, alreadyLinked: false };
  }

  async unlinkProvider(userId: number, provider: string): Promise<UnlinkProviderResult> {
    const accounts = await this.userRepo.getOAuthAccounts(userId);
    const remaining = accounts.filter((a: OAuthAccount) => a.provider !== provider);

    // Must keep at least one login method.
    if (remaining.length === 0) {
      return { ok: false, code: "LAST_AUTH_PROVIDER" };
    }

    await this.userRepo.unlinkOAuthAccount(userId, provider);
    return { ok: true, provider };
  }
}
