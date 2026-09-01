import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../features/auth";
import { useI18n } from "../features/i18n/I18nContext";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  User,
  LogOut,
  ExternalLink,
  ArrowLeft,
  Link2,
  Unlink,
  Loader2,
  Settings as SettingsIcon,
  Eye,
  EyeOff,
  Video,
  CheckCircle2,
  Code2,
  Gamepad2,
  ShieldCheck,
  Image as ImageIcon,
} from "lucide-react";
import {
  fetchConnectedProviders,
  linkGoogleProvider,
  getDiscordLinkUrl,
  unlinkProvider,
} from "../features/auth/authService";
import {
  updateNicknameApi,
  updateAvatarPreferenceApi,
  updateCountryApi,
  updateVisibilityApi,
  fetchPublicProfileApi,
} from "../features/profile/api";
import {
  fetchMyStreamerProfileApi,
  fetchStreamerProvidersApi,
  disconnectStreamerPlatformApi,
  streamerVerificationUrl,
} from "../features/streamers/streamerApi";
import {
  STREAMER_UI_PLATFORM_LABELS,
  STREAMER_UI_PLATFORMS,
} from "../features/streamers/streamerPlatforms";
import type { StreamerUiPlatform } from "../features/streamers/streamerPlatforms";
import { fetchDevMe } from "../features/devApi";
import { COUNTRY_OPTIONS } from "../lib/countries";
import type {
  ConnectedProvider,
  SocialProvider,
  CreateMergeChallengeResponse,
  StreamerProfileDto,
  StreamerProvidersResponse,
  GameCreatorMeResponse,
} from "@owogg/contracts";
import { formatPublicUserTag } from "@owogg/core";
import { ApiClientError } from "../lib/api";
import { MergeModal } from "../components/ui/MergeModal";
import { PlatformIcon } from "../components/ui/PlatformIcon";

export function meta() {
  return [
    { title: "설정 | OwOGG" },
    {
      name: "description",
      content: "OwOGG 계정 정보, 연결된 로그인 계정, 공개 범위를 관리하세요.",
    },
  ];
}

/** /settings — the sensitive/account-management half of what used to be the combined
 * "내 프로필 & 기록" page. Everything display-oriented (level/XP, achievements, records,
 * favorites, recent plays) now lives on the unified public profile at /users/:id, which used
 * to duplicate most of this page. This page only ever concerns the account owner (no public
 * variant), so nothing here needs a visibility/privacy distinction of its own — except the two
 * toggles that control what the /users/:id side discloses. */
const ALL_PROVIDERS: SocialProvider[] = ["google", "discord"];

function providerLabel(provider: SocialProvider): string {
  return provider === "google" ? "Google" : "Discord";
}

