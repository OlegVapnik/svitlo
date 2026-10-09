export function kyivDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

export function kyivDayStart(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const dayReference = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetText =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' })
      .formatToParts(dayReference)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+2';
  const match = offsetText.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/u);
  const offsetMinutes = match
    ? Number(match[1]) * 60 + Math.sign(Number(match[1])) * Number(match[2] ?? 0)
    : 120;
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000);
}

export function outageOverlapsKyivDay(startsAt: string, endsAt: string, day: Date): boolean {
  const from = kyivDayStart(day);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return Date.parse(startsAt) < to.getTime() && Date.parse(endsAt) >= from.getTime();
}
