#!/usr/bin/env node
/**
 * Генерация структурного чейнджлога приложения из истории git.
 *
 * Зачем отдельный шаг, если есть `git log`: сборка идёт в Docker, где репозитория нет, а в
 * PWA/Android-бандле история коммитов не нужна целиком. Поэтому чейнджлог — маленький JSON,
 * который коммитится и раздаётся по сети (GET /api/v1/changelog). Благодаря этому фикс,
 * задеплоенный на сервере, виден в уже установленном приложении без пересборки APK.
 *
 * Формат — сразу для экрана обновлений, а не для `git log`:
 *   releases: [{ version, date, tag, features[], fixes[], optimizations[] }]
 *   totalReleases / totalFeatures / totalFixes / totalOptimizations
 *   entries — плоская копия для старых установленных APK (обратная совместимость).
 *
 * Версия релиза берётся из тела коммита (`Версия 2.15.0.`) — так её писали при каждом релизе.
 * Коммит без версии относится к ближайшему более новому релизу: история идёт от свежих к старым,
 * поэтому это не догадка о будущем, а привязка к уже объявленной версии.
 *
 * Тексты — только для человека: trailer `Release-Note:` или курируемая запись в
 * tools/changelog-notes.json. Сырые тела коммитов не используются: в них обоснования для
 * разработчика, имена таблиц и лимиты инфраструктуры.
 *
 * Запуск: node tools/gen_changelog.mjs [--limit 30]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outPath = path.join(repoRoot, 'apps/api/src/data/changelog.json');
const webFallbackPath = path.join(repoRoot, 'apps/web/src/data/changelog.json');
const workerPath = path.join(repoRoot, 'cf-worker/src/data/changelog.json');
const notesPath = path.join(repoRoot, 'tools/changelog-notes.json');
const versionPath = path.join(repoRoot, 'apps/web/src/version.ts');

const CURRENT_VERSION = (() => {
  const match = /APP_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/u.exec(readFileSync(versionPath, 'utf8'));
  if (!match?.[1]) throw new Error('Не найден APP_VERSION в apps/web/src/version.ts');
  return match[1];
})();

const limitArgIndex = process.argv.indexOf('--limit');
const limit = limitArgIndex > -1 ? Number(process.argv[limitArgIndex + 1]) : 60;

/** Типы коммитов, которые значат что-то для человека, и их раздел в UI. */
const USER_FACING = {
  feat: 'features',
  fix: 'fixes',
  security: 'fixes',
  perf: 'optimizations',
};

const NOTE_SECTIONS = {
  new: 'features',
  feat: 'features',
  feature: 'features',
  fix: 'fixes',
  fixed: 'fixes',
  opt: 'optimizations',
  optimization: 'optimizations',
  perf: 'optimizations',
};

