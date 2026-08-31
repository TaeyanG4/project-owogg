import { Pause, Play, RadioTower } from "lucide-react";
import type { StreamerAdminWorkspaceData } from "@owogg/contracts";
import { formatStreamerDateTime } from "../../../features/streamers/adminStreamerViewModel";
import { isStreamerUiPlatform } from "../../../features/streamers/streamerPlatforms";
import {
  StreamerActionButton,
  StreamerBadge,
  StreamerPanel,
  type StreamerActionControls,
} from "./StreamerAdminShared";

export function StreamerAdminProviders({
  data,
  actions,
}: {
  data: StreamerAdminWorkspaceData;
  actions: StreamerActionControls;
}) {
  return (
    <div className="space-y-4">
      <StreamerPanel className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-blue/10 text-accent-blue">
            <RadioTower className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-black text-text-primary">플랫폼 연결 운영</h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-text-muted">
              신규 OAuth 연결만 일시 중지하거나 재개합니다. 심사 판단은 모두 운영자가 수동으로
              수행하며 자동 스케줄러는 현재 사용하지 않습니다.
            </p>
          </div>
        </div>
      </StreamerPanel>

      <div className="grid gap-4 md:grid-cols-2">
        {data.providers
          .filter((provider) => isStreamerUiPlatform(provider.platform))
          .map((provider) => {
            const action = provider.newConnectionsPaused
              ? "RESUME_PROVIDER_CONNECTIONS"
              : "PAUSE_PROVIDER_CONNECTIONS";
            return (
              <StreamerPanel key={provider.platform} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-text-primary">{provider.displayName}</h3>
                    <p className="mt-1 text-[10px] text-text-muted">{provider.platform}</p>
                  </div>
                  <StreamerBadge tone={provider.reasonCode === "READY" ? "success" : "danger"}>
                    {provider.reasonCode}
                  </StreamerBadge>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-[10px]">
                  <Fact label="OAuth 소유권 연결" value={provider.ownership} />
                  <Fact label="수동 지표 갱신" value={provider.metricRefresh} />
                  <Fact label="Credential" value={provider.credentialState} />
                  <Fact
                    label="신규 연결"
                    value={provider.newConnectionsPaused ? "PAUSED" : "OPEN"}
                  />
                  <Fact label="대기 심사" value={`${provider.pendingReviews.toLocaleString()}건`} />
                  <Fact
                    label="최근 연결"
                    value={formatStreamerDateTime(provider.lastSuccessfulConnectionAt)}
                  />
                </dl>
                <StreamerActionButton
                  className="mt-5 w-full"
                  tone={provider.newConnectionsPaused ? "success" : "danger"}
                  disabled={!actions.isActionEnabled(action)}
                  disabledReason={actions.actionDisabledReason(action)}
                  onClick={() =>
                    actions.requestAction({
                      action,
                      targetId: provider.platform,
                      expectedVersion: provider.rowVersion,
                      title: provider.newConnectionsPaused
                        ? `${provider.displayName} 신규 연결 재개`
                        : `${provider.displayName} 신규 연결 중지`,
                      description: provider.newConnectionsPaused
                        ? "신규 OAuth 소유권 연결을 다시 허용합니다."
                        : "기존 계정과 심사 이력은 유지하고 신규 OAuth 연결만 차단합니다.",
                      danger: !provider.newConnectionsPaused,
                    })
                  }
                >
                  {provider.newConnectionsPaused ? (
                    <Play className="h-3.5 w-3.5" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                  {provider.newConnectionsPaused ? "신규 연결 재개" : "신규 연결 중지"}
                </StreamerActionButton>
              </StreamerPanel>
            );
          })}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-1 font-black text-text-primary">{value}</dd>
    </div>
  );
}
