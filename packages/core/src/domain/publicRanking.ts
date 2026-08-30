/** Ranking calendar periods use the OwOGG service day (Asia/Seoul, fixed UTC+09:00). */
export type PublicRankingPeriod = "daily" | "weekly" | "monthly";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function shiftedKst(now: Date): Date {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

function kstPartsToUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - KST_OFFSET_MS;
}

/** Inclusive start and exclusive end for the current KST calendar period. Weeks start Monday. */
export function resolvePublicRankingPeriod(
  period: PublicRankingPeriod,
  now: Date = new Date(),
): { startAt: string; endAt: string } {
  const shifted = shiftedKst(now);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();

  if (period === "monthly") {
    return {
      startAt: new Date(kstPartsToUtcMs(year, month, 1)).toISOString(),
      endAt: new Date(kstPartsToUtcMs(year, month + 1, 1)).toISOString(),
    };
  }

  if (period === "weekly") {
    const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
    const startMs = kstPartsToUtcMs(year, month, day - daysSinceMonday);
    return {
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  const startMs = kstPartsToUtcMs(year, month, day);
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** KST YYYY-MM-DD, used by the lazily maintained attendance streak. */
export function serviceDateString(now: Date = new Date()): string {
  return shiftedKst(now).toISOString().slice(0, 10);
}

export function previousServiceDateString(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1)).toISOString().slice(0, 10);
}
