import process from "node:process";
import { resolveSmokeTargets } from "./staging-contract.js";

const { apiUrl: API_URL, webUrl: WEB_URL } = resolveSmokeTargets(process.env);

const FETCH_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 20;
const HARD_TIMEOUT_MS = 90_000;

const STATIC_ROUTES_TO_CHECK = [
  "/",
  "/games",
  "/ranking",
  "/profile",
  "/admin",
  "/admin/streamers",
  "/discord",
  "/discord/servers",
  "/discord/guide",
  "/discord/link",
  "/wiki",
  // Registered in the Discord Developer Portal as this app's official Terms of Service /
  // Privacy Policy URLs — if either 404s, Discord app verification silently breaks, so they
  // are deployment-blocking here rather than something we'd notice weeks later.
  "/terms",
  "/privacy",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/favicon-192x192.png",
  "/site.webmanifest",
];

interface PublicGameDeploymentTarget {
  slug: string;
  mediaUrl: string | null;
}

interface VerifyOptions {
  apiOnly: boolean;
  webOnly: boolean;
  expectedSha?: string;
}

function parseArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  let apiOnly = false;
  let webOnly = false;
  let expectedSha = process.env.EXPECTED_SHA || "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--api-only") apiOnly = true;
    if (arg === "--web-only") webOnly = true;
    if (arg === "--sha" && i + 1 < args.length) {
      expectedSha = args[i + 1] ?? "";
      i++;
    }
  }

  return { apiOnly, webOnly, expectedSha: expectedSha.trim() };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = { signal: controller.signal };
    if (headers) init.headers = headers;
    const res = await fetch(url, init);
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPublicGameCatalog(): Promise<PublicGameDeploymentTarget[]> {
  const res = await fetchWithTimeout(`${API_URL}/api/games?v=${Date.now()}`, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`GET /api/games returned HTTP ${res.status}`);

  const body = (await res.json()) as { games?: unknown };
  if (!Array.isArray(body.games) || body.games.length === 0) {
    throw new Error("GET /api/games returned an empty or malformed public catalog");
  }

  const seen = new Set<string>();
  return body.games.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`GET /api/games item ${index} is not an object`);
    }
    const { slug, mediaUrl } = candidate as { slug?: unknown; mediaUrl?: unknown };
    if (typeof slug !== "string" || !slug.trim() || seen.has(slug)) {
      throw new Error(`GET /api/games item ${index} has an invalid or duplicate slug`);
    }
    if (mediaUrl !== null && typeof mediaUrl !== "string") {
      throw new Error(`GET /api/games item ${index} has an invalid mediaUrl`);
    }
    seen.add(slug);
    return { slug, mediaUrl };
  });
}

async function verifyPublicGameApi(): Promise<PublicGameDeploymentTarget[]> {
  const games = await fetchPublicGameCatalog();
  const targets = games.flatMap((game) => {
    const detailUrl = `${API_URL}/api/games/${encodeURIComponent(game.slug)}`;
    if (!game.mediaUrl) return [{ label: `${game.slug} detail`, url: detailUrl }];
    const mediaUrl = new URL(game.mediaUrl, API_URL);
    if (mediaUrl.origin !== API_URL) {
      throw new Error(`Public game ${game.slug} mediaUrl points outside the API origin`);
    }
    return [
      { label: `${game.slug} detail`, url: detailUrl },
      { label: `${game.slug} media`, url: mediaUrl.toString() },
    ];
  });

  const results = await Promise.allSettled(
    targets.map(async ({ label, url }) => {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
      return label;
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => String(failure.reason)).join("; "));
  }

  console.log(`✅ Public game API verified ${games.length} D1/B2-backed games.`);
  return games;
}

async function verifyApi(expectedSha?: string): Promise<boolean> {
  console.log("🔍 Starting API Health & Provenance Check...");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const url = `${API_URL}/api/health?v=${Date.now()}`;
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }
      const data = (await res.json()) as { status?: string; commit?: string };
      console.log(
        `[API Attempt ${attempt}/${MAX_ATTEMPTS}] Status: ${data.status}, Commit: ${data.commit}`,
      );

      if (data.status === "ok") {
        if (expectedSha && data.commit !== expectedSha) {
          console.log(
            `⚠️ API commit (${data.commit}) does not match expected (${expectedSha}) yet. Retrying...`,
          );
        } else {
          await verifyPublicGameApi();
          console.log("✅ API Health, Provenance & Public Game Catalog Verified Successfully!");
          return true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[API Attempt ${attempt}/${MAX_ATTEMPTS}] Failed: ${message}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }

  console.error("❌ API Health & Provenance Verification Failed after maximum retries.");
  return false;
}

const STREAMER_PLATFORM_KEYS = ["YOUTUBE", "TWITCH", "CHZZK", "SOOP"] as const;
type StreamerPlatformKey = (typeof STREAMER_PLATFORM_KEYS)[number];

/**
 * Streamer providers are optional integrations — OwOGG must deploy cleanly with some (or all)
 * unconfigured. `STREAMER_ENABLED_PROVIDERS` (comma-separated) is this deployment's explicit list
 * of providers operations expects to be live; only those are required to report configured=true.
 * An unconfigured provider that was never declared enabled is reported, not treated as failure.
 */
