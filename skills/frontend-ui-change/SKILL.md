# Skill: Frontend UI, Tailwind v4, Bookmarks & All-Ukraine Search (`frontend-ui-change`)

## Когда применять
При любых правках в `apps/web/src/**`: страницы, компоненты, стили Tailwind v4 (`globals.css`), система закладок групп и локаций (`useMyQueues`, `useMyAddress`), выбор области, поиск по сёлам и улицам, графики и PWA.

## Правила Frontend-архитектуры Svitlo
1. **Стек и Tailwind v4 (CSS-first):**
   - В проекте React 19, Vite 8, Tailwind v4 (`@tailwindcss/vite`). Файлов `tailwind.config.ts` и `postcss.config.js` **нет**.
   - Все семантические токены (`bg-card`, `text-muted-foreground`, `border-border`, `bg-popover`, `text-success`, `text-warning`, `text-destructive`) объявлены в `apps/web/src/styles/globals.css` через `@theme` и `@theme inline` с парами значений в `:root` (тёплая светлая тема `#f3efe6`) и `.dark` (`#101411`).
   - **Никаких inline-цветов** (`style={{ backgroundColor: ... }}`) для фонов/текста. Единственное исключение — цвет интервала графика от оператора (`interval.stateColor` в `QueueScheduleBar`).
2. **Закладки своих групп и локаций («Мої закладки»):**
   - Пользователь может сохранять в закладки **несколько групп/очередей и адресов** из разных областей Украины (например: «🏠 Дім — Київ, черга 3.1», «🏡 Батьки — с. Деснянське, черга 2/2», «💼 Робота — Львів, черга 1.2»).
   - Никакого хардкода одной очереди `'2/2'`! Список доступных областей берётся из `GET /api/v1/regions`, список очередей области — из `GET /api/v1/queues?region=<cpu>`.
   - На главной (`HomePage` / `MyQueueHero`) и на странице `/queues` пользователь в 1 клик переключается между своими закладками и сразу видит статус: `Світло є` / `Світла немає` / `Даних графіка немає` (`unknown`, если слотов нет — никогда не показывай зелёный «Світло є» при пустом графике!).
3. **Поиск групп по сёлам и улицам:**
   - На страницах `/streets` и `/my-address` поддерживай выбор области (`region`), поиск по населённому пункту (селу/городу) и улице: если пользователь вводит село целиком или конкретную улицу в селе — показывать привязанную группу ГПВ, её график на сегодня/завтра и кнопку «Додати в закладки».
4. **Локализация и доступность:**
   - Язык интерфейса один — **украинский** (`apps/web/src/i18n/uk.json`; файлы `ru.json` и `en.json` удалены). Все новые строки в JSX проводи через `t('namespace.key')`.
   - Для вкладок используй `components/ui/Tabs.tsx` (`role="tablist"`, клавиатурная навигация). Тач-зоны кнопок и чипов закладок — минимум `44px`.
   - Тяжёлые вкладки (`OutageCalendar`, `OutageTimeline`, `OutageBarChart`, `OutageHeatmap`, `OutageMap`) держи в `React.lazy()` + `Suspense`, чтобы стартовый чанк оставался `< 200 kB gzip` для плохих мобильных сетей во время отключений.

## Пошаговая процедура
1. При добавлении новых UI-состояний проверь наличие токенов в `apps/web/src/styles/globals.css` и ключей в `apps/web/src/i18n/uk.json`.
2. Подключи данные через хуки из `apps/web/src/api/queries.ts` (с передачей `region` и `queue`).
3. Прогони скрипт проверки токенов Tailwind v4, проверку типов и сборку `vite build`.

## Команды проверки
```bash
./apps/web/node_modules/.bin/tsc --noEmit
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .
pnpm --filter @svitlo/web build
```

## Типичные ошибки
- Показ статуса «Світло є» зелёным цветом, когда `intervals` пуст (должно быть состояние `unknown`: «Даних графіка немає»).
- Дублирование расчёта окон времени в компонентах вместо использования единого `apps/web/src/lib/scheduleWindow.ts`.
- Проверка UI в браузере без Hard Reload (`Ctrl+Shift+R`) после пересборки (PWA Service Worker отдаст закэшированный старый бандл).
