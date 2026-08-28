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
import { MultiplayerRoomLobby } from "./MultiplayerRoomLobby";
import { primeMultiplayerLobbySound } from "./multiplayerLobbySound";
import {
  createMultiplayerRoom,
  fetchMultiplayerGameAvailability,
  joinMultiplayerRoom,
} from "./multiplayerRoomApi";
import type { MultiplayerRuntimeResolution } from "./multiplayerRuntimeResolution";

export interface MultiplayerGameSurfaceProps {
  readonly gameSlug: string;
  readonly src: string;
  readonly title: string;
  readonly attemptKey: number;
  readonly frameClassName?: string;
  readonly frameStyle?: CSSProperties;
  readonly iframeStyle?: CSSProperties;
  readonly fallback: ReactNode;
  readonly viewer: {
    readonly nickname: string;
    readonly avatarUrl: string | null;
  } | null;
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

const PUBLIC_ROOM_CODE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Keeps the invite credential in parent UI only while producing the one-click URL another player
 * can open. The fragment is never sent in an HTTP request, so the sandbox, origin server, CDN,
 * and access logs receive neither this URL credential nor the token. */
export function buildMultiplayerRoomShareValue(
  pageUrl: string,
  publicCode: string,
  inviteToken?: string,
): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.delete("room");
    url.searchParams.delete("invite");
    const fragment = new URLSearchParams({ room: publicCode });
    if (inviteToken) fragment.set("invite", inviteToken);
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return inviteToken ? `${publicCode}\n${inviteToken}` : publicCode;
  }
}

export function readMultiplayerRoomShareValue(pageUrl: string): {
  readonly publicCode: string;
  readonly inviteToken: string;
} {
  try {
    const url = new URL(pageUrl);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const source = fragment.has("room") || fragment.has("invite") ? fragment : url.searchParams;
    return {
      publicCode: source.get("room") ?? "",
      inviteToken: source.get("invite") ?? "",
    };
  } catch {
    return { publicCode: "", inviteToken: "" };
  }
}

/** Accepts a room-code link, a plain code, and historical two-part invite values. New official
 * Omok rooms need only the code; the hidden invite value is retained solely so an already-created
 * legacy Staging room can still be consumed during the rollout. */
export function parseMultiplayerRoomJoinValue(value: string): {
  readonly publicCode: string;
  readonly inviteToken: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const shared = readMultiplayerRoomShareValue(trimmed);
  if (PUBLIC_ROOM_CODE_PATTERN.test(shared.publicCode)) {
    return shared;
  }

  if (PUBLIC_ROOM_CODE_PATTERN.test(trimmed)) {
    return { publicCode: trimmed, inviteToken: "" };
  }

  const [publicCode, inviteToken, ...rest] = trimmed.split(/\s+/);
  if (
    rest.length === 0 &&
    publicCode !== undefined &&
    inviteToken !== undefined &&
    PUBLIC_ROOM_CODE_PATTERN.test(publicCode) &&
    INVITE_TOKEN_PATTERN.test(inviteToken)
  ) {
    return { publicCode, inviteToken };
  }
  return null;
}