async function verifyStreamerProviders(): Promise<boolean> {
  console.log("🔍 Checking Streamer provider readiness (GET /api/streamers/providers)...");

  const enabledRaw = (process.env.STREAMER_ENABLED_PROVIDERS || "").trim();
  const enabled = new Set(
    enabledRaw
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p): p is StreamerPlatformKey =>
        (STREAMER_PLATFORM_KEYS as readonly string[]).includes(p),
      ),
  );

  let data: Partial<Record<StreamerPlatformKey, { configured?: boolean }>>;
  try {
    const res = await fetchWithTimeout(
      `${API_URL}/api/streamers/providers?v=${Date.now()}`,
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    data = (await res.json()) as typeof data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to reach GET /api/streamers/providers: ${message}`);
    return false;
  }

  let allRequiredConfigured = true;
  for (const platform of STREAMER_PLATFORM_KEYS) {
    const configured = Boolean(data[platform]?.configured);
    const isEnabled = enabled.has(platform);
    const statusLabel = configured ? "configured" : "외부 설정 대기";
    const requiredLabel = isEnabled ? " (required)" : "";
    console.log(`  · ${platform}: ${statusLabel}${requiredLabel}`);

    if (isEnabled && !configured) {
      console.error(
        `❌ ${platform} is declared in STREAMER_ENABLED_PROVIDERS but is not configured in production.`,
      );
      allRequiredConfigured = false;
    }
  }

  if (enabled.size === 0) {
    console.log(
      "ℹ️ STREAMER_ENABLED_PROVIDERS is unset — no Streamer provider is required for this deployment.",
    );
  }

  if (allRequiredConfigured) {
    console.log("✅ Streamer provider readiness OK.");
  }
  return allRequiredConfigured;
}

async function verifyWeb(expectedSha?: string): Promise<boolean> {
  console.log("🔍 Starting Web Version & Route Provenance Check...");
  let shaVerified = false;
  const accessHeaders = cloudflareAccessHeaders();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const url = `${WEB_URL}/version.json?v=${Date.now()}`;
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, accessHeaders);
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }
      const data = (await res.json()) as { commit?: string };
      console.log(`[Web Attempt ${attempt}/${MAX_ATTEMPTS}] Commit: ${data.commit}`);

      if (expectedSha && data.commit !== expectedSha) {
        console.log(
          `⚠️ Web commit (${data.commit}) does not match expected (${expectedSha}) yet. Retrying...`,
        );
      } else {
        console.log("✅ Web Version Provenance Verified!");
        shaVerified = true;
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[Web Attempt ${attempt}/${MAX_ATTEMPTS}] Failed: ${message}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }

  if (!shaVerified && expectedSha) {
    console.error("❌ Web Version Provenance Verification Failed after maximum retries.");
    return false;
  }

  let publicGames: PublicGameDeploymentTarget[];
  try {
    publicGames = await fetchPublicGameCatalog();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Public game catalog discovery failed: ${message}`);
    return false;
  }

  console.log("🔍 Checking Web Routes & Published Assets...");
  const routesToCheck = [
    ...STATIC_ROUTES_TO_CHECK,
    ...publicGames.map((game) => `/games/${encodeURIComponent(game.slug)}`),
  ];
  const routeResults = await Promise.allSettled(
    routesToCheck.map(async (route) => {
      const routeUrl = `${WEB_URL}${route}?v=${Date.now()}`;
      const res = await fetchWithTimeout(routeUrl, FETCH_TIMEOUT_MS, accessHeaders);
      if (!res.ok) {
        throw new Error(`Route ${route} returned HTTP ${res.status}`);
      }
      return route;
    }),
  );

  let allRoutesOk = true;
  // Iterating the results (rather than indexing them by loop counter) is what lets TypeScript see
  // `result` as a settled result rather than a possibly-undefined one, which in turn lets the
  // else-branch narrow to the rejected case and reach `.reason`. allSettled preserves input order,
  // so the paired route is still the one at the same index.
  for (const [i, result] of routeResults.entries()) {
    const route = routesToCheck[i] ?? "(unknown route)";
    if (result.status === "fulfilled") {
      console.log(`  ✅ ${route} OK`);
    } else {
      console.error(`  ❌ ${route} FAILED: ${result.reason}`);
      allRoutesOk = false;
    }
  }

  if (!allRoutesOk) {
    console.error("❌ Web Route Verification Failed!");
    return false;
  }

  console.log("✅ Web Frontend & Published Assets Verified Successfully!");
  return true;
}

function cloudflareAccessHeaders(): Record<string, string> | undefined {
  const clientId = process.env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be configured together");
  }
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}

async function main() {
  const options = parseArgs();

  const hardTimeout = setTimeout(() => {
    console.error(
      `\n💥 HARD TIMEOUT EXCEEDED (${HARD_TIMEOUT_MS / 1000}s)! Aborting deployment check.`,
    );
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  try {
    let success = true;
    if (options.apiOnly) {
      const apiOk = await verifyApi(options.expectedSha);
      const streamerProvidersOk = await verifyStreamerProviders();
      success = apiOk && streamerProvidersOk;
    } else if (options.webOnly) {
      success = await verifyWeb(options.expectedSha);
    } else {
      const apiOk = await verifyApi(options.expectedSha);
      const streamerProvidersOk = await verifyStreamerProviders();
      const webOk = await verifyWeb(options.expectedSha);
      success = apiOk && streamerProvidersOk && webOk;
    }

    clearTimeout(hardTimeout);
    if (!success) {
      process.exit(1);
    }
    console.log("\n🎉 All requested deployment verification checks passed cleanly!");
    process.exit(0);
  } catch (err) {
    clearTimeout(hardTimeout);
    console.error("❌ Unexpected error during production verification:", err);
    process.exit(1);
  }
}

void main();
