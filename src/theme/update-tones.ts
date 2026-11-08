/**
 * Цвета смысловых групп чейнджлога.
 *
 * Не часть темы: зелёный/голубой/фиолетовый означают «можливість / виправлення / швидкість»,
 * а не состояние сети, поэтому при смене палитры они не должны меняться. Значения совпадают
 * с веб-версией шторки, чтобы человек узнавал группы на обоих клиентах.
 */
export interface UpdateTone {
  /** Точка перед пунктом и иконка группы. */
  dot: string;
  /** Мягкая подложка пилюли. */
  soft: string;
  border: string;
  text: string;
}

export const UPDATE_TONES = {
  feature: {
    dot: '#10b981',
    soft: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.32)',
    text: '#34d399',
  },
  fix: {
    dot: '#38bdf8',
    soft: 'rgba(56, 189, 248, 0.14)',
    border: 'rgba(56, 189, 248, 0.32)',
    text: '#7dd3fc',
  },
  optimization: {
    dot: '#a78bfa',
    soft: 'rgba(167, 139, 250, 0.14)',
    border: 'rgba(167, 139, 250, 0.32)',
    text: '#c4b5fd',
  },
} as const satisfies Record<string, UpdateTone>;
