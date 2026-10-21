# Svitlo Mobile (Expo / React Native)

Новый клиент Svitlo для Android и iOS. Заменяет Capacitor-обёртку Android APK; веб-PWA в
`apps/web` продолжает жить отдельно.

## Стек

- Expo SDK 58 (RN 0.88, React 19), expo-router (4 таба), TypeScript strict.
- NativeWind 4 + Tailwind 3.4: статичные утилиты — классами, динамика (тема, состояние сети,
  цвета графиков) — JS-токенами из `src/theme/tokens.ts` через `style`.
- `@tanstack/react-query`, `i18next` (uk), `zod`, `date-fns`.
- Хранилище — `expo-sqlite/kv-store` за интерфейсом `@svitlo/core` (`configureStorage`).
- Общая бизнес-логика — в `packages/core` (`@svitlo/core`). Импорт из мобильного:
  `@svitlo/core` (storage/config) и подпути `@svitlo/core/lib/*`, `@svitlo/core/api/*`.
  Правило ядра: относительные импорты БЕЗ `.js` (Metro не достраивает `.js` → `.ts`).

## Команды

```bash
pnpm -C apps/mobile start          # dev-сервер (dev client)
pnpm -C apps/mobile android        # expo run:android (нужен Android SDK/эмулятор)
pnpm -C apps/mobile prebuild       # сгенерировать android/ios
pnpm -C apps/mobile typecheck      # tsc --noEmit
pnpm -C apps/mobile doctor         # expo-doctor
```

Зависимости ставить только через workspace:

```bash
pnpm --filter @svitlo/mobile add <pkg>
npx expo install <expo-pkg>        # из apps/mobile — подберёт версию под SDK
```

## Идентификаторы и подпись

- `android.package` и `ios.bundleIdentifier` — `ua.com.svitlo.app` (совпадает с текущим APK,
  поэтому обновление ставится поверх без переустановки).
- Release-подпись Android берёт ключ из `apps/mobile/credentials/` (`svitlo-release.p12`,
  alias `svitlo`, пароли в `keystore.properties`). Каталог в `.gitignore` и лежит вне дерева
  сборки, поэтому `expo prebuild --clean` его не затирает; `tools/build-android-apk.sh`
  подставляет путь через env `SVITLO_KEYSTORE`. Сам файл в git не коммитится, резервная
  копия — в `~/.config/svitlo-keystore/`.

## Нативный код

`expo prebuild` перезаписывает `android/`, поэтому нативный код живёт в `native-android/`:
сейчас там модуль тихого OTA (`java/ua/com/svitlo/app/OtaBundle.kt` и его JVM-тест) и
модуль перезапуска `AppRestart.kt`/`AppRestartPackage.kt`, `res/` с ресурсами. Config plugin
`plugins/withAndroidWidget.js` копирует эти каталоги в сгенерированный проект при каждом
prebuild, `plugins/withSvitloNative.js` добавляет разрешения (`POST_NOTIFICATIONS`,
`REQUEST_INSTALL_PACKAGES`), `<queries>` для установщика APK, receiver'ы, signing config и
`versionCode`.

## Обновления

- **OTA JS-бандла** — `src/lib/ota.ts` + `UpdateContext`: бандл качается в фоне, применяется
  перезапуском (`AppRestart.restart()` — launcher-intent + `killProcess`), при неудачном старте
  `OtaBundle.resolve` откатывается к вшитому бандлу.
- **APK** — `src/lib/updates.ts`: `createDownloadResumable` с прогрессом, проверка размера и
  SHA-256 из `/api/v1/version`, затем системный установщик через `expo-intent-launcher` и
  `getContentUriAsync`. Без нового APK кнопка «Застосувати» у OTA честно отвечает, что бандл
  применится при следующем запуске.
- **UI** — `components/updates/DynamicUpdatePill.tsx` (капсула над таб-баром) и
  `ChangelogSheet.tsx` (шторка «Що нового» с группами feat/fix/perf и `WavyProgressBar`).

Виджет 4×2 остался в архиве Capacitor-эпохи (`apps/web/android`, коммит `082e8d4`): в текущем
APK `appwidget`-провайдеров нет, `dumpsys appwidget` его не видит. Перенос виджета в
`native-android/` — отдельная задача.

## Сборка APK

