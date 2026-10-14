#!/usr/bin/env node
/**
 * Генерация иконок приложения для Android (и PWA) из одного SVG-источника.
 *
 * Зачем свой скрипт, а не @capacitor/assets: тот требует `sharp` (нативный модуль, у нас
 * build-скрипты pnpm блокирует, а на хосте нет Android-инструментов). Здесь только чистый JS:
 * SVG → PNG нужных размеров. Исходник иконки — единственный файл правды, все размеры
 * выводятся из него, поэтому иконка приложения и PWA не расходятся.
 *
 * Запуск: node apps/web/scripts/generate-android-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const svgPath = path.join(webRoot, 'public/icons/icon.svg');
const outDir = path.join(webRoot, 'android/app/src/main/res');

/** Исходная иконка: тот же синий фон с молнией, что и в PWA-манифесте. */
const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1e40af"/><path d="M290 52 142 278h101l-21 182 148-239H268l22-169Z" fill="#fff"/></svg>`;

/**
 * Плотности Android → размер иконки в px. Квадраты нужны для launcher'а (здесь Android
 * до сих пор ждёт квадрат, а не adaptive icon с вырезом), плюс отдельный foreground для
 * adaptive-иконки Android 8+ — она сама накладывает маску на любую форму.
 */
const LAUNCHER_ICONS = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

/** Adaptive icon: слой 108dp, безопасная зона — центральные 72dp (треть с каждой стороны). */
const ADAPTIVE_FOREGROUND = [
  { dir: 'mipmap-mdpi', size: 108 },
  { dir: 'mipmap-hdpi', size: 162 },
  { dir: 'mipmap-xhdpi', size: 216 },
  { dir: 'mipmap-xxhdpi', size: 324 },
  { dir: 'mipmap-xxxhdpi', size: 432 },
];

/**
 * Минимальный PNG-энкодер (только truecolor + альфа), без зависимостей.
 *
 * Своя реализация, потому что ради иконок тянуть canvas/sharp несоразмерно: нужен ровно
 * один кадр — заливка фоном и один многоугольник. Формат: 8-бит RGBA, фильтр строки 0,
 * zlib-уровень из стандартной библиотеки node.
 */
import zlib from 'node:zlib';

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Кодирует RGBA-пиксели в PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // truecolor + alpha
  // Каждая строка: filter byte 0 + RGBA-байты.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Молния из исходного SVG (координаты 512×512), для перерисовки по пунктиру. */
const BOLT_PATH = [
  [290, 52], [142, 278], [243, 278], [222, 460], [370, 221], [268, 221], [290, 52],
];

/** Точка внутри многоугольника (ray casting). */
function insidePolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Рисует иконку: синий скруглённый квадрат + белая молния, сглаженная суперсэмплингом.
 *
 * Сглаживание обязательно: без него на 48×48 диагонали молнии превращаются в лесенку,
 * и лаунчер выглядит «пиксельно» рядом с системными иконками.
 */
function renderIcon(size, { adaptive = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4;
  // В adaptive-иконке фон не рисуем: его подставляет система своим цветом/маской,
  // а молня должна занимать только безопасные центральные 2/3.
  const boltScale = adaptive ? (size / 512) * (72 / 108) * 2.4 : size / 512;
  const boltOffset = adaptive ? (size - 512 * boltScale) / 2 : 0;
  const radius = adaptive ? 0 : 112 * (size / 512);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgHits = 0;
      let boltHits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const boltPoint = [(px - boltOffset) / boltScale, (py - boltOffset) / boltScale];
          if (insidePolygon(boltPoint[0], boltPoint[1], BOLT_PATH)) boltHits += 1;
          if (!adaptive) {
            const inX = px >= 0 && px < size;
            const inY = py >= 0 && py < size;
            let inRounded = false;
            if (inX && inY) {
              // Скругление углов: внутри «круга» радиуса radius в каждом углу квадрата.
              const cx = px < radius ? radius : px > size - radius ? size - radius : px;
              const cy = py < radius ? radius : py > size - radius ? size - radius : py;
              const dx = px - cx;
              const dy = py - cy;
              inRounded = dx * dx + dy * dy <= radius * radius;
            }
            if (inRounded) bgHits += 1;
          }
        }
      }
      const total = samples * samples;
      const bgAlpha = adaptive ? 0 : bgHits / total;
      const boltAlpha = boltHits / total;
      const offset = (y * size + x) * 4;
      if (boltAlpha > 0) {
        // Молния непрозрачная поверх фона (или поверх прозрачности в adaptive-режиме).
        rgba[offset] = Math.round(255 * boltAlpha + rgba[offset] * (1 - boltAlpha));
        rgba[offset + 1] = Math.round(255 * boltAlpha + rgba[offset + 1] * (1 - boltAlpha));
        rgba[offset + 2] = Math.round(255 * boltAlpha + rgba[offset + 2] * (1 - boltAlpha));
      }
      rgba[offset + 3] = Math.round(255 * (Math.max(bgAlpha, boltAlpha)));
      if (!adaptive && bgAlpha > 0) {
        // Фон #1e40af, молния перекрывает его там, где boltAlpha == 1.
        const bgBlue = [30, 64, 175];
        const covered = boltAlpha;
        rgba[offset] = Math.round(bgBlue[0] * bgAlpha * (1 - covered) + rgba[offset]);
        rgba[offset + 1] = Math.round(bgBlue[1] * bgAlpha * (1 - covered) + rgba[offset + 1]);
        rgba[offset + 2] = Math.round(bgBlue[2] * bgAlpha * (1 - covered) + rgba[offset + 2]);
      }
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const { dir, size } of LAUNCHER_ICONS) {
  mkdirSync(path.join(outDir, dir), { recursive: true });
  writeFileSync(path.join(outDir, dir, 'ic_launcher.png'), renderIcon(size));
  writeFileSync(path.join(outDir, dir, 'ic_launcher_round.png'), renderIcon(size));
  console.log(`${dir}/ic_launcher.png ${size}×${size}`);
}
for (const { dir, size } of ADAPTIVE_FOREGROUND) {
  mkdirSync(path.join(outDir, dir), { recursive: true });
  writeFileSync(path.join(outDir, dir, 'ic_launcher_foreground.png'), renderIcon(size, { adaptive: true }));
  console.log(`${dir}/ic_launcher_foreground.png ${size}×${size} (adaptive)`);
}

// Фон adaptive-иконки — плотный синий, его рисует система под маской любой формы.
const BACKGROUND_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Цвет фона adaptive-иконки: та же точка #1e40af, что и у квадратной иконки и PWA-манифеста.
     Система Android 8+ накладывает на этот слой маску по форме (круг/скруглённый квадрат). -->
<resources>
    <color name="ic_launcher_background">#1e40af</color>
</resources>
`;
mkdirSync(path.join(outDir, 'values'), { recursive: true });
writeFileSync(path.join(outDir, 'values/ic_launcher_background.xml'), BACKGROUND_XML);
console.log('values/ic_launcher_background.xml');

// Исходный SVG остаётся в проекте: из него же генерируются PWA-иконки, источник правды один.
mkdirSync(path.join(webRoot, 'public/icons'), { recursive: true });
writeFileSync(svgPath, SOURCE_SVG);
console.log(`источник: ${path.relative(webRoot, svgPath)}`);