export default function SettingsPage() {
  const { user, isAuthenticated, logout, openLoginModal, refreshUser, providerStatus } = useAuth();
  const { dict } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connected, setConnected] = useState<ConnectedProvider[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<SocialProvider | null>(null);
  const [mergeChallengeId, setMergeChallengeId] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [avatarBusyProvider, setAvatarBusyProvider] = useState<SocialProvider | null>(null);
  const [countryInput, setCountryInput] = useState("");
  const [countryBusy, setCountryBusy] = useState(false);
  const [countryError, setCountryError] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<{
    showFavorites: boolean;
    showRecentPlays: boolean;
  } | null>(null);
  const [visibilityBusyField, setVisibilityBusyField] = useState<
    "favorites" | "recentPlays" | null
  >(null);

  const [streamerProfile, setStreamerProfile] = useState<StreamerProfileDto | null>(null);
  const [busyStreamerPlatform, setBusyStreamerPlatform] = useState<StreamerUiPlatform | null>(null);
  const [streamerProviders, setStreamerProviders] = useState<StreamerProvidersResponse>({
    YOUTUBE: {
      configured: false,
      paused: false,
      verificationMethod: "OAUTH_REDIRECT",
      unavailableReason: null,
    },
    TWITCH: {
      configured: false,
      paused: false,
      verificationMethod: "OAUTH_REDIRECT",
      unavailableReason: null,
    },
    CHZZK: {
      configured: false,
      paused: false,
      verificationMethod: "OAUTH_REDIRECT",
      unavailableReason: null,
    },
    SOOP: {
      configured: false,
      paused: false,
      verificationMethod: "UNAVAILABLE",
      unavailableReason: "SECURE_OAUTH_CALLBACK_BINDING_UNAVAILABLE",
    },
  });

  // "게임 크리에이터" card — admin 또는 게임 크리에이터(승인/신청 가능/신청 이력)에게만 노출
  // (docs/GAME_CREATION_GUIDE.md §3.6, docs/AUTHORIZATION.md). Full upload/manage UI lives at
  // the dedicated /game-creator route now — this page only shows a pointer card.
  const [devMe, setDevMe] = useState<GameCreatorMeResponse | null>(null);

  const refreshStreamerProfile = useCallback(async () => {
    try {
      const res = await fetchMyStreamerProfileApi();
      setStreamerProfile(res.profile);
    } catch {
      setStreamerProfile(null);
    }
  }, []);

  const refreshStreamerProviders = useCallback(async () => {
    try {
      const res = await fetchStreamerProvidersApi();
      setStreamerProviders(res);
    } catch {
      // keep defaults
    }
  }, []);

  // Keep the settings inputs in sync with the latest saved user data (e.g. after a
  // successful update, or on first load) without clobbering an unrelated in-progress edit.
  useEffect(() => {
    if (user) {
      setNicknameInput(user.nickname);
      setCountryInput(user.country ?? "");
    }
  }, [user]);

  const refreshConnected = useCallback(async () => {
    try {
      const data = await fetchConnectedProviders();
      setConnected(data.providers);
    } catch {
      setConnected([]);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      void refreshConnected();
      void refreshStreamerProfile();
      void refreshStreamerProviders();
      // Reuses the public-profile endpoint (rather than a dedicated GET) to seed the current
      // toggle state — as the owner, the response always includes visibilitySettings.
      void fetchPublicProfileApi(user.id)
        .then((data) => setVisibility(data.visibilitySettings))
        .catch(() => setVisibility(null));
      // 게임 크리에이터 카드 gate — devMe stays null (card hidden) on any failure, including a
      // plain 401 for a user who was never authenticated in the first place.
      void fetchDevMe()
        .then(setDevMe)
        .catch(() => setDevMe(null));
    }
  }, [isAuthenticated, user, refreshConnected, refreshStreamerProfile, refreshStreamerProviders]);

  // Handle Discord link and Streamer verify redirect status params
  useEffect(() => {
    const linkStatus = searchParams.get("link_status");
    const challenge = searchParams.get("challenge");
    const streamerVerify = searchParams.get("streamer_verify");

    if (linkStatus) {
      if (linkStatus === "success") {
        setStatusMessage(dict.profile.linkSuccess);
        void refreshConnected();
        void refreshUser();
      } else if (linkStatus === "already") {
        setStatusMessage(dict.profile.alreadyLinkedAccount);
      } else if (linkStatus === "registered") {
        setStatusMessage(dict.profile.alreadyLinkedAccount);
      } else if (linkStatus === "conflict" && challenge) {
        setMergeChallengeId(challenge);
      } else if (linkStatus === "error") {
        setStatusMessage(dict.profile.linkError);
      }
      setSearchParams({}, { replace: true });
      return;
    }

    if (streamerVerify) {
      const channelName = searchParams.get("channel");
      if (streamerVerify === "success") {
        setStatusMessage(
          `${dict.profile.streamerVerifySuccess}${
            channelName ? ` (${decodeURIComponent(channelName)})` : ""
          }`,
        );
        void refreshStreamerProfile();
      } else if (streamerVerify === "conflict") {
        setStatusMessage(dict.profile.streamerVerifyConflict);
      } else if (streamerVerify === "platform_conflict") {
        setStatusMessage(dict.profile.streamerVerifyPlatformConflict);
      } else if (streamerVerify === "unconfigured") {
        setStatusMessage(dict.profile.streamerVerifyUnconfigured);
      } else if (streamerVerify === "paused") {
        setStatusMessage(dict.profile.streamerVerifyPaused);
      } else if (streamerVerify === "deferred") {
        setStatusMessage(dict.profile.streamerVerifyDeferred);
      } else if (streamerVerify === "unauthorized") {
        setStatusMessage(dict.profile.streamerVerifyUnauthorized);
      } else if (streamerVerify === "error") {
        setStatusMessage(dict.profile.streamerVerifyError);
      }
      setSearchParams({}, { replace: true });
    }
  }, [
    searchParams,
    refreshConnected,
    refreshStreamerProfile,
    refreshUser,
    setSearchParams,
    dict.profile,
  ]);

  const isConnected = (provider: SocialProvider) => connected.some((p) => p.provider === provider);

  const handleLinkGoogle = () => {
    if (busyProvider) return;
    const clientId = providerStatus.google.clientId;
    if (
      providerStatus.availability !== "ready" ||
      !clientId ||
      !providerStatus.google.configured ||
      !window.google?.accounts?.id
    ) {
      setStatusMessage(dict.profile.googleScriptNotReady);
      return;
    }
    setBusyProvider("google");
    const googleAuth = window.google.accounts.id;
    googleAuth.initialize({
      client_id: clientId,
      callback: async (response: { credential: string }) => {
        try {
          await linkGoogleProvider(response.credential);
          setStatusMessage(dict.profile.googleLinkSuccess);
          await Promise.all([refreshConnected(), refreshUser()]);
        } catch (err: unknown) {
          const code = err instanceof ApiClientError ? err.code : undefined;
          const data = err instanceof ApiClientError ? err.data : undefined;
          if (code === "ACCOUNT_ALREADY_LINKED" && data) {
            const merge = (data as { mergeChallenge?: CreateMergeChallengeResponse })
              .mergeChallenge;
            if (merge?.challengeId) {
              setMergeChallengeId(merge.challengeId);
            } else {
              setStatusMessage(dict.profile.googleAccountInUse);
            }
          } else if (code === "ACCOUNT_PREVIOUSLY_REGISTERED") {
            setStatusMessage(dict.profile.alreadyLinkedAccount);
          } else if (code === "PROVIDER_ALREADY_LINKED") {
            setStatusMessage(dict.profile.googleAlreadyLinked);
          } else {
            setStatusMessage(err instanceof Error ? err.message : dict.profile.googleLinkFailed);
          }
        } finally {
          setBusyProvider(null);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    googleAuth.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        const tempDiv = document.createElement("div");
        tempDiv.style.position = "fixed";
        tempDiv.style.top = "-9999px";
        document.body.appendChild(tempDiv);
        googleAuth.renderButton(tempDiv, { type: "icon", size: "large" });
        const btn = tempDiv.querySelector("div[role=button]") as HTMLElement | null;
        if (btn) btn.click();
        setTimeout(() => document.body.removeChild(tempDiv), 5000);
      }
    });
  };

  const handleLinkDiscord = () => {
    if (busyProvider) return;
    window.location.href = getDiscordLinkUrl();
  };

  const handleUnlink = async (provider: SocialProvider) => {
    if (busyProvider) return;
    setBusyProvider(provider);
    try {
      await unlinkProvider(provider);
      setStatusMessage(`${providerLabel(provider)} ${dict.profile.unlinkSuccessSuffix}`);
      await Promise.all([refreshConnected(), refreshUser()]);
    } catch (err: unknown) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      if (code === "LAST_AUTH_PROVIDER") {
        setStatusMessage(dict.profile.lastAuthProviderError);
      } else {
        setStatusMessage(err instanceof Error ? err.message : dict.profile.unlinkFailed);
      }
    } finally {
      setBusyProvider(null);
    }
  };

  const handleStreamerDisconnect = async (platform: StreamerUiPlatform) => {
    if (busyStreamerPlatform) return;
    if (!window.confirm(dict.profile.streamerUnlinkConfirm)) return;

    setBusyStreamerPlatform(platform);
    try {
      await disconnectStreamerPlatformApi(platform);
      await refreshStreamerProfile();
      setStatusMessage(dict.profile.streamerUnlinkSuccess);
    } catch (err: unknown) {
      setStatusMessage(
        err instanceof ApiClientError && err.detail
          ? err.detail
          : dict.profile.streamerUnlinkFailed,
      );
    } finally {
      setBusyStreamerPlatform(null);
    }
  };

  const handleMerged = async () => {
    setMergeChallengeId(null);
    setStatusMessage(dict.profile.mergeCompleted);
    // The current session may now resolve to the primary account or be invalidated (reverse merge).
    await refreshUser();
    await refreshConnected();
  };

  const handleUpdateNickname = async () => {
    if (!user || nicknameBusy) return;
    const trimmed = nicknameInput.trim();
    if (!trimmed || trimmed === user.nickname) return;

    setNicknameBusy(true);
    setNicknameError(null);
    try {
      await updateNicknameApi(trimmed);
      await refreshUser();
      setStatusMessage(dict.profile.nicknameUpdated);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        const data = err.data as { nextAllowedAt?: string } | undefined;
        if (err.code === "NICKNAME_COOLDOWN_ACTIVE" && data?.nextAllowedAt) {
          setNicknameError(
            `${dict.profile.nicknameCooldownPrefix} ${data.nextAllowedAt.split("T")[0]} ${dict.profile.nicknameCooldownSuffix}`,
          );
        } else {
          setNicknameError(err.detail || dict.profile.nicknameUpdateFailed);
        }
      } else {
        setNicknameError(dict.profile.nicknameUpdateFailed);
      }
    } finally {
      setNicknameBusy(false);
    }
  };

  const handleUpdateAvatar = async (provider: SocialProvider) => {
    if (avatarBusyProvider) return;
    setAvatarBusyProvider(provider);
    try {
      await updateAvatarPreferenceApi(provider);
      await Promise.all([refreshConnected(), refreshUser()]);
      setStatusMessage(dict.profile.avatarUpdated);
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === "AVATAR_UNAVAILABLE") {
        setStatusMessage(dict.profile.avatarUnavailable);
      } else {
        setStatusMessage(dict.profile.avatarUpdateFailed);
      }
    } finally {
      setAvatarBusyProvider(null);
    }
  };

  const handleUpdateCountry = async () => {
    if (!user || countryBusy) return;
    const nextCountry = countryInput || null;
    if (nextCountry === (user.country ?? null)) return;

    setCountryBusy(true);
    setCountryError(null);
    try {
      await updateCountryApi(nextCountry);
      await refreshUser();
      setStatusMessage(dict.profile.countryUpdated);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        const data = err.data as { nextAllowedAt?: string } | undefined;
        if (err.code === "COUNTRY_COOLDOWN_ACTIVE" && data?.nextAllowedAt) {
          setCountryError(
            `${dict.profile.countryCooldownPrefix} ${data.nextAllowedAt.split("T")[0]} ${dict.profile.countryCooldownSuffix}`,
          );
        } else {
          setCountryError(err.detail || dict.profile.countryUpdateFailed);
        }
      } else {
        setCountryError(dict.profile.countryUpdateFailed);
      }
    } finally {
      setCountryBusy(false);
    }
  };

  const handleToggleVisibility = async (field: "favorites" | "recentPlays") => {
    if (!visibility || visibilityBusyField) return;
    const next = {
      showFavorites: field === "favorites" ? !visibility.showFavorites : visibility.showFavorites,
      showRecentPlays:
        field === "recentPlays" ? !visibility.showRecentPlays : visibility.showRecentPlays,
    };
    setVisibilityBusyField(field);
    try {
      const res = await updateVisibilityApi(next.showFavorites, next.showRecentPlays);
      setVisibility({ showFavorites: res.showFavorites, showRecentPlays: res.showRecentPlays });
      setStatusMessage(dict.profile.visibilityUpdated);
    } catch {
      setStatusMessage(dict.profile.visibilityUpdateFailed);
    } finally {
      setVisibilityBusyField(null);
    }
  };

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-20 text-center gap-6 select-none">
        <div className="w-16 h-16 rounded-full bg-brand/10 text-brand flex items-center justify-center">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-text-primary">{dict.profile.loginRequiredTitle}</h2>
        <p className="text-sm text-text-secondary max-w-sm">{dict.profile.loginRequiredBody}</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-3.5 bg-brand text-white font-extrabold rounded-2xl shadow-xl shadow-brand/30 hover:scale-105 transition-all cursor-pointer"
        >
          {dict.profile.loginRequiredCta}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full px-4 md:px-8 py-8 gap-8 max-w-3xl mx-auto flex-1 select-none">
      {mergeChallengeId && (
        <MergeModal
          challengeId={mergeChallengeId}
          onClose={() => setMergeChallengeId(null)}
          onMerged={() => void handleMerged()}
        />
      )}

      <button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-xs font-bold text-text-muted hover:text-text-primary transition-colors cursor-pointer w-fit"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{dict.profile.backButton}</span>
      </button>

      {/* Identity header — just enough to confirm whose settings these are; the full display
          profile (avatar/level/records) lives at /users/:id, one tap away. */}
      <div className="w-full bg-surface-raised rounded-3xl border border-border p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-brand/20 text-brand font-black text-xl flex items-center justify-center border-2 border-brand/40 overflow-hidden shadow-md shrink-0">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.nickname}
                className="w-full h-full object-cover"
              />
            ) : (
              user.nickname.slice(0, 2)
            )}
          </div>

          <div className="flex flex-col gap-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start flex-wrap">
              <h1 className="text-xl font-black text-text-primary">
                {formatPublicUserTag(user.nickname, user.id)}
              </h1>
              {user.providers.map((p) => (
                <span
                  key={p}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-brand/10 text-brand border border-brand/20 uppercase"
                >
                  {p}
                </span>
              ))}
            </div>
            <p className="text-xs text-text-secondary">{user.email}</p>
            <p className="text-[11px] text-text-muted mt-1">
              {dict.profile.joinedLabel}: {user.created_at?.split("T")[0]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to={`/users/${user.id}`}
            className="flex items-center gap-2 px-6 py-2.5 bg-surface border border-border rounded-2xl font-bold text-xs text-text-secondary hover:text-text-primary hover:border-brand/40 transition-all whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-4 h-4" />
            <span>{dict.profile.viewProfileCta}</span>
          </Link>
          <button
            onClick={() => void logout()}
            className="flex items-center gap-2 px-6 py-2.5 bg-accent-red/10 text-accent-red border border-accent-red/30 rounded-2xl font-bold text-xs hover:bg-accent-red/20 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" />
            <span>{dict.profile.logout}</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="px-4 py-3 rounded-2xl bg-brand/10 border border-brand/30 text-brand text-xs font-semibold">
          {statusMessage}
          <button
            onClick={() => setStatusMessage(null)}
            className="ml-2 p-1 hover:bg-brand/20 rounded-full cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Nickname & country/region */}
      <div className="w-full bg-surface-raised rounded-3xl border border-border p-6 md:p-8 flex flex-col gap-6 shadow-xl">
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-brand" />
          <h2 className="text-xl font-bold text-text-primary">{dict.profile.pageTitle}</h2>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="nickname-input" className="text-xs font-bold text-text-muted">
            {dict.profile.nicknameLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="nickname-input"
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              maxLength={20}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-brand/50"
              placeholder={dict.profile.nicknamePlaceholder}
            />
            <button
              type="button"
              onClick={() => void handleUpdateNickname()}
              disabled={
                nicknameBusy || !nicknameInput.trim() || nicknameInput.trim() === user.nickname
              }
              className="flex items-center justify-center px-4 py-2.5 bg-brand text-white border border-brand rounded-xl font-bold text-xs hover:bg-brand-dark transition-all cursor-pointer disabled:opacity-50 shrink-0 min-w-16"
            >
              {nicknameBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                dict.profile.changeButton
              )}
            </button>
          </div>
          {nicknameError && (
            <p className="text-[11px] text-accent-red font-semibold">{nicknameError}</p>
          )}
          <p className="text-[11px] leading-relaxed text-text-muted">
            {dict.profile.nicknamePolicyHint}
          </p>
          <p className="text-xs font-bold text-text-secondary">
            {dict.profile.nicknamePreviewLabel}: {nicknameInput.trim() || user.nickname} #{user.id}
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 pt-5">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-brand" />
            <div>
              <div className="text-xs font-bold text-text-primary">{dict.profile.avatarTitle}</div>
              <div className="text-[11px] text-text-muted">{dict.profile.avatarSubtitle}</div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {connected.map((account) => {
              const selected = account.isAvatarSelected;
              const unavailable = !account.avatarUrl;
              return (
                <button
                  key={account.provider}
                  type="button"
                  onClick={() => void handleUpdateAvatar(account.provider)}
                  disabled={selected || unavailable || avatarBusyProvider !== null}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
                    selected
                      ? "border-brand bg-brand/10"
                      : "border-border bg-surface hover:border-brand/40"
                  } disabled:cursor-default disabled:opacity-70`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-xs font-black text-brand">
                    {account.avatarUrl ? (
                      <img
                        src={account.avatarUrl}
                        alt={`${providerLabel(account.provider)} avatar`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-text-primary">
                      {providerLabel(account.provider)}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {unavailable
                        ? dict.profile.avatarUnavailable
                        : selected
                          ? dict.profile.avatarSelected
                          : dict.profile.avatarUseButton}
                    </div>
                  </div>
                  {avatarBusyProvider === account.provider ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  ) : selected ? (
                    <CheckCircle2 className="h-4 w-4 text-brand" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="country-input" className="text-xs font-bold text-text-muted">
            {dict.profile.countryLabel}{" "}
            <span className="font-normal text-text-muted">{dict.profile.countryHint}</span>
          </label>
          <div className="flex gap-2">
            <select
              id="country-input"
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-brand/50"
            >
              <option value="">{dict.profile.countryNotSet}</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.labelKo}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleUpdateCountry()}
              disabled={countryBusy || countryInput === (user.country ?? "")}
              className="flex items-center justify-center px-4 py-2.5 bg-brand text-white border border-brand rounded-xl font-bold text-xs hover:bg-brand-dark transition-all cursor-pointer disabled:opacity-50 shrink-0 min-w-16"
            >
              {countryBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                dict.profile.changeButton
              )}
            </button>
          </div>
          {countryError && (
            <p className="text-[11px] text-accent-red font-semibold">{countryError}</p>
          )}
        </div>
      </div>

      {/* Public profile visibility */}
      <div className="w-full bg-surface-raised rounded-3xl border border-border p-6 md:p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-brand" />
            <h2 className="text-xl font-bold text-text-primary">{dict.profile.visibilityTitle}</h2>
          </div>
          <p className="text-xs text-text-muted">{dict.profile.visibilitySubtitle}</p>
        </div>

        {visibility && (
          <div className="flex flex-col divide-y divide-border/60">
            {[
              {
                field: "favorites" as const,
                label: dict.profile.visibilityFavoritesLabel,
                on: visibility.showFavorites,
              },
              {
                field: "recentPlays" as const,
                label: dict.profile.visibilityRecentPlaysLabel,
                on: visibility.showRecentPlays,
              },
            ].map((row) => (
              <div key={row.field} className="flex items-center justify-between py-3">
                <span className="text-sm font-bold text-text-primary">{row.label}</span>
                <button
                  type="button"
                  onClick={() => void handleToggleVisibility(row.field)}
                  disabled={visibilityBusyField !== null}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold border transition-all cursor-pointer disabled:opacity-50 ${
                    row.on
                      ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                      : "bg-surface text-text-muted border-border"
                  }`}
                >
                  {visibilityBusyField === row.field ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : row.on ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  {row.on
                    ? dict.profile.visibilityPublicOption
                    : dict.profile.visibilityPrivateOption}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connected login accounts */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-brand" />
          <h2 className="text-xl font-bold text-text-primary">
            {dict.profile.connectedAccountsTitle}
          </h2>
        </div>
        <div className="flex flex-col gap-3">
          {ALL_PROVIDERS.map((provider) => {
            const linked = isConnected(provider);
            return (
              <div
                key={provider}
                className="flex items-center justify-between p-4 rounded-2xl bg-surface-raised border border-border shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm text-text-primary">
                    {providerLabel(provider)}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${
                      linked
                        ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                        : "bg-surface text-text-muted border-border"
                    }`}
                  >
                    {linked ? dict.profile.linkedStatus : dict.profile.notLinkedStatus}
                  </span>
                </div>
                {linked ? (
                  <button
                    type="button"
                    onClick={() => void handleUnlink(provider)}
                    disabled={busyProvider === provider}
                    className="flex items-center gap-2 px-4 py-2 bg-accent-red/10 text-accent-red border border-accent-red/30 rounded-xl font-bold text-xs hover:bg-accent-red/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {busyProvider === provider ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Unlink className="w-3.5 h-3.5" />
                    )}
                    <span>{dict.profile.unlinkButton}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={provider === "google" ? handleLinkGoogle : handleLinkDiscord}
                    disabled={
                      busyProvider !== null ||
                      providerStatus.availability !== "ready" ||
                      (provider === "google" && !providerStatus.google.configured) ||
                      (provider === "discord" && !providerStatus.discord.configured)
                    }
                    className="flex items-center gap-2 px-4 py-2 bg-brand text-white border border-brand rounded-xl font-bold text-xs hover:bg-brand-dark transition-all cursor-pointer disabled:opacity-50"
                  >
                    {busyProvider === provider ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    <span>{dict.profile.linkButton}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Streamer Channel Ownership Verification — this is the STREAMER program (see
          docs/AUTHORIZATION.md): id="streamer-center" gives the profile dropdown's "스트리머 센터"
          entry a real anchor to deep-link to, since this program has no dedicated route of its
          own (base status has no application/approval step, so there was never a separate page
          to build one against — see myAccess.ts / packages/core/src/domain/gameCreator.ts). */}
      <div id="streamer-center" className="flex flex-col gap-4 scroll-mt-24">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Video className="w-5 h-5 text-brand" />
            <h2 className="text-xl font-bold text-text-primary">
              {dict.profile.streamerVerificationTitle}
            </h2>
          </div>
          <p className="text-xs text-text-muted">{dict.profile.streamerVerificationSubtitle}</p>
        </div>

        <div className="flex flex-col gap-3">
          {STREAMER_UI_PLATFORMS.map((platform) => {
            const platformAccount = streamerProfile?.platformAccounts?.find(
              (account) => account.platform === platform,
            );
            const ownershipVerified = Boolean(
              platformAccount?.verificationStatus === "VERIFIED" &&
              platformAccount.ownershipExpiresAt &&
              new Date(platformAccount.ownershipExpiresAt).getTime() > Date.now(),
            );
            const provider = streamerProviders[platform];
            const canConnect =
              provider.verificationMethod === "OAUTH_REDIRECT" &&
              provider.configured &&
              !provider.paused;
            const unavailableLabel =
              provider.verificationMethod === "UNAVAILABLE"
                ? dict.profile.streamerVerifyDeferred
                : provider.paused
                  ? dict.profile.streamerVerifyPaused
                  : dict.profile.verifyUnavailable;
            const approvalLabel =
              platformAccount?.approvalStatus === "APPROVED"
                ? dict.profile.streamerApproved
                : platformAccount?.approvalStatus === "REJECTED"
                  ? dict.profile.streamerRejected
                  : dict.profile.streamerApprovalPending;
            const approvalClass =
              platformAccount?.approvalStatus === "APPROVED"
                ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                : platformAccount?.approvalStatus === "REJECTED"
                  ? "bg-accent-red/10 text-accent-red border-accent-red/30"
                  : "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30";

            return (
              <div
                key={platform}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-4 shadow-md sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <PlatformIcon platform={platform} size={34} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text-primary">
                        {STREAMER_UI_PLATFORM_LABELS[platform]}
                      </span>
                      {ownershipVerified ? (
                        <span className="flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2.5 py-0.5 text-[10px] font-extrabold text-accent-green">
                          <CheckCircle2 className="h-3 w-3 text-accent-green" />
                          {dict.profile.ownershipVerified}
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[10px] font-extrabold text-text-muted">
                          {dict.profile.unverified}
                        </span>
                      )}
                      {platformAccount && (
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold ${approvalClass}`}
                        >
                          {approvalLabel}
                        </span>
                      )}
                    </div>

                    {platformAccount ? (
                      <div className="mt-1.5 min-w-0">
                        <a
                          href={platformAccount.channelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs font-bold text-brand-light hover:underline"
                        >
                          {platformAccount.channelName}{" "}
                          {platformAccount.channelHandle
                            ? `(${platformAccount.channelHandle})`
                            : ""}
                        </a>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-muted">
                          {ownershipVerified && <span>{dict.profile.verifiedConfirmedText}</span>}
                          {/* audienceCount === null means UNKNOWN (never obtained via official
                              API) — never rendered as 0; the value is simply omitted. */}
                          {platformAccount.audienceCount !== null && (
                            <span>
                              {dict.profile.audienceCountLabel}{" "}
                              {platformAccount.audienceCount.toLocaleString()}
                              {dict.profile.audienceUnit}
                              {platformAccount.metricsSyncedAt
                                ? ` ${dict.profile.metricsSyncedPrefix} ${platformAccount.metricsSyncedAt.split("T")[0]}`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-text-muted">
                        {dict.profile.notLinkedStatus}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                  {!ownershipVerified && canConnect ? (
                    <a
                      href={streamerVerificationUrl(platform)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand bg-brand px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-brand-dark sm:w-auto"
                    >
                      <Video className="h-3.5 w-3.5" />
                      <span>{dict.profile.verifyChannelCta}</span>
                    </a>
                  ) : !ownershipVerified && !platformAccount ? (
                    <div className="w-full rounded-xl border border-border bg-surface px-4 py-2 text-center text-xs font-bold text-text-muted sm:w-auto">
                      {unavailableLabel}
                    </div>
                  ) : null}
                  {platformAccount && (
                    <button
                      type="button"
                      onClick={() => void handleStreamerDisconnect(platform)}
                      disabled={busyStreamerPlatform !== null}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-2 text-xs font-bold text-accent-red transition-colors hover:bg-accent-red/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      {busyStreamerPlatform === platform ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unlink className="h-3.5 w-3.5" />
                      )}
                      {dict.profile.unlinkButton}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] leading-5 text-text-muted">{dict.profile.streamerApprovalHint}</p>
      </div>

      {/* 게임 크리에이터 — 승인/신청 가능/신청 이력이 있거나 admin인 사용자에게만 노출. 실제
          업로드/관리 도구는 전용 페이지(/game-creator)로 이동했다 — 여기는 안내 카드만.
          GAME_CREATOR는 Staff Role이 아니라 Program/Entitlement (docs/AUTHORIZATION.md). */}
      {devMe && (devMe.hasAccess || devMe.canApply || devMe.latestApplication || devMe.isAdmin) && (
        <div className="flex flex-col gap-4 rounded-3xl border border-border bg-surface-raised p-6 shadow-xl md:p-8">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-brand" />
              <h2 className="text-xl font-bold text-text-primary">게임 크리에이터</h2>
            </div>
            <p className="text-xs text-text-muted">
              샌드박스 게임 업로드/신청/관리는 전용 페이지에서 진행합니다.
              {devMe.latestApplication?.status === "PENDING" && " 현재 신청이 심사 대기 중입니다."}
              {devMe.latestApplication?.status === "REJECTED" &&
                " 지난 신청이 거절되었습니다 — 다시 신청할 수 있습니다."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(devMe.hasAccess || devMe.canApply || devMe.latestApplication) && (
              <Link
                to="/game-creator"
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
              >
                <Gamepad2 className="h-3.5 w-3.5" />
                {devMe.hasAccess
                  ? "게임 크리에이터 센터로 이동"
                  : "게임 크리에이터 신청/센터로 이동"}
              </Link>
            )}
            {devMe.isAdmin && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> 관리자 센터로 이동
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
