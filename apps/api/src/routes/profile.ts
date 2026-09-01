import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  UpdateNicknameRequestSchema,
  UpdateAvatarPreferenceRequestSchema,
  UpdateAvatarPreferenceResponseSchema,
  UpdateCountryRequestSchema,
  UpdateLocaleRequestSchema,
  UpdateVisibilityRequestSchema,
  UpdateProfilePresentationRequestSchema,
  UpdateProfilePresentationResponseSchema,
  PublicProfileResponseSchema,
  ProfileConnectionsQuerySchema,
  ProfileConnectionsResponseSchema,
  ProfileFollowMutationResponseSchema,
} from "@owogg/contracts";
import type { ApiEnv } from "./auth.js";
import { createContainer, getPublicProfileData } from "../container.js";
import { readB2Config } from "./devGames.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "../auth/adminEligibility.js";

export const profileRouter = new Hono<ApiEnv>();

function parsePositiveUserId(value: string): number | null {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

profileRouter.get("/public/:userId/followers", async (c) => {
  const userId = parsePositiveUserId(c.req.param("userId"));
  if (!userId) return profileError(c, "INVALID_USER_ID", "잘못된 사용자 ID입니다.", 400);
  if (!c.env?.DB) return c.json({ error: "Database unavailable" }, 500);
  const query = ProfileConnectionsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return profileError(c, "INVALID_PAGINATION", "페이지 설정이 올바르지 않습니다.", 400);
  }
  const { profileFollowUseCases } = createContainer(c.env.DB);
  const result = await profileFollowUseCases.listFollowers(
    userId,
    query.data.page,
    query.data.pageSize,
  );
  if (!result.ok) return profileError(c, result.code, "사용자를 찾을 수 없습니다.", 404);
  return c.json(
    ProfileConnectionsResponseSchema.parse({
      user: result.user,
      kind: "FOLLOWERS",
      ...result.page,
    }),
    200,
  );
});

profileRouter.get("/public/:userId/following", async (c) => {
  const userId = parsePositiveUserId(c.req.param("userId"));
  if (!userId) return profileError(c, "INVALID_USER_ID", "잘못된 사용자 ID입니다.", 400);
  if (!c.env?.DB) return c.json({ error: "Database unavailable" }, 500);
  const query = ProfileConnectionsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return profileError(c, "INVALID_PAGINATION", "페이지 설정이 올바르지 않습니다.", 400);
  }
  const { profileFollowUseCases } = createContainer(c.env.DB);
  const result = await profileFollowUseCases.listFollowing(
    userId,
    query.data.page,
    query.data.pageSize,
  );
  if (!result.ok) return profileError(c, result.code, "사용자를 찾을 수 없습니다.", 404);
  return c.json(
    ProfileConnectionsResponseSchema.parse({
      user: result.user,
      kind: "FOLLOWING",
      ...result.page,
    }),
    200,
  );
});

profileRouter.put("/follows/:userId", async (c) => {
  const viewerId = await getAuthUserId(c);
  if (!viewerId) return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  const userId = parsePositiveUserId(c.req.param("userId"));
  if (!userId) return profileError(c, "INVALID_USER_ID", "잘못된 사용자 ID입니다.", 400);
  if (!c.env?.DB) return c.json({ error: "Database unavailable" }, 500);
  const { profileFollowUseCases } = createContainer(c.env.DB);
  const result = await profileFollowUseCases.follow(viewerId, userId);
  if (!result.ok) {
    return profileError(
      c,
      result.code,
      result.code === "USER_NOT_FOUND"
        ? "사용자를 찾을 수 없습니다."
        : "자기 자신은 관심 플레이어로 등록할 수 없습니다.",
      result.code === "USER_NOT_FOUND" ? 404 : 400,
    );
  }
  return c.json(
    ProfileFollowMutationResponseSchema.parse({ success: true, followStats: result.summary }),
    200,
  );
});

