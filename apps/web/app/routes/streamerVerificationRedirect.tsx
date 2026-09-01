import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { StreamerPlatformSchema } from "@owogg/contracts";
import { API_URL } from "../lib/api/config";
import { streamerVerificationUrl } from "../features/streamers/streamerApi";

export function streamerVerificationRedirectTarget(
  rawPlatform: string | undefined,
  apiUrl: string = API_URL,
): string | null {
  const platform = StreamerPlatformSchema.safeParse(rawPlatform?.toUpperCase());
  if (!platform.success) {
    return null;
  }

  return streamerVerificationUrl(platform.data, apiUrl);
}

/** Compatibility for Web-origin links emitted before OAuth moved to the dedicated API origin. */
export default function StreamerVerificationRedirectRoute() {
  const { platform } = useParams();
  const target = streamerVerificationRedirectTarget(platform);

  useEffect(() => {
    if (target) window.location.replace(target);
  }, [target]);

  if (!target) {
    return <Navigate to="/settings?streamer_verify=error&reason=invalid_platform" replace />;
  }

  return (
    <main className="flex min-h-[40vh] items-center justify-center px-4 text-center">
      <a className="font-bold text-brand hover:underline" href={target}>
        인증 페이지로 이동 / Continue to verification
      </a>
    </main>
  );
}
