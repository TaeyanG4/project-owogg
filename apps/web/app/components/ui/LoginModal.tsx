import { useEffect, useMemo, useRef, useState } from "react";
import { X, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../../features/auth";
import { useI18n } from "../../features/i18n/I18nContext";

export function LoginModal() {
  const {
    isLoginModalOpen,
    closeLoginModal,
    loginWithGoogleCredential,
    loginWithDiscord,
    providerStatus,
    error,
    clearError,
    refreshUser,
  } = useAuth();
  const { dict } = useI18n();

  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isDiscordLoading, setIsDiscordLoading] = useState(false);
  const [googleButtonReady, setGoogleButtonReady] = useState(false);
  const [googleButtonError, setGoogleButtonError] = useState<string | null>(null);
  const googleButtonContainerRef = useRef<HTMLDivElement>(null);

  const googleClientId = useMemo(
    () =>
      providerStatus.google.clientId ||
      ((import.meta as unknown as { env?: { VITE_GOOGLE_CLIENT_ID?: string } }).env
        ?.VITE_GOOGLE_CLIENT_ID ??
        ""),
    [providerStatus.google.clientId],
  );

  useEffect(() => {
    setGoogleButtonReady(false);
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

    const tryRender = (attemptsLeft: number) => {
      if (cancelled) return;
      const googleAuth = window.google?.accounts?.id;
      if (!googleAuth || !googleButtonContainerRef.current) {
        if (attemptsLeft <= 0) {
          setGoogleButtonError(
            "Google 로그인 버튼을 불러오지 못했습니다. 페이지를 새로고침해주세요.",
          );
          return;
        }
        timer = setTimeout(() => tryRender(attemptsLeft - 1), 150);
        return;
      }

      googleButtonContainerRef.current.replaceChildren();
      googleAuth.initialize({
        client_id: googleClientId,
        callback: (response: { credential: string }) => {
          setIsGoogleLoading(true);
          void loginWithGoogleCredential(response.credential).finally(() => {
            if (!cancelled) setIsGoogleLoading(false);
          });
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleAuth.renderButton(googleButtonContainerRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "pill",
      });
      setGoogleButtonReady(true);
    };

    tryRender(60);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    googleClientId,
    isLoginModalOpen,
    loginWithGoogleCredential,
    providerStatus.availability,
    providerStatus.google.configured,
  ]);

  if (!isLoginModalOpen) return null;

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
            <div className="relative flex min-h-[44px] w-full items-center justify-center">
              <div
                ref={googleButtonContainerRef}
                className={googleButtonReady && !isDiscordLoading ? undefined : "invisible"}
              />
              {providerStatus.availability === "ready" &&
                providerStatus.google.configured &&
                (!googleButtonReady || isGoogleLoading || isDiscordLoading) && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-white text-xs font-bold text-slate-600">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{dict.loginModal.googleLoading}</span>
                  </div>
                )}
            </div>
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
