import React from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Состояние сети. Ровно четыре, и они не заменяют друг друга.
 *
 * Ключевое правило проекта: «Світло є» зелёным показывается ТОЛЬКО когда данные подтверждают
 * отсутствие отключений. Поэтому состояний пять, а не четыре: `allClear` — день опубликован,
 * отключений в нём нет (зелёный), и `unknown` — данных нет (графит). Зелёный при пустом графике
 * без публикации означал бы, что оператор подтвердил отсутствие отключений, а это не так.
 */
export type NetworkState = 'on' | 'soon' | 'off' | 'allClear' | 'unknown';

const DOT_STYLE: Record<NetworkState, string> = {
  // Изумруд
  on: 'bg-success',
  // Янтарь: скоро выключат
  soon: 'bg-warning',
  // Рубин: света нет
  off: 'bg-destructive',
  // Изумруд: день опубликован, отключений нет
  allClear: 'bg-success',
  // Графит: данных нет
  unknown: 'bg-unknown',
};

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: NetworkState;
  /** Размер точки. По умолчанию 10px — читается рядом с текстом, не превращаясь в бусину. */
  size?: 'sm' | 'md' | 'lg';
}

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3.5 w-3.5',
};

/**
 * Точка статуса. Цвет ВСЕГДА дублируется текстом рядом (см. компоненты, которые её
 * используют): человек с дальтонизмом или на сером экране различия «изумруд/рубин» не увидит,
 * и единственный носитель смысла здесь — цвет, поэтому он не может быть единственным.
 */
export const StatusDot: React.FC<StatusDotProps> = ({ state, size = 'md', className, ...rest }) => (
  <span
    aria-hidden
    className={cn('inline-block shrink-0 rounded-full', SIZE[size], DOT_STYLE[state], className)}
    {...rest}
  />
);
