/**
 * 관리자 권한은 서버 설정의 명시적 OwOGG 사용자 ID만으로 판단합니다.
 * 이메일, 닉네임, OAuth provider, Streamer/Game Creator 상태는 권한 근거로 사용하지 않습니다.
 */
export function isAdminUserId(userId: number, configuredIds?: string): boolean {
  if (!configuredIds || !Number.isSafeInteger(userId) || userId <= 0) return false;
  return configuredIds.split(",").some((value) => {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed === userId;
  });
}

const DEFAULT_FRONTEND_URL = "https://owogg.com";

/** Returns the normalized `scheme://host:port` origin, or null if `value` is not a valid URL. */
function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(value: string): boolean {
  const origin = safeOrigin(value);
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Admin mutations require an explicit, exactly-matching browser Origin. This is stricter than
 * the general API guard because an authenticated session cookie alone must never authorize a
 * write.
 *
 * Comparison is always an exact origin match (`new URL(origin).origin === new URL(FRONTEND_URL).origin`)
 * — never `startsWith`/prefix matching, which a lookalike host (e.g.
 * `https://owogg.com.evil.example`) could otherwise satisfy.
 *
 * localhost/127.0.0.1 origins are only ever trusted when the configured `FRONTEND_URL` itself
 * is a localhost/127.0.0.1 development origin — production configuration never grants a
 * blanket localhost bypass.
 */
export function isTrustedAdminOrigin(origin: string | undefined, frontendUrl?: string): boolean {
  if (!origin) return false;
  const originValue = safeOrigin(origin);
  if (!originValue) return false;

  const configuredFrontendUrl = frontendUrl || DEFAULT_FRONTEND_URL;

  const configuredOrigin = safeOrigin(configuredFrontendUrl);
  if (!configuredOrigin) return false;
  if (originValue === configuredOrigin) return true;

  // Development-only exception: the request origin and the *configured* frontend URL must
  // both be localhost/127.0.0.1 — a production FRONTEND_URL never enables this branch.
  return isLocalhostOrigin(configuredFrontendUrl) && isLocalhostOrigin(originValue);
}
