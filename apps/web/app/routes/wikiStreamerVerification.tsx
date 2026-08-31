import { Link } from "react-router";
import { WikiLayout, WikiCallout, WikiSteps } from "../components/wiki/WikiLayout";
import { PlatformIcon } from "../components/ui/PlatformIcon";
import { useI18n } from "../features/i18n/I18nContext";

export function meta() {
  return [
    { title: "채널 소유권 인증 | OwOGG Wiki" },
    { name: "description", content: "OwOGG Streamer 채널 소유권 인증 방법" },
  ];
}

export default function WikiStreamerVerificationRoute() {
  const { dict } = useI18n();
  const t = dict.wikiBody.streamerVerification;

  return (
    <WikiLayout eyebrow="STREAMER" title={t.title} description={t.description}>
      <section>
        <h2 className="text-lg font-black text-text-primary">{t.platformsHeading}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {(["YOUTUBE", "CHZZK", "SOOP", "TWITCH"] as const).map((p) => (
            <div key={p} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
              <PlatformIcon platform={p} size={22} />
              <span className="text-xs font-bold text-text-primary">{p}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${
                  p === "SOOP"
                    ? "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow"
                    : "border-accent-green/30 bg-accent-green/10 text-accent-green"
                }`}
              >
                {p === "SOOP" ? t.platformDeferred : t.platformAvailable}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.conditionsHeading}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>
            {t.condOnePrefix}
            <b className="text-text-primary">{t.condOneStrong}</b>
            {t.condOneSuffix}
          </li>
          <li>{t.condNoMinimum}</li>
          <li>{t.condOauthOnly}</li>
          <li>{t.condOneChannelOneAccount}</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.methodHeading}</h2>
        <div className="mt-3">
          <WikiSteps steps={[t.step1, t.step2, t.step3, t.step4]} />
        </div>
      </section>

      <WikiCallout>
        <b className="text-text-primary">{t.calloutLoginStrong}</b>
        {t.calloutLoginBody}
      </WikiCallout>

      <WikiCallout tone="warning">{t.calloutDuplicate}</WikiCallout>

      <p className="text-xs text-text-muted">
        {t.footerPrefix}
        <b className="text-text-primary">{t.footerStrong}</b>
        {t.footerMid}
        <Link to="/wiki/games/ranking" className="font-bold text-brand-light hover:underline">
          {t.footerLink}
        </Link>
        {t.footerSuffix}
      </p>
    </WikiLayout>
  );
}
