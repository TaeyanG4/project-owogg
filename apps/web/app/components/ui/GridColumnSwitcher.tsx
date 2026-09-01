import { Smartphone, Monitor } from "lucide-react";
import {
  MOBILE_COLUMN_OPTIONS,
  DESKTOP_COLUMN_OPTIONS,
  type MobileColumns,
  type DesktopColumns,
} from "../../features/personalization/useGridColumns";
import { useI18n } from "../../features/i18n/I18nContext";

interface GridColumnSwitcherProps {
  mobileColumns: MobileColumns;
  onMobileChange: (columns: MobileColumns) => void;
  desktopColumns: DesktopColumns;
  onDesktopChange: (columns: DesktopColumns) => void;
}

/** Lets the user pick how dense the game grid renders — separately for mobile (2/3/4 columns,
 * below `lg`) and desktop (4/5/6 columns, `lg` and up), since GameGrid uses two independent
 * preferences rather than one value that scales across breakpoints. Only the group matching the
 * *current* viewport is shown (`lg:hidden` / `hidden lg:flex`, mirroring GameGrid's own `lg`
 * split) — showing both at once regardless of device just confused mobile users into thinking
 * the 4/5/6 buttons did something on their screen. */
export function GridColumnSwitcher({
  mobileColumns,
  onMobileChange,
  desktopColumns,
  onDesktopChange,
}: GridColumnSwitcherProps) {
  const { dict } = useI18n();

  return (
    <div className="flex items-center gap-2" data-testid="grid-column-switcher">
      <div className="flex h-9 items-center gap-1 rounded-xl border border-border/80 bg-surface-raised p-1 lg:hidden">
        <Smartphone className="ml-1 h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        {MOBILE_COLUMN_OPTIONS.map((option) => {
          const isSelected = option === mobileColumns;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onMobileChange(option)}
              aria-label={`${dict.home.gridColumnsAriaPrefix}${option}${dict.home.gridColumnsAriaSuffix}`}
              aria-pressed={isSelected}
              className={`h-7 min-w-7 rounded-lg px-2 text-xs font-bold transition-all cursor-pointer ${
                isSelected
                  ? "bg-brand text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>

      <div className="hidden h-9 items-center gap-1 rounded-xl border border-border/80 bg-surface-raised p-1 lg:flex">
        <Monitor className="ml-1 h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        {DESKTOP_COLUMN_OPTIONS.map((option) => {
          const isSelected = option === desktopColumns;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onDesktopChange(option)}
              aria-label={`${dict.home.gridColumnsAriaPrefix}${option}${dict.home.gridColumnsAriaSuffix}`}
              aria-pressed={isSelected}
              className={`h-7 min-w-7 rounded-lg px-2 text-xs font-bold transition-all cursor-pointer ${
                isSelected
                  ? "bg-brand text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
