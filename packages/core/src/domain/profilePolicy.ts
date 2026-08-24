// Pure domain policy for the OwOGG nickname and country/region fields.
// Centralized here so cooldown days and validation rules are never duplicated
// across API routes or the web app.

/** OwOGG nickname is independent from any OAuth provider display name. */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

/** Nickname change cooldown, in days. Applies only after the first explicit change. */
export const NICKNAME_COOLDOWN_DAYS = 30;

/**
 * Country/region change cooldown, in days. "국가/지역" is self-reported metadata, not a
 * legally verified nationality claim, and is never inferred from request IP.
 */
export const COUNTRY_COOLDOWN_DAYS = 30;

// C0 control characters (U+0000-U+001F) and DEL (U+007F). Written via \u escapes so no
// literal control bytes live in this source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const ISO_3166_ALPHA2_PATTERN = /^[A-Z]{2}$/;

export type NicknameValidationResult =
  { valid: true; nickname: string } | { valid: false; reason: string };

/** Trims, rejects empty/control-character input, and enforces a Unicode-codepoint-aware length range. */
export function validateNickname(raw: string): NicknameValidationResult {
  if (typeof raw !== "string") {
    return { valid: false, reason: "닉네임을 입력해주세요." };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: "닉네임을 입력해주세요." };
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    return {
      valid: false,
      reason: "닉네임에 허용되지 않는 문자가 포함되어 있습니다.",
    };
  }

  // Count by Unicode code point (not UTF-16 code unit) so surrogate-pair characters
  // (e.g. some emoji) count as one character, matching what users see.
  const codepointLength = Array.from(trimmed).length;
  if (codepointLength < NICKNAME_MIN_LENGTH) {
    return {
      valid: false,
      reason: `닉네임은 최소 ${NICKNAME_MIN_LENGTH}자 이상이어야 합니다.`,
    };
  }
  if (codepointLength > NICKNAME_MAX_LENGTH) {
    return {
      valid: false,
      reason: `닉네임은 최대 ${NICKNAME_MAX_LENGTH}자까지 가능합니다.`,
    };
  }

  return { valid: true, nickname: trimmed };
}

/** `null` means "설정 안 함(unset)". Callers may also pass "UNSET" or "" to mean the same thing. */
export type CountryValue = string | null;

export type CountryValidationResult = { valid: true; country: CountryValue } | { valid: false };

/** Validates a self-reported ISO 3166-1 alpha-2 country/region code, or unset. */
export function validateCountry(raw: string | null | undefined): CountryValidationResult {
  if (raw === null || raw === undefined || raw === "" || raw.toUpperCase() === "UNSET") {
    return { valid: true, country: null };
  }

  const upper = raw.trim().toUpperCase();
  if (!ISO_3166_ALPHA2_PATTERN.test(upper)) {
    return { valid: false };
  }
  return { valid: true, country: upper };
}

export type CooldownCheckResult = { allowed: true } | { allowed: false; nextAllowedAt: string };

/** `lastChangedAt` is null before the first explicit change - always allowed in that case. */
export function checkCooldown(
  lastChangedAt: string | null,
  cooldownDays: number,
  now: Date = new Date(),
): CooldownCheckResult {
  if (!lastChangedAt) return { allowed: true };

  const lastChangedMs = new Date(lastChangedAt).getTime();
  if (Number.isNaN(lastChangedMs)) return { allowed: true };

  const nextAllowedMs = lastChangedMs + cooldownDays * 24 * 60 * 60 * 1000;
  if (now.getTime() >= nextAllowedMs) return { allowed: true };

  return { allowed: false, nextAllowedAt: new Date(nextAllowedMs).toISOString() };
}

/** Public duplicate-safe identity. `userId` is the stable public user number already used by
 * `/users/:id`; nicknames intentionally remain non-unique and user-controlled. */
export function formatPublicUserTag(nickname: string, userId: number): string {
  return `${nickname} #${userId}`;
}
