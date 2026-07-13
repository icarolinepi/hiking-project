/** Місяць 1–12 у часовому поясі Києва. */
export function kyivMonth(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    month: "numeric",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "month")?.value ?? 1);
}

export function kyivYear(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "year")?.value ?? date.getUTCFullYear());
}

export function trackMatchesYear(
  startDateIso: string,
  year: number | "all",
): boolean {
  const date = new Date(startDateIso);
  if (Number.isNaN(date.getTime())) return false;
  if (year !== "all" && kyivYear(date) !== year) return false;
  return true;
}

export function collectTrackYears(startDates: string[]): number[] {
  const years = new Set<number>();
  for (const iso of startDates) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) years.add(kyivYear(date));
  }
  return [...years].sort((a, b) => b - a);
}
