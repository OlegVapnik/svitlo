#!/usr/bin/env node
/**
 * Генерация чейджлога приложения из истории git.
 *
 * Зачем отдельный шаг, если есть `git log`: сборка идёт в Docker, где репозитория нет, а в
 * PWA/Android-бандле история коммитов не нужна целиком. Поэтому чейджлог — маленький JSON,
 * который коммитится и раздаётся по сети (GET /api/v1/changelog). Благодаря этому фикс,
 * задеплоенный на сервере, виден в уже установленном приложении без пересборки APK.
 * Копия в apps/web/src/data используется только как офлайн-фолбэк, а копия в cf-worker/src/data —
 * для маршрута GET /api/v1/changelog в Cloudflare-воркере (в Workers нет файловой системы,
 * поэтому JSON попадает в бандл на сборке).
 *
 * Что попадает в выдачу:
 *  - только готовый текст для человека: trailer `Release-Note:` в теле коммита или запись
 *    в tools/changelog-notes.json. Сырые тела коммитов не используются — в них обоснования
 *    для разработчика, имена таблиц и лимиты инфраструктуры;
 *  - служебные изменения (chore/docs/test) в приложении ничего не объясняют и не попадают
 *    в список, даже если у них есть тело;
 *  - для истории до введения trailer'а тексты лежат в tools/changelog-notes.json. Это
 *    курируемый список: один коммит может дать несколько пунктов, а внутренние правки —
 *    не дать ни одного.
 *
 * Запуск: node tools/gen_changelog.mjs [--limit 30]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
// Канонический источник — API: чейджлог отдаётся по сети, поэтому фикс, задеплоенный на
// сервере, виден в уже установленном приложении без пересборки APK.
// Копия в web — офлайн-фолбэк на случай, когда сети нет (её же подхватывает кеш ответов).
const outPath = path.join(repoRoot, 'apps/api/src/data/changelog.json');
const webFallbackPath = path.join(repoRoot, 'apps/web/src/data/changelog.json');
// Копия для воркера: он раздаёт чейнджлог тем же маршрутом, что и Node-бэкенд, а читать файлы
// из рантайма Cloudflare Workers не умеет — JSON вшивается в бандл wrangler на сборке.
const workerPath = path.join(repoRoot, 'cf-worker/src/data/changelog.json');
// Курируемые тексты для истории до появления trailer'а `Release-Note:`. Ключ — короткий хеш
// коммита, значение — один объект { kind, text } или массив таких объектов. Коммиты, которых
// здесь нет и у которых нет trailer'а, в чейнджлог не попадают: это внутренние правки.
const notesPath = path.join(repoRoot, 'tools/changelog-notes.json');

const limitArgIndex = process.argv.indexOf('--limit');
const limit = limitArgIndex > -1 ? Number(process.argv[limitArgIndex + 1]) : 30;

/**
 * Типы коммитов, которые значат что-то для человека, использующего приложение, и их вид в UI.
 * Служебные (chore, docs, test, ci, build, refactor) намеренно не показываются.
 */
const USER_FACING = {
  feat: { kind: 'new', label: 'Нове' },
  fix: { kind: 'fix', label: 'Виправлено' },
  security: { kind: 'fix', label: 'Безпека' },
};

const KIND_LABELS = { new: 'Нове', fix: 'Виправлено' };

function loadCuratedNotes() {
  try {
    const parsed = JSON.parse(readFileSync(notesPath, 'utf8'));
    return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
  } catch (error) {
    // ENOENT — штатная ситуация для нового репозитория: тексты можно писать только
    // trailer'ами. Любая другая ошибка — повод сказать о ней, но не ронять сборку.
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

function noteToEntry(note, hash, date) {
  if (!note || typeof note.text !== 'string' || !note.text.trim()) return null;
  const kind = note.kind === 'fix' ? 'fix' : 'new';
  return {
    hash: hash.slice(0, 7),
    date,
    kind,
    label: KIND_LABELS[kind],
    text: cleanNote(note.text),
  };
}

/** Разделители записей в `git log` — нужно, чтобы тело коммита не потеряло переносы строк. */
const RECORD_SEPARATOR = '';
const FIELD_SEPARATOR = '';

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

const raw = git([
  'log',
  `--max-count=${Math.max(limit * 4, 120)}`, // берём с запасом: часть коммитов отсеется как служебные
  `--pretty=format:%h${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
  '--date=short',
]);

const entries = [];
for (const record of raw.split(RECORD_SEPARATOR)) {
  const trimmed = record.trim();
  if (!trimmed) continue;
  const [hash, date, subject, ...bodyLines] = trimmed.split(FIELD_SEPARATOR);
  if (!hash || !subject) continue;

  // Курируемые тексты идут первыми: один коммит может дать несколько пользовательских
  // пунктов (например, новая матрица и исправление таймера в одной правке).
  const curated = curatedNotes[hash];
  if (curated) {
    for (const note of Array.isArray(curated) ? curated : [curated]) {
      const entry = noteToEntry(note, hash, date);
      if (entry) entries.push(entry);
    }
    if (entries.length >= limit) break;
    continue;
  }

  // Для новых коммитов единственный источник текста — trailer. Сырое тело не используем:
  // оно написано для разработчика и содержит технический мусор.
  const releaseNote = bodyLines.join('\n').match(/^Release-Note:\s*(.+)$/imu)?.[1];
  if (!releaseNote) continue;

  // Тема вида `fix(web): …` или `feat: …` → тип из первого слова.
  const type = subject.split(/[:(]/u)[0].trim().toLowerCase();
  const meta = USER_FACING[type];
  if (!meta) continue;

  entries.push({
    hash: hash.slice(0, 7),
    date,
    kind: meta.kind,
    label: meta.label,
    text: cleanNote(releaseNote),
  });

  if (entries.length >= limit) break;
}

// Порядок НЕ пересортировываем: git log уже отдаёт от свежих к старым, а сортировка по дате
// перемешала бы коммиты одного дня (все даты в разработке одинаковые).

const payload = {
  generatedAt: new Date().toISOString(),
  note: 'Згенеровано tools/gen_changelog.mjs з історії git. Не редагувати вручну.',
  entries,
};

const serialized = JSON.stringify(payload, null, 1) + '\n';
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, serialized, 'utf8');
mkdirSync(path.dirname(webFallbackPath), { recursive: true });
writeFileSync(webFallbackPath, serialized, 'utf8');
mkdirSync(path.dirname(workerPath), { recursive: true });
writeFileSync(workerPath, serialized, 'utf8');

console.log(`Записано ${entries.length} записей:`);
console.log(`  канон (API):  ${path.relative(repoRoot, outPath)}`);
console.log(`  фолбэк (web): ${path.relative(repoRoot, webFallbackPath)}`);
console.log(`  воркер (CF):  ${path.relative(repoRoot, workerPath)}`);
for (const entry of entries.slice(0, 5)) {
  console.log(`  ${entry.date} [${entry.label}] ${entry.text.slice(0, 78)}`);
}