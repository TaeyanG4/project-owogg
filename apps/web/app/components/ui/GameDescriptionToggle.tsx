import { Eye, EyeOff } from "lucide-react";

interface GameDescriptionToggleProps {
  showDescriptions: boolean;
  onChange: (showDescriptions: boolean) => void;
  showLabel: string;
  hideLabel: string;
}

/** A compact, persistent display preference placed beside the grid-density controls. */
export function GameDescriptionToggle({
  showDescriptions,
  onChange,
  showLabel,
  hideLabel,
}: GameDescriptionToggleProps) {
  const label = showDescriptions ? hideLabel : showLabel;
  const Icon = showDescriptions ? EyeOff : Eye;

  return (
    <button
      type="button"
      data-testid="game-description-toggle"
      onClick={() => onChange(!showDescriptions)}
      aria-label={label}
      aria-pressed={showDescriptions}
      title={label}
      className="flex h-11 items-center gap-2 rounded-2xl border border-border/80 bg-surface-raised px-3.5 text-xs font-bold text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}