Собирается локальным Gradle из Android Studio: JDK 17, NDK 27.1.12297006, cmake 3.22.1.
Контейнерная сборка удалена — она поднимала второй Gradle-кэш на несколько гигабайт и на
14 ГБ RAM доводила до `systemd-oomd`.

```bash
./tools/build-android-apk.sh                    # release: arm64-v8a, подпись, публикация в R2
./tools/build-android-apk.sh --debug            # debug: arm64-v8a + x86_64 для эмулятора
./tools/build-android-apk.sh --no-publish --skip-tests
SVITLO_ABIS=arm64-v8a,x86_64 ./tools/build-android-apk.sh --no-publish   # релиз на эмулятор
```

APK кладётся в `apps/mobile/android-apk/`. Первая сборка ~15–20 мин (компиляция C++ модулей),
инкрементальная ~4–7 мин. `arm64-v8a` — единственная ABI релиза: так из 107,7 МБ ушли ~60 МБ
библиотек для x86/x86_64 и 32-бит. Эмулятор — x86_64, поэтому ему нужна debug-сборка или
`SVITLO_ABIS`.

Release подписывается ключом из `apps/mobile/credentials/` (см. раздел «Идентификаторы и
подпись»), путь подставляется через env `SVITLO_KEYSTORE`.

`NODE_PATH` обязателен для release-сборки: Gradle запускает Metro без Expo CLI, и Babel
ищет пресеты из `apps/mobile`, куда pnpm не линкует транзитивные пакеты. Без него
`createBundleReleaseJsAndAssets` падает с `Cannot find module 'babel-preset-expo'` или
`@babel/plugin-transform-react-jsx`. Debug-сборка не бандлит JS и потому этого не замечает.
`tools/build-android-apk.sh` выставляет его сам.

## Фаза 2: Главная

Точка входа подключает ядро до первого рендера: `configureCoreApi` (адрес API), `installStorage`
(expo-sqlite/kv-store) и `hydrateOfflineStartup()` (офлайн-пакет), плюс общий `queryClient` из
`@svitlo/core/api/query-client`.

Адрес API на сборке:

```bash
EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:8787/api/v1" npx expo start   # Android-эмулятор → локальный API
```

Без переменной используется прод-воркер `https://svitlo-api.olegvapnik45.workers.dev/api/v1`.

## Фаза 3.1: Монітор без карт

Розділ «Монітор» повторює веб-версію без карти відключень: сегменти «Групи», «Відключення»,
«Події». Групи — плитки з реальним станом `isActiveNow`; відключення й події — списки з часом,
адресою/районом і джерелом.

**Нативних карт у застосунку немає і не буде.** Це усвідомлене рішення:

- нуль нативного оверхеду: без `react-native-maps`, Gradle-плагінів, ключів Google/Apple,
  правок `AndroidManifest.xml` і ризику зламати `expo prebuild`;
- економія RAM і батареї на бюджетних пристроях — карта тримає движок і тайли, а користувачу
  потрібен код своєї групи та час;
- текстові контракти `packages/core` (черги, інтервали, `AlarmManager`) не потребують геометрії,
  а реєстр геоточок лише роздував би офлайн-пакет.

Карта лишається тільки у веб-версії (`apps/web`, `react-leaflet`); мобільний її не імпортує.

## Фаза 3.2: Пошук адреси

Екран «Пошук» — майстер «область → населений пункт → вулиця → будинок» на тих самих хуках
`@svitlo/core/api/queries`, що й веб. Підказки НП беруться з офлайн-пакета
(`searchOfflineSettlements` / `topOfflineSettlements`) і доповнюються серверними; Київ фіксує
«Київ» без введення.

Результат не вгадується: якщо точного дома немає, показуються відомі сусідні будинки та ручний
вибір групи з області. Для знайденої групи одразу показується графік на сьогодні й чесний статус
(«немає даних» ≠ «світло є»). Карти немає — адреса вводиться текстом.

## Фаза 3.3: Інфо

Екран «Інфо» — стрічка новин операторів і Укренерго (`useNews` з ядра): пошук по тексту,
фільтри за типом, перемикачі «Уся Україна» та «Лише про світло», pull-to-refresh. Якщо для
області новин немає, підхоплюється загальноукраїнська стрічка. Офлайн показуються останні
новини з пакета `/sync`. Картинки-графіки відкриваються, тап по картці веде на першоджерело.
