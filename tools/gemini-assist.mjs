#!/usr/bin/env node
/**
 * gemini-assist — helper-обёртка над Antigravity CLI (`agy`), чтобы звать Gemini
 * как ассистента прямо из консоли/скриптов, с отдельным выводом его действий.
 *
 * Особенности:
 *  - Всегда использует flash 3.8 с low thinking: `--model gemini-3.8-flash-low --effort low`.
 *  - Стримит stream-json и раздельно печатает в консоль:
 *      [gemini]     — текстовый ответ ассистента (дёльтами, как в терминале)
 *      [gemini-step]— думание (thinking) и шаги инструментов (что он делает)
 *    В конце отдельным блоком — финальный ответ `result.response`.
 *  - Промпт передаётся либо аргументом, либо через `--stdin` (пайп/heredoc).
 *
 * Использование:
 *   node tools/gemini-assist.mjs 'Сделай X'          # короткий промпт аргументом
 *   cat notes.md | node tools/gemini-assist.mjs --stdin
 *   AGY_BIN=/path/to/agy node tools/gemini-assist.mjs '...'
 *
 * Коды выхода: 0 = SUCCESS, 1 = ошибка/неуспешный result, 2 = bad usage.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const AGY_BIN = process.env.AGY_BIN || '/home/oleg/.local/bin/agy';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash-low';
const EFFORT = process.env.GEMINI_EFFORT || 'low';

function usage() {
  console.error(
    'usage: node tools/gemini-assist.mjs [--stdin] [--debug] [prompt...]\n' +
      '  --stdin   read the prompt from stdin\n' +
      '  --debug   print raw stream-json events (for debugging)\n' +
      'exit codes: 0 success, 1 gemini failure, 2 bad usage',
  );
}

function parseArgs(argv) {
  const args = { stdin: false, debug: false, prompt: '' };
  const rest = [];
  for (const a of argv) {
    if (a === '--stdin') args.stdin = true;
    else if (a === '--debug') args.debug = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(2); }
    else rest.push(a);
  }
  args.prompt = rest.join(' ');
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.stdin && !args.prompt.trim()) {
  usage();
  process.exit(2);
}

// Промпт: из аргумента или из stdin.
let prompt = args.prompt;
if (args.stdin) {
  prompt = readFileSync(0, 'utf8');
}
if (!prompt || !prompt.trim()) {
  console.error('[gemini-assist] пустой промпт — нечего отправлять.');
  process.exit(2);
}

const cliArgs = [
  '--print', prompt,
  '--model', MODEL,
  '--effort', EFFORT,
  '--output-format', 'stream-json',
];

const child = spawn(AGY_BIN, cliArgs, { cwd: process.cwd() });

let buffer = '';
let finalResponse = '';
let finalStatus = 'UNKNOWN';
let exitCode = 0;
let sawContent = false;

function emit(raw) {
  // Классификация события по его типу.
  const ev = JSON.parse(raw);
  if (args.debug) {
    console.error(`[debug] ${raw}`);
    return;
  }
  const kind = ev.event;
  if (kind === 'init') {
    const init = ev.init || {};
    console.error(`[gemini] модель: ${init.model || MODEL} · cwd: ${init.cwd || ''}`);
    return;
  }
  if (kind === 'step_update') {
    const su = ev.step_update || {};
    const textDelta = su.text_delta ?? '';
    switch (su.step_type) {
      case 'thinking':
        if (textDelta) {
          sawContent = true;
          process.stderr.write(`\x1b[2m[gemini-think] ${textDelta}\x1b[0m`); // приглушённо, в stderr
        }
        return;
      case 'agent_response':
        if (textDelta) {
          sawContent = true;
          // чистый ответ ассистента — без префикса, чтобы stdout был чистым
          process.stdout.write(textDelta);
        }
        return;
      case 'tool':
      case 'tool_call':
      case 'tool_result':
      case 'tool_use': {
        // tool-событие: печатаем, что Gemini вызвал и с каким аргументом,
        // а при завершении (state DONE + output) — короткий результат.
        sawContent = true;
        const name = su.tool_name || 'tool';
        const info = su.tool_info || {};
        const params = info.parameters || {};
        const paramStr = Object.entries(params)
          .map(([k, v]) => `${k}=${String(v).slice(0, 240)}`)
          .join(' ');
        let line = `[gemini-step] ${name}`;
        if (paramStr) line += ` ${paramStr}`;
        if (su.state === 'DONE' && info.output != null) {
          const out = String(info.output).replace(/\s+/g, ' ').slice(0, 240);
          line += `\n   └─ результат: ${out}`;
        }
        // шаги инструментов — в stderr (отдельный поток), чтобы можно было развести с ответом
        process.stderr.write(`\x1b[33m${line}\u001b[0m\n`);
        return;
      }
      default:
        // прочие step_update (user_input, subagent и т.п.) — печатаем, если есть текст
        if (textDelta) {
          sawContent = true;
          process.stdout.write(`[gemini-step] ${textDelta}`);
        }
        return;
    }
  }
  if (kind === 'result') {
    const res = ev.result || {};
    finalStatus = res.status || 'UNKNOWN';
    finalResponse = res.response || '';
    // usage — без секретов, только счётчики токенов
    if (res.usage) {
      const u = res.usage;
      console.error(
        `[gemini] токены: in=${u.input_tokens} out=${u.output_tokens} think=${u.thinking_tokens} ` +
          `всего=${u.total_tokens} · сек=${(res.duration_seconds ?? 0).toFixed(1)}`,
      );
    }
  }
}

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      emit(line);
    } catch (err) {
      // невалидная строка stream-json — пропускаем, не роняем помощника
      if (args.debug) console.error(`[debug] SKIP_parse_error: ${line.slice(0, 200)}`);
    }
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('error', (err) => {
  console.error(`[gemini-assist] не удалось запустить ${AGY_BIN}: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  if (buffer.trim()) {
    // хвост без перевода строки
    try { emit(buffer.trim()); } catch { /* ignore */ }
  }
  if (finalStatus === 'SUCCESS') exitCode = 0;
  else if (finalStatus === 'UNKNOWN') exitCode = code === 0 ? 1 : (code ?? 1);
  else exitCode = 1;

  // Финальный ответ отдельным блоком — только если он ещё не был выведен полностью
  if (finalResponse && !args.debug) {
    console.error('\n[gemini] ─── итог ───');
    console.error(finalResponse.trimEnd());
    process.stdout.write('\u001b[0m');
  }

  console.error(`\n[gemini] статус: ${finalStatus} · exit=${code ?? '?'}`);
  process.exit(exitCode);
});