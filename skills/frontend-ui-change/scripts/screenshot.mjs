#!/usr/bin/env node
/**
 * Скриншоты Svitlo через Chrome DevTools Protocol — визуальная проверка «как выглядит в реальности»,
 * когда в сессии нет браузера (frontend-ui-change требует проверять обе темы и 360 px).
 * Зависимостей нет: WebSocket и fetch встроены в Node 22+; берём chromium из кэша playwright,
 * а если его нет — системный chrome/chromium из PATH.
 *
 * Запуск (dev-сервер уже поднят: `pnpm --filter @svitlo/web dev -- --host`):
 *   node skills/frontend-ui-change/scripts/screenshot.mjs --url http://localhost:5173/ --out /tmp/shots
 *   node skills/frontend-ui-change/scripts/screenshot.mjs --mobile --mock-schedule   # 360 px + подмена /schedules
 *
 * Флаги: --url <адрес>  --out <каталог>  --mobile  --mock-schedule
 * Каждый снимок печатает DOM-пробу (цвет и кегль героя, фон карточки, рамка) — цифры, а не «на глаз».
 * Ответ /api/v1/schedules при --mock-schedule подменяется на лету: ни код, ни БД не трогаются.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const url = arg('url', 'http://localhost:5173/');
const out = arg('out', '/tmp/svitlo-shots');
const mobile = argv.includes('--mobile');
const mockSchedule = argv.includes('--mock-schedule');
const port = arg('port', '9222');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const candidate = join(cache, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const name of ['chromium', 'google-chrome', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      /* не найден — пробуем следующий */
    }
  }
  throw new Error('chromium не найден: положите его в кэш playwright или установите системно');
}

/** График оператора на сутки: 00–07 світло, 07–10 відключення, 10–17 світло, 17–20 відключення, 20–24 світло. */
function schedulePayload(date) {
  const dayStart = Date.parse(`${date}T00:00:00Z`) - 180 * 60_000; // октябрь: Киев UTC+3
  const at = (minutes) => new Date(dayStart + minutes * 60_000).toISOString();
  const slot = (from, to, stateCode, stateName, stateColor) => ({ startsAt: at(from), endsAt: at(to), stateCode, stateName, stateColor });
  return {
    data: {
      queue: '2/2',
      date,
      intervals: [
        slot(0, 420, 1, 'Світло є', '#63AA18'),
        slot(420, 600, 3, 'Відключення', '#E33535'),
        slot(600, 1020, 1, 'Світло є', '#63AA18'),
        slot(1020, 1200, 3, 'Відключення', '#E33535'),
        slot(1200, 1440, 1, 'Світло є', '#63AA18'),
      ],
      demo: false,
      source: 'manual',
      lastImportedAt: null,
    },
  };
}

mkdirSync(out, { recursive: true });
const chrome = findChrome();
const child = spawn(
  chrome,
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, 'chrome-profile')}`, 'about:blank'],
  { detached: true, stdio: 'ignore' },
);
child.unref();
await sleep(4000);

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

ws.addEventListener('message', async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error);
    pending.delete(msg.id);
    return;
  }
  // Подмена графика: перехватываем только /schedules, остальные запросы идут как обычно.
  if (msg.method === 'Fetch.requestPaused') {
    const { requestId, request } = msg.params;
    if (mockSchedule && request.url.includes('/schedules')) {
      const date = new URL(request.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(schedulePayload(date))).toString('base64'),
      });
    } else {
      await send('Fetch.continueRequest', { requestId });
    }
  }
});

await new Promise((resolve) => ws.addEventListener('open', resolve));
await send('Page.enable');
if (mockSchedule) await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

const PROBE = `JSON.stringify({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  metaThemeColor: document.querySelector('meta[name=theme-color]')?.content ?? null,
  hero: document.querySelector('h2.font-display')?.textContent ?? null,
  heroColor: (() => { const h = document.querySelector('h2.font-display'); return h ? getComputedStyle(h).color : null; })(),
  heroFontSize: (() => { const h = document.querySelector('h2.font-display'); return h ? getComputedStyle(h).fontSize : null; })(),
  cardBg: (() => { const s = document.querySelector('section.rounded-2xl'); return s ? getComputedStyle(s).backgroundColor : null; })(),
  cardBorder: (() => { const s = document.querySelector('section.rounded-2xl'); return s ? getComputedStyle(s).borderTopColor : null; })()
})`;

for (const theme of ['light', 'dark']) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: mobile ? 360 : 1280,
    height: mobile ? 900 : 1000,
    deviceScaleFactor: mobile ? 3 : 1,
    mobile,
  });
  await send('Page.navigate', { url });
  await sleep(2500);
  // Те же ключи, что читают инлайн-скрипт в index.html, useTheme и useMyQueues.
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('theme','${theme}');
      localStorage.setItem('myQueues','["2/2"]');
      localStorage.setItem('myAddress','смт Деснянське, вул. Шевченка 12');`,
  });
  await send('Page.reload', {});
  await sleep(3000);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !mobile });
  const file = join(out, `${mobile ? 'mobile' : 'desktop'}-${theme}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  const probe = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  console.log(`${file}\n  ${probe?.result?.value ?? probe}`);
}

ws.close();
process.exit(0);
