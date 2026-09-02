import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  ExternalGameBookmarkResponseSchema,
  ExternalGameCreateRequestSchema,
  ExternalGameListQuerySchema,
  ExternalGameListResponseSchema,
  ExternalGameMediaKindSchema,
  ExternalGameRecordSchema,
  ExternalGameSubmitRequestSchema,
  ExternalGameUpdateRequestSchema,
} from "@owogg/contracts";
import { ExternalGameUseCaseFailure, type ExternalGameRecord } from "@owogg/core";
import { createContainer, type AppContainer } from "../container.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { ApiEnv } from "./auth.js";
import { readB2Config } from "./devGames.js";

export const externalGamesRouter = new Hono<ApiEnv>();

const FAILURE_STATUS = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  SLUG_TAKEN: 409,
  INVALID_CONTENT: 400,
  INVALID_STATE: 409,
  REVIEW_SLOT_LIMIT: 409,
  SCREENSHOT_REQUIRED: 409,
  RIGHTS_CONFIRMATION_REQUIRED: 400,
  MEDIA_LIMIT: 409,
  MEDIA_INVALID: 400,
  MEDIA_TOO_LARGE: 413,
  STORAGE_ERROR: 503,
  CANNOT_DELETE_PUBLISHED: 409,
  REJECT_REASON_REQUIRED: 400,
} as const;

const FAILURE_MESSAGE = {
  NOT_FOUND: "타 플랫폼 게임 소개를 찾을 수 없습니다.",
  FORBIDDEN: "이 소개를 변경할 권한이 없습니다.",
  SLUG_TAKEN: "이미 사용 중인 URL ID입니다.",
  INVALID_CONTENT: "소개 내용이 올바르지 않습니다.",
  INVALID_STATE: "현재 심사 상태에서는 이 작업을 할 수 없습니다.",
  REVIEW_SLOT_LIMIT: "동시에 심사받을 수 있는 타 플랫폼 게임은 최대 3개입니다.",
  SCREENSHOT_REQUIRED: "심사 제출 전에 소개 스크린샷을 1개 이상 등록하세요.",
  RIGHTS_CONFIRMATION_REQUIRED: "저작권과 소개 권한 확인에 동의해야 제출할 수 있습니다.",
  MEDIA_LIMIT: "배너는 1개, 소개 스크린샷은 최대 8개까지 등록할 수 있습니다.",
  MEDIA_INVALID: "PNG, JPEG, GIF, WebP 또는 AVIF 이미지 파일만 등록할 수 있습니다.",
  MEDIA_TOO_LARGE: "이미지 한 개는 최대 5MB까지 등록할 수 있습니다.",
  STORAGE_ERROR: "이미지 저장소를 사용할 수 없습니다. 잠시 후 다시 시도하세요.",
  CANNOT_DELETE_PUBLISHED: "한 번 공개된 소개는 사용자가 직접 삭제할 수 없습니다.",
  REJECT_REASON_REQUIRED: "반려 사유가 필요합니다.",
} as const;

export function externalGameFailureResponse(error: unknown): {
  body: { error: { code: string; message: string } };
  status: (typeof FAILURE_STATUS)[keyof typeof FAILURE_STATUS];
} {
  if (!(error instanceof ExternalGameUseCaseFailure)) throw error;
  return {
    body: { error: { code: error.code, message: FAILURE_MESSAGE[error.code] } },
    status: FAILURE_STATUS[error.code],
  };
}

async function optionalAuth(c: Context<ApiEnv>): Promise<{ userId: number } | null> {
  const rawToken = getCookie(c, "owogg_session");
  if (!rawToken || !c.env?.DB) return null;
  const result = await createContainer(c.env.DB).sessionRepo.findSession(rawToken);
  return result ? { userId: result.user.id } : null;
}

async function requireAuth(c: Context<ApiEnv>): Promise<{ userId: number } | null> {
  return optionalAuth(c);
}

function mediaUrl(
  c: Context<ApiEnv>,
  game: ExternalGameRecord,
  mediaId: number,
  contentHash: string,
  mode: "public" | "mine" | "admin",
): string {
  const path =
    mode === "public"
      ? `/api/external-games/${encodeURIComponent(game.slug)}/media/${mediaId}`
      : mode === "mine"
        ? `/api/external-games/mine/${game.id}/media/${mediaId}`
        : `/api/admin/external-games/${game.id}/media/${mediaId}`;
  const url = new URL(path, c.req.url);
  url.searchParams.set("v", contentHash);
  return url.toString();
}

