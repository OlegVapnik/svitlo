---
name: kyiv-time
description: "Correct handling of Europe/Kyiv time in Svitlo: UTC in DB/API, Kyiv-day boundaries, 23h/25h days on DST change, the non-existent and repeated hour, operator HH:MM wall-clock conversion, 'today' in schedules and reliability windows, SQL at time zone. Use for any code or bug involving dates, 'today/tomorrow', day/week/month windows, queue schedule intervals, DST, time zones, or off-by-one-hour/off-by-one-day symptoms. Триггеры: время, часовой пояс, сегодня, завтра, переход на летнее время, сутки, интервал, kyivDayStart, Europe/Kyiv, UTC."
---

# Kyiv time

## Rules

1. **Store and transmit UTC** (`timestamptz`, ISO strings with `Z`). Convert to Kyiv only to (a) decide which *calendar day/week/month* something belongs to, (b) display, (c) parse operator wall-clock times.
2. **Zone id is `Europe/Kyiv`** (not `Europe/Kiev`, not a fixed `+02:00`/`+03:00` offset). Check that the runtime tzdata knows it (`new Intl.DateTimeFormat('en', {timeZone:'Europe/Kyiv'})` must not throw; Alpine images may need `tzdata`).
3. **Never add `24 * 3600 * 1000` to get "tomorrow"**. A Kyiv day is 24 h only most of the year. Compute day boundaries from the calendar date: start of day D = Kyiv `D 00:00` converted to UTC; end = start of day D+1.
4. **Use the existing helpers** and do not write new ones: API `kyivDayStart` (`power-summary.ts`), `kyivMonthStart`, `mondayKeyOf` (`reliability.ts`); web `kyivDateKey`, `kyivDayStart`, `outageOverlapsKyivDay` (`lib/outage-dates.ts`), `KYIV_TZ` (`lib/date.ts`); SQL `at time zone 'Europe/Kyiv'`. If a helper is wrong, fix it and add a test; do not fork it.
5. **Pass `now` as a parameter** into any function that depends on the current time. Tests inject a fixed instant.
6. "Duration of an outage in a day" = overlap of the interval with `[dayStart, nextDayStart)` in UTC, in minutes. On DST days the denominator is 1380 or 1500 minutes, not 1440 — reliability percentages must use the real day length.
7. Weeks start on **Monday** (`mondayKeyOf`); months start at Kyiv `1st 00:00`.

## DST facts (EU rules, Ukraine follows them)

Transitions happen at 01:00 UTC on the last Sunday of March/October.

| Year | Spring (EET +2 → EEST +3) | Autumn (EEST +3 → EET +2) |
|---|---|---|
| 2026 | Sun **2026-03-29**: 03:00 → 04:00 (local 03:00–03:59 does **not exist**), day = 23 h | Sun **2026-10-25**: 04:00 → 03:00 (local 03:00–03:59 happens **twice**), day = 25 h |
| 2027 | Sun **2027-03-28** | Sun **2027-10-31** |

UTC start of those Kyiv days: 2026-03-29 → `2026-03-28T22:00:00Z`; 2026-10-25 → `2026-10-24T21:00:00Z`.
More verified cases in `references/dst-cases.md`.

## Operator wall-clock strings (`kyivWallClockToUtc`, schedule HH:MM)

- A time inside the spring gap (03:00–03:59 on the transition day) does not exist: map it forward to the first valid instant (04:00 local) and log `warn`.
- A time inside the autumn overlap (03:00–03:59) is ambiguous: choose the **first** occurrence (EEST) unless the source gives an offset, and log `warn`. Decide once, document it in the function, test it.
- Schedule slots `time_from`/`time_to` for a Kyiv date: a slot ending at `24:00` means next day's `00:00`. Intervals crossing midnight must be split per Kyiv day when shown per day.
- Never parse operator strings with `new Date('2026-10-25 03:30')` (engine-local zone, differs between your host `TZ` and the container `TZ=Europe/Kyiv`).

## Typical bugs and where to look

| Symptom | Likely cause |
|---|---|
| Event appears on the previous/next day around midnight | Day key computed in UTC instead of Kyiv |
| One-hour shift only in summer or only in winter | Fixed offset instead of tz database |
| "today" differs between API and UI | UI uses browser zone, API uses Kyiv. Use `Europe/Kyiv` on both for outage logic |
| Reliability >100 % or <0 % on 2026-03-29/10-25 | Denominator fixed at 1440 min |
| Test passes locally, fails in Docker | Host `TZ` differs from container `TZ=Europe/Kyiv`; make tests zone-independent (pass explicit zone/UTC instants) |

## Tests to add whenever you touch time code

- `kyivDayStart` for 2026-03-28, 03-29, 03-30 and 2026-10-24, 10-25, 10-26 returns the UTC instants in `references/dst-cases.md`.
- Interval 2026-10-24T20:00Z → 2026-10-25T05:00Z split over Kyiv days: Kyiv 24 Oct ends at 2026-10-24T21:00Z, so 24 Oct gets 1 h and 25 Oct gets 8 h; the parts must sum to the interval length (9 h).
- A 23 h and a 25 h day both give `reliabilityPct` of 100 for an empty outage list and exactly `100 * (1 - down/dayMinutes)` for a known outage.
- Run the whole test suite twice with different `TZ` env values (`TZ=UTC` and `TZ=America/New_York`): results must be identical.

## Definition of done

No arithmetic on milliseconds for calendar logic, no hand-made offsets, tests for both DST days, and the suite passes under two different host `TZ` values.
