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
- Release-подпись Android переиспользует keystore из `apps/web/android/app/keystore/`
  (`svitlo-release.p12`, alias `svitlo`). На этапе EAS он загружается в credentials проекта
  (см. фазу 5 плана) — сам файл в git не коммитится.

## Нативный код

`expo prebuild` перезаписывает `android/`, поэтому виджет и фоновые receivers держим в
`native-android/{java,res}`. Config plugin `plugins/withAndroidWidget.js` копирует их в
сгенерированный проект при каждом prebuild.

## Сборка APK без локального Android SDK

Используется тот же образ, что и для веба (`svitlo-android-builder:latest`). Кэш Gradle —
`.cache/gradle` в корне репозитория:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/.cache/gradle:/tmp/.gradle" -v "$PWD:/repo" \
  -e ANDROID_HOME=/opt/android-sdk -e ANDROID_SDK_ROOT=/opt/android-sdk \
  -e GRADLE_USER_HOME=/tmp/.gradle -e HOME=/tmp \
  -e ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a \
  svitlo-android-builder:latest \
  bash -c 'cd /repo/apps/mobile/android && ./gradlew --no-daemon assembleDebug'
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Первая сборка ~15–20 мин
(компиляция C++ модулей), инкрементальная ~4–7 мин. `arm64-v8a` — только для dev-проверок;
release собирать со всеми ABI (фаза 5).

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
