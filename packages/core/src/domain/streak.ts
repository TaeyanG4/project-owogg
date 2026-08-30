// Pure OwOGG service-calendar-day (Asia/Seoul) "consecutive active days" streak math. No I/O — callers (the D1
// session adapter) own reading the previous state and persisting the result.

import { previousServiceDateString, serviceDateString } from "./publicRanking.js";

/** Returns today's service date as a "YYYY-MM-DD" string. */
export const todayServiceDateString = serviceDateString;

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

export interface StreakUpdateResult extends StreakState {
  /** false when `today` matches the already-recorded last active date — caller should skip writing. */
  changed: boolean;
}

/**
 * Given the user's previously recorded streak state and today's service date, returns the next
 * state. Same-day repeat visits are a no-op (`changed: false`). A visit on the day right
 * after `lastActiveDate` extends the streak; any bigger gap (or no prior activity) resets it
 * to 1 — today itself always counts as an active day once this runs.
 */
export function nextStreakState(previous: StreakState, today: string): StreakUpdateResult {
  if (previous.lastActiveDate === today) {
    return { ...previous, changed: false };
  }

  const wasConsecutive =
    previous.lastActiveDate !== null &&
    previous.lastActiveDate === previousServiceDateString(today);
  const currentStreak = wasConsecutive ? previous.currentStreak + 1 : 1;
  const longestStreak = Math.max(previous.longestStreak, currentStreak);

  return { currentStreak, longestStreak, lastActiveDate: today, changed: true };
}
