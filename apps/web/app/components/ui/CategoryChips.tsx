import { Flame, Zap, Brain, Target, Keyboard, Bookmark } from "lucide-react";
import { useI18n } from "../../features/i18n/I18nContext";
import type { Dictionary } from "../../features/i18n/dictionary";

export interface CategoryOption {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Category ids are stable identifiers used for filtering/URL state — only the label text is
 * localized. Mirrors dict.games.categories in docs/i18n-content/02-game-content.json. */
function buildCategories(t: Dictionary["games"]["categories"]): CategoryOption[] {
  return [
    { id: "all", label: t.all, icon: Flame },
    { id: "reaction", label: t.reaction, icon: Zap },
    { id: "brain", label: t.brain, icon: Brain },
    { id: "aim", label: t.aim, icon: Target },
    { id: "typing", label: t.typing, icon: Keyboard },
    { id: "favorites", label: t.favorites, icon: Bookmark },
  ];
}

interface CategoryChipsProps {
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  className?: string;
}

export function CategoryChips({
  selectedCategory,
  onSelectCategory,
  className = "",
}: CategoryChipsProps) {
  const { dict } = useI18n();
  const categories = buildCategories(dict.games.categories);

  return (
    <div
      data-testid="game-category-filters"
      className={`flex w-full min-w-0 select-none items-center gap-2 overflow-x-auto py-2 no-scrollbar ${className}`}
    >
      {categories.map((cat) => {
        const Icon = cat.icon;
        const isSelected = selectedCategory === cat.id;

        return (
          <button
            key={cat.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelectCategory(cat.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs md:text-sm font-bold whitespace-nowrap transition-all cursor-pointer border ${
              isSelected
                ? "bg-brand text-white border-brand shadow-lg shadow-brand/25 scale-105"
                : "bg-surface-raised text-text-secondary border-border/80 hover:text-text-primary hover:bg-surface-overlay hover:border-border"
            }`}
          >
            <Icon className={`w-4 h-4 ${isSelected ? "text-white" : "text-brand-light"}`} />
            <span>{cat.label}</span>
          </button>
        );
      })}
    </div>
  );
}
