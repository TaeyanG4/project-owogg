import type { ProfileBannerType, User, UserRepository } from "../ports/repositories.js";
import {
  NICKNAME_COOLDOWN_DAYS,
  COUNTRY_COOLDOWN_DAYS,
  validateNickname,
  validateCountry,
  checkCooldown,
} from "../domain/profilePolicy.js";
import { isSupportedLocale } from "../domain/i18nPolicy.js";

export type UpdateNicknameResult =
  | { ok: true; user: User }
  | { ok: false; code: "INVALID_NICKNAME"; reason: string }
  | { ok: false; code: "NICKNAME_COOLDOWN_ACTIVE"; nextAllowedAt: string }
  | { ok: false; code: "USER_NOT_FOUND" };

export type UpdateCountryResult =
  | { ok: true; user: User }
  | { ok: false; code: "INVALID_COUNTRY" }
  | { ok: false; code: "COUNTRY_COOLDOWN_ACTIVE"; nextAllowedAt: string }
  | { ok: false; code: "USER_NOT_FOUND" };

export type UpdateLocaleResult =
  | { ok: true; user: User }
  | { ok: false; code: "INVALID_LOCALE" }
  | { ok: false; code: "USER_NOT_FOUND" };

export type UpdateVisibilityResult =
  { ok: true; user: User } | { ok: false; code: "USER_NOT_FOUND" };

export type UpdateAvatarPreferenceResult =
  | { ok: true; user: User }
  | { ok: false; code: "USER_NOT_FOUND" }
  | { ok: false; code: "AVATAR_PROVIDER_NOT_LINKED" }
  | { ok: false; code: "AVATAR_UNAVAILABLE" };

export type UpdateProfilePresentationResult =
  | { ok: true; user: User }
  | { ok: false; code: "USER_NOT_FOUND" }
  | { ok: false; code: "INVALID_PROFILE_BANNER" }
  | { ok: false; code: "INVALID_PROFILE_BIO" };

const PROFILE_BANNERS = new Set<ProfileBannerType>(["AURORA", "SUNSET", "MIDNIGHT", "MINT"]);
const PROFILE_BIO_MAX_LENGTH = 2000;

export class ProfileUseCases {
  constructor(private userRepo: UserRepository) {}

  async updateNickname(userId: number, rawNickname: string): Promise<UpdateNicknameResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };

    const validation = validateNickname(rawNickname);
    if (!validation.valid) {
      return { ok: false, code: "INVALID_NICKNAME", reason: validation.reason };
    }

    const cooldown = checkCooldown(user.nickname_updated_at ?? null, NICKNAME_COOLDOWN_DAYS);
    if (!cooldown.allowed) {
      return { ok: false, code: "NICKNAME_COOLDOWN_ACTIVE", nextAllowedAt: cooldown.nextAllowedAt };
    }

    const updated = await this.userRepo.updateNickname(
      userId,
      validation.nickname,
      new Date().toISOString(),
    );
    return { ok: true, user: updated };
  }

  async updateAvatarPreference(
    userId: number,
    provider: string,
  ): Promise<UpdateAvatarPreferenceResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };

    const accounts = await this.userRepo.getOAuthAccounts(userId);
    const account = accounts.find((item) => item.provider === provider);
    if (!account) return { ok: false, code: "AVATAR_PROVIDER_NOT_LINKED" };
    if (!account.avatar_url) return { ok: false, code: "AVATAR_UNAVAILABLE" };

    const updated = await this.userRepo.updateAvatarPreference(
      userId,
      provider,
      account.avatar_url,
      new Date().toISOString(),
    );
    return { ok: true, user: updated };
  }

  async updateCountry(userId: number, rawCountry: string | null): Promise<UpdateCountryResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };

    const validation = validateCountry(rawCountry);
    if (!validation.valid) {
      return { ok: false, code: "INVALID_COUNTRY" };
    }

    const cooldown = checkCooldown(user.country_updated_at ?? null, COUNTRY_COOLDOWN_DAYS);
    if (!cooldown.allowed) {
      return { ok: false, code: "COUNTRY_COOLDOWN_ACTIVE", nextAllowedAt: cooldown.nextAllowedAt };
    }

    const updated = await this.userRepo.updateCountry(
      userId,
      validation.country,
      new Date().toISOString(),
    );
    return { ok: true, user: updated };
  }

  /** No cooldown — language switching is meant to apply immediately, unlike nickname/country. */
  async updateLocale(userId: number, rawLocale: string): Promise<UpdateLocaleResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };

    if (!isSupportedLocale(rawLocale)) {
      return { ok: false, code: "INVALID_LOCALE" };
    }

    const updated = await this.userRepo.updateLocale(userId, rawLocale, new Date().toISOString());
    return { ok: true, user: updated };
  }

  /** No validation beyond boolean coercion, no cooldown — this only controls disclosure of
   * data already stored server-side, not the data itself, so there's nothing to rate-limit. */
  async updateVisibility(
    userId: number,
    showFavorites: boolean,
    showRecentPlays: boolean,
  ): Promise<UpdateVisibilityResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };

    const updated = await this.userRepo.updateVisibility(
      userId,
      showFavorites,
      showRecentPlays,
      new Date().toISOString(),
    );
    return { ok: true, user: updated };
  }

  async updatePresentation(
    userId: number,
    banner: ProfileBannerType,
    bioMarkdown: string,
  ): Promise<UpdateProfilePresentationResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };
    if (!PROFILE_BANNERS.has(banner)) {
      return { ok: false, code: "INVALID_PROFILE_BANNER" };
    }
    if (bioMarkdown.length > PROFILE_BIO_MAX_LENGTH) {
      return { ok: false, code: "INVALID_PROFILE_BIO" };
    }

    const updated = await this.userRepo.updateProfilePresentation(
      userId,
      banner,
      bioMarkdown,
      new Date().toISOString(),
    );
    return { ok: true, user: updated };
  }
}
