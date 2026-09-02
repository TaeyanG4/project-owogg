const PROFILE_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/;

/** Keeps the public profile date stable for both ISO and D1's SQL-style timestamps. */
export function formatProfileJoinedDate(value: string): string {
  return PROFILE_DATE_PREFIX.exec(value)?.[1] ?? value;
}
