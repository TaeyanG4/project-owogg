import { WikiLayout, WikiCallout } from "../components/wiki/WikiLayout";
import { useI18n } from "../features/i18n/I18nContext";

export function meta() {
  return [
    { title: "Featured Streamer | OwOGG Wiki" },
    { name: "description", content: "OwOGG Featured Streamer 자격 기준 안내" },
  ];
}

export default function WikiStreamerFeaturedRoute() {
  const { dict } = useI18n();
  const t = dict.wikiBody.streamerFeatured;

  return (
    <WikiLayout eyebrow="STREAMER" title={t.title} description={t.description}>
      <section>
        <h2 className="text-lg font-black text-text-primary">{t.conceptHeading}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>
            <b className="text-text-primary">{t.conceptStreamerTerm}</b>
            {t.conceptStreamerDesc}
          </li>
          <li>
            <b className="text-text-primary">{t.conceptFeaturedTerm}</b>
            {t.conceptFeaturedDesc}
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.reviewHeading}</h2>
        <p className="mt-2 text-sm text-text-secondary">{t.reviewBody}</p>
      </section>

      <WikiCallout>
        <b className="text-text-primary">{t.calloutNoRankImpactStrong}</b>
        {t.calloutNoRankImpactBody}
      </WikiCallout>

      <WikiCallout tone="warning">{t.calloutTestingPhase}</WikiCallout>

      <p className="text-xs text-text-muted">{t.footerNote}</p>
    </WikiLayout>
  );
}
