import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, CalendarDays, Check, ChevronDown, Eye, TrendingUp } from "lucide-react";
import type { GameSortKey } from "../../features/catalog/gameSort";

interface GameSortSelectProps {
  value: GameSortKey;
  onChange: (value: GameSortKey) => void;
  label: string;
  options: Record<GameSortKey, string>;
}

const SORT_ITEMS = [
  { value: "popular", icon: TrendingUp },
  { value: "newest", icon: CalendarDays },
  { value: "players", icon: Eye },
  { value: "bookmarks", icon: Bookmark },
] as const satisfies ReadonlyArray<{
  value: GameSortKey;
  icon: typeof TrendingUp;
}>;

export function GameSortSelect({ value, onChange, label, options }: GameSortSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    SORT_ITEMS.findIndex((item) => item.value === value),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedItem = SORT_ITEMS.find((item) => item.value === value) ?? SORT_ITEMS[0];
  const SelectedIcon = selectedItem.icon;

  useEffect(() => {
    if (!isOpen) return;

    const selectedIndex = SORT_ITEMS.findIndex((item) => item.value === value);
    setActiveIndex(selectedIndex);
    optionRefs.current[selectedIndex]?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen, value]);

  const moveActiveOption = (nextIndex: number) => {
    const normalizedIndex = (nextIndex + SORT_ITEMS.length) % SORT_ITEMS.length;
    setActiveIndex(normalizedIndex);
    optionRefs.current[normalizedIndex]?.focus();
  };

  const selectOption = (nextValue: GameSortKey) => {
    onChange(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, optionIndex: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveOption(optionIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(optionIndex - 1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveActiveOption(event.key === "Home" ? 0 : SORT_ITEMS.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      data-testid="game-sort-root"
      className={`relative shrink-0 ${isOpen ? "z-[60]" : "z-20"}`}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="game-sort-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
        className={`group flex h-9 min-w-40 cursor-pointer items-center gap-2 rounded-xl border px-2 pr-2.5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand/40 ${
          isOpen
            ? "border-brand bg-brand/10 shadow-lg shadow-brand/10"
            : "border-border/90 bg-surface-raised hover:border-brand/60 hover:bg-surface-overlay"
        }`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-light transition-colors group-hover:bg-brand/20">
          <SelectedIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-text-primary">
          {options[value]}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180 text-brand-light" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-[calc(100%+0.5rem)] w-full min-w-52 overflow-hidden rounded-2xl border border-border bg-surface-raised p-1.5 shadow-2xl shadow-black/40"
        >
          {SORT_ITEMS.map((item, optionIndex) => {
            const Icon = item.icon;
            const isSelected = item.value === value;
            const isActive = optionIndex === activeIndex;

            return (
              <button
                key={item.value}
                ref={(element) => {
                  optionRefs.current[optionIndex] = element;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={isActive ? 0 : -1}
                onMouseEnter={() => setActiveIndex(optionIndex)}
                onClick={() => selectOption(item.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, optionIndex)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
                  isSelected
                    ? "bg-brand/15 text-text-primary"
                    : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 ${isSelected ? "text-brand-light" : "text-text-muted"}`}
                />
                <span className="flex-1">{options[item.value]}</span>
                {isSelected && <Check aria-hidden="true" className="h-4 w-4 text-brand-light" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
