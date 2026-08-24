import { Link } from "react-router";
import { WikiLayout, WikiCallout, WikiSteps } from "../components/wiki/WikiLayout";
import { useI18n } from "../features/i18n/I18nContext";

export function meta() {
  return [
    { title: "계정 통합 | OwOGG Wiki" },
    { name: "description", content: "Google과 Discord로 따로 만든 계정을 하나로 합치는 방법" },
  ];
}

export default function WikiAccountMergeRoute() {
  const { dict } = useI18n();
  const t = dict.wikiBody.accountMerge;

  return (
    <WikiLayout eyebrow="ACCOUNT" title={t.title} description={t.description}>
      <section>
        <h2 className="text-lg font-black text-text-primary">{t.howHeading}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {t.howBodyPrefix}
          <b className="text-text-primary">{t.howBodyPrimary}</b>
          {t.howBodySuffix}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-black text-text-primary">{t.stepsHeading}</h2>
        <div className="mt-3">
          <WikiSteps steps={[t.step1, t.step2, t.step3, t.step4, t.step5]} />
        </div>
      </section>

      <WikiCallout tone="warning">
        <b className="text-text-primary">{t.calloutNoMergeStrong}</b>
        {t.calloutNoMergeBody}
      </WikiCallout>

      <WikiCallout tone="warning">
        <b className="text-text-primary">{t.calloutAdminStrong}</b>
        {t.calloutAdminBody}
      </WikiCallout>

      <p className="text-xs text-text-secondary">
        {t.footerPrefix}
        <Link
          to="/wiki/streamer/verification"
          className="font-bold text-brand-light hover:underline"
        >
          {t.footerLink}
        </Link>
        {t.footerSuffix}
      </p>
    </WikiLayout>
  );
}
