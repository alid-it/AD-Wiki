import type { BackupSchedule } from "@ad-wiki/shared-types";

const MINUTE_MS = 60_000;
// Bei einem woechentlichen Plan kann eine nicht existente DST-Minute den Lauf
// auf die Folgewoche verschieben; Zeitzonenversatz kommt zum Abstand hinzu.
const MAX_SEARCH_MINUTES = 15 * 24 * 60;
const DST_LOOKBACK_MINUTES = 180;

interface LocalMinute {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/**
 * Ermittelt den naechsten UTC-Zeitpunkt fuer einen strukturierten lokalen
 * Zeitplan. Nicht existente DST-Minuten werden uebersprungen; bei der
 * Zeitumstellung im Herbst wird die doppelte lokale Minute nur einmal geplant.
 */
export function nextScheduledRun(schedule: BackupSchedule, after: Date): Date {
  const formatter = formatterFor(schedule.timezone);
  const start = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  for (let offset = 0; offset < MAX_SEARCH_MINUTES; offset += 1) {
    const candidate = new Date(start + offset * MINUTE_MS);
    const local = localMinute(candidate, formatter);
    if (
      local.hour !== schedule.hour ||
      local.minute !== schedule.minute ||
      !schedule.weekdays.includes(local.weekday)
    ) {
      continue;
    }

    if (!isSecondOccurrence(candidate, local, formatter)) return candidate;
  }

  throw new RangeError(`Kein naechster Ausfuehrungszeitpunkt fuer ${schedule.timezone} gefunden.`);
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localMinute(date: Date, formatter: Intl.DateTimeFormat): LocalMinute {
  const values = new Map(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = requiredPart(values, "year");
  const month = requiredPart(values, "month");
  const day = requiredPart(values, "day");
  return {
    year,
    month,
    day,
    hour: requiredPart(values, "hour"),
    minute: requiredPart(values, "minute"),
    weekday: isoWeekday(year, month, day),
  };
}

function requiredPart(values: Map<string, number>, name: string): number {
  const value = values.get(name);
  if (value === undefined || Number.isNaN(value)) {
    throw new RangeError(`Datumsbestandteil ${name} konnte nicht ermittelt werden.`);
  }
  return value;
}

function isoWeekday(year: number, month: number, day: number): number {
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayBased === 0 ? 7 : sundayBased;
}

function isSecondOccurrence(
  candidate: Date,
  expected: LocalMinute,
  formatter: Intl.DateTimeFormat,
): boolean {
  const signature = localSignature(expected);
  for (let offset = 1; offset <= DST_LOOKBACK_MINUTES; offset += 1) {
    const previous = new Date(candidate.getTime() - offset * MINUTE_MS);
    if (localSignature(localMinute(previous, formatter)) === signature) return true;
  }
  return false;
}

function localSignature(value: LocalMinute): string {
  return `${value.year}-${value.month}-${value.day}-${value.hour}-${value.minute}`;
}
