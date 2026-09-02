import { Hono, type Context } from "hono";
import {
  AdminExternalGameListQuerySchema,
  ExternalGameListResponseSchema,
  ExternalGameReviewDecisionRequestSchema,
  ExternalGameVisibilityUpdateRequestSchema,
} from "@owogg/contracts";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  isElevatedAdminResponse,
  requireElevatedAdmin,
  requirePermission,
} from "../auth/adminSession.js";
import type { ApiEnv } from "./auth.js";
import { readB2Config } from "./devGames.js";
import { externalGameFailureResponse, externalGameResponse, serveMedia } from "./externalGames.js";

export const adminExternalGamesRouter = new Hono<ApiEnv>();

adminExternalGamesRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method.toUpperCase())) {
    if (!isTrustedAdminOrigin(c.req.header("Origin"), c.env.FRONTEND_URL)) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "요청 출처를 확인할 수 없습니다." } },
        403,
      );
    }
  }
  await next();
});

adminExternalGamesRouter.get("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;
  const parsed = AdminExternalGameListQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    status: c.req.query("status") || undefined,
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "목록 조건이 올바르지 않습니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const page = await container.externalGameUseCases.listAdmin(parsed.data);
  const mediaByGame = await container.externalGameRepo.listMediaByGameIds(
    page.games.map((game) => game.id),
  );
  return c.json(
    ExternalGameListResponseSchema.parse({
      games: await Promise.all(
        page.games.map((game) =>
          externalGameResponse(c, container, game, "admin", mediaByGame.get(game.id) ?? []),
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

adminExternalGamesRouter.post("/:id/approve", async (c) => {
  return decide(c, "APPROVED");
});

adminExternalGamesRouter.post("/:id/reject", async (c) => {
  return decide(c, "REJECTED");
});

adminExternalGamesRouter.patch("/:id/visibility", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;
  const parsed = ExternalGameVisibilityUpdateRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "공개 상태를 확인하세요." } }, 400);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.setVisibility({
      id: Number(c.req.param("id")),
      visibility: parsed.data.visibility,
      adminId: admin.userId,
    });
    return c.json(await externalGameResponse(c, container, game, "admin"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

adminExternalGamesRouter.delete("/:id", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.delete");
  if (denied) return denied;
  const parsed = ExternalGameReviewDecisionRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "삭제 사유를 확인하세요." } }, 400);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.deleteAsAdmin({
      id: Number(c.req.param("id")),
      adminId: admin.userId,
      reason: parsed.data.reason ?? null,
    });
    return c.json(await externalGameResponse(c, container, game, "admin"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
});

adminExternalGamesRouter.get("/:id/media/:mediaId", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return c.text("Not Found", 404);
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return c.text("Not Found", 404);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  return serveMedia(c, container, Number(c.req.param("id")), Number(c.req.param("mediaId")), false);
});

async function decide(c: Context<ApiEnv>, decision: "APPROVED" | "REJECTED") {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;
  const parsed = ExternalGameReviewDecisionRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "심사 내용을 확인하세요." } }, 400);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const game = await container.externalGameUseCases.decide({
      id: Number(c.req.param("id")),
      decision,
      adminId: admin.userId,
      reason: parsed.data.reason ?? null,
    });
    return c.json(await externalGameResponse(c, container, game, "admin"), 200);
  } catch (error) {
    const failure = externalGameFailureResponse(error);
    return c.json(failure.body, failure.status);
  }
}