profileRouter.delete("/follows/:userId", async (c) => {
  const viewerId = await getAuthUserId(c);
  if (!viewerId) return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  const userId = parsePositiveUserId(c.req.param("userId"));
  if (!userId) return profileError(c, "INVALID_USER_ID", "잘못된 사용자 ID입니다.", 400);
  if (!c.env?.DB) return c.json({ error: "Database unavailable" }, 500);
  const { profileFollowUseCases } = createContainer(c.env.DB);
  const result = await profileFollowUseCases.unfollow(viewerId, userId);
  if (!result.ok) {
    return profileError(
      c,
      result.code,
      result.code === "USER_NOT_FOUND"
        ? "사용자를 찾을 수 없습니다."
        : "자기 자신은 관심 플레이어에서 해제할 수 없습니다.",
      result.code === "USER_NOT_FOUND" ? 404 : 400,
    );
  }
  return c.json(
    ProfileFollowMutationResponseSchema.parse({ success: true, followStats: result.summary }),
    200,
  );
});

// GET /api/profile/public/:userId — public profile page data, no auth required. Returns
// only the public-safe subset (see getPublicProfileData); 404 if the user doesn't exist.
profileRouter.get("/public/:userId", async (c) => {
  const userId = parsePositiveUserId(c.req.param("userId"));
  if (!userId) {
    return profileError(c, "INVALID_USER_ID", "잘못된 사용자 ID입니다.", 400);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const viewerId = await getAuthUserId(c);
  const staffRole = resolveEffectiveStaffRole(
    await resolveAdminEligibility(userId, c.env.ADMIN_USER_IDS, container.adminAccountUseCases),
  );
  const data = await getPublicProfileData(container, userId, viewerId, new Date(), staffRole);
  if (!data) {
    return profileError(c, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
  }

  return c.json(PublicProfileResponseSchema.parse(data), 200);
});

// PATCH /api/profile/presentation — owner-only predefined banner + CommonMark biography.
profileRouter.patch("/presentation", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const parsed = UpdateProfilePresentationRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    const bioTooLong = parsed.error.issues.some((issue) => issue.path[0] === "bioMarkdown");
    return profileError(
      c,
      bioTooLong ? "INVALID_PROFILE_BIO" : "INVALID_PROFILE_BANNER",
      bioTooLong ? "자기소개는 2,000자 이하여야 합니다." : "지원하지 않는 프로필 배너입니다.",
      400,
    );
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updatePresentation(
    userId,
    parsed.data.banner,
    parsed.data.bioMarkdown,
  );
  if (!result.ok) {
    return profileError(
      c,
      result.code,
      result.code === "USER_NOT_FOUND"
        ? "계정을 찾을 수 없습니다."
        : "프로필 표시 정보를 저장할 수 없습니다.",
      result.code === "USER_NOT_FOUND" ? 404 : 400,
    );
  }

  return c.json(
    UpdateProfilePresentationResponseSchema.parse({
      success: true,
      banner: result.user.profile_banner ?? parsed.data.banner,
      bioMarkdown: result.user.profile_bio_markdown ?? parsed.data.bioMarkdown,
      updatedAt: result.user.updated_at,
    }),
    200,
  );
});

// PATCH /api/profile/avatar — select one of the current user's verified, linked OAuth avatars.
// The client sends only a provider name; the URL always comes from the server-owned account row.
profileRouter.patch("/avatar", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateAvatarPreferenceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return profileError(
      c,
      "INVALID_AVATAR_PROVIDER",
      "프로필 이미지 출처가 올바르지 않습니다.",
      400,
    );
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updateAvatarPreference(userId, parsed.data.provider);
  if (!result.ok) {
    if (result.code === "USER_NOT_FOUND") {
      return profileError(c, result.code, "계정을 찾을 수 없습니다.", 404);
    }
    if (result.code === "AVATAR_PROVIDER_NOT_LINKED") {
      return profileError(c, result.code, "연결되지 않은 로그인 계정입니다.", 400);
    }
    return profileError(c, result.code, "이 로그인 계정에는 사용할 프로필 이미지가 없습니다.", 400);
  }

  return c.json(
    UpdateAvatarPreferenceResponseSchema.parse({
      success: true,
      avatarProvider: result.user.avatar_provider,
      avatarUrl: result.user.avatar_url,
    }),
    200,
  );
});

async function getAuthUserId(c: Context<ApiEnv>): Promise<number | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId || !c.env?.DB) return null;

  try {
    const { sessionRepo } = createContainer(c.env.DB);
    const result = await sessionRepo.findSession(sessionId);
    return result ? result.user.id : null;
  } catch {
    return null;
  }
}

