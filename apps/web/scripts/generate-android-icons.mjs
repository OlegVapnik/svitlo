#!/usr/bin/env node
/**
 * Генерация иконок Android и splash из одного SVG-источника.
 *
 * Источник правды — apps/web/public/icons/icon.svg. В нём две группы:
 *   <g id="background"> — фон, кольца и блик;
 *   <g id="foreground"> — молния и искры.
 *
 * Из этих слоёв скрипт собирает:
 *   • обычную иконку лаунчера (скруглённый квадрат);
 *   • круглую иконку для лаунчеров с круглой маской;
 *   • adaptive-иконку Android 8+: отдельный фон и foreground с запасом под маску;
 *   • maskable-иконку для PWA (полный фон, безопасная зона);
 *   • splash-экраны для всех плотностей.
 *
 * PNG рендерит rsvg-convert. На хосте он не нужен: сборщик APK запускает этот
 * скрипт внутри Docker-образа svitlo-android-builder (там есть nodejs и librsvg2-bin).
 * Режим --svg-only пишет только icon-maskable.svg и не требует rsvg — он выполняется
 * на хосте перед сборкой веба, чтобы maskable-иконка попала в dist.
 *
 * Запуск:
 *   node apps/web/scripts/generate-android-icons.mjs --svg-only
 *   node apps/web/scripts/generate-android-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const sourcePath = path.join(webRoot, 'public/icons/icon.svg');
const publicIconsDir = path.join(webRoot, 'public/icons');
const resDir = path.join(webRoot, 'android/app/src/main/res');
const svgOnly = process.argv.includes('--svg-only');

/** Adaptive-слой: 108dp, безопасная зона — центральные 66dp. */
const ADAPTIVE_SCALE = 0.7;
/** Maskable PWA: безопасная зона — центральные 80% иконки. */
const MASKABLE_SCALE = 0.72;

const LAUNCHER_ICONS = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const ADAPTIVE_LAYERS = [
  { dir: 'mipmap-mdpi', size: 108 },
  { dir: 'mipmap-hdpi', size: 162 },
  { dir: 'mipmap-xhdpi', size: 216 },
  { dir: 'mipmap-xxhdpi', size: 324 },
  { dir: 'mipmap-xxxhdpi', size: 432 },
];

/**
 * Размеры splash совпадают с тем, что уже использует Android-проект. Держим их
 * здесь, чтобы пересборка не зависела от старых PNG и не оставляла белую заглушку.
 */
const SPLASHES = [
  { dir: 'drawable', w: 480, h: 320 },
  { dir: 'drawable-land-mdpi', w: 480, h: 320 },
  { dir: 'drawable-land-hdpi', w: 800, h: 480 },
  { dir: 'drawable-land-xhdpi', w: 1280, h: 720 },
  { dir: 'drawable-land-xxhdpi', w: 1600, h: 960 },
  { dir: 'drawable-land-xxxhdpi', w: 1920, h: 1280 },
  { dir: 'drawable-port-mdpi', w: 320, h: 480 },
  { dir: 'drawable-port-hdpi', w: 480, h: 800 },
  { dir: 'drawable-port-xhdpi', w: 720, h: 1280 },
  { dir: 'drawable-port-xxhdpi', w: 960, h: 1600 },
  { dir: 'drawable-port-xxxhdpi', w: 1280, h: 1920 },
];

const source = readFileSync(sourcePath, 'utf8');
// Комментарии могут содержать примеры тегов <g id="...">; для поиска слоёв они только мешают.
const sourceLayers = source.replace(/<!--[\s\S]*?-->/g, '');
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
if (!defs) {
  throw new Error(`${path.relative(webRoot, sourcePath)}: не найден блок <defs>`);
}

/** Вырезает группу по id. В исходнике группы не должны содержать вложенных <g>. */
function extractGroup(svg, id) {
  const start = svg.indexOf(`<g id="${id}">`);
  if (start === -1) throw new Error(`В icon.svg нет группы <g id="${id}">`);
  const end = svg.indexOf('</g>', start);
  if (end === -1) throw new Error(`В icon.svg не закрыта группа <g id="${id}">`);
  return svg.slice(start, end + '</g>'.length);
}

function groupInner(group) {
  return group.replace(/^<g[^>]*>/, '').replace(/<\/g>$/, '');
}

function svgDocument(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n${defs}\n${body}\n</svg>\n`;
}

const background = extractGroup(sourceLayers, 'background');
const foreground = extractGroup(sourceLayers, 'foreground');
const foregroundInner = groupInner(foreground);

// Полный фон без скруглений: нужен adaptive-фону и maskable-иконке, где маску
// накладывает система, а не сам рисунок.
const fullBleedBackground = background.replace(/\brx="\d+"/g, 'rx="0"');
// Круглая иконка: квадрат 512×512 с радиусом 256 — это круг.
const roundBackground = background.replace(/\brx="\d+"/g, 'rx="256"');

const maskableSvg = svgDocument(
  `${fullBleedBackground}\n<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">${foregroundInner}</g>`,
);
const adaptiveForegroundSvg = svgDocument(
  `<g transform="translate(256 256) scale(${ADAPTIVE_SCALE}) translate(-256 -256)">${foregroundInner}</g>`,
);
const adaptiveBackgroundSvg = svgDocument(fullBleedBackground);
const roundSvg = svgDocument(`${roundBackground}\n${foreground}`);

