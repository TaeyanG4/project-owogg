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
  MultiplayerRoomPlayer,
  MultiplayerRoomResponse,
} from "@owogg/contracts";
import { gameVersionPlayUrl } from "../../../lib/api/config";
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
  readonly title: string;
  readonly attemptKey: number;
  readonly frameClassName?: string;
  readonly frameStyle?: CSSProperties;
  readonly iframeStyle?: CSSProperties;
  readonly fallback: ReactNode;
  readonly viewer: {
    readonly userId: number;
    readonly nickname: string;
    readonly avatarUrl: string | null;
  } | null;
  readonly onRuntimeResolved: (mode: MultiplayerRuntimeResolution) => void;
  readonly initialAvailability?: Extract<
    MultiplayerGameAvailabilityResponse,
    { readonly status: "AVAILABLE" }
  >;
  readonly onExitToModeSelection?: () => void;
  /** Internal admin testers may need to inspect long diagnostics. Normal managed game surfaces
   * remain viewport-fitted and keep their nested document scrollbar disabled. */
  readonly allowDocumentScrolling?: boolean;
}

export function supportsPrivateOpenRoomLauncher(
  availability: MultiplayerGameAvailabilityResponse,
): availability is Extract<MultiplayerGameAvailabilityResponse, { readonly status: "AVAILABLE" }> {
  return (
    availability.status === "AVAILABLE" &&
    availability.profile.allowedVisibility.includes("PRIVATE") &&
    availability.profile.allowedJoinPolicies.includes("OPEN")
  );
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
const GAME_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MULTIPLAYER_RESUME_STORAGE_PREFIX = "owogg_multiplayer_resume_v1";

interface MultiplayerResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserMultiplayerResumeStorage(): MultiplayerResumeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function multiplayerResumeStorageKey(gameSlug: string, userId: number): string | null {
  if (!GAME_SLUG_PATTERN.test(gameSlug) || !Number.isSafeInteger(userId) || userId < 1) return null;
  return `${MULTIPLAYER_RESUME_STORAGE_PREFIX}:${userId}:${gameSlug}`;
}

export function readMultiplayerRoomResumeValue(
  storage: MultiplayerResumeStorage,
  gameSlug: string,
  userId: number,
): string {
  const key = multiplayerResumeStorageKey(gameSlug, userId);
  if (!key) return "";
  try {
    const raw = storage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { version?: unknown; publicCode?: unknown };
    return parsed.version === 1 &&
      typeof parsed.publicCode === "string" &&
      PUBLIC_ROOM_CODE_PATTERN.test(parsed.publicCode)
      ? parsed.publicCode
      : "";
  } catch {
    return "";
  }
}

export function writeMultiplayerRoomResumeValue(
  storage: MultiplayerResumeStorage,
  gameSlug: string,
  userId: number,
  publicCode: string,
): boolean {
  const key = multiplayerResumeStorageKey(gameSlug, userId);
  if (!key || !PUBLIC_ROOM_CODE_PATTERN.test(publicCode)) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, publicCode }));
    return true;
  } catch {
    return false;
  }
}

export function clearMultiplayerRoomResumeValue(
  storage: MultiplayerResumeStorage,
  gameSlug: string,
  userId: number,
): void {
  const key = multiplayerResumeStorageKey(gameSlug, userId);
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in private/restricted browser modes. In-memory play still works.
  }
}

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

/** Accepts a room-code link, a plain code, and an optional two-part invite value. */
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

interface InitialLobbyRoster {
  readonly instanceId: string;
  readonly generation: number;
  readonly players: readonly MultiplayerRoomPlayer[];
}

