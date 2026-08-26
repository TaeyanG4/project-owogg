import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  type AuthUser,
  type ProviderStatus,
  fetchCurrentUser,
  fetchProviderStatus,
  loginGoogleCode,
  getDiscordLoginUrl,
  logoutFromServer,
} from "./authService.js";
import { retryAsync } from "../../lib/api/retry.js";

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  providerStatus: ProviderStatus;
  error: string | null;
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  loginWithGoogleCode: (code: string) => Promise<void>;
  loginWithDiscord: () => void;
  logout: () => void;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (
            notification?: (n: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
            }) => void,
          ) => void;
          renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
          revoke: (hint: string, callback: () => void) => void;
        };
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode?: "popup" | "redirect";
            include_granted_scopes?: boolean;
            select_account?: boolean;
            callback: (response: {
              code?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (error: {
              type: "popup_failed_to_open" | "popup_closed" | "unknown";
            }) => void;
          }) => { requestCode: () => void };
        };
      };
    };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    availability: "loading",
    google: { configured: false },
    discord: { configured: false },
  });
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const refreshGeneration = useRef(0);

  const refreshUser = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setIsLoading(true);
    const [currentUserResult, providerStatusResult] = await Promise.allSettled([
      retryAsync(fetchCurrentUser),
      retryAsync(fetchProviderStatus),
    ]);
    if (generation !== refreshGeneration.current) return;

    if (currentUserResult.status === "fulfilled") {
      setUser(currentUserResult.value);
      setAuthUnavailable(false);
    } else {
      // A transient API outage must not actively log out a user who was already restored in this
      // SPA session. A hard reload has no trustworthy cached identity, so it remains unknown/null
      // until the focus/online retry below succeeds.
      setAuthUnavailable(true);
    }

    if (providerStatusResult.status === "fulfilled") {
      setProviderStatus(providerStatusResult.value);
    } else {
      // "unavailable" is deliberately distinct from configured=false. The latter is a real
      // operator setting; the former is a retryable network/server failure and must never be
      // presented to users as "OAuth is not configured".
      setProviderStatus((previous) => ({ ...previous, availability: "unavailable" }));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const retryAfterReconnect = () => {
      if (authUnavailable || providerStatus.availability === "unavailable") {
        void refreshUser();
      }
    };
    window.addEventListener("online", retryAfterReconnect);
    window.addEventListener("focus", retryAfterReconnect);
    return () => {
      window.removeEventListener("online", retryAfterReconnect);
      window.removeEventListener("focus", retryAfterReconnect);
    };
  }, [authUnavailable, providerStatus.availability, refreshUser]);

  const openLoginModal = () => {
    setError(null);
    setIsLoginModalOpen(true);
    if (authUnavailable || providerStatus.availability === "unavailable") {
      setProviderStatus((previous) => ({ ...previous, availability: "loading" }));
      void refreshUser();
    }
  };
  const closeLoginModal = () => {
    setError(null);
    setIsLoginModalOpen(false);
  };
  const clearError = () => setError(null);

  const loginWithGoogleCode = useCallback(async (code: string) => {
    setError(null);
    if (!code) {
      setError("Google 로그인 응답이 비어 있습니다. 다시 시도해주세요.");
      return;
    }
    try {
      setIsLoading(true);
      const loggedInUser = await loginGoogleCode(code);
      setUser(loggedInUser);
      setIsLoginModalOpen(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Google 로그인에 실패했습니다. 다시 시도해주세요.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginWithDiscord = useCallback(() => {
    setError(null);
    if (providerStatus.availability !== "ready") {
      setError("로그인 서버 상태를 확인하고 있습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!providerStatus.discord.configured) {
      setError("Discord 로그인이 아직 설정되지 않았습니다.");
      return;
    }
    window.location.href = getDiscordLoginUrl();
  }, [providerStatus]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    await logoutFromServer();
    setUser(null);
    setIsLoading(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        providerStatus,
        error,
        isLoginModalOpen,
        openLoginModal,
        closeLoginModal,
        loginWithGoogleCode,
        loginWithDiscord,
        logout,
        clearError,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
