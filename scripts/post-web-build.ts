import fs from "node:fs";
import path from "node:path";
import { shouldRequestWebManifest } from "../apps/web/app/lib/api/config.js";

/**
 * [React Router v7 SPA Mode Post-Build Provenance Script]
 *
 * `react-router build` 과정에서 Vite 컴파일러가 `build/client` 디렉토리를 초기화하므로,
 * 빌드 직후 `build/client/version.json` 정적 자산을 확실하게 보장하기 위해 실행됩니다.
 */
const cwd = process.cwd();
const rootDir =
  cwd.endsWith("apps/web") || cwd.endsWith("apps\\web") ? path.resolve(cwd, "..", "..") : cwd;

const clientDir = path.join(rootDir, "apps", "web", "build", "client");
fs.mkdirSync(clientDir, { recursive: true });

const versionPath = path.join(clientDir, "version.json");
const commitSha = process.env.COMMIT_SHA || "dev";
fs.writeFileSync(versionPath, JSON.stringify({ commit: commitSha }, null, 2), "utf-8");
console.log(
  `✅ Deployment Provenance version.json written to ${versionPath} (Commit: ${commitSha})`,
);

// Inject OwOGG favicon / manifest links into the SPA HTML shell so the initial
// document references the brand icons before client hydration.
const indexPath = path.join(clientDir, "index.html");
if (fs.existsSync(indexPath)) {
  const faviconLinks = [
    '<meta name="theme-color" content="#6366f1" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="icon" href="/favicon.ico" sizes="any" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  ];
  const apiUrl = process.env.VITE_API_URL?.trim();
  if (!apiUrl || shouldRequestWebManifest(apiUrl)) {
    faviconLinks.push('<link rel="manifest" href="/site.webmanifest" />');
  }
  let html = fs.readFileSync(indexPath, "utf-8");
  if (!html.includes('href="/favicon.svg"')) {
    html = html.replace(/<head>/, `<head>${faviconLinks.join("")}`);
    fs.writeFileSync(indexPath, html, "utf-8");
    console.log("✅ OwOGG favicon links injected into SPA index.html.");
  }
}
