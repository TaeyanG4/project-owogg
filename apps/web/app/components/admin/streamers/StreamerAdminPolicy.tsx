import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  StreamerAdminWorkspaceData,
  StreamerAdminWorkspaceQuery,
  StreamerPolicyField,
  StreamerPolicyValues,
} from "@owogg/contracts";
import {
  formatStreamerDateTime,
  STREAMER_POLICY_FIELD_LABELS,
  STREAMER_POLICY_UNIT_LABELS,
} from "../../../features/streamers/adminStreamerViewModel";
import {
  StreamerActionButton,
  StreamerPagination,
  StreamerPanel,
  type StreamerActionControls,
} from "./StreamerAdminShared";

export function StreamerAdminPolicy({
  data,
  actions,
  onQueryChange,
}: {
  data: StreamerAdminWorkspaceData;
  query: StreamerAdminWorkspaceQuery;
  actions: StreamerActionControls;
  onQueryChange: (patch: Partial<StreamerAdminWorkspaceQuery>) => void;
}) {
  const policy = data.policy;
  const [values, setValues] = useState<StreamerPolicyValues | null>(policy?.current.values ?? null);
  useEffect(() => setValues(policy?.current.values ?? null), [policy]);
  const changed = useMemo(
    () =>
      Boolean(policy && values && JSON.stringify(values) !== JSON.stringify(policy.current.values)),
    [policy, values],
  );

  if (!policy || !values) {
    return (
      <StreamerPanel className="p-8 text-center text-xs text-text-muted">
        활성 심사 정책을 불러오지 못했습니다.
      </StreamerPanel>
    );
  }

  const constraintByField = new Map(policy.constraints.map((item) => [item.field, item]));
  return (
    <div className="space-y-5">
      <StreamerPanel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-text-primary">
              수동 심사 정책 v{policy.current.version}
            </h2>
            <p className="mt-1 text-[11px] text-text-muted">
              모든 기준은 서버의 버전된 정책으로 저장됩니다. 새 심사는 활성 버전을 사용하고 진행
              중인 심사의 증거는 생성 당시 버전에 고정됩니다.
            </p>
          </div>
          <StreamerActionButton
            tone="primary"
            disabled={!changed || !actions.isActionEnabled("SAVE_POLICY")}
            disabledReason={
              !changed ? "변경된 값이 없습니다." : actions.actionDisabledReason("SAVE_POLICY")
            }
            onClick={() =>
              actions.requestAction({
                action: "SAVE_POLICY",
                targetId: String(policy.current.version),
                expectedVersion: policy.current.version,
                title: "심사 정책 저장",
                description: "현재 값을 새 불변 정책 버전으로 저장하고 즉시 활성화합니다.",
                policyValues: values,
              })
            }
          >
            <Save className="h-3.5 w-3.5" /> 새 버전 저장
          </StreamerActionButton>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(values) as StreamerPolicyField[]).map((field) => {
            const constraint = constraintByField.get(field);
            if (!constraint) return null;
            return (
              <label key={field} className="rounded-2xl border border-border bg-surface p-4">
                <span className="text-[11px] font-black text-text-secondary">
                  {STREAMER_POLICY_FIELD_LABELS[field]}
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={constraint.minimum}
                    max={constraint.maximum}
                    step={constraint.step}
                    value={values[field]}
                    onChange={(event) =>
                      setValues((current) =>
                        current ? { ...current, [field]: Number(event.target.value) } : current,
                      )
                    }
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm font-black tabular-nums text-text-primary outline-none focus:border-brand"
                  />
                  <span className="w-10 text-[10px] text-text-muted">
                    {STREAMER_POLICY_UNIT_LABELS[constraint.unit]}
                  </span>
                </div>
                <span className="mt-2 block text-[9px] text-text-muted">
                  {constraint.minimum.toLocaleString()}–{constraint.maximum.toLocaleString()} ·{" "}
                  {constraint.step} 단위
                </span>
              </label>
            );
          })}
        </div>
      </StreamerPanel>

      <StreamerPanel className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-black text-text-primary">정책 변경 이력</h2>
          <p className="mt-1 text-[11px] text-text-muted">이전 버전은 감사 목적으로 보존됩니다.</p>
        </div>
        <div className="divide-y divide-border/70">
          {policy.history.items.map((version) => (
            <div
              key={version.version}
              className="grid gap-2 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <span className="text-xs font-black text-brand-light">v{version.version}</span>
              <div>
                <p className="text-xs text-text-primary">{version.reason}</p>
                <p className="mt-1 text-[10px] text-text-muted">{version.updatedBy}</p>
              </div>
              <span className="text-[10px] text-text-muted">
                {formatStreamerDateTime(version.updatedAt)}
              </span>
            </div>
          ))}
        </div>
        <StreamerPagination
          {...policy.history}
          onChange={({ page, pageSize }) =>
            onQueryChange({ policyPage: page, policyPageSize: pageSize })
          }
        />
      </StreamerPanel>
    </div>
  );
}
