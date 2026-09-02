import { Trophy, Video } from "lucide-react";
import type { RankingScope } from "@owogg/contracts";

export function RankingScopeTabs({
  scope,
  onScopeChange,
  generalLabel,
  streamerLabel,
}: {
  scope: RankingScope;
  onScopeChange: (scope: RankingScope) => void;
  generalLabel: string;
  streamerLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-surface-sidebar p-1.5">
      <button
        type="button"
        aria-pressed={scope === "general"}
        onClick={() => onScopeChange("general")}
        className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all md:text-sm ${
          scope === "general"
            ? "bg-brand text-white shadow-lg shadow-brand/25"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        <Trophy className="h-4 w-4" /> {generalLabel}
      </button>
      <button
        type="button"
        aria-pressed={scope === "streamer"}
        onClick={() => onScopeChange("streamer")}
        className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all md:text-sm ${
          scope === "streamer"
            ? "bg-purple-600 text-white shadow-lg shadow-purple-600/25"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        <Video className="h-4 w-4" /> {streamerLabel}
      </button>
    </div>
  );
}
