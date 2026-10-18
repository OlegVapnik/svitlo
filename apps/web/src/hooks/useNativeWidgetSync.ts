import { useEffect, useMemo } from 'react';

/**
 * Снимок расписания для нативного Android-виджета и фоновых будильников.
 *
 * Зачем мост. WebView не умеет рисовать виджет рабочего стола и не переживает выгрузку
 * приложения из памяти. Поэтому веб считает состояние (оно уже посчитано для героя главной),
 * отдаёт компактный JSON в `window.SvitloNative.syncState`, а Java-сторона кладёт его в
 * SharedPreferences, обновляет `AppWidgetManager` и планирует уведомления.
 *
 * С v2.17.0 снимок — не единственный источник: Java раз в 30 минут (и по кнопке «Оновити» на
 * виджете) перезапрашивает `/schedules/upcoming` по `apiBaseUrl` + `regionCpu` и пересчитывает
 * статус по часам телефона. Для этого в снимок входят адрес API, CPU области и сегодняшние
 * интервалы: без них фоновая синхронизация не знала бы, что именно запрашивать.
 *
 * В браузере моста нет — хук молча ничего не делает. Это не ошибка: виджет существует
 * только в APK, а веб-версия должна работать без него.
 */
export interface NativeUpcomingInterval {
  startEpochMs: number;
  endEpochMs: number;
}

export interface NativeWidgetState {
  regionName: string;
  /** CPU области: по нему фоновая синхронизация виджета знает, что запрашивать. */
  regionCpu: string;
  /** Адрес API, вшитый в сборку: в PWA относительный `/api/v1`, и фоновая сеть просто не идёт. */
  apiBaseUrl: string;
  queue: string;
  isOff: boolean;
  statusText: string;
  nextChangeTime: string | null;
  nextChangeLabel: string;
  todayOutageHours: number;
  /** Все будущие отключения (сегодня + завтра) — по ним Java планирует будильники. */
  upcomingIntervals: NativeUpcomingInterval[];
  /** Только сегодняшние окна: панель 4×2 показывает их списком и считает часы без света. */
  todayIntervals: NativeUpcomingInterval[];
}

export function useNativeWidgetSync(state: NativeWidgetState | null): void {
  // Сериализуем здесь, а не в вызывающем компоненте: объект пересоздаётся на каждом рендере,
  // а эффект должен срабатывать только когда меняется содержимое снимка.
  const serialized = useMemo(() => (state ? JSON.stringify(state) : null), [state]);

  useEffect(() => {
    if (!serialized || typeof window === 'undefined') return;
    try {
      // Мост вызывается через рефлексию WebView: его отсутствие или ошибка не должны
      // ломать рендер главной.
      window.SvitloNative?.syncState?.(serialized);
    } catch {
      // Виджет — необязательная часть: в браузере и в старом APK моста просто нет.
    }
  }, [serialized]);
}