export async function externalGameResponse(
  c: Context<ApiEnv>,
  container: AppContainer,
  game: ExternalGameRecord,
  mode: "public" | "mine" | "admin",
  providedMedia?: Awaited<ReturnType<AppContainer["externalGameRepo"]["listMedia"]>>,
) {
  const media = providedMedia ?? (await container.externalGameRepo.listMedia(game.id));
  return ExternalGameRecordSchema.parse({
    id: game.id,
    slug: game.slug,
    introducerUserId: game.introducerUserId,
    introducerName: game.introducerName,
    title: game.title,
    shortDescription: game.shortDescription,
    descriptionMarkdown: game.descriptionMarkdown,
    platformName: game.platformName,
    externalUrl: game.externalUrl,
    releaseDate: game.releaseDate,
    tags: game.tags,
    ownershipType: game.ownershipType,
    rightsNote: mode === "public" ? "" : game.rightsNote,
    rightsAttestedAt: mode === "public" ? null : game.rightsAttestedAt,
    moderationStatus: game.moderationStatus,
    visibility: game.visibility,
    reviewSlot: game.reviewSlot,
    rejectReason: mode === "public" ? null : game.rejectReason,
    publishedAt: game.publishedAt,
    deletedAt: game.deletedAt,
    bookmarkCount: game.bookmarkCount,
    isBookmarked: game.isBookmarked,
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      url: mediaUrl(c, game, item.id, item.contentHash, mode),
      contentType: item.contentType,
      byteSize: item.byteSize,
      altText: item.altText,
      sortOrder: item.sortOrder,
    })),
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  });
}

externalGamesRouter.use("/mine/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

// Authenticated Creator Center reads must be registered before the public /:slug route.
externalGamesRouter.get("/mine", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const games = await container.externalGameUseCases.listMine(auth.userId);
  const mediaByGame = await container.externalGameRepo.listMediaByGameIds(
    games.map((game) => game.id),
  );
  return c.json(
    {
      games: await Promise.all(
        games.map((game) =>
          externalGameResponse(c, container, game, "mine", mediaByGame.get(game.id) ?? []),
        ),
      ),
    },
    200,
  );
});

externalGamesRouter.post(
  "/",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const auth = await requireAuth(c);
    if (!auth) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    const parsed = ExternalGameCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "소개 내용을 확인하세요." } },
        400,
      );
    }
    const container = createContainer(c.env.DB, readB2Config(c.env));
    try {
      const game = await container.externalGameUseCases.create({
        slug: parsed.data.slug,
        introducerUserId: auth.userId,
        content: parsed.data,
      });
      return c.json(await externalGameResponse(c, container, game, "mine"), 201);
    } catch (error) {
      const failure = externalGameFailureResponse(error);
      return c.json(failure.body, failure.status);
    }
  },
);

