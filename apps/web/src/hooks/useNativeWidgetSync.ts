import { useEffect, useMemo } from 'react';

/**
 * Снимок расписания для нативного Android-виджета и фоновых будильников.
 *
 * Зачем мост. WebView не умеет рисовать виджет рабочего стола и не переживает выгрузку
 * приложения из памяти. Поэтому веб считает состояние (оно уже посчитано для героя главной),
 * отдаёт компактный JSON в `window.SvitloNative.syncState`, а Java-сторона кладёт его в
 * SharedPreferences, обновляет `AppWidgetManager` и планирует уведомления.
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
  queue: string;
  isOff: boolean;
  statusText: string;
  nextChangeTime: string | null;
  nextChangeLabel: string;
  todayOutageHours: number;
  upcomingIntervals: NativeUpcomingInterval[];
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
