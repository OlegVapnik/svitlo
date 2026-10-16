import React, { useId } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * M3 Expressive Wavy Progress Indicator — «волнистая змейка» Android 16.
 *
 * ЧТО ЭТО. Пройденная часть слота рисуется бегущей синусоидой (SVG `<path>` из кривых Безье),
 * на стыке стоит пухлый вертикальный пилл-ползунок (M3 Expressive Thumb), оставшаяся часть —
 * спокойная прямая дорожка с микро-точками на концах.
 *
 * ПОЧЕМУ ТАЙЛ, А НЕ ОДНА ДЛИННАЯ КРИВАЯ. Ширина слота неизвестна (телефон 320px, десктоп 1200px).
 * Одна кривая на всю ширину потребовала бы либо растяжки (`preserveAspectRatio="none"` даёт
 * разную длину волны на разных экранах), либо замера ширины через ResizeObserver — лишний
 * ре-рендер на каждом повороте экрана. Здесь волна живёт в `<pattern>` шириной ровно в одну
 * длину волны и внутри него сдвигается на ту же длину: цикл бесшовный, геометрия волны
 * одинаковая на любом экране, анимация — чистый CSS (`@keyframes wave-slide`).
 *
 * СМЫСЛ АМПЛИТУДЫ. Форма полосы честно повторяет состояние: когда свет есть — волна идёт
 * бодро и высоко, во время отключения амплитуда затухает в «технический пунктир», но оживает
 * к концу слота (человек видит, что включение близко). Нет данных — ровный пунктир.
 */

export type WaveTone = 'on' | 'warning' | 'off' | 'unknown';

/** Длина волны, высота полосы и толщина линии в пикселях. Сдвиг волны равен длине волны. */
const WAVELENGTH = 22;
const STRIP_HEIGHT = 16;
const STROKE = 4.5;

interface WaveGeometry {
  /** Амплитуда волны: половина размаха, в пикселях. */
  amplitude: number;
  /** Пунктир линии: спокойный технический ритм вместо сплошной волны. */
  dash?: string;
  /** Длительность одного прохода волны. */
  duration: number;
}

/** Пресеты формы волны по состоянию сети. */
const TONES: Record<WaveTone, WaveGeometry> = {
  on: { amplitude: 3.2, duration: 1.05 },
  warning: { amplitude: 2.6, duration: 1.7 },
  off: { amplitude: 1.1, dash: '2 3.5', duration: 2.6 },
  unknown: { amplitude: 0.9, dash: '2 4', duration: 3.4 },
};

/**
 * Одна волна как путь из кривых Безье: две квадратичные дуги (вверх и вниз) с одинаковым
 * наклоном в точке стыка — поэтому кривая гладкая, без излома посреди волны.
 * Координаты в пользовательских единицах SVG, которые без `viewBox` равны пикселям.
 */
function sineWave(offset: number, amplitude: number): string {
  const mid = STRIP_HEIGHT / 2;
  const half = WAVELENGTH / 2;
  // У квадратичной кривой пик равен половине управляющей точки.
  const control = amplitude * 2;
  const segment = (start: number, direction: -1 | 1): string =>
    `Q ${start + half / 2} ${mid + direction * control} ${start + half} ${mid}`;
  return `M ${offset} ${mid} ${segment(offset, -1)} ${segment(offset + half, 1)}`;
}

export interface WavyProgressBarProps {
  /** 0…100: насколько слот (отключение или «світло є») уже прошёл. */
  progress: number;
  /** Состояние сети: задаёт амплитуду, скорость и цвет волны. */
  tone?: WaveTone;
  /** Подпись слева — обычно «Пройшло 1 год 20 хв». */
  elapsedLabel?: string;
  /** Подпись справа — «Залишилось 2 год». */
  remainingLabel?: string;
  /** Центральная подпись с процентом завершения слота. */
  percentLabel?: string;
  className?: string;
  'aria-label'?: string;
}

