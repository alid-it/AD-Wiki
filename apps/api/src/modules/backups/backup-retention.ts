import type { BackupRetention } from "@ad-wiki/shared-types";

export interface RetentionCandidate {
  id: string;
  createdAt: Date;
}

/**
 * Liefert die nicht mehr benoetigten IDs nach einer GFS-Aufbewahrung.
 * Eine Sicherung bleibt erhalten, sobald sie in mindestens eine Tages-,
 * Wochen- oder Monatsgruppe faellt; die neueste Sicherung bleibt immer erhalten.
 */
export function expiredBackupJobIds(
  candidates: readonly RetentionCandidate[],
  retention: BackupRetention,
  timezone: string,
): string[] {
  const sorted = [...candidates].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  if (sorted.length === 0) return [];
  const keep = new Set<string>([sorted[0].id]);
  keepBuckets(sorted, retention.daily, timezone, "day", keep);
  keepBuckets(sorted, retention.weekly, timezone, "week", keep);
  keepBuckets(sorted, retention.monthly, timezone, "month", keep);
  return sorted.filter((candidate) => !keep.has(candidate.id)).map((candidate) => candidate.id);
}

function keepBuckets(
  candidates: readonly RetentionCandidate[],
  limit: number,
  timezone: string,
  unit: "day" | "week" | "month",
  keep: Set<string>,
): void {
  if (limit <= 0) return;
  const buckets = new Set<string>();
  for (const candidate of candidates) {
    const key = bucketKey(candidate.createdAt, timezone, unit);
    if (buckets.has(key) || buckets.size >= limit) continue;
    buckets.add(key);
    keep.add(candidate.id);
  }
}

function bucketKey(date: Date, timezone: string, unit: "day" | "week" | "month"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = new Map(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = required(values, "year");
  const month = required(values, "month");
  const day = required(values, "day");
  if (unit === "month") return `${year}-${String(month).padStart(2, "0")}`;
  if (unit === "day") return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const week = isoWeek(year, month, day);
  return `${week.year}-W${String(week.week).padStart(2, "0")}`;
}

function isoWeek(year: number, month: number, day: number): { year: number; week: number } {
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const weekYear = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  return { year: weekYear, week: Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7) };
}

function required(values: Map<string, number>, key: string): number {
  const value = values.get(key);
  if (value === undefined || Number.isNaN(value)) throw new RangeError(`Datumsbestandteil ${key} fehlt.`);
  return value;
}
