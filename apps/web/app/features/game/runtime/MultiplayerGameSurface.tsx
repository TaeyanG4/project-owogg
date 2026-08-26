import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  MultiplayerGameAvailabilityResponse,
  MultiplayerRoomResponse,
} from "@owogg/contracts";
import { MultiplayerIframeRuntime } from "./MultiplayerIframeRuntime";
import {
  createMultiplayerInvite,
  createMultiplayerRoom,
  fetchMultiplayerGameAvailability,
  joinMultiplayerRoom,
} from "./multiplayerRoomApi";
import type { MultiplayerRuntimeResolution } from "./multiplayerRuntimeResolution";

type AvailableMultiplayerGame = Extract<
  MultiplayerGameAvailabilityResponse,
  { readonly status: "AVAILABLE" }
>;

export interface MultiplayerGameSurfaceProps {
  readonly gameSlug: string;
  readonly src: string;
  readonly title: string;
  readonly attemptKey: number;
  readonly frameClassName?: string;
  readonly frameStyle?: CSSProperties;
  readonly iframeStyle?: CSSProperties;
  readonly fallback: ReactNode;
  readonly onRuntimeResolved: (mode: MultiplayerRuntimeResolution) => void;
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "멀티플레이 요청을 처리하지 못했습니다.";
}

/** Keeps the invite credential in parent UI only while producing the one-click URL another player
 * can open. The sandbox receives neither this URL nor the token. */
export function buildMultiplayerRoomShareValue(
  pageUrl: string,
  publicCode: string,
  inviteToken?: string,
): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.set("room", publicCode);
    if (inviteToken) url.searchParams.set("invite", inviteToken);
    else url.searchParams.delete("invite");
    url.hash = "";
    return url.toString();
  } catch {
    return inviteToken ? `${publicCode}\n${inviteToken}` : publicCode;
  }
}

function roomShareValue(publicCode: string, inviteToken?: string): string {
  return buildMultiplayerRoomShareValue(
    typeof window === "undefined" ? "" : window.location.href,
    publicCode,
    inviteToken,
  );
}