function loadCuratedNotes() {
  try {
    const parsed = JSON.parse(readFileSync(notesPath, 'utf8'));
    return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Не удалось прочитать ${path.relative(repoRoot, notesPath)}: ${error.message}`);
    }
    return {};
  }
}

const curatedNotes = loadCuratedNotes();

/**
 * Приводит пользовательский текст к одной аккуратной строке: убирает markdown-разметку,
 * переносы и обрезает слишком длинные абзацы по границе предложения или слова.
 */
function cleanNote(value) {
  const text = String(value)
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length <= 260) return text;
  const cut = text.slice(0, 260);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd >= 120) return cut.slice(0, sentenceEnd + 1);
  const wordEnd = cut.lastIndexOf(' ');
  return `${cut.slice(0, wordEnd > 0 ? wordEnd : 260).replace(/[;,.:-]$/u, '')}…`;
}

/** Версия из тела коммита: «Версия 2.15.0.» или «v2.15.0» в конце строки. */
function commitVersion(text) {
  const match = /(?:Версия|версія)\s*(\d+\.\d+\.\d+)/u.exec(text)
    ?? /(?:^|\s)v(\d+\.\d+\.\d+)(?:\s|$)/mu.exec(text);
  return match?.[1] ?? null;
}

function noteToEntry(note, hash, date, fallbackSection) {
  if (!note || typeof note.text !== 'string' || !note.text.trim()) return null;
  const section = NOTE_SECTIONS[String(note.kind ?? '').toLowerCase()] ?? fallbackSection;
  return {
    hash: hash.slice(0, 7),
    date,
    kind: section === 'fixes' ? 'fix' : section === 'optimizations' ? 'perf' : 'new',
    label: section === 'fixes' ? 'Виправлено' : section === 'optimizations' ? 'Оптимізація' : 'Нове',
    text: cleanNote(note.text),
    section,
  };
}

/** Разделители записей в `git log` — нужно, чтобы тело коммита не потеряло переносы строк. */
const RECORD_SEPARATOR = '\u001e\u001e';
const FIELD_SEPARATOR = '\u001f';

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

const raw = git([
  'log',
  `--max-count=${Math.max(limit * 4, 160)}`,
  `--pretty=format:%h${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
  '--date=short',
]);

const entries = [];
let activeVersion = CURRENT_VERSION;

for (const record of raw.split(RECORD_SEPARATOR)) {
  const trimmed = record.trim();
  if (!trimmed) continue;
  const [hash, date, subject, ...bodyLines] = trimmed.split(FIELD_SEPARATOR);
  if (!hash || !subject) continue;

  const body = bodyLines.join('\n');
  const declaredVersion = commitVersion(body);
  if (declaredVersion) activeVersion = declaredVersion;

  const type = subject.split(/[:(]/u)[0].trim().toLowerCase();
  const fallbackSection = USER_FACING[type];

  // Курируемые тексты идут первыми: один коммит может дать несколько пользовательских пунктов.
  const curated = curatedNotes[hash];
  if (curated) {
    const bucket = fallbackSection ?? 'features';
    for (const note of Array.isArray(curated) ? curated : [curated]) {
      const entry = noteToEntry(note, hash, date, bucket);
      if (entry) entries.push({ ...entry, version: activeVersion });
    }
    if (entries.length >= limit) break;
    continue;
  }

  if (!fallbackSection) continue;

  // Один коммит может изменить несколько вещей для человека. Поэтому читаем все строки
  // Release-Note, а `[optimization]` позволяет отнести пункт к разделу оптимизаций.
  const releaseNotes = [...body.matchAll(/^Release-Note(?:\[([a-z]+)\])?:\s*(.+)$/gimu)]
    .map((match) => ({ kind: match[1] ?? null, text: (match[2] ?? '').trim() }))
    .filter((note) => note.text.length > 0);
  if (releaseNotes.length === 0) continue;

  for (const note of releaseNotes) {
    const entry = noteToEntry(note, hash, date, fallbackSection);
    if (entry) entries.push({ ...entry, version: activeVersion });
    if (entries.length >= limit) break;
  }
  if (entries.length >= limit) break;
}

/**
 * Группировка по версиям. Порядок релизов — от новых к старым, как пришёл git log.
 * Тег `Release` — на минорном/мажорном релизе, `Update` — на патче.
 */
const releaseMap = new Map();
for (const entry of entries) {
  const version = entry.version || CURRENT_VERSION;
  let release = releaseMap.get(version);
  if (!release) {
    const [, , patch] = version.split('.').map(Number);
    release = {
      version,
      date: entry.date,
      tag: patch === 0 ? 'Release' : 'Update',
      features: [],
      fixes: [],
      optimizations: [],
    };
    releaseMap.set(version, release);
  }
  if (entry.date > release.date) release.date = entry.date;
  const bucket = entry.section === 'fixes' ? release.fixes : entry.section === 'optimizations' ? release.optimizations : release.features;
  // Один и тот же текст не дублируем: курируемая запись и trailer могут описывать одно и то же.
  if (!bucket.includes(entry.text)) bucket.push(entry.text);
}

const releases = [...releaseMap.values()];
const totals = releases.reduce(
  (sum, release) => ({
    totalFeatures: sum.totalFeatures + release.features.length,
    totalFixes: sum.totalFixes + release.fixes.length,
    totalOptimizations: sum.totalOptimizations + release.optimizations.length,
  }),
  { totalFeatures: 0, totalFixes: 0, totalOptimizations: 0 },
);

const payload = {
  generatedAt: new Date().toISOString(),
  version: CURRENT_VERSION,
  note: 'Згенеровано tools/gen_changelog.mjs з історії git. Не редагувати вручну.',
  totalReleases: releases.length,
  ...totals,
  releases,
  // Плоский список для уже установленных APK, которые ещё читают `entries`.
  entries: entries.map(({ version: _version, section: _section, ...entry }) => entry),
};

const serialized = JSON.stringify(payload, null, 1) + '\n';
for (const target of [outPath, webFallbackPath, workerPath]) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, serialized, 'utf8');
}

console.log(`Версия ${CURRENT_VERSION}: ${releases.length} релизов, ${entries.length} пунктов`);
console.log(`  функций ${totals.totalFeatures}, исправлений ${totals.totalFixes}, оптимизаций ${totals.totalOptimizations}`);
console.log(`  канон (API):  ${path.relative(repoRoot, outPath)}`);
console.log(`  фолбэк (web): ${path.relative(repoRoot, webFallbackPath)}`);
console.log(`  воркер (CF):  ${path.relative(repoRoot, workerPath)}`);
for (const release of releases.slice(0, 5)) {
  console.log(`  v${release.version} [${release.tag}] ${release.date}: +${release.features.length} / !${release.fixes.length} / ^${release.optimizations.length}`);
}
