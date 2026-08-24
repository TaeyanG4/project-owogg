import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "./app.css";
import { Layout } from "./components/layout/Layout";
import { AuthProvider } from "./features/auth";
import { PersonalizationProvider } from "./features/personalization";
import { I18nProvider } from "./features/i18n/I18nContext";
import { LoginModal } from "./components/ui/LoginModal";
import { API_URL, GAME_ORIGIN } from "./lib/api/config";

export default function App() {
  return (
    <html lang="ko-KR" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>OwOGG — 심심할 틈 없이, 게임을 한곳에</title>
        <meta name="description" content="설치 없이 바로 즐기는 가벼운 웹 미니게임 모음 플랫폼" />
        <meta name="theme-color" content="#6366f1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        {/* First catalog/leaderboard and game start use separate origins. Establishing DNS/TLS
            while the SPA bundle loads removes that handshake from the user's first interaction. */}
        <link rel="preconnect" href={API_URL} crossOrigin="anonymous" />
        {GAME_ORIGIN !== API_URL && (
          <link rel="preconnect" href={GAME_ORIGIN} crossOrigin="anonymous" />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Google Identity Services library for OAuth login */}
        <script src="https://accounts.google.com/gsi/client" async defer />
        <Meta />
        <Links />
      </head>
      <body className="bg-surface text-text-primary antialiased">
        <AuthProvider>
          <I18nProvider>
            <PersonalizationProvider>
              <Layout>
                <Outlet />
              </Layout>
              <LoginModal />
            </PersonalizationProvider>
          </I18nProvider>
        </AuthProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
