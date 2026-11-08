/**
 * Тексти банера режиму мережі для мобільного застосунку.
 *
 * Чиста функція без React Native: так само, як `schedule-change-view.ts`, вона перевіряється
 * у vitest без рендера. Компонент лише малює те, що повернула ця функція, і бере іконку Lucide
 * за `tone`. Жодних емодзі — тон задають колір і векторна іконка.
 */
import type { GridRegimeSnapshot } from '@svitlo/shared';

export type GridRegimeTone = 'critical' | 'alert' | 'neutral' | 'info';

export interface GridRegimeBannerView {
  tone: GridRegimeTone;
  title: string;
  body: string;
  /** Перелік черг для ГАВ, якщо режим стосується не всіх. */
  queues: string[];
}

/** Тон і текст для кожного режиму; ГОП/ГОЕ та локальна аварія не лякають даремно. */
export function gridRegimeBannerView(regime: GridRegimeSnapshot): GridRegimeBannerView {
  switch (regime.kind) {
    case 'SGAV':
      return {
        tone: 'critical',
        title: 'Введено СГАВ (спеціальний графік аварійних відключень)',
        body: 'Критична ситуація за командою НЕК Укренерго. Погодинні графіки (ГПВ) зараз не діють.',
        queues: [],
      };
    case 'GAV':
      return {
        tone: 'alert',
        title: 'Екстрені аварійні відключення (ГАВ)',
        body: 'Погодинні графіки тимчасово не діють — час відновлення залежить від команди Укренерго.',
        queues: regime.affectedQueues === 'all' ? [] : regime.affectedQueues,
      };
    case 'GOP_GOE':
      return {
        tone: 'neutral',
        title: 'Обмеження потужності (ГОП)',
        body: 'Діють обмеження потужності (ГОП) лише для промисловості та бізнесу. Для населення — за графіком.',
        queues: [],
      };
    case 'LOCAL_EMERGENCY':
      return {
        tone: 'info',
        title: 'Локальні аварії в мережі',
        body: 'Зафіксовано локальні мережеві аварії в області. Погодинні графіки ГПВ продовжують діяти.',
        queues: [],
      };
    default:
      return { tone: 'neutral', title: regime.titleUk, body: regime.messageUk, queues: [] };
  }
}
