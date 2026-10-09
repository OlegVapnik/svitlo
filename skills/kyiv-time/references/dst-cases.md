# Verified Europe/Kyiv DST cases (computed with the IANA tz database)

| Kyiv date | Offset at 00:00 → 12:00 | Day length | UTC instant of Kyiv 00:00 |
|---|---|---|---|
| 2026-03-28 | +02:00 | 24 h | 2026-03-27T22:00:00Z |
| **2026-03-29** | +02:00 → +03:00 | **23 h** | 2026-03-28T22:00:00Z |
| 2026-03-30 | +03:00 | 24 h | 2026-03-29T21:00:00Z |
| 2026-10-24 | +03:00 | 24 h | 2026-10-23T21:00:00Z |
| **2026-10-25** | +03:00 → +02:00 | **25 h** | 2026-10-24T21:00:00Z |
| 2026-10-26 | +02:00 | 24 h | 2026-10-25T22:00:00Z |
| **2027-03-28** | +02:00 → +03:00 | **23 h** | 2027-03-27T22:00:00Z |
| **2027-10-31** | +03:00 → +02:00 | **25 h** | 2027-10-30T21:00:00Z |

Transition instants: 2026-03-29T01:00:00Z (local 03:00 → 04:00) and 2026-10-25T01:00:00Z (local 04:00 → 03:00).

Re-verify any value yourself:

```python
from zoneinfo import ZoneInfo
from datetime import datetime, timezone
tz = ZoneInfo("Europe/Kyiv")
d = datetime(2026, 10, 25, tzinfo=tz)
print(d.astimezone(timezone.utc))                    # 2026-10-24 21:00:00+00:00
print((datetime(2026, 10, 26, tzinfo=tz) - d).total_seconds() / 3600)   # wall-clock diff: 24.0 (!)
print((datetime(2026,10,26,tzinfo=tz).astimezone(timezone.utc) - d.astimezone(timezone.utc)).total_seconds() / 3600)  # real: 25.0
```

Note the trap in the last two lines: subtracting aware datetimes with the **same tzinfo** compares wall-clock time in Python;
convert both to UTC first to get the real elapsed duration.

JavaScript check (Node):

```js
new Date('2026-10-24T21:00:00Z').toLocaleString('en-GB', { timeZone: 'Europe/Kyiv', hour12: false })
// "25/10/2026, 00:00:00"
```
