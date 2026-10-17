import React, { useId } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Линия прогресса слота — волнистая змейка состояния (M3 wavy progress).
 *
 * ГЕОМЕТРИЯ. Волна спокойная, но заметная: амплитуда 4.5px, длина волны 28px, толщина линии
 * 3.5px, высота полосы 32px. Раньше линия была вдвое тоньше и ниже (2.5px / 24px) — на телефоне
 * её приходилось разглядывать, а рядом стоящий таймер визуально её перевешивал. Амплитуда не
 * зависит от состояния: форма одна на все состояния, меняются только цвет (токены состояния) и
 * скорость течения (проп `tone`), иначе полоса «дышала» и читалась как дрожание.
 *
 * ПОЧЕМУ ТАЙЛ, А НЕ ОДНА ДЛИННАЯ КРИВАЯ. Ширина слота неизвестна (телефон 320px, десктоп
 * 1200px). Одна кривая на всю ширину потребовала бы либо растяжки
 * (`preserveAspectRatio="none"` даёт разную длину волны на разных экранах), либо замера ширины
 * через ResizeObserver — лишний ре-рендер на каждом повороте экрана. Здесь волна живёт в
 * `<pattern>` шириной ровно в одну длину волны и внутри него сдвигается на ту же длину: цикл
 * бесшовный, геометрия одинакова на любом экране, анимация — чистый CSS (wave-slide).
 *
 * ПРОЙДЕННАЯ ЧАСТЬ — ВОЛНА, ОСТАВШАЯСЯ — ПРЯМАЯ. Так сразу видно, где «сейчас»: на стыке стоит
 * белая риска-ползунок, а спокойный серый хвост не отвлекает от цифр.
 */

export type WaveTone = 'on' | 'warning' | 'off' | 'unknown';

/** Длина волны, высота полосы, толщина линии и амплитуда — в пикселях. Сдвиг волны = длина. */
const WAVELENGTH = 28;
const STRIP_HEIGHT = 32;
const STROKE = 3.5;
const AMPLITUDE = 4.5;

/** Скорость течения волны: у спокойных состояний медленнее — тревога не «несётся». */
const SPEED: Record<WaveTone, number> = { on: 1.3, warning: 1.8, off: 2.4, unknown: 3 };

/**
 * Одна волна как путь из квадратичных кривых: вверх и вниз с общим наклоном на стыке, поэтому
 * кривая гладкая, без излома посреди волны. Координаты в пикселях: `viewBox` не задаём, значит
 * пользовательские единицы SVG равны пикселям разметки.
 */
function sineWave(offset: number, mid: number): string {
  const quarter = WAVELENGTH / 4;
  const half = WAVELENGTH / 2;
  // У квадратичной кривой высота подъёма равна половине управляющей точки.
  const control = AMPLITUDE * 2;
  const segment = (start: number, direction: -1 | 1): string =>
    `Q ${start + quarter} ${mid + direction * control} ${start + half} ${mid}`;
  return `M ${offset} ${mid} ${segment(offset, -1)} ${segment(offset + half, 1)}`;
}

export interface WavyProgressBarProps {
  /** 0…100: насколько слот (отключение или «світло є») уже прошёл. */
  progress: number;
  /** Состояние сети: задаёт скорость течения волны. Цвет приходит токенами состояния. */
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
  // Идентификатор паттерна: url(#…) не принимает «:» из useId().
  const waveId = `wave-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const mid = STRIP_HEIGHT / 2;

  return (
    <div className={cn('w-full', className)} {...rest}>
      <div className="relative h-8">
        {/* Оставшаяся часть — спокойная прямая линия на всю ширину. */}
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-track" aria-hidden />

        {/* Пройденная часть — волна цвета состояния: обрезка по контейнеру задаёт её конец. */}
        <div
          className="absolute inset-y-0 left-0 overflow-hidden text-status transition-[width] duration-700 ease-m3-standard"
          style={{ width: `${clamped}%` }}
          aria-hidden
        >
          <svg className="absolute left-0 top-0 h-8 w-full">
            <defs>
              <pattern id={waveId} width={WAVELENGTH} height={STRIP_HEIGHT} patternUnits="userSpaceOnUse">
                {/* Копия волны со сдвигом ровно на длину волны: за время цикла группа уезжает
                    влево на одну длину, и картинка в тайле совпадает сама с собой — шва нет. */}
                <g
                  className="animate-wave-slide"
                  style={{ ['--wave-shift' as string]: `-${WAVELENGTH}px`, animationDuration: `${SPEED[tone]}s` }}
                >
                  <path d={sineWave(0, mid)} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
                  <path
                    d={sineWave(WAVELENGTH, mid)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                  />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${waveId})`} />
          </svg>
        </div>

        {/* Риска-ползунок на стыке: белая, с ореолом цвета состояния. */}
        <span
          className="absolute top-1/2 z-10 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white text-status shadow-[0_0_10px_currentColor] transition-[left] duration-700 ease-m3-standard"
          style={{ left: `${clamped}%` }}
          aria-hidden
        />
      </div>

      {(elapsedLabel || percentLabel || remainingLabel) && (
        // Подписи переносятся, а не обрезаются: «Пройшло 5 год 38 хв» с многоточием
        // выглядело как обрыв данных, а на телефоне с крупным системным шрифтом
        // обрезались сразу две из трёх подписей.
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-semibold leading-snug text-on-surface-variant sm:text-xs">
          {elapsedLabel && <span className="whitespace-nowrap">{elapsedLabel}</span>}
          {percentLabel && <span className="tabular text-on-surface">{percentLabel}</span>}
          {remainingLabel && <span className="ml-auto whitespace-nowrap text-right">{remainingLabel}</span>}
        </div>
      )}
    </div>
  );
};
