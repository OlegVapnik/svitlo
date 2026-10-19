package ua.com.svitlo.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Снимок расписания, который WebView положил в `SharedPreferences`, вместе с пересчётом «по
 * текущему времени телефона».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КЛАСС. И виджет, и фоновое обновление (раз в 30 минут) должны одинаково
 * понимать, идёт ли отключение сейчас и когда следующее переключение. Если бы каждый считал
 * это своими руками, виджет и будильник разошлись бы на минутных границах: один показывал бы
 * «світло є», другой ставил уведомление о включении.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не придумываем статус, когда интервалов нет: пустой график — это «немає
 * даних», а не «світло є». Текст из веба (`statusText`) сохраняется как есть, пока фоновая
 * синхронизация не принесёт настоящие интервалы.
 */
final class WidgetSnapshot {

    private static final ZoneId KYIV = ZoneId.of("Europe/Kyiv");
    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm", Locale.forLanguageTag("uk-UA"));

    static final class Interval {
        final long startMs;
        final long endMs;

        Interval(long startMs, long endMs) {
            this.startMs = startMs;
            this.endMs = endMs;
        }
    }

    String regionName = "";
    String queue = "";
    String regionCpu = "";
    String apiBaseUrl = "";
    /** Текст статуса из веба: нужен, когда интервалов нет (например «світло за графіком»). */
    String statusText = "";
    boolean isOff;
    String nextChangeLabel = "";
    String nextChangeTime = "";
    double todayOutageHours;
    /** Когда снимок получен (ISO): виджет показывает «Оновлено о 16:24». */
    String updatedAt = "";
    /** Границы киевских суток для отрисовки 24-часовой полосы. */
    long dayStartMs;
    long dayEndMs;

    final List<Interval> today = new ArrayList<>();
    final List<Interval> upcoming = new ArrayList<>();

    static WidgetSnapshot fromJson(String json) {
        WidgetSnapshot snapshot = new WidgetSnapshot();
        if (json == null || json.isEmpty()) return snapshot;
        try {
            JSONObject state = new JSONObject(json);
            snapshot.regionName = state.optString("regionName", "");
            snapshot.queue = state.optString("queue", "");
            snapshot.regionCpu = state.optString("regionCpu", "");
            snapshot.apiBaseUrl = state.optString("apiBaseUrl", "");
            snapshot.statusText = state.optString("statusText", "");
            snapshot.isOff = state.optBoolean("isOff", false);
            snapshot.nextChangeLabel = state.optString("nextChangeLabel", "");
            snapshot.nextChangeTime = state.optString("nextChangeTime", "");
            snapshot.todayOutageHours = state.optDouble("todayOutageHours", 0);
            snapshot.updatedAt = state.optString("updatedAt", "");
            readIntervals(state.optJSONArray("todayIntervals"), snapshot.today);
            readIntervals(state.optJSONArray("upcomingIntervals"), snapshot.upcoming);
        } catch (JSONException ignored) {
            // Битый снимок (обрезанная запись, старый формат) — показываем заглушку, а не
            // выдуманный статус: человек должен видеть, что данных ещё нет.
        }
        return snapshot;
    }

