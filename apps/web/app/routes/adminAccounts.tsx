import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router";
import {
  KeyRound,
  Power,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  UserCog,
  UserPlus,
  Key,
} from "lucide-react";
import { useAuth } from "../features/auth";
import {
  fetchAdminAccounts,
  fetchAdminAccountAudit,
  postCreateAdminAccount,
  patchAdminAccountStatus,
  patchAdminAccountRole,
  postResetAdminAccountPassword,
  postRevokeAdminAccountSessions,
  fetchAdminAccountPermissions,
  postGrantAdminPermission,
  deleteRevokeAdminPermission,
  fetchAdminRolePermissions,
  putAdminRolePermissions,
} from "../features/adminApi";
import { ApiClientError } from "../lib/api/errors";
import type {
  AdminAccountSummary,
  AdminAccountAuditEntry,
  AdminAccountRoleValue,
  PermissionValue,
  ConfigurableStaffRoleValue,
  RolePermissionPolicy,
} from "@owogg/contracts";

export function meta() {
  return [
    { title: "관리자 계정 관리 | OwOGG" },
    { name: "description", content: "OwOGG 관리자 계정 관리 (ADMIN 전용)" },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

const STAFF_ROLES: AdminAccountRoleValue[] = ["ADMIN", "OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"];
const STAFF_ROLE_LABELS: Record<AdminAccountRoleValue, string> = {
  ADMIN: "관리자",
  OPERATOR: "운영자",
  MODERATOR: "모더레이터",
  SYSTEM_DEVELOPER: "시스템 개발자",
};

const CONFIGURABLE_ROLES: ConfigurableStaffRoleValue[] = [
  "OPERATOR",
  "MODERATOR",
  "SYSTEM_DEVELOPER",
];

const PERMISSION_OPTIONS: Array<{
  value: PermissionValue;
  label: string;
  description: string;
}> = [
  {
    value: "admin.center.access",
    label: "관리자 센터 접근",
    description: "통합 관리자 센터에 진입",
  },
  { value: "users.view", label: "유저 조회", description: "유저 목록과 상세 정보 조회" },
  { value: "users.suspend", label: "유저 일시 정지", description: "계정 일시 정지 및 해제" },
  { value: "users.ban", label: "유저 영구 차단", description: "계정 영구 차단" },
  {
    value: "users.score_moderation",
    label: "점수 관리",
    description: "점수 제출 차단과 점수 초기화/복원",
  },
  { value: "games.moderate", label: "공식 게임 관리", description: "공식 게임 게시와 안전 제어" },
  {
    value: "sandbox_games.review",
    label: "사용자 게임 심사",
    description: "사용자 제작 게임 승인·거절·공개 설정",
  },
  {
    value: "sandbox_games.delete",
    label: "사용자 게임 삭제",
    description: "사용자 제작 게임 삭제 및 영구 정리",
  },
  {
    value: "game_creators.manage",
    label: "게임 크리에이터 관리",
    description: "제작 권한과 신청 심사",
  },
  { value: "streamers.review", label: "스트리머 심사", description: "Featured Streamer 수동 심사" },
  { value: "system.monitor", label: "운영 모니터링", description: "서비스와 데이터 상태 조회" },
  { value: "system.dev.access", label: "시스템 개발 도구", description: "내부 진단·개발 기능" },
];

const DELEGABLE_PERMISSIONS = PERMISSION_OPTIONS.map(({ value }) => value);

export default function AdminAccountsRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<AdminAccountSummary[] | null>(null);
  const [rolePolicies, setRolePolicies] = useState<RolePermissionPolicy[] | null>(null);
  const [audit, setAudit] = useState<AdminAccountAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [accountData, auditData, rolePermissionData] = await Promise.all([
        fetchAdminAccounts(),
        fetchAdminAccountAudit(),
        fetchAdminRolePermissions(),
      ]);
      setAccounts(accountData.accounts);
      setAudit(auditData.entries);
      setRolePolicies(rolePermissionData.roles);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
        setError(
          err.code === "ADMIN_SESSION_REQUIRED"
            ? "관리자 로그인이 필요합니다. /admin 에서 본인 확인을 먼저 완료해주세요."
            : "ADMIN만 접근할 수 있습니다.",
        );
      } else {
        setError(err instanceof Error ? err.message : "관리자 계정 목록을 불러올 수 없습니다.");
      }
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) void load();
  }, [authLoading, isAuthenticated, load]);

  const withBusy = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청을 처리할 수 없습니다.");
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) return <PageMessage>접근 권한을 확인하는 중...</PageMessage>;
  if (!isAuthenticated) {
    return (
      <PageMessage>
        <Link to="/">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }
  if (accessDenied) {
    return (
      <PageMessage>
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <h1 className="text-lg font-black text-text-primary">관리자 계정 관리</h1>
        <p className="mt-2 text-sm text-text-muted">{error}</p>
        <Link
          to="/admin"
          className="mt-6 inline-block text-xs font-bold text-brand-light hover:underline"
        >
          관리자 센터로 돌아가기
        </Link>
      </PageMessage>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 px-4 py-8 md:px-8">
      <header>
        <div className="mb-2 inline-flex items-center gap-2 text-accent-yellow">
          <UserCog className="h-5 w-5" />
          <span className="text-[11px] font-black uppercase tracking-[0.2em]">ADMIN</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-text-primary">관리자 계정 관리</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-muted">
          모든 관리자 계정은 이미 존재하는 OwOGG 사용자와, 그 사용자에게 연결된 Google 계정을
          기준으로만 생성됩니다.
        </p>
      </header>

      {error && !accessDenied && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-xs font-semibold text-accent-red">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-accent-green/30 bg-accent-green/10 p-3 text-xs font-semibold text-accent-green">
          {notice}
        </p>
      )}

      <RolePermissionEditor
        policies={rolePolicies}
        onSaved={async (role) => {
          setNotice(`${STAFF_ROLE_LABELS[role]} 역할 권한이 저장되었습니다.`);
          await load();
        }}
        onError={setError}
      />

      <CreateAdminForm
        onCreated={() => {
          setNotice("관리자 계정이 생성되었습니다.");
          void load();
        }}
        onError={(msg) => setError(msg)}
      />

      <section className="overflow-x-auto rounded-2xl border border-border bg-surface-raised">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-border text-text-muted">
            <tr>
              <th className="px-4 py-3 font-bold">닉네임</th>
              <th className="px-4 py-3 font-bold">아이디</th>
              <th className="px-4 py-3 font-bold">역할</th>
              <th className="px-4 py-3 font-bold">상태</th>
              <th className="px-4 py-3 font-bold">비밀번호 변경 필요</th>
              <th className="px-4 py-3 font-bold">작업</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((account) => (
              <tr key={account.id} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-3 font-bold text-text-primary">
                  {account.nickname}{" "}
                  {account.isSelf && <span className="text-text-muted">(나)</span>}
                </td>
                <td className="px-4 py-3 text-text-muted">{account.username}</td>
                <td className="px-4 py-3">
                  <RoleBadge role={account.role} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={account.status} />
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {account.mustChangePassword ? "예" : "아니오"}
                </td>
                <td className="px-4 py-3">
                  <AccountActions
                    account={account}
                    busy={busyId === account.id}
                    onToggleStatus={() =>
                      withBusy(account.id, () =>
                        patchAdminAccountStatus(
                          account.id,
                          account.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                        ),
                      )
                    }
                    onChangeRole={(role) =>
                      withBusy(account.id, () => patchAdminAccountRole(account.id, role))
                    }
                    onResetPassword={(newPassword) =>
                      withBusy(account.id, () =>
                        postResetAdminAccountPassword(account.id, newPassword),
                      )
                    }
                    onRevokeSessions={() =>
                      withBusy(account.id, () => postRevokeAdminAccountSessions(account.id))
                    }
                  />
                </td>
              </tr>
            ))}
            {accounts && accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  등록된 관리자 계정이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5">
        <h2 className="text-sm font-black text-text-primary">계정별 추가 권한</h2>
        <p className="mt-1 text-xs text-text-muted">
          위 역할 권한에 더해 특정 계정에만 예외 권한을 추가하거나 회수합니다. 역할 전체를 바꾸려면
          위의 역할별 기능 권한을 사용하세요. <code>roles.manage</code>는 ADMIN 전용이라 위임할 수
          없습니다.
        </p>
        <div className="mt-4 space-y-3">
          {(accounts ?? []).map((account) => (
            <PermissionEditor key={account.id} account={account} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5">
        <h2 className="text-sm font-black text-text-primary">감사 로그 (최근 100건)</h2>
        <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
          {audit.length === 0 && <p className="text-xs text-text-muted">기록이 없습니다.</p>}
          {audit.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5 text-xs"
            >
              <span className="font-bold text-text-primary">{entry.action}</span>
              <span className="text-text-muted">
                {entry.createdAt.replace("T", " ").slice(0, 16)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RolePermissionEditor({
  policies,
  onSaved,
  onError,
}: {
  policies: RolePermissionPolicy[] | null;
  onSaved: (role: ConfigurableStaffRoleValue) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [selectedRole, setSelectedRole] = useState<ConfigurableStaffRoleValue>("OPERATOR");
  const [draft, setDraft] = useState<PermissionValue[]>([]);
  const [saving, setSaving] = useState(false);
  const persisted = policies?.find((policy) => policy.role === selectedRole)?.permissions ?? [];

  useEffect(() => {
    setDraft([...(policies?.find((policy) => policy.role === selectedRole)?.permissions ?? [])]);
  }, [policies, selectedRole]);

  const normalized = (permissions: readonly PermissionValue[]) => [...permissions].sort().join("|");
  const dirty = normalized(draft) !== normalized(persisted);

  const toggle = (permission: PermissionValue) => {
    setDraft((current) =>
      current.includes(permission)
        ? current.filter((candidate) => candidate !== permission)
        : [...current, permission],
    );
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    onError("");
    try {
      await putAdminRolePermissions(selectedRole, draft);
      await onSaved(selectedRole);
    } catch (err) {
      onError(err instanceof Error ? err.message : "역할 권한을 저장할 수 없습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-surface-raised">
      <div className="border-b border-border bg-brand/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand-light">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-black text-text-primary">역할별 기능 권한</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              운영자·모더레이터·시스템 개발자가 통합 관리자 센터에서 사용할 기능을 설정합니다. 변경
              사항은 해당 역할의 모든 계정에 즉시 적용됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="권한을 설정할 역할">
          {CONFIGURABLE_ROLES.map((role) => {
            const selected = role === selectedRole;
            const count = policies?.find((policy) => policy.role === role)?.permissions.length ?? 0;
            return (
              <button
                key={role}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedRole(role)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                  selected
                    ? "border-brand bg-brand/15 text-brand-light"
                    : "border-border bg-surface text-text-secondary hover:border-brand/50"
                }`}
              >
                <span className="block text-xs font-black">{STAFF_ROLE_LABELS[role]}</span>
                <span className="mt-0.5 block text-[10px] opacity-70">{count}개 기능</span>
              </button>
            );
          })}
        </div>

        {policies === null ? (
          <p className="py-10 text-center text-xs text-text-muted">역할 권한을 불러오는 중...</p>
        ) : (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {PERMISSION_OPTIONS.map((option) => {
              const checked = draft.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    checked
                      ? "border-brand/60 bg-brand/10"
                      : "border-border bg-surface hover:border-brand/35"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.value)}
                    className="mt-0.5 h-4 w-4 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-text-primary">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-text-muted">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-[10px] text-text-muted">
            ADMIN은 항상 모든 기능과 역할 권한 관리를 보유하며 이 목록에서 변경할 수 없습니다.
          </p>
          <button
            type="button"
            disabled={!dirty || saving || policies === null}
            onClick={() => void save()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "저장 중..." : "역할 권한 저장"}
          </button>
        </div>
      </div>
    </section>
  );
}

function RoleBadge({ role }: { role: AdminAccountRoleValue }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-bold ${
        role === "ADMIN"
          ? "bg-accent-yellow/15 text-accent-yellow"
          : role === "OPERATOR"
            ? "bg-brand/15 text-brand-light"
            : role === "MODERATOR"
              ? "bg-accent-green/15 text-accent-green"
              : "bg-surface-overlay text-text-muted"
      }`}
    >
      {STAFF_ROLE_LABELS[role]}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-bold ${
        status === "ACTIVE"
          ? "bg-accent-green/15 text-accent-green"
          : "bg-accent-red/15 text-accent-red"
      }`}
    >
      {status === "ACTIVE" ? "활성" : "비활성"}
    </span>
  );
}

function AccountActions({
  account,
  busy,
  onToggleStatus,
  onChangeRole,
  onResetPassword,
  onRevokeSessions,
}: {
  account: AdminAccountSummary;
  busy: boolean;
  onToggleStatus: () => void;
  onChangeRole: (role: AdminAccountRoleValue) => void;
  onResetPassword: (newPassword: string) => void;
  onRevokeSessions: () => void;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={onToggleStatus}
        title={account.status === "ACTIVE" ? "비활성화" : "활성화"}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-text-primary hover:border-brand disabled:opacity-50 cursor-pointer"
      >
        <Power className="h-3 w-3" /> {account.status === "ACTIVE" ? "비활성화" : "활성화"}
      </button>
      <label
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-text-primary has-[select:disabled]:opacity-50"
        title="역할 변경 — 자기 자신의 역할은 이 화면에서 변경할 수 없습니다"
      >
        <UserCog className="h-3 w-3" />
        <select
          value={account.role}
          disabled={busy || account.isSelf}
          onChange={(e) => onChangeRole(e.target.value as AdminAccountRoleValue)}
          className="cursor-pointer bg-transparent text-[10px] font-bold outline-none disabled:cursor-not-allowed"
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {STAFF_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={onRevokeSessions}
        title="세션 해제"
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-text-primary hover:border-brand disabled:opacity-50 cursor-pointer"
      >
        <RotateCcw className="h-3 w-3" /> 세션 해제
      </button>
      {!resetOpen ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setResetOpen(true)}
          title="임시 비밀번호 발급"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-text-primary hover:border-brand disabled:opacity-50 cursor-pointer"
        >
          <KeyRound className="h-3 w-3" /> 비밀번호 재설정
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="새 임시 비밀번호 (12자 이상)"
            minLength={12}
            className="w-44 rounded-lg border border-border bg-surface px-2 py-1 text-[10px]"
          />
          <button
            type="button"
            disabled={busy || newPassword.length < 12}
            onClick={() => {
              onResetPassword(newPassword);
              setNewPassword("");
              setResetOpen(false);
            }}
            className="rounded-lg bg-brand px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50 cursor-pointer"
          >
            적용
          </button>
        </div>
      )}
    </div>
  );
}

function CreateAdminForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminAccountRoleValue>("ADMIN");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await postCreateAdminAccount({
        userId: Number(userId),
        username,
        password,
        role,
      });
      setUserId("");
      setUsername("");
      setPassword("");
      setRole("ADMIN");
      onCreated();
    } catch (err) {
      onError(
        err instanceof ApiClientError
          ? err.detail || "관리자 계정 생성에 실패했습니다."
          : "관리자 계정 생성에 실패했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface-raised p-5"
    >
      <label className="flex flex-col gap-1 text-xs font-bold text-text-primary">
        OwOGG 사용자 ID
        <input
          type="number"
          min={1}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="w-40 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-text-primary">
        관리자 아이디
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          maxLength={64}
          className="w-40 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-text-primary">
        임시 비밀번호
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          className="w-44 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-text-primary">
        역할
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminAccountRoleValue)}
          className="w-36 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {STAFF_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50 cursor-pointer"
      >
        <UserPlus className="h-3.5 w-3.5" /> {loading ? "생성 중..." : "관리자 추가"}
      </button>
      <p className="w-full text-[10px] text-text-muted">
        대상 사용자는 이미 Google 계정이 연결되어 있어야 합니다. Google sub는 서버에서 자동으로
        가져옵니다.
      </p>
    </form>
  );
}

/** One account's individually-delegated permissions, lazily loaded on first expand (not eagerly
 * for every row on page load — this is an N+1-shaped call the admin rarely needs for every
 * account at once). ADMIN accounts are shown collapsed with an explanatory note instead of a
 * checklist, since ADMIN already implies every permission — delegating one individually would be
 * a meaningless no-op the server would silently accept but that could confuse an operator
 * skimming this list into thinking it matters. */
function PermissionEditor({ account }: { account: AdminAccountSummary }) {
  const [open, setOpen] = useState(false);
  const [granted, setGranted] = useState<PermissionValue[] | null>(null);
  const [busyPermission, setBusyPermission] = useState<PermissionValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminAccountPermissions(account.id);
      setGranted(res.permissions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "권한 목록을 불러올 수 없습니다.");
    }
  }, [account.id]);

  const toggle = async (permission: PermissionValue, currentlyGranted: boolean) => {
    setBusyPermission(permission);
    setError(null);
    try {
      if (currentlyGranted) {
        await deleteRevokeAdminPermission(account.id, permission);
      } else {
        await postGrantAdminPermission(account.id, permission);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "권한 변경에 실패했습니다.");
    } finally {
      setBusyPermission(null);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-surface p-3">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && granted === null) void load();
        }}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-bold text-text-primary"
      >
        <span className="inline-flex items-center gap-1.5">
          <Key className="h-3.5 w-3.5 text-text-muted" />
          {account.nickname}
          <span className="font-normal text-text-muted">({STAFF_ROLE_LABELS[account.role]})</span>
        </span>
        <span className="text-text-muted">{open ? "접기" : "펼치기"}</span>
      </button>

      {open &&
        (account.role === "ADMIN" ? (
          <p className="mt-2 text-[11px] text-text-muted">
            ADMIN은 모든 권한을 이미 가지고 있어 개별 위임이 필요하지 않습니다.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {error && <p className="text-[11px] font-semibold text-accent-red">{error}</p>}
            {granted === null ? (
              <p className="text-[11px] text-text-muted">불러오는 중...</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {DELEGABLE_PERMISSIONS.map((permission) => {
                  const isGranted = granted.includes(permission);
                  const option = PERMISSION_OPTIONS.find(
                    (candidate) => candidate.value === permission,
                  );
                  return (
                    <button
                      key={permission}
                      type="button"
                      disabled={busyPermission === permission}
                      onClick={() => void toggle(permission, isGranted)}
                      className={`rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-50 cursor-pointer ${
                        isGranted
                          ? "border-brand bg-brand/10 text-brand-light"
                          : "border-border text-text-muted hover:border-brand/50"
                      }`}
                      title={`${option?.label ?? permission}: ${option?.description ?? ""}`}
                    >
                      {option?.label ?? permission}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-24 text-center">{children}</div>;
}
