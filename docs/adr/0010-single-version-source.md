# ADR-0010: Одна версия — один источник, релиз из CI

- **Статус:** Принято (2026-10-27), реализовано (2026-10-30)
- **Дата:** 2026-10-27

## Контекст

Версия продукта дублируется минимум в десяти местах:

- `package.json` в корне и в пяти воркспейсах (`apps/web`, `apps/mobile`, `apps/api`,
  `packages/shared`, `packages/core`) + `cf-worker/package.json`;
- `apps/mobile/app.json` → `expo.version` и `expo.android.versionCode`;
- `apps/api/src/data/version.json` → метаданные APK (url, sha256, размер);
- `apps/web/src/data/changelog.json` и `apps/api/src/data/changelog.json`;
- OTA-манифест (`ota/version.json` / подпись);
- `HANDOFF.md` (ручной снимок).

Исторические инциденты: `HANDOFF` говорил 2.37.8, метаданные — 2.37.9; `versionCode` считался
от `git rev-list --count` и после очистки истории упал до 22; APK в R2 и локальная сборка
расходились.

Синхронизация выполняется скриптами (`bump-version.sh`) и памятью, а не генерацией.

## Решение

1. **Канонический источник** — один файл в корне (`version.json`):
   ```json
   {
     "version": "2.42.0",
     "androidVersionCode": 280,
     "releasedAt": "2026-11-01T12:00:00Z",
     "apk": { "url": "...", "sha256": "...", "size": 0 },
     "notes": "2.42.0"
   }
   ```
2. Все остальные значения **генерируются** из него:
   - `package.json` (корень и воркспейсы);
   - `app.json` (`expo.version`, `android.versionCode`);
   - метаданные `/api/v1/version` и `/api/v1/changelog`;
   - OTA-манифест и его подпись;
   - заголовок CHANGELOG.
   Ручное редактирование производных запрещено.
3. `versionCode` монотонно увеличивается и хранится в источнике; он **не** вычисляется из git.
4. CI проверяет равенство всех производных значений; расхождение — красный тест.
5. Релиз — из CI: сборка APK → подпись OTA → публикация в R2/Pages → smoke-проверка
   `/api/v1/version` и sha256 → тег `vX.Y.Z` в обоих репозиториях.
6. `HANDOFF.md` не содержит версии как источника истины; он ссылается на `version.json`.

## Реалізація (2026-10-30)

| Що | Де |
|---|---|
| Генератор і перевірка | `tools/sync-version.mjs` (`--check`, `--set X.Y.Z`, `--bump patch\|minor\|major`) |
| Гейт у тестах | `apps/api/tests/version-consistency.test.ts` (vitest) |
| Гейт у скриптах | `pnpm check:versions` |
| Метадані APK | `apps/api/src/data/version.json` (пише лише `tools/build-android-apk.sh --publish-only`) |
| Кореневий хеш | `tools/build-android-apk.sh` оновлює `version.json → apk.{url,sha256,size}` після публікації в R2 |
| GitHub Release | `tools/publish-github-release.sh` (викликається збіркою; `--latest`, ідемпотентний) |

Порядок релізу:

```bash
node tools/sync-version.mjs --set 2.42.0        # версія + versionCode+1 у всіх похідних
node tools/gen_changelog.mjs                    # чейнджлог із курованих нотаток (без git-хешів)
pnpm check:versions && pnpm -r test             # гейти
./tools/build-android-apk.sh                    # APK → R2 + метадані + кореневий version.json + GitHub Release
./tools/publish-ota.sh                          # JS-бандл → Pages
# OTA для GitHub raw: каталог ota/ лежить у публічному репозиторії, а прямий push в origin
# заборонено ADR-0009. Дозволений обхід — лише для ota/ і лише з --no-verify:
#   git worktree add /tmp/pub origin/main && cp -r ota /tmp/pub/ && cd /tmp/pub \
#     && git commit -am "chore(ota): OTA vX.Y.Z" && git push --no-verify origin HEAD:main
```

Третій пакет-носій — GitHub Releases. Застосунок качає повний APK саме звідти
(`releases/download/v{version}/svitlo-{version}.apk`), а `apkUrl` з `/api/v1/version` — лише
резерв. Крок довго робився руками, і 2.41.1/2.41.2 вийшли в R2 та OTA, але на GitHub чотири дні
висіла 2.41.0: у людей, які ставили «повний APK», завантаження падало в резервний шлях.
Тому реліз тепер створює сама збірка, а `--latest` виставляється явно (інакше GitHub позначає
останнім той, що створено пізніше за часом, а не за версією).

Дві пастки, які вже коштували релізу:

- `applyVersion` править у `apps/api/src/data/version.json` **лише** `version`: `notes`, `sha256`
  і `sizeBytes` пише збірка, інакше повторний `--set` затирав список «що нового».
- Якщо в кореневому `version.json` `apk.sha256` заповнений, `--check` звіряє його з
  опублікованим APK: розбіжність = клієнт завантажить інший файл.

## Последствия

**Положительные**

- Один `bump` обновляет всё; рассинхрон релизов и OTA исчезает как класс.
- Проверяемо машиной: CI ловит забытое обновление.
- Упрощается откат: тег + версия + sha256 однозначно идентифицируют сборку.
- Клиенты могут безопасно сравнивать версии.

**Отрицательные / риски**

- Нужен генератор и проверка; первое время придётся привести существующие значения к одному.
- При ручной сборке APK вне CI возможно расхождение — сборка только из CI либо явная
  пометка `local`.
- `version.json` становится критическим файлом: ошибка в нём блокирует релиз (это плюс,
  но требует аккуратности).

## Альтернативы

| Вариант | Почему не выбран |
|---|---|
| `app.json` как источник | не покрывает API, web и OTA |
| Только git-тег | APK и web живут вне git-артефактов; нужен sha256 |
| semantic-release | полезен, но не решает APK/OTA и добавляет зависимость |
| Оставить ручную синхронизацию | уже приводила к расхождениям в проде |

## Критерии приёмки

- [x] Есть один корневой `version.json`; все остальные значения генерируются.
- [x] CI падает при расхождении версии в любом производном файле (`pnpm check:versions`, vitest-гейт).
- [x] `versionCode` не зависит от истории git.
- [ ] Релиз выполняется из CI и заканчивается проверкой `/api/v1/version` + sha256.
- [x] `HANDOFF.md` не хранит версию как истину.

## Ссылки

- `docs/ARCHITECTURE.md` §10
- `PROJECT_AUDIT.md` (H-4, L-4)
- `HANDOFF.md` (раздел «Решение по размеру APK»)
