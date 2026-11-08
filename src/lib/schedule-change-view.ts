import type { ScheduleChangeNotice } from '@svitlo/core/lib/schedule-change';

/** Готовий до рендеру вид чипа «Що змінилось»: тон і підпис. */
export interface ScheduleChangeView {
  /**
   * Куди змінився графік: `more` — годин без світла побільшало, `less` — оператор
   * прибрав частину відключень. Тон малює векторна іконка (Lucide), не емодзі.
   */
  trend: 'more' | 'less';
  title: string;
  summary: string;
  /** Київський час останньої правки (`HH:MM`); порожньо для старих записів. */
  timeLabel: string;
  /** Скільки правок уже накопичилося за добу. */
  historyCount: number;
}

/**
 * Чистий мапінг notice → текст чипа.
 *
 * Винесено з компонента, щоб тестувати без React Native: у мобільному клієнті vitest ганяє
 * лише `src/lib/*`, а сам чип тягне нативні модулі.
 */
export function scheduleChangeView(notice: ScheduleChangeNotice | null): ScheduleChangeView | null {
  if (!notice) return null;
  const latest = notice.revisions[notice.revisions.length - 1];
  return {
    // `more` — годин без світла побільшало, `less` — оператор прибрав частину відключень.
    trend: notice.addedMinutes > 0 ? 'more' : 'less',
    title: 'Що змінилось',
    summary: notice.summary,
    timeLabel: latest?.detectedAtLabel ?? '',
    historyCount: notice.revisions.length,
  };
}
