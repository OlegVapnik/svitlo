# HANDOFF — Svitlo

> Краткая восстановленная версия после очистки истории. Полный старый HANDOFF был удалён
> из git в `e83b276` и локально не сохранился. Здесь — только то, что нельзя потерять.

## Снимок на 2026-10-26

- Версия приложения: **2.41.1**, Android `versionCode` **279** (источник — `apps/mobile/app.json`).
- Ветка разработки: `fix/d1-save-slots-herostatus-queue-chips` (включает Telegram webhook, D1 status, HeroStatus anchor fix, saveSlots replace fix).
- ОТА: выпущены v2.40.0, v2.41.0, v2.41.1 (с поддержкой Ed25519 подписи, Morphe-style карточкой обновлений, чистым системным видом живого уведомления в шторке).
- Свои источники новин: в `apps/mobile` добавлена поддержка отключения серверной ленты и подключения прямых RSS/Telegram каналов с локальным кэшированием (30 мин) для минимизации нагрузки на D1.
- Оптимизация D1: R2-снапшоты для `/news` и `/sync` (снижение rows_read), отключено мертвое зеркало ДТЕК, fingerprint-дедуп в OSR-движке.

## Снимок на 2026-10-22

- Версия приложения: **2.37.9**, Android `versionCode` **270** (источник — `apps/mobile/app.json`).
- Локальный APK: `apps/mobile/android-apk/svitlo-2.37.9.apk`, **~20 МБ**, только `arm64-v8a`, sha256 `880528b1feafb0bd20687582d196301a443aa5e423c14d7a771e00f38afc1cf4`.
- В R2/live пока **2.37.8**: `37 811 556 B`, sha256 `edaf30d8f96a926d42cbaa8ff6c1680b5e89650dc97ed830a2774c2df65d7af4`. Новую сборку не публиковали.
- `main` до локальных правок: `44671a2`.

## Решение по размеру APK (не откатывать)

- `expo.useLegacyPackaging=true` в `apps/mobile/plugins/withSvitloNative.js` — `.so` сжимаются внутри APK. Это даёт ~20 МБ вместо ~36 МБ. Для блэкаута важнее трафик скачивания на слабом LTE, чем одноразовая распаковка native libs при установке.
- `reactNativeArchitectures=arm64-v8a` в том же плагине — primary defense. Даже ручной `./gradlew assembleRelease` не должен собирать x86/x86_64/armeabi-v7a.
- `tools/build-android-apk.sh` проверяет ABI и запрещает публикацию APK вне `apps/mobile/android-apk/`. В корне репозитория APK быть не должно; корневые `*.apk` игнорируются.
- `versionCode` больше нельзя считать по `git rev-list --count` — после очистки истории он упал до 22. Источник истины: `app.json` → `expo.android.versionCode`; `tools/bump-version.sh` повышает его вместе с версией.
- Проверено в собранном APK: `versionCode=270`, `versionName=2.37.9`, только arm64, `.so` сжаты (`Defl:N`), `extractNativeLibs=true`, виджеты `SvitloWidget2x1/4x1/4x2` и exact-alarm разрешения на месте, подпись тем же release-сертификатом (`37184d...`).
- Установить локальный APK поверх телефона не удалось: на устройстве стоит **debug-подписанная** 2.37.8 (`versionCode=16`), а не релиз из R2. Для проверки на этом телефоне нужен uninstall (потеря данных) либо эмулятор. Релизные пользователи обновятся нормально: R2 2.37.8 подписан тем же сертификатом.

## Безопасность

- `apps/mobile/credentials/keystore.properties` был в публичной истории; файл убран из current tree и локальной истории, добавлен в `.gitignore`. История переписана и force-push. Бэкап: `/tmp/svitlo-security-backup/svitlo-before-purge.bundle`.
- Старые commit’ы (`df7f063`, `bd4e6ab`) всё ещё доступны на GitHub — нужен GitHub Support. Пароль keystore по решению пользователя **не менялся**, считать его скомпрометированным.
- Secret scanning и push protection включены; non-provider patterns и validity checks — нет.

## Покрытие областей на 22.10.2026

- Свежие (12 областей + Киев): Днепр, Житомир, Ивано-Франковск, Киев, Киевская, Николаев, Полтава, Ровно, Сумы, Харьков, Черкассы, Черновцы, Чернигов.
- Устарели на 17.10 (6): Закарпатская, Запорожская, Львовская, Одесская, Тернопольская, Хмельницкая.
- Нет вообще (6): Винницкая, Волынская, Донецкая, Кировоградская, Луганская, Херсонская. В UI они отделены заголовком «Немає даних», застарілі — блоком «Застарілі графіки».
- Статический fallback `apps/web/public/data/schedules-all.json` содержит 20 из 25 регионов; пяти из списка «нет вообще» там нет.

## ОСР

- `tools/osr_direct_sync.py`: Черновцы проверены и залиты в D1 (14 statements / 48 rows), live API отдаёт `covered: true`.
- Одесса: `/schedule.json` устарел с 17.10.2026 — импорт намеренно заблокирован.
- Николаев: активного графика нет (`[]`). Кировоград: Cloudflare WAF на API. Волынь/Закарпатье: графики, вероятно, картинками. Львов/Херсон — кабинеты. Луганск — публичного URL нет.

## Проверки

- `./tools/build-android-apk.sh --no-publish --skip-tests` — успешно, 3m55s.
- `npm run lint --workspace @svitlo/web` — успешно.
- `npm run typecheck --workspace @svitlo/mobile` — падает на существующем `src/hooks/useSavedPlacesStatus.ts:75` (`GroupOutageSummary`), к этой сборке отношения не имеет.

## Следующие шаги

1. Проверить 2.37.9 на чистом устройстве/эмуляторе: установка, запуск, виджет, будильники.
2. Если ок — `./tools/build-android-apk.sh --publish-only` и обновить version metadata.
3. Отправить обращение в GitHub Support по старым commit’ам.
4. Решить судьбу уже отслеживаемых `apps/mobile/android-apk/*.apk` (они раздувают git).
