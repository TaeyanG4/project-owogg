import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY,
  type StreamerAdminActionRequest,
  type StreamerAdminWorkspaceData,
  type StreamerAdminWorkspaceQuery,
} from "@owogg/contracts";
import { StreamerAdminWorkspace } from "../components/admin/streamers/StreamerAdminWorkspace";
import { useAuth } from "../features/auth";
import {
  applyStreamerAdminActionApi,
  fetchStreamerAdminWorkspaceApi,
} from "../features/streamers/adminStreamerApi";
import { ApiClientError } from "../lib/api";

export function meta() {
  return [
    { title: "스트리머 관리 및 심사 | OwOGG" },
    {
      name: "description",
      content: "OwOGG 스트리머 플랫폼 연결, 수동 심사, 정책과 감사 이력 관리",
    },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

export default function AdminStreamersRoute() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [query, setQuery] = useState<StreamerAdminWorkspaceQuery>(
    DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY,
  );
  const [data, setData] = useState<StreamerAdminWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const requestSequence = useRef(0);

  const loadWorkspace = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      const workspace = await fetchStreamerAdminWorkspaceApi(query);
      if (sequence === requestSequence.current) setData(workspace);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      if (caught instanceof ApiClientError && (caught.status === 401 || caught.status === 403)) {
        setAccessDenied(true);
        setError(
          caught.code === "ADMIN_SESSION_REQUIRED"
            ? "관리자 로그인이 필요합니다. 관리자 센터에서 본인 확인을 먼저 완료해주세요."
            : "이 페이지를 사용할 수 있는 스트리머 관리 권한이 없습니다.",
        );
      } else {
        setError(
          caught instanceof Error ? caught.message : "스트리머 관리 데이터를 불러올 수 없습니다.",
        );
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) void loadWorkspace();
  }, [authLoading, isAuthenticated, loadWorkspace]);

  const updateQuery = (patch: Partial<StreamerAdminWorkspaceQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  };

  const handleAction = async (request: StreamerAdminActionRequest) => {
    await applyStreamerAdminActionApi(request);
    await loadWorkspace();
  };

  if (authLoading) return <PageMessage>접근 권한을 확인하는 중...</PageMessage>;
  if (!isAuthenticated) {
    return (
      <PageMessage>
        스트리머 관리 도구를 사용하려면 <Link to="/profile">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }
  if (accessDenied) {
    return (
      <PageMessage>
        <h1 className="text-lg font-black text-text-primary">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-text-muted">{error}</p>
        <Link
          to="/admin"
          className="mt-6 inline-flex rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white"
        >
          관리자 센터로 돌아가기
        </Link>
      </PageMessage>
    );
  }
  if (!data) {
    return (
      <PageMessage>
        {loading ? "스트리머 관리 데이터를 불러오는 중..." : (error ?? "표시할 데이터가 없습니다.")}
      </PageMessage>
    );
  }

  return (
    <StreamerAdminWorkspace
      data={data}
      query={query}
      loading={loading}
      error={error}
      currentReviewerUserId={user?.id ?? null}
      onQueryChange={updateQuery}
      onRefresh={() => void loadWorkspace()}
      onAction={handleAction}
    />
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}