/** Discovery + room control UI shared by every approved multiplayer profile. */
export function MultiplayerGameSurface({
  gameSlug,
  title,
  attemptKey,
  frameClassName,
  frameStyle,
  iframeStyle,
  fallback,
  viewer,
  onRuntimeResolved,
  initialAvailability,
  onExitToModeSelection,
  allowDocumentScrolling = false,
}: MultiplayerGameSurfaceProps) {
  const [availability, setAvailability] = useState<
    MultiplayerGameAvailabilityResponse | "LOADING" | "ERROR"
  >("LOADING");
  const [room, setRoom] = useState<MultiplayerRoomResponse | null>(null);
  const [initialRoster, setInitialRoster] = useState<InitialLobbyRoster | null>(null);
  const [shareValue, setShareValue] = useState<string | undefined>();
  const [publicCode, setPublicCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [busy, setBusy] = useState<"CREATE" | "JOIN" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createIdempotencyRef = useRef(newIdempotencyKey());
  const pendingAutoJoinRef = useRef<string | null>(null);
  const viewerUserId = viewer?.userId ?? null;

  const rememberRoom = useCallback(
    (nextPublicCode: string) => {
      if (viewerUserId === null) return;
      const storage = browserMultiplayerResumeStorage();
      if (storage) {
        writeMultiplayerRoomResumeValue(storage, gameSlug, viewerUserId, nextPublicCode);
      }
    },
    [gameSlug, viewerUserId],
  );

  const forgetRoom = useCallback(() => {
    if (viewerUserId === null) return;
    const storage = browserMultiplayerResumeStorage();
    if (storage) clearMultiplayerRoomResumeValue(storage, gameSlug, viewerUserId);
  }, [gameSlug, viewerUserId]);

  const discover = useCallback(() => {
    let active = true;
    setAvailability("LOADING");
    setError(null);
    void fetchMultiplayerGameAvailability(gameSlug)
      .then((resolved) => {
        if (!active) return;
        setAvailability(resolved);
        if (resolved.status === "AVAILABLE") {
          if (!supportsPrivateOpenRoomLauncher(resolved)) {
            setAvailability("ERROR");
            setError("현재 승인된 멀티플레이 프로필은 코드 방 입장을 지원하지 않습니다.");
            return;
          }
          onRuntimeResolved("ONLINE");
        } else {
          onRuntimeResolved("GENERIC");
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
    setInitialRoster(null);
    setShareValue(undefined);
    if (initialAvailability) {
      if (!supportsPrivateOpenRoomLauncher(initialAvailability)) {
        setAvailability("ERROR");
        setError("현재 승인된 멀티플레이 프로필은 코드 방 입장을 지원하지 않습니다.");
        return;
      }
      setAvailability(initialAvailability);
      setError(null);
      onRuntimeResolved("ONLINE");
      return;
    }
    return discover();
  }, [discover, initialAvailability, onRuntimeResolved]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sharedRoom = readMultiplayerRoomShareValue(window.location.href);
    const storage = browserMultiplayerResumeStorage();
    const resumePublicCode =
      !PUBLIC_ROOM_CODE_PATTERN.test(sharedRoom.publicCode) &&
      viewerUserId !== null &&
      storage !== null
        ? readMultiplayerRoomResumeValue(storage, gameSlug, viewerUserId)
        : "";
    const nextPublicCode = sharedRoom.publicCode || resumePublicCode;
    const nextInviteToken = sharedRoom.publicCode ? sharedRoom.inviteToken : "";
    pendingAutoJoinRef.current = PUBLIC_ROOM_CODE_PATTERN.test(nextPublicCode)
      ? `${nextPublicCode}\u0000${nextInviteToken}`
      : null;
    setPublicCode(nextPublicCode);
    setInviteToken(nextInviteToken);
  }, [gameSlug, viewerUserId]);

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
      setInitialRoster({
        instanceId: created.instance.id,
        generation: created.instance.generation,
        players: created.players,
      });
      setRoom(created);
      rememberRoom(created.instance.publicCode);
      createIdempotencyRef.current = newIdempotencyKey();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }, [availability, gameSlug, rememberRoom]);

  const joinRoom = useCallback(
    async (automaticResume = false) => {
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
        setInitialRoster({
          instanceId: joined.instance.id,
          generation: joined.instance.generation,
          players: joined.players,
        });
        setRoom(joined);
        rememberRoom(joined.instance.publicCode);
        if (typeof window !== "undefined") {
          window.history.replaceState(
            window.history.state,
            "",
            stripMultiplayerRoomCredentials(window.location.href),
          );
        }
      } catch (reason) {
        if (automaticResume) forgetRoom();
        setError(errorMessage(reason));
      } finally {
        setBusy(null);
      }
    },
    [forgetRoom, inviteToken, publicCode, rememberRoom],
  );

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
    void joinRoom(true);
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
          {...(initialRoster?.instanceId === room.instance.id &&
          initialRoster.generation === room.instance.generation
            ? { initialPlayers: initialRoster.players }
            : {})}
          {...(frameClassName ? { frameClassName } : {})}
          {...(frameStyle ? { frameStyle } : {})}
          onPlayersChange={(players) => {
            setInitialRoster({
              instanceId: room.instance.id,
              generation: room.instance.generation,
              players,
            });
          }}
          onRoomChange={setRoom}
          onExit={() => {
            forgetRoom();
            setRoom(null);
            setInitialRoster(null);
            setShareValue(undefined);
          }}
        />
      );
    }
    return (
      <MultiplayerIframeRuntime
        src={gameVersionPlayUrl(room.instance.gameId, room.instance.gameVersionId)}
        title={title}
        room={room}
        attemptKey={attemptKey}
        {...(frameClassName ? { frameClassName } : {})}
        {...(frameStyle ? { frameStyle } : {})}
        {...(iframeStyle ? { iframeStyle } : {})}
        {...(shareValue ? { shareValue } : {})}
        {...(allowDocumentScrolling ? { allowDocumentScrolling: true } : {})}
        {...(initialRoster?.instanceId === room.instance.id &&
        initialRoster.generation === room.instance.generation
          ? { initialPlayers: initialRoster.players }
          : {})}
        onExit={() => {
          forgetRoom();
          setRoom(null);
          setInitialRoster(null);
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
        {onExitToModeSelection && (
          <button
            type="button"
            onClick={onExitToModeSelection}
            className="mt-3 cursor-pointer text-xs font-bold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
          >
            게임 모드 선택으로 돌아가기
          </button>
        )}
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
