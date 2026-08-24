export type AdminRuntimeEnvironment = "production" | "staging" | "local";

export interface AdminDataTargets {
  environment: AdminRuntimeEnvironment;
  environmentLabel: string;
  d1Database: string;
  b2Bucket: string;
}

export interface AdminResourceLink {
  id: "d1" | "b2" | "workers" | "actions" | "access" | "discord";
  label: string;
  provider: string;
  description: string;
  href: string;
}

export const ADMIN_RESOURCE_LINKS: readonly AdminResourceLink[] = [
  {
    id: "d1",
    label: "D1 데이터 검색",
    provider: "Cloudflare D1",
    description: "데이터 탐색기에서 테이블과 레코드를 직접 조회합니다.",
    href: "https://dash.cloudflare.com/?to=/:account/workers-and-pages/d1",
  },
  {
    id: "b2",
    label: "B2 파일 검색",
    provider: "Backblaze B2",
    description: "Browse Files에서 게임 번들과 canonical 파일을 찾습니다.",
    href: "https://secure.backblaze.com/b2_browse_files.htm",
  },
  {
    id: "workers",
    label: "Worker 및 로그",
    provider: "Cloudflare",
    description: "API·Web Worker 배포 상태, 호출 지표와 실시간 로그를 확인합니다.",
    href: "https://dash.cloudflare.com/?to=/:account/workers-and-pages",
  },
  {
    id: "actions",
    label: "CI/CD 실행 내역",
    provider: "GitHub Actions",
    description: "검증, Staging 배포와 Production 승격 실행 내역을 확인합니다.",
    href: "https://github.com/TaeyanG4/project-owogg/actions",
  },
  {
    id: "access",
    label: "Access 정책",
    provider: "Cloudflare Zero Trust",
    description: "Staging 접근 정책과 Service Token 설정을 관리합니다.",
    href: "https://one.dash.cloudflare.com/",
  },
  {
    id: "discord",
    label: "Discord 애플리케이션",
    provider: "Discord Developer Portal",
    description: "OAuth, Interactions Endpoint와 명령어 관련 설정을 확인합니다.",
    href: "https://discord.com/developers/applications",
  },
] as const;

export function resolveAdminDataTargets(hostname: string): AdminDataTargets {
  const normalizedHostname = hostname.trim().toLocaleLowerCase("en-US");
  const isStaging =
    normalizedHostname === "stg.owogg.com" ||
    normalizedHostname === "api-stg.owogg.com" ||
    normalizedHostname === "play-stg.owogg.com";

  if (isStaging) {
    return {
      environment: "staging",
      environmentLabel: "Staging",
      d1Database: "owogg-d1-staging",
      b2Bucket: "owogg-game-bundles-staging",
    };
  }

  if (
    normalizedHostname === "owogg.com" ||
    normalizedHostname === "www.owogg.com" ||
    normalizedHostname === "api.owogg.com" ||
    normalizedHostname === "play.owogg.com"
  ) {
    return {
      environment: "production",
      environmentLabel: "Production",
      d1Database: "owogg-d1",
      b2Bucket: "owogg-game-bundles",
    };
  }

  return {
    environment: "local",
    environmentLabel: "로컬 · 대상 확인 필요",
    d1Database: "owogg-d1 / owogg-d1-staging",
    b2Bucket: "owogg-game-bundles / owogg-game-bundles-staging",
  };
}
