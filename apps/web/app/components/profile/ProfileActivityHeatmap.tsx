import type { PublicProfilePlayActivity, SupportedLocale } from "@owogg/contracts";

const DAY_MS = 86_400_000;
const CELL_SIZE_PX = 11;
const CELL_GAP_PX = 3;

const ACTIVITY_LEVEL_CLASSES = [
  "border-border/50 bg-surface-raised",
  "border-emerald-950 bg-emerald-950",
  "border-emerald-800 bg-emerald-800",
  "border-emerald-600 bg-emerald-600",
  "border-emerald-300 bg-emerald-400",
] as const;

export interface ProfileActivityLabels {
  activeDays: string;
  totalPlays: string;
  today: string;
  daysSuffix: string;
  playsSuffix: string;
  less: string;
  more: string;
  definition: string;
  utcHint: string;
}

export interface ActivityCalendarCell {
  date: string | null;
  playCount: number;
}

export interface ActivityCalendarWeek {
  days: ActivityCalendarCell[];
}

function parseUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fixed, legible levels keep the same play count comparable across users and dates. */
export function activityLevel(playCount: number): 0 | 1 | 2 | 3 | 4 {
  if (playCount <= 0) return 0;
  if (playCount === 1) return 1;
  if (playCount <= 3) return 2;
  if (playCount <= 6) return 3;
  return 4;
}

/** Builds Sunday-starting week columns and pads only outside the requested profile period. */
export function buildActivityCalendar(activity: PublicProfilePlayActivity): ActivityCalendarWeek[] {
  const periodStart = parseUtcDate(activity.periodStart);
  const periodEnd = parseUtcDate(activity.periodEnd);
  const calendarStart = new Date(periodStart.getTime() - periodStart.getUTCDay() * DAY_MS);
  const calendarEnd = new Date(periodEnd.getTime() + (6 - periodEnd.getUTCDay()) * DAY_MS);
  const counts = new Map(activity.days.map((day) => [day.date, day.playCount]));
  const weeks: ActivityCalendarWeek[] = [];

  for (
    let weekStart = calendarStart.getTime();
    weekStart <= calendarEnd.getTime();
    weekStart += DAY_MS * 7
  ) {
    const days: ActivityCalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(weekStart + day * DAY_MS);
      const inPeriod = date >= periodStart && date <= periodEnd;
      const dateString = utcDateString(date);
      days.push({
        date: inPeriod ? dateString : null,
        playCount: inPeriod ? (counts.get(dateString) ?? 0) : 0,
      });
    }
    weeks.push({ days });
  }

  return weeks;
}

function weekdayLabels(locale: SupportedLocale): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, day) =>
    formatter.format(new Date(Date.UTC(2024, 0, 7 + day))),
  );
}