export const WavyProgressBar: React.FC<WavyProgressBarProps> = ({
  progress,
  tone = 'on',
  elapsedLabel,
  remainingLabel,
  percentLabel,
  className,
  ...rest
}) => {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0));
  // Идентификатор pattern обязан быть валидным для url(#…): useId() содержит «:».
  const patternId = `wave-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Отключение, которое почти закончилось: волна снова набирает амплитуду — «оживает».
  const geometry = tone === 'off' && clamped >= 66 ? { amplitude: 2.4, duration: 1.3 } : TONES[tone];
  const fillColor =
    tone === 'off'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'unknown'
          ? 'text-unknown'
          : 'text-primary';

  return (
    <div className={cn('w-full', className)}>
      <div
        className="relative h-7 w-full"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={rest['aria-label']}
      >
        {/* Оставшаяся часть: спокойная прямая дорожка с микро-точками на концах. */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-on-surface/15" aria-hidden />
        <span className="absolute left-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-on-surface/25" aria-hidden />
        <span className="absolute right-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-on-surface/25" aria-hidden />

        {/* Пройденная часть: бегущая волна. `currentColor` наследуется от класса тона, поэтому
            цвет один на волну, ползунок и свечение. */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-700 ease-[var(--ease-m3-expressive-default)]',
            fillColor,
          )}
          style={{ width: `${clamped}%` }}
          aria-hidden
        >
          <svg className="absolute left-0 top-1/2 h-4 w-full -translate-y-1/2 drop-shadow-[0_0_6px_currentColor]">
            <defs>
              <pattern id={patternId} width={WAVELENGTH} height={STRIP_HEIGHT} patternUnits="userSpaceOnUse">
                {/* Копия волны со сдвигом на длину волны: за время цикла группа уезжает влево
                    ровно на одну длину, и картинка в тайле совпадает сама с собой — шва нет. */}
                <g
                  className="animate-wave-slide"
                  style={{ ['--wave-shift' as string]: `-${WAVELENGTH}px`, animationDuration: `${geometry.duration}s` }}
                >
                  <path
                    d={sineWave(0, geometry.amplitude)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={geometry.dash}
                  />
                  <path
                    d={sineWave(WAVELENGTH, geometry.amplitude)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={geometry.dash}
                  />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>
        </div>

        {/* Ползунок M3 Expressive: вертикальный пилл с пружинным переездом по слотам. */}
        <span
          className="absolute top-1/2 z-10 block h-7 w-2 -translate-y-1/2 rounded-full bg-primary text-primary shadow-[0_0_16px_currentColor] transition-[left] duration-700 ease-[var(--ease-m3-expressive-fast)]"
          style={{ left: `calc(${clamped}% - 0.25rem)` }}
          aria-hidden
        />
      </div>

      {(elapsedLabel || percentLabel || remainingLabel) && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-on-surface-variant">
          <span className="truncate">{elapsedLabel}</span>
          {percentLabel && <span className="shrink-0 tabular text-foreground">{percentLabel}</span>}
          <span className="truncate text-right">{remainingLabel}</span>
        </div>
      )}
    </div>
  );
};

/**
 * WavyDivider — декоративный волнистый разделитель M3 Expressive внутри карточек.
 * Вектор, а не border: линия тонкая, но «дышит» вместе с интерфейсом.
 */
export const WavyDivider: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={cn('h-2.5 w-full text-outline-variant', className)}
    viewBox="0 0 120 10"
    preserveAspectRatio="none"
    aria-hidden
    focusable="false"
  >
    <path
      d="M 0 5 Q 5 0.5 10 5 Q 15 9.5 20 5 Q 25 0.5 30 5 Q 35 9.5 40 5 Q 45 0.5 50 5 Q 55 9.5 60 5 Q 65 0.5 70 5 Q 75 9.5 80 5 Q 85 0.5 90 5 Q 95 9.5 100 5 Q 105 0.5 110 5 Q 115 9.5 120 5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);
