import { Link } from "react-router";
import { WikiLayout, WikiCallout } from "../components/wiki/WikiLayout";
import { useI18n } from "../features/i18n/I18nContext";

export function meta() {
  return [
    { title: "랭킹 | OwOGG Wiki" },
    { name: "description", content: "OwOGG 게임/XP/스트리머 랭킹 계산 방식" },
  ];
}

export default function WikiGamesRankingRoute() {
  const { dict } = useI18n();
  const t = dict.wikiBody.gamesRanking;

  return (
    <WikiLayout eyebrow="GAMES" title={t.title} description={t.description}>
      <section>
        <h2 className="text-lg font-black text-text-primary">{t.gameHeading}</h2>
        <p className="mt-2 text-sm text-text-secondary">{t.gameBody}</p>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.xpHeading}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {t.xpBodyPrefix}
          <Link to="/wiki/games/xp" className="font-bold text-brand-light hover:underline">
            {t.xpBodyLink}
          </Link>
          {t.xpBodySuffix}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.streamerHeading}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {t.streamerBodyPrefix}
          <b className="text-text-primary">{t.streamerBodyStrong}</b>
          {t.streamerBodySuffix}
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {t.streamerLinkPrefix}
          <Link
            to="/wiki/streamer/verification"
            className="font-bold text-brand-light hover:underline"
          >
            {t.streamerLink}
          </Link>
          {t.streamerLinkSuffix}
        </p>
      </section>

      <WikiCallout>{t.calloutFeatured}</WikiCallout>

      <p className="text-xs text-text-muted">
        {t.footerPrefix}
        <Link to="/wiki/discord/xp" className="font-bold text-brand-light hover:underline">
          {t.footerLink}
        </Link>
        {t.footerSuffix}
      </p>
    </WikiLayout>
  );
}
