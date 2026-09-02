export type GameCreatorCenterTool = "OWOGG" | "EXTERNAL";

export function resolveGameCreatorCenterTool(tool: string | null): GameCreatorCenterTool {
  return tool === "external" ? "EXTERNAL" : "OWOGG";
}

/**
 * Introducing a game hosted elsewhere is available to every signed-in OwOGG player. Only the
 * standalone OwOGG bundle upload/manage surface belongs to the Game Creator entitlement.
 */
export function requiresGameCreatorAccess(tool: GameCreatorCenterTool): boolean {
  return tool === "OWOGG";
}

interface GameCreatorAccessSummary {
  hasAccess: boolean;
  canApply: boolean;
  applicationStatus: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | null;
}

export function gameCreatorCenterEntry(access: GameCreatorAccessSummary | undefined): {
  to: string;
  label: string;
} | null {
  if (!access) return null;
  if (access.hasAccess) return { to: "/game-creator", label: "게임 크리에이터 센터" };
  if (access.applicationStatus === "PENDING") {
    return { to: "/game-creator", label: "게임 크리에이터 신청 확인" };
  }
  if (access.canApply) return { to: "/game-creator", label: "게임 크리에이터 신청" };
  return { to: "/game-creator?tool=external", label: "타 플랫폼 게임 소개" };
}
