#!/usr/bin/env node
/**
 * Генерация чейджлога приложения из истории git.
 *
 * Зачем отдельный шаг, если есть `git log`: сборка идёт в Docker, где репозитория нет,
 * а в PWA/Android-бандле история коммитов не нужна целиком. Поэтому чейджлог — это маленький
 * JSON рядом с исходниками, который коммитится и едет в бандл.
 *
 * Что попадает в выдачу:
 *  - только пользовательские типы (feat/fix/security). Служебные chore/docs/misc в приложении
 *    человеку ничего не объясняют и только засоряют список;
 *  - заголовок — первая строка тела коммита (там живое украинское описание), а не тема
 *    коммита: темы короткие и часто машинные («fix: CORS»);
 *  - если тело пустое, используется тема.
 *
 * Запуск: node tools/gen_changelog.mjs [--limit 30]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outPath = path.join(repoRoot, 'apps/web/src/data/changelog.json');

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

  // Тема вида `fix(web): …` или `feat: …` → тип из первого слова.
  const type = subject.split(/[:(]/u)[0].trim().toLowerCase();
  const meta = USER_FACING[type];
  if (!meta) continue;

  // Тело коммита — живое описание. Берём первую содержательную строку: дальше идут детали
  // реализации, которые человеку в приложении не нужны.
  const body = bodyLines.join('\n').trim();
  const firstBodyLine = body.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  // Фолбэк на тему коммита убираем машинный префикс: «fix(web): …» читается хуже, чем «…».
  const subjectText = subject.replace(/^[a-z]+(\([^)]*\))?:\s*/iu, '');
  const text = firstBodyLine || subjectText;

  entries.push({
    hash: hash.slice(0, 7),
    date,
    kind: meta.kind,
    label: meta.label,
    text,
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

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 1) + '\n', 'utf8');

console.log(`Записано ${entries.length} записів у ${path.relative(repoRoot, outPath)}`);
for (const entry of entries.slice(0, 5)) {
  console.log(`  ${entry.date} [${entry.label}] ${entry.text.slice(0, 78)}`);
}