#!/usr/bin/env node
/**
 * gen-git-history.mjs — пересобирает GIT_HISTORY.md из `git log`.
 *
 * Зачем скрипт, а не ручная правка: файл истории отставал от репозитория на 128 коммитов,
 * потому что каждый раз его дописывали руками. Документ, который нельзя воспроизвести,
 * быстро превращается в ложь. Здесь история — чистая функция от `git log`.
 *
 * Использование:
 *   node tools/gen-git-history.mjs            # перезаписать GIT_HISTORY.md
 *   node tools/gen-git-history.mjs --check    # только проверить, что файл актуален (exit 1)
 *
 * Формат записи намеренно повторяет прежний ручной: дата → коммиты этой даты → хеш, тема,
 * метаданные и тело коммита дословно. Тело содержит обоснования решений, ради которых файл
 * и читают; пересказывать его нельзя.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(REPO_ROOT, 'GIT_HISTORY.md');

// Разделители ASCII US/RS, а не NUL: Node запрещает нулевой байт в аргументах процесса.
const FIELD = '\u001f';
const RECORD = '\u001e';
const FORMAT = ['%h', '%ad', '%an <%ae>', '%s', '%B'].join(FIELD) + RECORD;

/** Украинское склонение: 1 коміт, 2 коміти, 5 комітів. */
function pluralUk(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Тип коммита из Conventional Commits: `feat(web): …` → `feat`. */
function commitType(subject) {
  const match = /^([a-z]+)(?:\([^)]*\))?!?:/u.exec(subject);
  return match ? match[1] : 'other';
}

function readCommits() {
  const raw = execFileSync(
    'git',
    ['log', `--format=${FORMAT}`, '--date=format:%Y-%m-%d %H:%M:%S'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );

  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\n/u, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [hash, date, author, subject, body = ''] = record.split(FIELD);
      // `%B` — сырое сообщение целиком, то есть с темой в первой строке. В документе тема
      // стоит в заголовке, поэтому из тела её убираем, иначе каждый коммит дублируется.
      const lines = body.replace(/\r\n/gu, '\n').trim().split('\n');
      if (lines.length > 0 && lines[0].trim() === subject.trim()) lines.shift();
      return {
        hash: hash.trim(),
        date,
        day: date.slice(0, 10),
        author,
        subject: subject.trim(),
        body: lines.join('\n').trim(),
      };
    });
}

function renderHeader(commits) {
  const days = commits.map((commit) => commit.day).sort();
  const types = new Map();
  for (const commit of commits) {
    const type = commitType(commit.subject);
    types.set(type, (types.get(type) ?? 0) + 1);
  }
  const typeList = [...types.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `\`${type}\` × ${count}`)
    .join(', ');

  // Автор один на весь репозиторий; если появится второй, список покажет обоих.
  const authors = [...new Set(commits.map((commit) => commit.author))];

  return [
    '# Svitlo — історія розробки (git log)',
    '',
    `**Комітів:** ${commits.length}  `,
    `**Перший:** ${days[0]}  `,
    `**Останній:** ${days[days.length - 1]}  `,
    `**Автор:** ${authors.join(', ')}`,
    '',
    `**Типи комітів:** ${typeList}`,
    '',
    '> Файл генерується з `git log` скриптом `tools/gen-git-history.mjs`; ручні правки не',
    '> зберігаються. Оновити: `node tools/gen-git-history.mjs`.',
    '',
    '---',
    '',
  ].join('\n');
}

function renderDay(day, commitsOfDay) {
  const count = commitsOfDay.length;
  const title = `${day}  (${count} ${pluralUk(count, 'коміт', 'коміти', 'комітів')})`;
  const blocks = commitsOfDay.map((commit) => {
    const body = commit.body === '' ? '_(без опису)_' : commit.body;
    return `### \`${commit.hash}\` ${commit.subject}\n\n*\`${commit.hash}\` · ${commit.date} · ${commit.author}*\n\n${body}`;
  });

  return `## ${title}\n\n${blocks.join('\n\n')}\n\n`;
}

function render(commits) {
  // Даты — по убыванию, внутри даты порядок git log (свежие сверху).
  const byDay = new Map();
  for (const commit of commits) {
    const bucket = byDay.get(commit.day);
    if (bucket) bucket.push(commit);
    else byDay.set(commit.day, [commit]);
  }
  const days = [...byDay.keys()].sort().reverse();
  const sections = days.map((day) => renderDay(day, byDay.get(day)));

  return `${renderHeader(commits)}\n${sections.join('')}`.replace(/\n{3,}/gu, '\n\n');
}

const commits = readCommits();
if (commits.length === 0) {
  console.error('git log пуст — GIT_HISTORY.md не тронут.');
  process.exit(1);
}

const document = render(commits);
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('GIT_HISTORY.md отсутствует — запусти без --check.');
    process.exit(1);
  }
  if (current.trim() !== document.trim()) {
    console.error('GIT_HISTORY.md устарел: запусти `node tools/gen-git-history.mjs`.');
    process.exit(1);
  }
  console.log('GIT_HISTORY.md актуален.');
  process.exit(0);
}

writeFileSync(OUTPUT, document, 'utf8');
console.log(`GIT_HISTORY.md пересобран: ${commits.length} коммитов.`);
