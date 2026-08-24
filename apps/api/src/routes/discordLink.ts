import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  DiscordLinkPreviewResponseSchema,
  ConfirmDiscordLinkRequestSchema,
  ConfirmDiscordLinkResponseSchema,
  CreateMergeChallengeResponseSchema,
} from "@owogg/contracts";
import type { ApiEnv } from "./auth.js";
import { createContainer } from "../container.js";

export const discordLinkRouter = new Hono<ApiEnv>();

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

function linkError(
  c: Context<ApiEnv>,
  code: string,
  message: string,
  status: 400 | 401 | 404 | 409,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: { code, message }, ...(extra ?? {}) }, status);
}

// GET /api/discord/link/preview?token=... — safe pre-login preview of who is asking to
// link ("Discord 계정 @user 을 연동하시겠습니까?"). Does not require auth, does not reveal
// anything beyond the Discord username already visible in the inviting Discord message.
discordLinkRouter.get("/link/preview", async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const token = c.req.query("token");
  if (!token) {
    return linkError(c, "LINK_CHALLENGE_EXPIRED", "유효하지 않은 연동 링크입니다.", 400);
  }

  const { discordLinkUseCases } = createContainer(c.env.DB);
  const challenge = await discordLinkUseCases.findValidChallenge(token);
  if (!challenge) {
    return linkError(
      c,
      "LINK_CHALLENGE_EXPIRED",
      "연동 링크가 만료되었거나 이미 사용되었습니다. Discord에서 `/owogg link`를 다시 실행해주세요.",
      404,
    );
  }

  const validated = DiscordLinkPreviewResponseSchema.parse({
    discordUsername: challenge.discordUsername,
    expiresAt: challenge.expiresAt,
  });
  return c.json(validated, 200);
});

// POST /api/discord/link/confirm — requires an authenticated OwOGG session. Reuses
// IdentityUseCases.linkProvider verbatim (same ACCOUNT_ALREADY_LINKED / PROVIDER_ALREADY_LINKED
// rules and merge-challenge flow as OAuth-based linking) — no parallel merge subsystem.
discordLinkRouter.post("/link/confirm", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return linkError(c, "UNAUTHORIZED", "로그인 후 다시 시도해주세요.", 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ConfirmDiscordLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return linkError(c, "LINK_CHALLENGE_EXPIRED", "유효하지 않은 연동 링크입니다.", 400);
  }

  const { discordLinkUseCases, identityUseCases, accountMergeUseCases } = createContainer(c.env.DB);
  const challenge = await discordLinkUseCases.findValidChallenge(parsed.data.token);
  if (!challenge) {
    return linkError(
      c,
      "LINK_CHALLENGE_EXPIRED",
      "연동 링크가 만료되었거나 이미 사용되었습니다. Discord에서 `/owogg link`를 다시 실행해주세요.",
      404,
    );
  }

  const result = await identityUseCases.linkProvider(
    userId,
    "discord",
    challenge.discordUserId,
    null,
    null,
  );

  if (!result.ok) {
    if (result.code === "ACCOUNT_ALREADY_LINKED") {
      const mergeChallenge = await accountMergeUseCases.startMergeChallenge(
        userId,
        result.conflictUserId,
        "discord",
        challenge.discordUserId,
      );
      const validated = CreateMergeChallengeResponseSchema.parse({
        challengeId: mergeChallenge.challengeId,
        expiresAt: mergeChallenge.expiresAt,
        conflictUserId: result.conflictUserId,
        provider: "discord",
      });
      return c.json(
        {
          error: {
            code: "ACCOUNT_ALREADY_LINKED",
            message:
              "이 Discord 계정은 이미 다른 OwOGG 계정으로 사용 중입니다. 계정 통합을 진행할 수 있습니다.",
          },
          mergeChallenge: validated,
        },
        409,
      );
    }
    return linkError(
      c,
      "PROVIDER_ALREADY_LINKED",
      "이 계정에는 이미 Discord 로그인이 연결되어 있습니다.",
      409,
    );
  }

  // The link challenge is single-use regardless of outcome, once identity resolution succeeds.
  await discordLinkUseCases.consumeChallenge(parsed.data.token);

  const validated = ConfirmDiscordLinkResponseSchema.parse({
    linked: true,
    alreadyLinked: result.alreadyLinked,
  });
  return c.json(validated, 200);
});
