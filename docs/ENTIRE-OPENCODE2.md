# Entire ↔ OpenCode 2: мост через порт плагина и шим экспорта

Дата: 2026-10-27 · Контекст: Entire CLI 0.12.2, OpenCode 2.2.0. Всё ниже — про локальную
машину разработчика, не про прод.

## Зачем этот документ

Entire ставит в репозиторий плагин `entire.ts`, который на turn-end/turn-start дёргает
`entire hooks opencode <hook>`. В OpenCode 2 плагин этого шаблона **не загружается**, а
собранный им транскрипт **не экспортируется**. Оба места обойдены локально; документ
фиксирует, что именно стоит и что сломается при обновлениях.

## Поломка 1: плагин под V1 API

Симптом в `~/.local/share/opencode/log/opencode.log`:

```
WARN failed to load plugin target=.../.opencode/plugins/entire.ts
  cause="Plugin must export a default definition with an id and an effect or setup function.
  (cause: SchemaError(Missing key at [\"default\"]))"
```

Причина: шаблон Entire — `export const EntirePlugin: Plugin = async ({directory}) => ({...})`
из `@opencode-ai/plugin` (V1). OpenCode 2 грузит только
`export default Plugin.define({ id, setup(ctx) })` из `@opencode/plugin`.

Порт лежит в двух местах (содержимое одинаковое):

- `~/.opencode/plugins/entire.ts` — глобально, работает во всех каталогах;
- `.opencode/plugins/entire.ts` — в этом репозитории (файл в `.git/info/exclude`, не в git).

Что делает порт: подписывается на `ctx.event.subscribe()` и переводит события V2 на хуки
Entire — `session.created` → session-start, `session.inbox.enqueued` (тип `user`/`synthetic`)
→ turn-start, `session.execution.succeeded|failed|interrupted` → turn-end,
`session.compaction.ended` → compaction, `session.deleted`/`location.shutdown` → session-end.
Инъекция контекста — через `ctx.session.hook('context')`.

## Поломка 2: `opencode export` не существует

Entire при конденсации вызывает V1-команду `opencode export <sessionID>`. В V2 такой команды
нет: печатается help, код возврата 0, транскрипт пустой — в логе `failed to prepare transcript`
и чекпоинт без содержимого. Плюс схема V2 плоская (`messages[].type/content`) вместо
ожидаемой `{info, messages[].info/parts}`.

Обход — шим `~/.local/share/entire-shim/`:

- `opencode` — если первый аргумент `export`, вызывает `opencode session export <id>` во
  временный файл и конвертирует `v1-convert.mjs`; иначе передаёт вызов настоящему бинарнику;
- `v1-convert.mjs` — конвертер V2 → V1 (текст, reasoning, tool-парты с `callID`/`state`).

Шим попадает в PATH двумя путями: `~/.config/fish/config.fish` (для git-хуков
`post-commit`/`pre-push`) и явно из плагина (`PATH="$shimDir:$PATH"`), потому что сервер
OpenCode может стартовать не из fish.

**Важно:** `opencode session export` при выводе в пайп обрезает JSON на больших сессиях;
шив пишет во временный файл и читает оттуда.

## Грабли

- **Репозиторий определяется по cwd процесса.** `entire hooks` ищут git-корень от текущего
  каталога: если сессия агента запущена в нерепозиторном каталоге (например, `/home/oleg`),
  вызовы молча ничего не делают, и в логе не появляется даже `session-start`. Работал из
  `/home/oleg` — ноль захвата; из `~/Projects/svitlo` — сразу `TurnStart → active`.
- **Перезагрузка плагина посреди сессии.** OpenCode перезагружает плагин при изменении файла
  и рестарте сервиса; событие `session.inbox.enqueued`, открывающее turn, к этому моменту уже
  прошло. Порт поэтому открывает turn по первому `session.step.started`, если turn ещё не
  открыт, и закрывает по `session.execution.*` — иначе вся вторая половина сессии не пишется.
- `entire enable` / `entire agent add opencode` **перезаписывают** `entire.ts` обратно на
  V1-шаблон. После них — вернуть порт из `~/.opencode/plugins/entire.ts`. Копии V1-шаблона:
  `~/.opencode/entire.ts.v1.bak`, `.opencode/entire.ts.v1.bak`.
- `entire status` показывает `Agents · Antigravity` независимо от opencode — косметика CLI,
  на захват не влияет (`entire session list` показывает сессии OpenCode).
- Сессия в статусе `ended` — это про процесс агента, а не про сломанный захват: активность
  обновляется на каждом turn-end.
- Один и тот же файл плагина в двух местах: правки нужно вносить в оба (глобальный и
  репозиторный), иначе поведение зависит от каталога запуска.

## Проверка

```sh
entire status                       # enabled, агент, checkpoint remote
entire session list                 # сессии OpenCode видны, активность свежая
git commit -m "..."                 # при живой сессии → трейлер Entire-Checkpoint
entire checkpoint list              # 1 чекпоинт на ветке
entire checkpoint explain <id>      # intent, файлы, транскрипт, токены
```

## Когда шим можно убрать

Апстрим: [entireio/cli#2588](https://github.com/entireio/cli/issues/2588) (V1-плагин
отвергается в OpenCode 2, экспорт печатает help; PR #2589 портирует плагин). После выхода
версии с V2-плагином и вызовом `opencode session export`:

1. удалить `~/.local/share/entire-shim` из PATH (`config.fish` и блок `shimDir` в плагине);
2. переустановить плагин штатно (`entire agent add opencode`) и удалить этот документ.
