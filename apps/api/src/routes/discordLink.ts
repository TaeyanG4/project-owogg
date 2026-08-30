import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  DiscordLinkPreviewResponseSchema,
  ConfirmDiscordLinkRequestSchema,
  ConfirmDiscordLinkResponseSchema,
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

// POST /api/discord/link/confirm — requires an authenticated OwOGG session and reuses the
// canonical OAuth ownership guard. A Discord ID registered to another OwOGG user is rejected;
// this endpoint must never create a parallel identity-transfer path.
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

  const { discordLinkUseCases, identityUseCases } = createContainer(c.env.DB);
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
      return linkError(
        c,
        "ACCOUNT_PREVIOUSLY_REGISTERED",
        "이 Discord 계정은 이미 다른 OwOGG 계정에 등록되어 다시 연결할 수 없습니다.",
        409,
      );
    }
    if (result.code === "ACCOUNT_PREVIOUSLY_REGISTERED") {
      return linkError(
        c,
        "ACCOUNT_PREVIOUSLY_REGISTERED",
        "이 Discord 계정은 이전에 OwOGG에 등록되어 다른 계정에 다시 연결할 수 없습니다.",
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
