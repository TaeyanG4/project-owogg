import {
  Bookmark,
  Check,
  Clapperboard,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Share2,
  Smartphone,
} from "lucide-react";
import { Link } from "react-router";

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}

function ActionButton({ label, onClick, icon, active, disabled, testId }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-xs font-extrabold transition-all sm:h-11 sm:px-3.5 ${
        active
          ? "border-brand/50 bg-brand/15 text-brand-light"
          : "border-border/80 bg-surface-raised text-text-secondary hover:border-brand/40 hover:bg-surface-overlay hover:text-text-primary"
      } disabled:cursor-not-allowed disabled:opacity-35`}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

interface GamePlayActionBarProps {
  labels: {
    bookmark: string;
    bookmarked: string;
    share: string;
    feedback: string;
    mobile: string;
    theaterEnter: string;
    theaterExit: string;
    fullscreenEnter: string;
    fullscreenExit: string;
  };
  feedbackHref: string;
  isFavorite: boolean;
  isShareComplete: boolean;
  isTheater: boolean;
  isFullscreen: boolean;
  canFullscreen: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
  onMobilePlay: () => void;
  onToggleTheater: () => void;
  onToggleFullscreen: () => void;
}

export function GamePlayActionBar({
  labels,
  feedbackHref,
  isFavorite,
  isShareComplete,
  isTheater,
  isFullscreen,
  canFullscreen,
  onToggleFavorite,
  onShare,
  onMobilePlay,
  onToggleTheater,
  onToggleFullscreen,
}: GamePlayActionBarProps) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ActionButton
        label={isFavorite ? labels.bookmarked : labels.bookmark}
        onClick={onToggleFavorite}
        active={isFavorite}
        icon={<Bookmark className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />}
      />
      <ActionButton
        label={labels.share}
        onClick={onShare}
        active={isShareComplete}
        icon={isShareComplete ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      />
      <Link
        to={feedbackHref}
        title={labels.feedback}
        aria-label={labels.feedback}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-border/80 bg-surface-raised px-3 text-xs font-extrabold text-text-secondary transition-all hover:border-brand/40 hover:bg-surface-overlay hover:text-text-primary sm:h-11 sm:px-3.5"
      >
        <MessageSquareText className="h-4 w-4" />
        <span className="hidden 2xl:inline">{labels.feedback}</span>
      </Link>
      <ActionButton
        label={labels.mobile}
        onClick={onMobilePlay}
        icon={<Smartphone className="h-4 w-4" />}
      />
      <ActionButton
        label={isTheater ? labels.theaterExit : labels.theaterEnter}
        onClick={onToggleTheater}
        active={isTheater}
        testId="theater-mode-toggle"
        icon={<Clapperboard className="h-4 w-4" />}
      />
      <ActionButton
        label={isFullscreen ? labels.fullscreenExit : labels.fullscreenEnter}
        onClick={onToggleFullscreen}
        disabled={!canFullscreen}
        testId="fullscreen-toggle"
        icon={isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      />
    </div>
  );
}
