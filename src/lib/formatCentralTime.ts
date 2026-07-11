const CENTRAL_TIME_ZONE = "America/Chicago";

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Converts a wall-clock reading in America/Chicago into the correct UTC instant,
// accounting for DST (the offset depends on the date itself, not just the zone).
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const chicagoWallString = new Date(utcGuess).toLocaleString("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const [datePart, timePart] = chicagoWallString.split(", ");
  const [mo, da, yr] = datePart.split("/").map(Number);
  const [hh, mi, ss] = timePart.replace("24:", "00:").split(":").map(Number);
  const chicagoAsUtc = Date.UTC(yr, mo - 1, da, hh, mi, ss);
  const offset = utcGuess - chicagoAsUtc;
  return new Date(utcGuess + offset);
}

function centralDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Start of the calendar day (00:00:00) as observed in America/Chicago, returned as a UTC Date. */
export function startOfDayCentral(date: Date): Date {
  const { year, month, day } = centralDateParts(date);
  return zonedWallTimeToUtc(year, month, day, 0, 0, 0);
}

/** End of the calendar day (23:59:59) as observed in America/Chicago, returned as a UTC Date. */
export function endOfDayCentral(date: Date): Date {
  const { year, month, day } = centralDateParts(date);
  return zonedWallTimeToUtc(year, month, day, 23, 59, 59);
}