mkdirSync(publicIconsDir, { recursive: true });
writeFileSync(path.join(publicIconsDir, 'icon-maskable.svg'), maskableSvg, 'utf8');
console.log('public/icons/icon-maskable.svg');

if (svgOnly) {
  console.log('режим --svg-only: PNG не рендерились');
  process.exit(0);
}

try {
  execFileSync('rsvg-convert', ['--version'], { stdio: 'pipe' });
} catch (error) {
  console.error('Не найден rsvg-convert. Запускайте сборку через ./tools/build-android-apk.sh —');
  console.error('в образе svitlo-android-builder он уже установлен.');
  process.exit(1);
}

const tmpDir = mkdtempSync(path.join(tmpdir(), 'svitlo-icons-'));

function writeTempSvg(name, contents) {
  const file = path.join(tmpDir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

function render(svgPath, outPath, width, height) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync('rsvg-convert', [
    '-w', String(width),
    '-h', String(height),
    '-o', outPath,
    svgPath,
  ], { stdio: 'pipe' });
}

function splashSvg(width, height, iconHref) {
  const min = Math.min(width, height);
  const tile = Math.round(min * 0.34);
  const cx = width / 2;
  const cy = Math.round(height * 0.46);
  const x = (width - tile) / 2;
  const y = cy - tile / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${defs}
<defs>
  <radialGradient id="splash-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#60a5fa" stop-opacity="0.30"/>
    <stop offset="1" stop-color="#60a5fa" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#bg)"/>
<rect width="${width}" height="${height}" fill="url(#light)"/>
<circle cx="${cx}" cy="${cy}" r="${min * 0.34}" fill="none" stroke="#93c5fd" stroke-opacity="0.14" stroke-width="${Math.max(1, min * 0.006)}"/>
<circle cx="${cx}" cy="${cy}" r="${min * 0.43}" fill="none" stroke="#93c5fd" stroke-opacity="0.07" stroke-width="${Math.max(1, min * 0.003)}"/>
<circle cx="${cx}" cy="${cy}" r="${tile * 0.85}" fill="url(#splash-glow)"/>
<rect x="${x}" y="${y + min * 0.02}" width="${tile}" height="${tile}" rx="${tile * 0.22}" fill="#020617" opacity="0.38"/>
<image x="${x}" y="${y}" width="${tile}" height="${tile}" href="${iconHref}"/>
</svg>`;
}

try {
  const iconSvgPath = sourcePath;
  // Для <image> в splash нужен SVG без комментариев: librsvg не подгружает внешний SVG,
  // внутри которого есть комментарии, и молния на splash оставалась пустым квадратом.
  const cleanIconPath = writeTempSvg('icon-clean.svg', sourceLayers);
  const cleanIconHref = pathToFileURL(cleanIconPath).href;
  const roundSvgPath = writeTempSvg('icon-round.svg', roundSvg);
  const adaptiveForegroundPath = writeTempSvg('icon-foreground.svg', adaptiveForegroundSvg);
  const adaptiveBackgroundPath = writeTempSvg('icon-background.svg', adaptiveBackgroundSvg);

  for (const { dir, size } of LAUNCHER_ICONS) {
    render(iconSvgPath, path.join(resDir, dir, 'ic_launcher.png'), size, size);
    render(roundSvgPath, path.join(resDir, dir, 'ic_launcher_round.png'), size, size);
    console.log(`${dir}/ic_launcher.png ${size}×${size}`);
  }

  for (const { dir, size } of ADAPTIVE_LAYERS) {
    render(adaptiveBackgroundPath, path.join(resDir, dir, 'ic_launcher_background.png'), size, size);
    render(adaptiveForegroundPath, path.join(resDir, dir, 'ic_launcher_foreground.png'), size, size);
    console.log(`${dir}/ic_launcher_{background,foreground}.png ${size}×${size}`);
  }

  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const file = path.join(resDir, 'mipmap-anydpi-v26', name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, adaptiveXml, 'utf8');
  }
  console.log('mipmap-anydpi-v26/ic_launcher{,_round}.xml');

  // Цветной фолбэк для старых ссылок на @color/ic_launcher_background.
  const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#081226</color>
</resources>
`;
  mkdirSync(path.join(resDir, 'values'), { recursive: true });
  writeFileSync(path.join(resDir, 'values/ic_launcher_background.xml'), colorXml, 'utf8');

  for (const { dir, w, h } of SPLASHES) {
    const splashPath = writeTempSvg(`splash-${w}x${h}.svg`, splashSvg(w, h, cleanIconHref));
    render(splashPath, path.join(resDir, dir, 'splash.png'), w, h);
    console.log(`${dir}/splash.png ${w}×${h}`);
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('источник: public/icons/icon.svg');
