import { useEffect, useRef, useState } from "react";
import { X, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../../features/auth";
import { useI18n } from "../../features/i18n/I18nContext";

export function LoginModal() {
  const {
    isLoginModalOpen,
    closeLoginModal,
    loginWithGoogleCode,
    loginWithDiscord,
    providerStatus,
    error,
    clearError,
    refreshUser,
  } = useAuth();
  const { dict } = useI18n();

  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isDiscordLoading, setIsDiscordLoading] = useState(false);
  const [googleCodeClientReady, setGoogleCodeClientReady] = useState(false);
  const [googleButtonError, setGoogleButtonError] = useState<string | null>(null);
  const googleCodeClientRef = useRef<{ requestCode: () => void } | null>(null);

  const googleClientId =
    providerStatus.google.clientId ||
    ((import.meta as unknown as { env?: { VITE_GOOGLE_CLIENT_ID?: string } }).env
      ?.VITE_GOOGLE_CLIENT_ID ??
      "");

  useEffect(() => {
    googleCodeClientRef.current = null;
    setGoogleCodeClientReady(false);
    setGoogleButtonError(null);
    if (
      !isLoginModalOpen ||
      providerStatus.availability !== "ready" ||
      !providerStatus.google.configured ||
      !googleClientId
    ) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryInitialize = (attemptsLeft: number) => {
      if (cancelled) return;
      const googleOAuth = window.google?.accounts?.oauth2;
      if (!googleOAuth) {
        if (attemptsLeft <= 0) {
          setGoogleButtonError(
            "Google 로그인 기능을 불러오지 못했습니다. 페이지를 새로고침해주세요.",
          );
          return;
        }
        timer = setTimeout(() => tryInitialize(attemptsLeft - 1), 150);
        return;
      }

      try {
        googleCodeClientRef.current = googleOAuth.initCodeClient({
          client_id: googleClientId,
          scope: "openid email profile",
          ux_mode: "popup",
          include_granted_scopes: false,
          select_account: true,
          callback: (response) => {
            if (cancelled) return;
            if (response.error || !response.code) {
              setIsGoogleLoading(false);
              setGoogleButtonError("Google 인증 응답을 확인하지 못했습니다. 다시 시도해주세요.");
              return;
            }
            void loginWithGoogleCode(response.code).finally(() => {
              if (!cancelled) setIsGoogleLoading(false);
            });
          },
          error_callback: (popupError) => {
            if (cancelled) return;
            setIsGoogleLoading(false);
            if (popupError.type !== "popup_closed") {
              setGoogleButtonError(
                popupError.type === "popup_failed_to_open"
                  ? "Google 로그인 팝업을 열지 못했습니다. 팝업 차단 설정을 확인해주세요."
                  : "Google 로그인을 시작하지 못했습니다. 다시 시도해주세요.",
              );
            }
          },
        });
        setGoogleCodeClientReady(true);
      } catch {
        setGoogleButtonError(
          "Google 로그인 기능을 초기화하지 못했습니다. 페이지를 새로고침해주세요.",
        );
      }
    };

    tryInitialize(60);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      googleCodeClientRef.current = null;
    };
  }, [
    googleClientId,
    isLoginModalOpen,
    loginWithGoogleCode,
    providerStatus.availability,
    providerStatus.google.configured,
  ]);

  if (!isLoginModalOpen) return null;

  const handleGoogleLogin = () => {
    if (isGoogleLoading || isDiscordLoading || !googleCodeClientRef.current) return;
    setGoogleButtonError(null);
    setIsGoogleLoading(true);
    try {
      googleCodeClientRef.current.requestCode();
    } catch {
      setIsGoogleLoading(false);
      setGoogleButtonError("Google 로그인을 시작하지 못했습니다. 다시 시도해주세요.");
    }
  };

  const handleDiscordLogin = () => {
    if (isGoogleLoading || isDiscordLoading) return;
    setIsDiscordLoading(true);
    loginWithDiscord();
    setTimeout(() => setIsDiscordLoading(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-md bg-surface-raised border border-border rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 animate-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={closeLoginModal}
          className="absolute top-5 right-5 p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors cursor-pointer"
          aria-label={dict.loginModal.close}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title & Header */}
        <div className="flex flex-col gap-2 text-center items-center">
          <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mb-1">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-extrabold text-text-primary">{dict.loginModal.title}</h2>
          <p className="text-xs text-text-secondary">{dict.loginModal.subtitle}</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button
              onClick={clearError}
              className="ml-auto p-1 hover:bg-accent-red/20 rounded-full cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Login Buttons Stack */}
        <div className="flex flex-col gap-3.5 w-full">
          {providerStatus.availability !== "ready" && (
            <div className="flex items-center justify-center gap-2 text-[11px] text-text-muted text-center font-medium">
              {providerStatus.availability === "loading" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{dict.loginModal.providerChecking}</span>
                </>
              ) : (
                <>
                  <span>{dict.loginModal.providerUnavailable}</span>
                  <button
                    type="button"
                    onClick={() => void refreshUser()}
                    className="text-brand-light hover:text-brand font-bold underline underline-offset-2 cursor-pointer"
                  >
                    {dict.loginModal.retry}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Google Login Button */}
          <div className="flex flex-col gap-1 w-full">
            <button
              onClick={handleGoogleLogin}
              disabled={
                isGoogleLoading ||
                isDiscordLoading ||
                !googleCodeClientReady ||
                providerStatus.availability !== "ready" ||
                !providerStatus.google.configured
              }
              className="flex items-center justify-center gap-3 w-full py-4 px-4 bg-white hover:bg-slate-100 text-slate-900 font-extrabold rounded-2xl transition-all shadow-lg hover:scale-[1.02] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isGoogleLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>
                {isGoogleLoading ? dict.loginModal.googleLoading : dict.loginModal.googleButton}
              </span>
            </button>
            {googleButtonError && (
              <span className="text-[11px] text-accent-red text-center font-semibold">
                {googleButtonError}
              </span>
            )}
            {providerStatus.availability === "ready" && !providerStatus.google.configured && (
              <span className="text-[11px] text-text-muted text-center font-medium">
                {dict.loginModal.googleUnconfigured}
              </span>
            )}
          </div>

          {/* Discord Login Button */}
          <div className="flex flex-col gap-1 w-full">
            <button
              onClick={handleDiscordLogin}
              disabled={
                isGoogleLoading ||
                isDiscordLoading ||
                providerStatus.availability !== "ready" ||
                !providerStatus.discord.configured
              }
              className="flex items-center justify-center gap-3 w-full py-4 px-4 bg-[#5865F2] hover:bg-[#4752C4] text-white font-extrabold rounded-2xl transition-all shadow-lg hover:scale-[1.02] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isDiscordLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              )}
              <span>
                {isDiscordLoading ? dict.loginModal.discordLoading : dict.loginModal.discordButton}
              </span>
            </button>
            {providerStatus.availability === "ready" && !providerStatus.discord.configured && (
              <span className="text-[11px] text-text-muted text-center font-medium">
                {dict.loginModal.discordUnconfigured}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
