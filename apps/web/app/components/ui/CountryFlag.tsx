export function countryCodeToFlag(country: string | null | undefined): string | null {
  const normalized = country?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) return null;
  return String.fromCodePoint(...[...normalized].map((letter) => 127397 + letter.charCodeAt(0)));
}

export function CountryFlag({
  country,
  unknownLabel,
}: {
  country: string | null | undefined;
  unknownLabel: string;
}) {
  const flag = countryCodeToFlag(country);
  const normalized = country?.trim().toUpperCase() ?? null;
  if (!flag) {
    return (
      <span
        role="img"
        aria-label={unknownLabel}
        title={unknownLabel}
        className="inline-flex h-5 min-w-7 items-center justify-center rounded border border-border bg-surface-sidebar px-1 text-[11px] font-black text-text-muted"
      >
        ?
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={normalized ?? unknownLabel}
      title={normalized ?? unknownLabel}
      className="text-xl leading-none"
    >
      {flag}
    </span>
  );
}
