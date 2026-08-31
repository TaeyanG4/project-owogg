import { z } from "zod";

/** Mirrors packages/core/src/domain/staffRoles.ts's STAFF_ROLES/PERMISSIONS — kept as a parallel
 * literal list (not generated from the core export) since contracts intentionally has no
 * dependency on core; see the other contracts files for the same pattern. */
export const StaffRoleSchema = z.enum(["ADMIN", "OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]);
export type StaffRoleValue = z.infer<typeof StaffRoleSchema>;

export const ConfigurableStaffRoleSchema = z.enum(["OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]);
export type ConfigurableStaffRoleValue = z.infer<typeof ConfigurableStaffRoleSchema>;

export const PermissionSchema = z.enum([
  "admin.center.access",
  "users.view",
  "users.suspend",
  "users.ban",
  "users.score_moderation",
  "games.moderate",
  "sandbox_games.review",
  "sandbox_games.delete",
  "game_creators.manage",
  "streamers.view",
  "streamers.review",
  "streamers.manage",
  "streamers.policy.manage",
  "streamers.operations.manage",
  "system.monitor",
  "system.dev.access",
  "roles.manage",
]);
export type PermissionValue = z.infer<typeof PermissionSchema>;

export const PermissionGrantRequestSchema = z.object({
  permission: PermissionSchema,
});
export type PermissionGrantRequest = z.infer<typeof PermissionGrantRequestSchema>;

export const RolePermissionPolicySchema = z.object({
  role: ConfigurableStaffRoleSchema,
  permissions: z.array(PermissionSchema),
});
export type RolePermissionPolicy = z.infer<typeof RolePermissionPolicySchema>;

export const RolePermissionPolicyListResponseSchema = z.object({
  roles: z.array(RolePermissionPolicySchema),
});
export type RolePermissionPolicyListResponse = z.infer<
  typeof RolePermissionPolicyListResponseSchema
>;

/** Full replacement payload. roles.manage is deliberately rejected so this ADMIN-only editor
 * cannot make itself delegable to a non-ADMIN role. */
export const RolePermissionUpdateRequestSchema = z
  .object({ permissions: z.array(PermissionSchema).max(PermissionSchema.options.length) })
  .superRefine(({ permissions }, ctx) => {
    if (permissions.includes("roles.manage")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: "roles.manage cannot be assigned",
      });
    }
    if (new Set(permissions).size !== permissions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: "permissions must be unique",
      });
    }
  });
export type RolePermissionUpdateRequest = z.infer<typeof RolePermissionUpdateRequestSchema>;

/**
 * GET /api/me/access — the single call the web app makes to decide what to show in the profile
 * dropdown and which route guards pass, across all three independent axes (Staff Role,
 * Game Creator program, Streamer program). See docs/AUTHORIZATION.md.
 */
export const MyAccessResponseSchema = z.object({
  staffRole: StaffRoleSchema.nullable(),
  /** D1 role-policy permissions for `staffRole` plus any individual admin_permission_grants rows,
   * already merged — the client never needs to know either persistence table. Empty when
   * staffRole is null; ADMIN receives the complete catalog. */
  permissions: z.array(PermissionSchema),
  gameCreator: z.object({
    hasAccess: z.boolean(),
    canApply: z.boolean(),
    applicationStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]).nullable(),
  }),
  streamer: z.object({
    /** Mirrors streamer_profiles.status === 'VERIFIED'. Base Streamer verification is channel
     * ownership state, independent from the Game Creator application program. */
    isVerified: z.boolean(),
  }),
});
export type MyAccessResponse = z.infer<typeof MyAccessResponseSchema>;
