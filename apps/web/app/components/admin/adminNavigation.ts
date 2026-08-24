import type { PermissionValue, StaffRoleValue } from "@owogg/contracts";

export type AdminNavigationItemId =
  | "dashboard"
  | "games"
  | "creator-reviews"
  | "game-creators"
  | "users"
  | "monitoring"
  | "accounts"
  | "security"
  | "ops-center"
  | "mod-center"
  | "system-dev-center";

export interface AdminNavigationItem {
  id: AdminNavigationItemId;
  label: string;
  description: string;
  path: string;
  aliases?: string[];
  permissionAny?: PermissionValue[];
  adminOnly?: boolean;
  elevatedOnly?: boolean;
}

export interface AdminNavigationGroup {
  id: "overview" | "operations" | "people" | "system" | "centers";
  label: string;
  items: AdminNavigationItem[];
}

/** One registry is the admin UI's information architecture. Backend gates remain authoritative. */
export const ADMIN_NAVIGATION_GROUPS: AdminNavigationGroup[] = [
  {
    id: "overview",
    label: "개요",
    items: [
      {
        id: "dashboard",
        label: "대시보드",
        description: "운영 현황과 주요 작업 요약",
        path: "/admin",
      },
    ],
  },
  {
    id: "operations",
    label: "콘텐츠 운영",
    items: [
      {
        id: "games",
        label: "게임 관리 및 심사",
        description: "공식 게임 게시와 사용자 게임 심사",
        path: "/admin/games",
        aliases: ["/admin/sandbox-games"],
        permissionAny: ["games.moderate", "sandbox_games.review", "sandbox_games.delete"],
        elevatedOnly: true,
      },
      {
        id: "creator-reviews",
        label: "Creator 심사",
        description: "Featured Creator 수동 심사",
        path: "/admin/creators",
        permissionAny: ["streamers.review"],
        elevatedOnly: true,
      },
      {
        id: "game-creators",
        label: "게임 크리에이터",
        description: "제작 권한과 신청 관리",
        path: "/admin/game-creators",
        permissionAny: ["game_creators.manage"],
        elevatedOnly: true,
      },
    ],
  },
  {
    id: "people",
    label: "사용자",
    items: [
      {
        id: "users",
        label: "유저 관리",
        description: "계정 조회와 운영 조치",
        path: "/admin/users",
        permissionAny: ["users.view"],
        elevatedOnly: true,
      },
    ],
  },
  {
    id: "system",
    label: "시스템 및 보안",
    items: [
      {
        id: "monitoring",
        label: "운영 모니터링",
        description: "서비스와 데이터 상태 확인",
        path: "/admin/monitoring",
        permissionAny: ["system.monitor"],
        elevatedOnly: true,
      },
      {
        id: "accounts",
        label: "관리자 계정",
        description: "역할, 권한, 세션 관리",
        path: "/admin/accounts",
        adminOnly: true,
        elevatedOnly: true,
      },
      {
        id: "security",
        label: "내 보안 설정",
        description: "관리자 비밀번호 변경",
        path: "/admin/settings/security",
        elevatedOnly: true,
      },
    ],
  },
  {
    id: "centers",
    label: "역할별 센터",
    items: [
      {
        id: "ops-center",
        label: "운영 센터",
        description: "운영자 전용 작업 공간",
        path: "/ops",
        permissionAny: ["admin.center.access"],
        elevatedOnly: true,
      },
      {
        id: "mod-center",
        label: "모더레이션",
        description: "모더레이터 전용 작업 공간",
        path: "/mod",
        permissionAny: ["admin.center.access"],
        elevatedOnly: true,
      },
      {
        id: "system-dev-center",
        label: "시스템 개발",
        description: "내부 진단 및 개발 도구",
        path: "/system-dev",
        permissionAny: ["system.dev.access"],
        elevatedOnly: true,
      },
    ],
  },
];

export interface AdminNavigationAccess {
  elevated: boolean;
  role: StaffRoleValue | null;
  permissions: PermissionValue[];
}

export function canAccessAdminNavigationItem(
  item: AdminNavigationItem,
  access: AdminNavigationAccess,
): boolean {
  if (item.elevatedOnly && !access.elevated) return false;
  if (item.adminOnly) return access.role === "ADMIN";
  if (access.role === "ADMIN") return true;
  if (!item.permissionAny?.length) return true;
  return item.permissionAny.some((permission) => access.permissions.includes(permission));
}

export function getVisibleAdminNavigation(
  access: AdminNavigationAccess,
  query = "",
): AdminNavigationGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  return ADMIN_NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!canAccessAdminNavigationItem(item, access)) return false;
      if (!normalizedQuery) return true;
      return `${item.label} ${item.description}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery);
    }),
  })).filter((group) => group.items.length > 0);
}

export function isAdminNavigationItemActive(item: AdminNavigationItem, pathname: string): boolean {
  return [item.path, ...(item.aliases ?? [])].some((path) => {
    if (path === "/admin") return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

export function findAdminNavigationItem(pathname: string): AdminNavigationItem | null {
  return (
    ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items).find((item) =>
      isAdminNavigationItemActive(item, pathname),
    ) ?? null
  );
}
