import { Link } from "react-router";
import { BookOpen, FileText, Gamepad2, MessagesSquare, User, Video, LifeBuoy } from "lucide-react";
import { useI18n } from "../features/i18n/I18nContext";
import type { Dictionary } from "../features/i18n/dictionary";

export function meta() {
  return [
    { title: "OwOGG Wiki" },
    { name: "description", content: "OwOGG 설치, 계정, 게임/랭킹, Discord, Streamer 이용 안내" },
  ];
}

function buildCategories(dict: Dictionary["wiki"]) {
  return [
    {
      icon: MessagesSquare,
      title: "Discord",
      description: dict.catDiscordDesc,
      path: "/wiki/discord",
      tone: "text-indigo-300 bg-indigo-500/10 border-indigo-500/30",
    },
    {
      icon: BookOpen,
      title: dict.navGettingStarted,
      description: dict.catGettingStartedDesc,
      path: "/wiki/getting-started",
      tone: "text-brand-light bg-brand/10 border-brand/30",
    },
    {
      icon: User,
      title: dict.navAccount,
      description: dict.catAccountDesc,
      path: "/wiki/account",
      tone: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    },
    {
      icon: Gamepad2,
      title: dict.navGamesRanking,
      description: dict.catGamesDesc,
      path: "/wiki/games",
      tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    },
    {
      icon: Video,
      title: "Streamer",
      description: dict.catStreamerDesc,
      path: "/wiki/streamer",
      tone: "text-purple-300 bg-purple-500/10 border-purple-500/30",
    },
    {
      icon: LifeBuoy,
      title: dict.navSupport,
      description: dict.catSupportDesc,
      path: "/wiki/support",
      tone: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    },
    {
      icon: FileText,
      title: dict.catPolicyTitle,
      description: dict.catPolicyDesc,
      path: "/terms",
      tone: "text-sky-300 bg-sky-500/10 border-sky-500/30",
    },
  ] as const;
}

export default function WikiHomeRoute() {
  const { dict } = useI18n();
  const categories = buildCategories(dict.wiki);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-10 md:px-8">
      <header className="text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-light">OwOGG Wiki</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-text-primary md:text-4xl">
          {dict.wiki.homeTitle}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-text-muted">
          {dict.wiki.homeSubtitle}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map(({ icon: Icon, title, description, path, tone }) => (
          <Link
            key={path}
            to={path}
            className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-5 shadow-lg shadow-black/10 transition-all hover:border-brand/40 hover:-translate-y-0.5"
          >
            <div className={`inline-flex w-fit items-center rounded-xl border p-2.5 ${tone}`}>
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black text-text-primary group-hover:text-brand-light">
              {title}
            </h2>
            <p className="text-xs leading-relaxed text-text-muted">{description}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
        <p className="text-sm text-text-muted">
          {dict.wiki.homeInstallPrompt}{" "}
          <Link to="/discord/setup" className="font-bold text-brand-light hover:underline">
            {dict.wiki.homeInstallGuideLink}
          </Link>
          {dict.wiki.homeInstallGuideSuffix}
        </p>
      </div>
    </div>
  );
}