/** Discovery + room control UI shared by every approved multiplayer profile. */
export function MultiplayerGameSurface({
  gameSlug,
  src,
  title,
  attemptKey,
  frameClassName,
  frameStyle,
  iframeStyle,
  fallback,
  onRuntimeResolved,
}: MultiplayerGameSurfaceProps) {
  const [availability, setAvailability] = useState<
    MultiplayerGameAvailabilityResponse | "LOADING" | "ERROR"
  >("LOADING");
  const [room, setRoom] = useState<MultiplayerRoomResponse | null>(null);
  const [shareValue, setShareValue] = useState<string | undefined>();
  const [publicCode, setPublicCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "UNLISTED" | "PRIVATE">("PRIVATE");
  const [joinPolicy, setJoinPolicy] = useState<"OPEN" | "INVITE_ONLY">("OPEN");
  const [busy, setBusy] = useState<"CREATE" | "JOIN" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createIdempotencyRef = useRef(newIdempotencyKey());
  const inviteIdempotencyRef = useRef(newIdempotencyKey());

  const discover = useCallback(() => {
    let active = true;
    setAvailability("LOADING");
    setError(null);
    void fetchMultiplayerGameAvailability(gameSlug)
      .then((resolved) => {
        if (!active) return;
        setAvailability(resolved);
        if (resolved.status === "AVAILABLE") {
          const firstVisibility = resolved.profile.allowedVisibility[0];
          const firstJoinPolicy = resolved.profile.allowedJoinPolicies[0];
          if (!firstVisibility || !firstJoinPolicy) {
            setAvailability("ERROR");
            setError("서버가 안전한 방 접근 정책을 제공하지 않았습니다.");
            return;
          }
          onRuntimeResolved("ONLINE");
          setVisibility(
            resolved.profile.allowedVisibility.includes("PRIVATE") ? "PRIVATE" : firstVisibility,
          );
          setJoinPolicy(
            resolved.profile.allowedJoinPolicies.includes("OPEN") ? "OPEN" : firstJoinPolicy,
          );
        } else {
          onRuntimeResolved("LEGACY");
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setAvailability("ERROR");
        setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [gameSlug, onRuntimeResolved]);

  useEffect(() => {
    setRoom(null);
    setShareValue(undefined);
    return discover();
  }, [discover]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    setPublicCode(query.get("room") ?? "");
    setInviteToken(query.get("invite") ?? "");
  }, [gameSlug]);

  const createRoom = useCallback(async () => {
    if (
      availability === "LOADING" ||
      availability === "ERROR" ||
      availability.status !== "AVAILABLE"
    ) {
      return;
    }
    setBusy("CREATE");
    setError(null);
    try {
      const created = await createMultiplayerRoom({
        gameSlug,
        visibility,
        joinPolicy,
        idempotencyKey: createIdempotencyRef.current,
      });
      let nextShareValue = roomShareValue(created.instance.publicCode);
      if (joinPolicy === "INVITE_ONLY") {
        const invite = await createMultiplayerInvite({
          instanceId: created.instance.id,
          expectedGeneration: created.instance.generation,
          idempotencyKey: inviteIdempotencyRef.current,
        });
        nextShareValue = roomShareValue(created.instance.publicCode, invite.inviteToken);
      }
      setShareValue(nextShareValue);
      setRoom(created);
      createIdempotencyRef.current = newIdempotencyKey();
      inviteIdempotencyRef.current = newIdempotencyKey();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }, [availability, gameSlug, joinPolicy, visibility]);

  const joinRoom = useCallback(async () => {
    setBusy("JOIN");
    setError(null);
    try {
      const joined = await joinMultiplayerRoom({
        publicCode: publicCode.trim(),
        inviteToken: inviteToken.trim() || null,
      });
      setShareValue(roomShareValue(joined.instance.publicCode));
      setRoom(joined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }, [inviteToken, publicCode]);

  if (
    availability !== "LOADING" &&
    availability !== "ERROR" &&
    availability.status === "UNAVAILABLE"
  ) {
    return fallback;
  }
  if (room) {
    return (
      <MultiplayerIframeRuntime
        src={src}
        title={title}
        room={room}
        attemptKey={attemptKey}
        {...(frameClassName ? { frameClassName } : {})}
        {...(frameStyle ? { frameStyle } : {})}
        {...(iframeStyle ? { iframeStyle } : {})}
        {...(shareValue ? { shareValue } : {})}
        onExit={() => {
          setRoom(null);
          setShareValue(undefined);
        }}
      />
    );
  }

  const available =
    availability !== "LOADING" && availability !== "ERROR"
      ? (availability as AvailableMultiplayerGame)
      : null;
  return (
    <div
      className={`${frameClassName ?? ""} flex w-full items-center justify-center bg-[#09090b] p-5`}
      style={frameStyle}
    >
      <div className="w-full max-w-xl rounded-3xl border border-border bg-surface-raised p-6 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">
          OWOGG Multiplayer
        </p>
        <h3 className="mt-2 text-2xl font-black text-text-primary">온라인 경기</h3>
        {availability === "LOADING" ? (
          <p className="mt-4 text-sm text-text-secondary">
            멀티플레이 사용 가능 여부를 확인 중입니다.
          </p>
        ) : availability === "ERROR" ? (
          <div className="mt-4">
            <p role="alert" className="text-sm font-semibold text-accent-red">
              {error}
            </p>
            <button
              type="button"
              onClick={discover}
              className="mt-4 cursor-pointer rounded-xl bg-brand px-4 py-2 text-sm font-black text-white"
            >
              다시 확인
            </button>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-text-secondary">
              {available?.profile.minPlayers}~{available?.profile.maxPlayers}명 · 서버 권위형{" "}
              {available?.profile.resolvedClass}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-text-secondary">
                공개 범위
                <select
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as "PUBLIC" | "UNLISTED" | "PRIVATE")
                  }
                  className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary"
                >
                  {available?.profile.allowedVisibility.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-text-secondary">
                참가 방식
                <select
                  value={joinPolicy}
                  onChange={(event) => setJoinPolicy(event.target.value as "OPEN" | "INVITE_ONLY")}
                  className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary"
                >
                  {available?.profile.allowedJoinPolicies.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void createRoom()}
              className="mt-4 w-full cursor-pointer rounded-xl bg-brand py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "CREATE" ? "방 생성 중" : "새 방 만들기"}
            </button>

            <div className="my-5 flex items-center gap-3 text-xs font-bold text-text-muted">
              <span className="h-px flex-1 bg-border" />
              또는
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={publicCode}
                onChange={(event) => setPublicCode(event.target.value)}
                placeholder="방 코드"
                autoComplete="off"
                className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary"
              />
              <input
                value={inviteToken}
                onChange={(event) => setInviteToken(event.target.value)}
                placeholder="초대 토큰 (선택)"
                autoComplete="off"
                className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary"
              />
            </div>
            <button
              type="button"
              disabled={busy !== null || publicCode.trim().length === 0}
              onClick={() => void joinRoom()}
              className="mt-3 w-full cursor-pointer rounded-xl border border-border py-3 text-sm font-black text-text-primary hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "JOIN" ? "참가 중" : "방 참가하기"}
            </button>
            {error && (
              <p role="alert" className="mt-3 text-sm font-semibold text-accent-red">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
