interface GamePlayAdSlotProps {
  label: string;
  body: string;
  variant: "rectangle" | "banner";
}

/** Reserved, layout-stable ad inventory. A provider can replace only this component later without
 * letting third-party ad markup dictate the game player's dimensions or visual hierarchy. */
export function GamePlayAdSlot({ label, body, variant }: GamePlayAdSlotProps) {
  return (
    <section
      aria-label={label}
      className={`relative isolate flex w-full overflow-hidden rounded-2xl border border-border/70 bg-surface-raised shadow-sm ${
        variant === "rectangle"
          ? "min-h-64 items-center justify-center p-6"
          : "min-h-28 items-center justify-center px-6 py-5"
      }`}
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.12),transparent_38%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.1),transparent_36%)]" />
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">
          {label}
        </span>
        <p className="text-xs font-medium leading-relaxed text-text-muted">{body}</p>
      </div>
    </section>
  );
}