export function stripMultiplayerRoomCredentials(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.delete("room");
    url.searchParams.delete("invite");
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.delete("room");
    fragment.delete("invite");
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return pageUrl;
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
  viewer,
  onRuntimeResolved,
}: MultiplayerGameSurfaceProps) {
  const [availability, setAvailability] = useState<
    MultiplayerGameAvailabilityResponse | "LOADING" | "ERROR"
  >("LOADING");
  const [room, setRoom] = useState<MultiplayerRoomResponse | null>(null);
  const [shareValue, setShareValue] = useState<string | undefined>();
  const [publicCode, setPublicCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [busy, setBusy] = useState<"CREATE" | "JOIN" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createIdempotencyRef = useRef(newIdempotencyKey());
  const pendingAutoJoinRef = useRef<string | null>(null);

  const discover = useCallback(() => {
    let active = true;
    setAvailability("LOADING");
    setError(null);
    void fetchMultiplayerGameAvailability(gameSlug)
      .then((resolved) => {
        if (!active) return;
        setAvailability(resolved);
        if (resolved.status === "AVAILABLE") {
          if (
            !resolved.profile.allowedVisibility.includes("PRIVATE") ||
            !resolved.profile.allowedJoinPolicies.includes("OPEN")
          ) {
            setAvailability("ERROR");
            setError("관리자 센터에서 공식 오목을 코드 참가 방식으로 갱신해 주세요.");
            return;
          }
          onRuntimeResolved("ONLINE");
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
    const sharedRoom = readMultiplayerRoomShareValue(window.location.href);
    pendingAutoJoinRef.current = PUBLIC_ROOM_CODE_PATTERN.test(sharedRoom.publicCode)
      ? `${sharedRoom.publicCode}\u0000${sharedRoom.inviteToken}`
      : null;
    setPublicCode(sharedRoom.publicCode);
    setInviteToken(sharedRoom.inviteToken);
  }, [gameSlug]);

  const updateJoinEntry = useCallback((value: string) => {
    const parsed = parseMultiplayerRoomJoinValue(value);
    if (parsed) {
      setPublicCode(parsed.publicCode);
      setInviteToken(parsed.inviteToken);
      setError(null);
      return;
    }
    setPublicCode(value);
  }, []);

  const createRoom = useCallback(async () => {
    if (
      availability === "LOADING" ||
      availability === "ERROR" ||
      availability.status !== "AVAILABLE"
    ) {
      return;
    }
    primeMultiplayerLobbySound();
    setBusy("CREATE");
    setError(null);
    try {
      const created = await createMultiplayerRoom({
        gameSlug,
        visibility: "PRIVATE",
        joinPolicy: "OPEN",
        idempotencyKey: createIdempotencyRef.current,
      });
      setShareValue(roomShareValue(created.instance.publicCode));
      setRoom(created);
      createIdempotencyRef.current = newIdempotencyKey();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }, [availability, gameSlug]);

  const joinRoom = useCallback(async () => {
    primeMultiplayerLobbySound();
    const normalizedPublicCode = publicCode.trim();
    const normalizedInviteToken = inviteToken.trim();
    setBusy("JOIN");
    setError(null);
    try {
      const joined = await joinMultiplayerRoom({
        publicCode: normalizedPublicCode,
        inviteToken: normalizedInviteToken || null,
      });
      setShareValue(roomShareValue(joined.instance.publicCode));
      setRoom(joined);
      if (typeof window !== "undefined") {
        window.history.replaceState(
          window.history.state,
          "",
          stripMultiplayerRoomCredentials(window.location.href),
        );
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }, [inviteToken, publicCode]);

  useEffect(() => {
    if (
      room ||
      busy !== null ||
      availability === "LOADING" ||
      availability === "ERROR" ||
      availability.status !== "AVAILABLE"
    ) {
      return;
    }
    const pending = pendingAutoJoinRef.current;
    if (pending !== `${publicCode}\u0000${inviteToken}`) return;
    pendingAutoJoinRef.current = null;
    void joinRoom();
  }, [availability, busy, inviteToken, joinRoom, publicCode, room]);

  if (
    availability !== "LOADING" &&
    availability !== "ERROR" &&
    availability.status === "UNAVAILABLE"
  ) {
    return fallback;
  }
  if (room) {
    if (room.instance.status !== "ACTIVE" && room.instance.status !== "CLOSING") {
      const minPlayers =
        availability !== "LOADING" &&
        availability !== "ERROR" &&
        availability.status === "AVAILABLE"
          ? availability.profile.minPlayers
          : 2;
      return (
        <MultiplayerRoomLobby
          key={`${room.instance.id}:${room.instance.generation}`}
          title={title}
          room={room}
          minPlayers={minPlayers}
          shareValue={shareValue ?? roomShareValue(room.instance.publicCode)}
          viewer={viewer}
          {...(frameClassName ? { frameClassName } : {})}
          {...(frameStyle ? { frameStyle } : {})}
          onRoomChange={setRoom}
          onExit={() => {
            setRoom(null);
            setShareValue(undefined);
          }}
        />
      );
    }
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
        onRoomChange={setRoom}
        onExit={() => {
          setRoom(null);
          setShareValue(undefined);
        }}
      />
    );
  }

  return (
    <div
      className={`${frameClassName ?? ""} flex w-full items-center justify-center bg-[#09090b] p-5`}
      style={frameStyle}
    >
      <div className="w-full max-w-xl rounded-3xl border border-border bg-surface-raised p-6 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">
          OWOGG Multiplayer
        </p>
        <h3 className="mt-2 text-2xl font-black text-text-primary">{title}</h3>
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
              새 방을 만들거나 받은 링크와 방 코드로 바로 참가하세요.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void createRoom()}
              className="mt-5 w-full cursor-pointer rounded-xl bg-brand py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "CREATE" ? "방 생성 중" : "새 방 만들기"}
            </button>

            <div className="my-5 flex items-center gap-3 text-xs font-bold text-text-muted">
              <span className="h-px flex-1 bg-border" />
              또는
              <span className="h-px flex-1 bg-border" />
            </div>
            <label className="block text-xs font-bold text-text-secondary">
              초대 링크 또는 방 코드
              <input
                value={publicCode}
                onChange={(event) => updateJoinEntry(event.target.value)}
                placeholder="링크를 붙여넣거나 방 코드를 입력하세요"
                autoComplete="off"
                className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary"
              />
            </label>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              비공개 방은 목록에 노출되지 않습니다. 받은 링크나 방 코드만 입력하면 참가할 수
              있습니다.
            </p>
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
