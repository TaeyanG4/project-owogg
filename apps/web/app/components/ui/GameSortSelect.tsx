import { ChevronDown } from "lucide-react";
import type { GameSortKey } from "../../features/catalog/gameSort";

interface GameSortSelectProps {
  value: GameSortKey;
  onChange: (value: GameSortKey) => void;
  label: string;
  options: Record<GameSortKey, string>;
}

export function GameSortSelect({ value, onChange, label, options }: GameSortSelectProps) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as GameSortKey)}
        aria-label={label}
        className="h-10 min-w-36 cursor-pointer appearance-none rounded-xl border border-border/90 bg-surface-raised py-2 pl-3 pr-9 text-sm font-bold text-text-primary outline-none transition-colors hover:border-brand/60 focus:border-brand focus:ring-2 focus:ring-brand/20"
      >
        <option value="popular">{options.popular}</option>
        <option value="newest">{options.newest}</option>
        <option value="players">{options.players}</option>
        <option value="bookmarks">{options.bookmarks}</option>
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}