function profileError(
  c: Context<ApiEnv>,
  code: string,
  message: string,
  status: 400 | 401 | 404 | 429,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: { code, message }, ...(extra ?? {}) }, status);
}

// POST /api/profile/nickname — change the OwOGG nickname (independent from any OAuth
// display name), subject to a centralized cooldown.
profileRouter.post("/nickname", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateNicknameRequestSchema.safeParse(body);
  if (!parsed.success) {
    return profileError(c, "INVALID_NICKNAME", "닉네임을 입력해주세요.", 400);
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updateNickname(userId, parsed.data.nickname);

  if (!result.ok) {
    if (result.code === "USER_NOT_FOUND") {
      return profileError(c, result.code, "계정을 찾을 수 없습니다.", 404);
    }
    if (result.code === "NICKNAME_COOLDOWN_ACTIVE") {
      return profileError(
        c,
        result.code,
        "닉네임은 변경 후 일정 기간이 지나야 다시 변경할 수 있습니다.",
        429,
        { nextAllowedAt: result.nextAllowedAt },
      );
    }
    return profileError(c, result.code, result.reason, 400);
  }

  return c.json(
    {
      success: true,
      nickname: result.user.nickname,
      nicknameUpdatedAt: result.user.nickname_updated_at,
    },
    200,
  );
});

// POST /api/profile/country — update self-reported "국가/지역" (not verified nationality),
// subject to a longer centralized cooldown. `country: null` means unset.
profileRouter.post("/country", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateCountryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return profileError(c, "INVALID_COUNTRY", "국가/지역 값이 올바르지 않습니다.", 400);
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updateCountry(userId, parsed.data.country);

  if (!result.ok) {
    if (result.code === "USER_NOT_FOUND") {
      return profileError(c, result.code, "계정을 찾을 수 없습니다.", 404);
    }
    if (result.code === "COUNTRY_COOLDOWN_ACTIVE") {
      return profileError(
        c,
        result.code,
        "국가/지역은 변경 후 일정 기간이 지나야 다시 변경할 수 있습니다.",
        429,
        { nextAllowedAt: result.nextAllowedAt },
      );
    }
    return profileError(c, result.code, "국가/지역 값이 올바르지 않습니다.", 400);
  }

  return c.json(
    {
      success: true,
      country: result.user.country ?? null,
      countryUpdatedAt: result.user.country_updated_at,
    },
    200,
  );
});

// POST /api/profile/locale — update saved UI language preference. No cooldown (unlike
// nickname/country) — language switching is meant to apply immediately.
profileRouter.post("/locale", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateLocaleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return profileError(c, "INVALID_LOCALE", "지원하지 않는 언어입니다.", 400);
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updateLocale(userId, parsed.data.locale);

  if (!result.ok) {
    if (result.code === "USER_NOT_FOUND") {
      return profileError(c, result.code, "계정을 찾을 수 없습니다.", 404);
    }
    return profileError(c, result.code, "지원하지 않는 언어입니다.", 400);
  }

  return c.json({ success: true, locale: result.user.locale ?? parsed.data.locale }, 200);
});

// PATCH /api/profile/visibility — controls whether favorites or recent-play activity (list plus
// exact daily calendar, already stored server-side either way) is disclosed to OTHER viewers.
// No cooldown — this only changes disclosure, not any stored data.
profileRouter.patch("/visibility", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return profileError(c, "UNAUTHORIZED", "Unauthenticated", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateVisibilityRequestSchema.safeParse(body);
  if (!parsed.success) {
    return profileError(c, "INVALID_VISIBILITY", "잘못된 요청입니다.", 400);
  }

  const { profileUseCases } = createContainer(c.env.DB);
  const result = await profileUseCases.updateVisibility(
    userId,
    parsed.data.showFavorites,
    parsed.data.showRecentPlays,
  );

  if (!result.ok) {
    return profileError(c, result.code, "계정을 찾을 수 없습니다.", 404);
  }

  return c.json(
    {
      success: true,
      showFavorites: result.user.show_favorites ?? false,
      showRecentPlays: result.user.show_recent_plays ?? false,
    },
    200,
  );
});
