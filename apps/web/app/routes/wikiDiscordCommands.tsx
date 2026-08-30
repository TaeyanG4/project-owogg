import { Link } from "react-router";
import { WikiLayout, WikiCallout } from "../components/wiki/WikiLayout";
import { useI18n } from "../features/i18n/I18nContext";

export function meta() {
  return [
    { title: "명령어 | OwOGG Wiki" },
    { name: "description", content: "/owogg 슬래시 명령어 전체 안내" },
  ];
}

// Mirrors apps/api/src/infrastructure/discord/commands.ts (DISCORD_SUBCOMMANDS) — the actual
// registered command source of truth. Never document a subcommand that doesn't exist there.
// Name/example/the two boolean flags are structural (not translated); purpose/where/args/
// commonError come from dict.wikiBody.discordCommands.commands at the matching index.
const COMMANDS = [
  {
    name: "/owogg link",
    accountLinkRequired: false,
    guildRequired: false,
    example: "/owogg link",
  },
  {
    name: "/owogg profile",
    accountLinkRequired: true,
    guildRequired: false,
    example: "/owogg profile",
  },
  {
    name: "/owogg games",
    accountLinkRequired: false,
    guildRequired: false,
    example: "/owogg games",
  },
  {
    name: "/owogg play",
    accountLinkRequired: true,
    guildRequired: true,
    example: "/owogg play game:game-slug",
  },
  {
    name: "/owogg rank",
    accountLinkRequired: true,
    guildRequired: true,
    example: "/owogg rank",
  },
  {
    name: "/owogg leaderboard",
    accountLinkRequired: false,
    guildRequired: true,
    example: "/owogg leaderboard",
  },
  {
    name: "/owogg server",
    accountLinkRequired: false,
    guildRequired: true,
    example: "/owogg server",
  },
] as const;

export default function WikiDiscordCommandsRoute() {
  const { dict } = useI18n();
  const t = dict.wikiBody.discordCommands;

  return (
    <WikiLayout eyebrow="DISCORD" title={t.title} description={t.description}>
      <WikiCallout>{t.calloutEphemeral}</WikiCallout>

      <div className="space-y-4">
        {COMMANDS.map((cmd, i) => {
          // t.commands is built 1:1 with COMMANDS above (same order, same length) in every
          // locale, so this index always exists — the guard below is just to satisfy
          // noUncheckedIndexedAccess without a non-null assertion.
          const text = t.commands[i];
          if (!text) return null;
          return (
            <article
              key={cmd.name}
              className="rounded-2xl border border-border bg-surface-raised p-5"
            >
              <code className="text-base font-black text-brand-light">{cmd.name}</code>
              <p className="mt-2 text-sm text-text-secondary">{text.purpose}</p>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-bold text-text-primary">{t.labelWhere}</dt>
                  <dd className="text-text-muted">{text.where}</dd>
                </div>
                <div>
                  <dt className="font-bold text-text-primary">{t.labelAccountLink}</dt>
                  <dd className="text-text-muted">{cmd.accountLinkRequired ? t.yes : t.no}</dd>
                </div>
                <div>
                  <dt className="font-bold text-text-primary">{t.labelGuildRequired}</dt>
                  <dd className="text-text-muted">{cmd.guildRequired ? t.yes : t.no}</dd>
                </div>
                <div>
                  <dt className="font-bold text-text-primary">{t.labelArgs}</dt>
                  <dd className="text-text-muted">{text.args}</dd>
                </div>
              </dl>
              <div className="mt-3 rounded-xl bg-surface p-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-text-muted">
                  {t.labelExample}
                </p>
                <code className="text-xs font-mono text-text-secondary">{cmd.example}</code>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                <b className="text-text-primary">{t.labelCommonError}</b>
                {text.commonError}
              </p>
            </article>
          );
        })}
      </div>

      <p className="text-xs text-text-muted">
        {t.footerPrefix}
        <Link
          to="/wiki/discord/troubleshooting"
          className="font-bold text-brand-light hover:underline"
        >
          {t.footerLink}
        </Link>
        {t.footerSuffix}
      </p>
    </WikiLayout>
  );
}
