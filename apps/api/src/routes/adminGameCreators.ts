import { Hono } from "hono";
import {
  GameCreatorGrantRequestSchema,
  GameCreatorAccessListResponseSchema,
  GameCreatorAccessRecordSchema,
  GameCreatorApplicationListResponseSchema,
  GameCreatorApplicationRecordSchema,
  GameCreatorApplicationDecisionRequestSchema,
} from "@owogg/contracts";
import { GameCreatorUseCaseFailure } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
import { GAME_CREATOR_FAILURE_STATUS, GAME_CREATOR_FAILURE_MESSAGE } from "./gameCreatorErrors.js";
import type { GameCreatorFailureStatus } from "./gameCreatorErrors.js";
import type { ApiEnv } from "./auth.js";

// Admin/operator management of the Game Creator program — both the admin-direct grant/revoke
// path (predates the application flow, still works for inviting a known creator directly) and
// reviewing self-serve applications (POST /api/game-creator/apply, see gameCreatorProgram.ts).
// See docs/AUTHORIZATION.md and docs/GAME_CREATION_GUIDE.md §3.6.
export const adminGameCreatorsRouter = new Hono<ApiEnv>();

adminGameCreatorsRouter.use("*", async (c, next) => {
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

function failureResponse(err: unknown): { body: unknown; status: GameCreatorFailureStatus } {
  if (!(err instanceof GameCreatorUseCaseFailure)) throw err;
  return {
    body: { error: { code: err.code, message: GAME_CREATOR_FAILURE_MESSAGE[err.code] } },
    status: GAME_CREATOR_FAILURE_STATUS[err.code],
  };
}

// ── Admin-direct grant/revoke (unchanged since the game_developers days) ────

// GET /api/admin/game-creators
adminGameCreatorsRouter.get("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const { gameCreatorUseCases } = createContainer(c.env.DB);
  const creators = await gameCreatorUseCases.list();
  return c.json(GameCreatorAccessListResponseSchema.parse({ creators }), 200);
});

// POST /api/admin/game-creators { userId } — grants (or reinstates) upload permission directly,
// without requiring the target to have applied first.
adminGameCreatorsRouter.post("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const parsed = GameCreatorGrantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "userId가 필요합니다." } }, 400);
  }

  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const record = await gameCreatorUseCases.grant(parsed.data.userId, admin.userId);
    return c.json(GameCreatorAccessRecordSchema.parse(record), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// POST /api/admin/game-creators/:userId/revoke
adminGameCreatorsRouter.post("/:userId/revoke", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const record = await gameCreatorUseCases.revoke(userId, admin.userId);
    return c.json(GameCreatorAccessRecordSchema.parse(record), 200);
  } catch (err) {
    const { body, status } = failureResponse(err);
    return c.json(body, status);
  }
});

// ── Self-serve application review ────────────────────────────────────────

// GET /api/admin/game-creators/applications?page=&pageSize= — the PENDING review queue.
adminGameCreatorsRouter.get("/applications", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize")) || 20));

  const { gameCreatorUseCases } = createContainer(c.env.DB);
  const { items, total } = await gameCreatorUseCases.listPendingApplications(
    pageSize,
    (page - 1) * pageSize,
  );
  return c.json(GameCreatorApplicationListResponseSchema.parse({ items, total }), 200);
});

// POST /api/admin/game-creators/applications/:id/approve — approves the application AND grants
// access in one call (see GameCreatorUseCases.decideApplication).
adminGameCreatorsRouter.post("/applications/:id/approve", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const applicationId = Number(c.req.param("id"));
  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const application = await gameCreatorUseCases.decideApplication({
      applicationId,
      reviewerAdminId: admin.userId,
      decision: "APPROVED",
    });
    return c.json(GameCreatorApplicationRecordSchema.parse(application), 200);
  } catch (err) {
    const { body, status } = failureResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/game-creators/applications/:id/reject { rejectReason? }
adminGameCreatorsRouter.post("/applications/:id/reject", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "game_creators.manage");
  if (denied) return denied;

  const applicationId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = GameCreatorApplicationDecisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const application = await gameCreatorUseCases.decideApplication({
      applicationId,
      reviewerAdminId: admin.userId,
      decision: "REJECTED",
      rejectReason: parsed.data.rejectReason ?? null,
    });
    return c.json(GameCreatorApplicationRecordSchema.parse(application), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});
