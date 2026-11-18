/**
 * dates.ts — calendar dates ('YYYY-MM-DD') for display.
 * Due dates have no time zone, so they're formatted in UTC: "2026-11-23" shows as
 * "Nov 23" for every viewer, whatever their local zone.
 */
const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatDay(isoDate: string): string {
  return dayFormat.format(new Date(`${isoDate}T00:00:00Z`));
}