export function ProfileActivityHeatmap({
  activity,
  locale,
  labels,
}: {
  activity: PublicProfilePlayActivity;
  locale: SupportedLocale;
  labels: ProfileActivityLabels;
}) {
  const weeks = buildActivityCalendar(activity);
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const numberFormatter = new Intl.NumberFormat(locale);
  const weekdays = weekdayLabels(locale);
  const gridColumns = `repeat(${weeks.length}, ${CELL_SIZE_PX}px)`;

  const monthMarkers = weeks.flatMap((week, column) => {
    const firstVisible = week.days.find((day) => day.date !== null)?.date ?? null;
    const firstOfMonth = week.days.find((day) => day.date?.endsWith("-01"))?.date ?? null;
    const date = column === 0 ? firstVisible : firstOfMonth;
    return date ? [{ column, date }] : [];
  });

  const summaryLabel = `${labels.activeDays} ${numberFormatter.format(activity.activeDays)}${labels.daysSuffix}, ${labels.totalPlays} ${numberFormatter.format(activity.totalPlays)}${labels.playsSuffix}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised/25">
      <div className="grid grid-cols-3 divide-x divide-border/70 border-b border-border/70">
        <ActivityMetric
          label={labels.activeDays}
          value={numberFormatter.format(activity.activeDays)}
          suffix={labels.daysSuffix}
        />
        <ActivityMetric
          label={labels.totalPlays}
          value={numberFormatter.format(activity.totalPlays)}
          suffix={labels.playsSuffix}
        />
        <ActivityMetric
          label={labels.today}
          value={numberFormatter.format(activity.todayPlays)}
          suffix={labels.playsSuffix}
        />
      </div>

      <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <p className="mb-4 text-[11px] leading-relaxed text-text-muted">
          {labels.definition} · {labels.utcHint}
        </p>

        <div className="overflow-x-auto pb-1" role="img" aria-label={summaryLabel}>
          <div className="w-max min-w-full">
            <div className="mb-1.5 grid grid-cols-[2rem_auto] gap-2">
              <span aria-hidden="true" />
              <div
                className="grid text-[10px] font-semibold text-text-muted"
                style={{ gridTemplateColumns: gridColumns, columnGap: CELL_GAP_PX }}
              >
                {monthMarkers.map((marker, index) => {
                  const nextColumn = monthMarkers[index + 1]?.column ?? weeks.length;
                  const span = Math.max(1, nextColumn - marker.column);
                  if (index > 0 && span < 2) return null;
                  return (
                    <span
                      key={marker.date}
                      className="truncate"
                      style={{ gridColumn: `${marker.column + 1} / span ${span}` }}
                    >
                      {monthFormatter.format(parseUtcDate(marker.date))}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-[2rem_auto] gap-2">
              <div
                className="grid text-[9px] font-semibold leading-none text-text-muted"
                style={{
                  gridTemplateRows: `repeat(7, ${CELL_SIZE_PX}px)`,
                  rowGap: CELL_GAP_PX,
                }}
                aria-hidden="true"
              >
                {weekdays.map((label, day) => (
                  <span key={day} className="flex items-center">
                    {day === 1 || day === 3 || day === 5 ? label : ""}
                  </span>
                ))}
              </div>

              <div
                className="grid"
                style={{ gridTemplateColumns: gridColumns, columnGap: CELL_GAP_PX }}
                aria-hidden="true"
              >
                {weeks.map((week, weekIndex) => (
                  <div
                    key={weekIndex}
                    className="grid"
                    style={{
                      gridTemplateRows: `repeat(7, ${CELL_SIZE_PX}px)`,
                      rowGap: CELL_GAP_PX,
                    }}
                  >
                    {week.days.map((day, dayIndex) => {
                      if (day.date === null) {
                        return <span key={dayIndex} className="invisible h-[11px] w-[11px]" />;
                      }

                      const dateLabel = dateFormatter.format(parseUtcDate(day.date));
                      const title = `${dateLabel} · ${numberFormatter.format(day.playCount)}${labels.playsSuffix}`;
                      return (
                        <span
                          key={day.date}
                          data-activity-date={day.date}
                          data-play-count={day.playCount}
                          title={title}
                          className={`h-[11px] w-[11px] rounded-[3px] border transition-transform hover:scale-125 ${ACTIVITY_LEVEL_CLASSES[activityLevel(day.playCount)]} ${
                            day.date === activity.periodEnd
                              ? "ring-1 ring-brand-light ring-offset-1 ring-offset-surface"
                              : ""
                          }`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] font-semibold text-text-muted">
              <span>{labels.less}</span>
              {ACTIVITY_LEVEL_CLASSES.map((className, level) => (
                <span
                  key={level}
                  className={`h-[11px] w-[11px] rounded-[3px] border ${className}`}
                  aria-hidden="true"
                />
              ))}
              <span>{labels.more}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityMetric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-3 text-center sm:px-5 sm:py-4">
      <span className="truncate text-[10px] font-bold text-text-muted sm:text-[11px]">{label}</span>
      <span className="text-base font-black tabular-nums text-text-primary sm:text-lg">
        {value}
        <span className="text-[10px] font-bold text-text-muted sm:text-xs">{suffix}</span>
      </span>
    </div>
  );
}
