import { Navigate, useLocation } from "react-router";

const LEGACY_STREAMER_ROUTE_TARGETS: Readonly<Record<string, string>> = {
  "/admin/creators": "/admin/streamers",
  "/wiki/creator": "/wiki/streamer",
  "/wiki/creator/verification": "/wiki/streamer/verification",
  "/wiki/creator/featured": "/wiki/streamer/featured",
};

export function legacyStreamerRedirectTarget(pathname: string): string {
  return LEGACY_STREAMER_ROUTE_TARGETS[pathname] ?? "/wiki/streamer";
}

/**
 * Temporary bookmark compatibility for the former broadcast-program route name. All visible UI,
 * new links, and domain code use Streamer; this redirect can be removed after the external-link
 * compatibility window closes.
 */
export default function LegacyStreamerRedirectRoute() {
  const { pathname } = useLocation();
  return <Navigate to={legacyStreamerRedirectTarget(pathname)} replace />;
}
