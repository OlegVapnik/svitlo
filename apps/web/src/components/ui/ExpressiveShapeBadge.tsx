import React from 'react';
import { FileQuestion, Timer, Zap, ZapOff, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import type { NetworkState } from './StatusDot.js';

/**
 * M3 Expressive Shape Badge — фирменные многолепестковые фигуры Material 3 вокруг иконки.
 *
 * ЗАЧЕМ ФИГУРЫ, А НЕ КРУГ. Expressive-слой M3 строится на морфинге формы: статус узнаётся по
 * силуэту (scallop/cookie — «всё спокойно», clover — «внимание, скоро смена», полигон — «нет
 * света»), ещё до чтения текста. Это второй, независимый от цвета сигнал — важно для людей с
 * дальтонизмом и на солнце, где цвет выгорает.
 *
 * Векторные фигуры считаются полярной функцией и сглаживаются квадратичными кривыми через
 * середины отрезков (классический приём «smooth polygon»): один код на любую форму, без
 * внешних библиотек и без ручных path-строк в разметке.
 */

export type ExpressiveShape = 'scallop' | 'clover' | 'polygon';

/** Кэш геометрии: путь зависит только от вида фигуры, поэтому считаем один раз на форму. */
const PATH_CACHE = new Map<string, string>();

/** Точки фигуры в системе координат 100×100 (её же масштабирует viewBox). */
function shapePoints(kind: ExpressiveShape, petals: number, sides = 6): Array<[number, number]> {
  const size = 100;
  const center = size / 2;
  const radius = size / 2 - 5; // запас, чтобы обводка не обрезалась краем viewBox
  const steps = 120;
  const sector = (Math.PI * 2) / sides;
  const points: Array<[number, number]> = [];

  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    let r: number;
    if (kind === 'scallop') {
      // 8 лепестков-«ракушек»: мягкие бугры по кругу (M3 cookie shape).
      r = radius * (1 + 0.15 * Math.cos(petals * angle));
    } else if (kind === 'clover') {
      // 4-листный клевер: |sin 2θ| даёт четыре лепестка и аккуратные вырезы между ними.
      r = radius * (0.62 + 0.46 * Math.abs(Math.sin(2 * angle)));
    } else {
      // Скруглённый полигон: полярная форма шестиугольника (плоские грани, ровные углы).
      const local = (((angle % sector) + sector) % sector) - sector / 2;
      r = Math.min(radius, (radius * 0.98) / Math.cos(local));
    }
    points.push([center + r * Math.cos(angle), center + r * Math.sin(angle)]);
  }
  return points;
}

/** Замкнутый гладкий путь: квадратичные кривые через середины соседних отрезков. */
function smoothPath(points: Array<[number, number]>): string {
  const middle = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = points[points.length - 1]!;
  const start = middle(first, points[0]!);
  const round = (value: number) => value.toFixed(2);
  let path = `M ${round(start[0])} ${round(start[1])}`;

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const stop = middle(current, next);
    path += ` Q ${round(current[0])} ${round(current[1])} ${round(stop[0])} ${round(stop[1])}`;
  }
  return `${path} Z`;
}

/** Путь фигуры для разметки (кэшируется: полярная функция считается один раз на форму). */
export function shapePath(kind: ExpressiveShape, petals = 8): string {
  const key = `${kind}-${petals}`;
  const cached = PATH_CACHE.get(key);
  if (cached) return cached;
  const path = smoothPath(shapePoints(kind, petals));
  PATH_CACHE.set(key, path);
  return path;
}

/** Форма, тон и иконка для каждого состояния сети. */
const STATE_STYLE: Record<
  NetworkState,
  { shape: ExpressiveShape; wrapper: string; animation: string; icon: LucideIcon; outlineOnly?: boolean }
> = {
  on: {
    shape: 'scallop',
    wrapper: 'bg-primary text-on-primary',
    animation: 'animate-shape-spin',
    icon: Zap,
  },
  soon: {
    shape: 'clover',
    wrapper: 'bg-warning text-warning-foreground',
    animation: 'animate-shape-breathe',
    icon: Timer,
  },
  off: {
    shape: 'polygon',
    wrapper: 'bg-destructive text-destructive-foreground',
    animation: 'animate-shape-spin',
    icon: ZapOff,
  },
  unknown: {
    shape: 'scallop',
    wrapper: 'bg-unknown-soft text-muted-foreground',
    animation: '',
    icon: FileQuestion,
    outlineOnly: true,
  },
};

const SIZES = {
  sm: { box: 'h-9 w-9', icon: 'h-4 w-4' },
  md: { box: 'h-12 w-12', icon: 'h-5 w-5' },
  lg: { box: 'h-20 w-20', icon: 'h-9 w-9' },
} as const;

export interface ExpressiveShapeBadgeProps {
  state: NetworkState;
  size?: keyof typeof SIZES;
  /** Вращение фоновой фигуры. В списках лучше выключать: десяток анимаций ест батарею. */
  animated?: boolean;
  className?: string;
}

/**
 * Бейдж статуса: вращающаяся (или пульсирующая) M3-фигура с векторной иконкой внутри.
 * Иконка — только `lucide-react`, никаких текстовых эмодзи: они разъезжаются по шрифтам и
 * выглядят по-разному на Android, iOS и Windows.
 */
export const ExpressiveShapeBadge: React.FC<ExpressiveShapeBadgeProps> = ({
  state,
  size = 'md',
  animated = true,
  className,
}) => {
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  const dims = SIZES[size];

  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', dims.box, className)} aria-hidden>
      {/* Цветная подложка: цвет состояния читается и без фигуры (второй сигнал — силуэт). */}
      <span className={cn('absolute inset-[16%] block rounded-full', style.wrapper)} />
      {/* Фигура: второй, не-цветовой сигнал состояния. */}
      <svg
        viewBox="0 0 100 100"
        className={cn('absolute inset-0 h-full w-full', animated && style.animation)}
        style={animated && state === 'off' ? { animationDuration: '40s' } : undefined}
        focusable="false"
      >
        <path d={shapePath(style.shape)} fill="currentColor" className="opacity-15" />
        <path
          d={shapePath(style.shape)}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Иконка состояния. У активных состояний контур залит: на солнце тонкая линия пропадает. */}
      <Icon className={cn('relative', dims.icon, !style.outlineOnly && 'fill-current')} strokeWidth={2.2} />
    </span>
  );
};

/**
 * ShapeOutline — крупный декоративный контур M3-фигуры для фона карточек и Hero
 * («водяной знак» статуса). Цвет и прозрачность задаёт вызывающий компонент.
 */
export const ShapeOutline: React.FC<{
  kind?: ExpressiveShape;
  petals?: number;
  className?: string;
}> = ({ kind = 'scallop', petals = 8, className }) => (
  <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
    <path
      d={shapePath(kind, petals)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);