externalGamesRouter.patch("/mine/:id", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const parsed = ExternalGameUpdateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "소개 내용을 확인하세요." } }, 400);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.updateOwn({
      id: Number(c.req.param("id")),
      userId: auth.userId,
      content: parsed.data,
    });
    return c.json(await externalGameResponse(c, container, game, "mine"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

externalGamesRouter.post("/mine/:id/submit", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const parsed = ExternalGameSubmitRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "저작권 확인 동의가 필요합니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.submitOwn({
      id: Number(c.req.param("id")),
      userId: auth.userId,
      rightsConfirmed: parsed.data.rightsConfirmed,
    });
    return c.json(await externalGameResponse(c, container, game, "mine"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

externalGamesRouter.post("/mine/:id/withdraw", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.withdrawOwn(
      Number(c.req.param("id")),
      auth.userId,
    );
    return c.json(await externalGameResponse(c, container, game, "mine"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

externalGamesRouter.delete("/mine/:id", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    await container.externalGameUseCases.deleteOwn(Number(c.req.param("id")), auth.userId);
    return c.json({ deleted: true }, 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

externalGamesRouter.post(
  "/mine/:id/media",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const auth = await requireAuth(c);
    if (!auth) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        {
          error: {
            code: "STORAGE_NOT_CONFIGURED",
            message: "이미지 저장소가 구성되지 않았습니다.",
          },
        },
        503,
      );
    }
    const body = await c.req.parseBody().catch(() => null);
    const image = body?.image;
    const kind = ExternalGameMediaKindSchema.safeParse(body?.kind);
    if (!(image instanceof File) || !kind.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "image 파일과 kind가 필요합니다." } },
        400,
      );
    }
    try {
      const media = await container.externalGameUseCases.uploadMedia({
        id: Number(c.req.param("id")),
        userId: auth.userId,
        kind: kind.data,
        bytes: await image.arrayBuffer(),
        altText: typeof body?.altText === "string" ? body.altText : "",
      });
      const game = await container.externalGameRepo.findById(
        Number(c.req.param("id")),
        auth.userId,
      );
      if (!game) throw new ExternalGameUseCaseFailure("NOT_FOUND");
      return c.json(
        {
          id: media.id,
          kind: media.kind,
          url: mediaUrl(c, game, media.id, media.contentHash, "mine"),
          contentType: media.contentType,
          byteSize: media.byteSize,
          altText: media.altText,
          sortOrder: media.sortOrder,
        },
        201,
      );
    } catch (error) {
      const failure = externalGameFailureResponse(error);
      return c.json(failure.body, failure.status);
    }
  },
);

externalGamesRouter.delete("/mine/:id/media/:mediaId", async (c) => {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    await container.externalGameUseCases.removeMedia({
      id: Number(c.req.param("id")),
      mediaId: Number(c.req.param("mediaId")),
      userId: auth.userId,
    });
    return c.json({ deleted: true }, 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

externalGamesRouter.get("/mine/:id/media/:mediaId", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) return c.text("Not Found", 404);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const game = await container.externalGameRepo.findById(Number(c.req.param("id")), auth.userId);
  if (!game || game.introducerUserId !== auth.userId || game.deletedAt !== null) {
    return c.text("Not Found", 404);
  }
  return serveMedia(c, container, game.id, Number(c.req.param("mediaId")), false);
});

externalGamesRouter.get("/", async (c) => {
  const parsed = ExternalGameListQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    sort: c.req.query("sort"),
    search: c.req.query("search"),
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "목록 조건이 올바르지 않습니다." } },
      400,
    );
  }
  const auth = await optionalAuth(c);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const page = await container.externalGameUseCases.listPublic({
    ...parsed.data,
    viewerUserId: auth?.userId ?? null,
  });
  const mediaByGame = await container.externalGameRepo.listMediaByGameIds(
    page.games.map((game) => game.id),
  );
  return c.json(
    ExternalGameListResponseSchema.parse({
      games: await Promise.all(
        page.games.map((game) =>
          externalGameResponse(c, container, game, "public", mediaByGame.get(game.id) ?? []),
        ),
      ),
      total: page.total,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      totalPages: Math.max(1, Math.ceil(page.total / parsed.data.pageSize)),
    }),
    200,
  );
});

externalGamesRouter.put("/:slug/bookmark", async (c) => {
  return updateBookmark(c, true);
});

externalGamesRouter.delete("/:slug/bookmark", async (c) => {
  return updateBookmark(c, false);
});

externalGamesRouter.get("/:slug/media/:mediaId", async (c) => {
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const game = await container.externalGameRepo.findBySlug(c.req.param("slug"));
  if (
    !game ||
    game.deletedAt !== null ||
    game.moderationStatus !== "APPROVED" ||
    game.visibility !== "PUBLIC"
  ) {
    return c.text("Not Found", 404);
  }
  return serveMedia(c, container, game.id, Number(c.req.param("mediaId")), true);
});

externalGamesRouter.get("/:slug", async (c) => {
  const auth = await optionalAuth(c);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.getPublicBySlug(
      c.req.param("slug"),
      auth?.userId ?? null,
    );
    return c.json(await externalGameResponse(c, container, game, "public"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

async function updateBookmark(c: Context<ApiEnv>, bookmarked: boolean) {
  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const slug = c.req.param("slug");
    if (!slug) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    const game = await container.externalGameUseCases.getPublicBySlug(slug, auth.userId);
    const result = await container.externalGameUseCases.bookmark({
      id: game.id,
      userId: auth.userId,
      bookmarked,
    });
    return c.json(ExternalGameBookmarkResponseSchema.parse(result), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
}

export async function serveMedia(
  c: Context<ApiEnv>,
  container: AppContainer,
  gameId: number,
  mediaId: number,
  publicCache: boolean,
) {
  const media = await container.externalGameRepo.findMedia(gameId, mediaId);
  if (!media || c.req.query("v") !== media.contentHash) return c.text("Not Found", 404);
  const bytes = await container.gameBundleStorageRepo.getObject(media.objectKey).catch(() => null);
  if (!bytes || bytes.byteLength !== media.byteSize) return c.text("Not Found", 404);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": publicCache
        ? "public, max-age=3600, s-maxage=3600"
        : "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