    private static void readIntervals(JSONArray array, List<Interval> target) {
        if (array == null) return;
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = array.optJSONObject(index);
            if (item == null) continue;
            long start = item.optLong("startEpochMs", 0);
            long end = item.optLong("endEpochMs", 0);
            if (end > start) target.add(new Interval(start, end));
        }
    }

    JSONObject toJson() {
        JSONObject state = new JSONObject();
        try {
            state.put("regionName", regionName);
            state.put("queue", queue);
            state.put("regionCpu", regionCpu);
            state.put("apiBaseUrl", apiBaseUrl);
            state.put("statusText", statusText);
            state.put("isOff", isOff);
            state.put("nextChangeTime", nextChangeTime);
            state.put("nextChangeLabel", nextChangeLabel);
            state.put("todayOutageHours", todayOutageHours);
            state.put("updatedAt", updatedAt);
            state.put("upcomingIntervals", toArray(upcoming));
            state.put("todayIntervals", toArray(today));
        } catch (JSONException ignored) {
            // JSONObject.put с простыми типами не бросает; блок оставлен ради компилятора.
        }
        return state;
    }

    private static JSONArray toArray(List<Interval> intervals) {
        JSONArray array = new JSONArray();
        for (Interval interval : intervals) {
            JSONObject item = new JSONObject();
            try {
                item.put("startEpochMs", interval.startMs);
                item.put("endEpochMs", interval.endMs);
            } catch (JSONException ignored) {
                continue;
            }
            array.put(item);
        }
        return array;
    }

    /**
     * Пересчитывает статус по часам телефона.
     *
     * `todayOutageHours` считается по сегодняшним интервалам, обрезанным до полуночи: иначе
     * окно «23:00–01:00» записалось бы в сутки целиком и сумма часов не сходилась бы с графиком.
     */
    void recompute(long nowMs) {
        LocalDate todayDate = LocalDate.now(KYIV);
        long dayStart = todayDate.atStartOfDay(KYIV).toInstant().toEpochMilli();
        long dayEnd = todayDate.plusDays(1).atStartOfDay(KYIV).toInstant().toEpochMilli();
        dayStartMs = dayStart;
        dayEndMs = dayEnd;

        long offMinutes = 0;
        for (Interval interval : today) {
            long start = Math.max(interval.startMs, dayStart);
            long end = Math.min(interval.endMs, dayEnd);
            if (end > start) offMinutes += (end - start) / 60_000L;
        }
        todayOutageHours = Math.round((offMinutes / 60.0) * 10) / 10.0;

        boolean hasData = !today.isEmpty() || !upcoming.isEmpty();
        Interval currentOff = null;
        Interval nextOff = null;
        for (Interval interval : upcoming) {
            if (interval.startMs <= nowMs && nowMs < interval.endMs) {
                if (currentOff == null || interval.endMs > currentOff.endMs) currentOff = interval;
            } else if (interval.startMs > nowMs) {
                if (nextOff == null || interval.startMs < nextOff.startMs) nextOff = interval;
            }
        }

        isOff = currentOff != null;
        if (!hasData) {
            // Пустой снимок не даёт права утверждать «світло є»: оставляем текст из веба.
            if (nextChangeLabel == null || nextChangeLabel.isEmpty()) {
                nextChangeLabel = "Змін не заплановано";
            }
            return;
        }

        statusText = isOff ? "Світла немає" : "Світло є";
        long nextChange = currentOff != null
            ? currentOff.endMs
            : nextOff != null ? nextOff.startMs : 0L;
        if (nextChange > 0) {
            nextChangeTime = Instant.ofEpochMilli(nextChange).toString();
            nextChangeLabel = (isOff ? "Увімкнуть о " : "Вимкнуть о ")
                + HM.format(Instant.ofEpochMilli(nextChange).atZone(KYIV));
        } else {
            nextChangeTime = "";
            nextChangeLabel = "Змін не заплановано";
        }
    }

    /**
     * Применяет ответ `GET /schedules/upcoming?region=…&days=2`.
     *
     * Берём только отключения своей черги и только за сегодня/завтра (ответ и так ограничен
     * двумя сутками). `false` — ответ не разобрался: вызывающий оставляет прежний снимок, а не
     * стирает честные данные пустотой.
     */
    boolean applySchedulePayload(String payload) {
        try {
            JSONObject root = new JSONObject(payload);
            JSONArray buckets = root.optJSONArray("data");
            if (buckets == null) return false;
            String wanted = queue.trim();
            if (wanted.isEmpty()) return false;
            LocalDate todayDate = LocalDate.now(KYIV);
            LocalDate tomorrowDate = todayDate.plusDays(1);

            List<Interval> nextToday = new ArrayList<>();
            List<Interval> nextUpcoming = new ArrayList<>();
            long nowMs = System.currentTimeMillis();

            for (int index = 0; index < buckets.length(); index++) {
                JSONObject bucket = buckets.optJSONObject(index);
                if (bucket == null) continue;
                if (!wanted.equals(bucket.optString("queue", "").trim())) continue;
                LocalDate date;
                try {
                    date = LocalDate.parse(bucket.optString("date", ""));
                } catch (RuntimeException ignored) {
                    // Дата не разобралась — слот нельзя честно отнести к сегодня/завтра.
                    continue;
                }
                if (!date.equals(todayDate) && !date.equals(tomorrowDate)) continue;
                JSONArray intervals = bucket.optJSONArray("intervals");
                if (intervals == null) continue;
                for (int slot = 0; slot < intervals.length(); slot++) {
                    JSONObject item = intervals.optJSONObject(slot);
                    if (item == null) continue;
                    long start = parseInstant(item.optString("startsAt", ""));
                    long end = parseInstant(item.optString("endsAt", ""));
                    if (end <= start) continue;
                    Interval interval = new Interval(start, end);
                    if (date.equals(todayDate)) nextToday.add(interval);
                    if (end > nowMs) nextUpcoming.add(interval);
                }
            }

            nextUpcoming.sort((left, right) -> Long.compare(left.startMs, right.startMs));
            nextToday.sort((left, right) -> Long.compare(left.startMs, right.startMs));
            today.clear();
            today.addAll(nextToday);
            upcoming.clear();
            upcoming.addAll(nextUpcoming);
            return true;
        } catch (JSONException ignored) {
            return false;
        }
    }

    /** ISO-8601 из Worker (`2026-10-18T19:00:00.000Z` или с офсетом). */
    private static long parseInstant(String value) {
        if (value == null || value.isEmpty()) return 0L;
        try {
            return Instant.parse(value).toEpochMilli();
        } catch (RuntimeException ignored) {
            // OffsetDateTime понимает `+03:00`, который Instant.parse отвергает.
        }
        try {
            return OffsetDateTime.parse(value).toInstant().toEpochMilli();
        } catch (RuntimeException ignored) {
            return 0L;
        }
    }

    /** «10:00–13:00, 18:00–21:00» — сегодняшние окна в киевском времени. */
    String todayScheduleLabel() {
        if (today.isEmpty()) return "";
        List<String> parts = new ArrayList<>();
        for (Interval interval : today) {
            parts.add(
                HM.format(Instant.ofEpochMilli(interval.startMs).atZone(KYIV))
                    + "–"
                    + HM.format(Instant.ofEpochMilli(interval.endMs).atZone(KYIV))
            );
        }
        return String.join(", ", parts);
    }

    /**
     * «5 год 30 хв» — без знака минус.
     *
     * Раньше здесь стояло «−5 год 30 хв», и в одной строке со «Світло є» это читалось как
     * «время ушло в минус на пять с половиной часов» или как «осталось 5 ч 30 мин». На самом
     * деле это суммарные часы без света за сутки. Минус убран, а подпись говорит явно.
     */
    String hoursLabel() {
        int total = (int) Math.round(Math.max(0, todayOutageHours) * 60);
        if (total <= 0) return "0 хв";
        if (total < 60) return total + " хв";
        int wholeHours = total / 60;
        int rest = total % 60;
        return rest == 0 ? wholeHours + " год" : wholeHours + " год " + rest + " хв";
    }

    /** Отключение, которое идёт прямо сейчас, либо null. */
    Interval currentOff(long nowMs) {
        Interval found = null;
        for (Interval interval : upcoming) {
            if (interval.startMs <= nowMs && nowMs < interval.endMs) {
                if (found == null || interval.endMs > found.endMs) found = interval;
            }
        }
        return found;
    }

    /** Ближайшее ещё не начавшееся отключение, либо null. */
    Interval nextOff(long nowMs) {
        Interval found = null;
        for (Interval interval : upcoming) {
            if (interval.startMs > nowMs) {
                if (found == null || interval.startMs < found.startMs) found = interval;
            }
        }
        return found;
    }

    /** Последнее уже закончившееся окно за сегодня (для приглушённого чипа «минуло»). */
    Interval lastEndedToday(long nowMs) {
        Interval found = null;
        for (Interval interval : today) {
            if (interval.endMs <= nowMs) {
                if (found == null || interval.endMs > found.endMs) found = interval;
            }
        }
        return found;
    }

    /** Крупная строка виджета: «До 20:00» либо «Увімкнуть о 13:00». */
    String heroCountdown(long nowMs) {
        Interval current = currentOff(nowMs);
        if (current != null) return "Увімкнуть о " + HM.format(Instant.ofEpochMilli(current.endMs).atZone(KYIV));
        Interval next = nextOff(nowMs);
        if (next != null) return "До " + HM.format(Instant.ofEpochMilli(next.startMs).atZone(KYIV));
        return "Змін не заплановано";
    }

    /** Подпись под крупной строкой: «наступне відключення 20:00–22:00». */
    String nextWindowLabel(long nowMs) {
        Interval window = currentOff(nowMs);
        if (window == null) window = nextOff(nowMs);
        if (window == null) return "";
        return HM.format(Instant.ofEpochMilli(window.startMs).atZone(KYIV))
            + "–"
            + HM.format(Instant.ofEpochMilli(window.endMs).atZone(KYIV));
    }

    /** «✓ 09:30–13:00» — чип прошедшего окна. */
    String chipLabel(Interval interval) {
        if (interval == null) return "";
        return HM.format(Instant.ofEpochMilli(interval.startMs).atZone(KYIV))
            + "–"
            + HM.format(Instant.ofEpochMilli(interval.endMs).atZone(KYIV));
    }

    /** Длительность окна словами: «2 год» / «3 год 30 хв». */
    String durationLabel(Interval interval) {
        if (interval == null) return "";
        int total = (int) Math.max(0, Math.round((interval.endMs - interval.startMs) / 60_000.0));
        if (total < 60) return total + " хв";
        int hours = total / 60;
        int rest = total % 60;
        return rest == 0 ? hours + " год" : hours + " год " + rest + " хв";
    }

    /** «Оновлено о 16:24» из ISO-метки снимка; пустая строка, если метки нет. */
    String updatedLabel() {
        long ms = parseInstant(updatedAt);
        if (ms <= 0) return "";
        return HM.format(Instant.ofEpochMilli(ms).atZone(KYIV));
    }
}
