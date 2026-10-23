/**
 * Config plugin: переносит нативные возможности Svitlo в сгенерированные `expo prebuild`
 * Android и iOS.
 *
 * `apps/mobile/android` и `apps/mobile/ios` не коммитятся, поэтому правки, сделанные руками,
 * исчезли бы после prebuild. Плагин воспроизводит их идемпотентно.
 *
 * Android:
 *   - разрешение POST_NOTIFICATIONS и meta-data статических App Shortcuts;
 *   - строки ярлыков;
 *   - загрузчик тихого OTA в MainApplication и ночной режим в MainActivity;
 *   - ProGuard-правила для WorkManager/Notifee/Room.
 *
 * iOS:
 *   - копіювання `native-ios/*.swift` в `ios/Svitlo/`;
 *   - реєстрація цих файлів у Xcode-проєкті (PBXFileReference/PBXBuildFile/PBXSources);
 *   - App Group `group.ua.com.svitlo.app` в entitlements (для майбутнього віджета);
 *   - виклик `SvitloOtaLoader.bundleURL()` у release-гілці `AppDelegate`.
 *
 * Kotlin-загрузчик OTA и ресурсы (иконка уведомления, shortcuts.xml) лежат в
 * `native-android/` и копируются плагином `withAndroidWidget`.
 */
const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
  withMainApplication,
  withMainActivity,
  withStringsXml,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('expo/config-plugins');

/** Спільна App Group для застосунку й майбутнього iOS-віджета. */
const IOS_APP_GROUP = 'group.ua.com.svitlo.app';

/** Swift-файли, які копіюються в `ios/Svitlo/` і реєструються в Xcode. */
const IOS_NATIVE_SOURCES = [
  'SvitloOtaLoader.swift',
  'SvitloSharedDefaults.swift',
  'SvitloSharedDefaults.m',
];

const PROGUARD_MARKER = '# svitlo-native:begin';
const PROGUARD_RULES = `${PROGUARD_MARKER}
# WorkManager (через Notifee) создаёт Room-базу по имени класса через reflection.
# R8 full mode вырезал WorkDatabase_Impl → краш InitializationProvider на старте.
-keep class androidx.work.** { *; }
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class com.notifee.** { *; }
# svitlo-native:end
`;

const SHORTCUT_STRINGS = {
  shortcut_home: 'Головна',
  shortcut_home_long: 'Статус світла й моя черга',
  shortcut_search: 'Пошук адреси',
  shortcut_search_long: 'Знайти групу за адресою',
  shortcut_monitor: 'Монітор',
  shortcut_monitor_long: 'Відключення та події',
  shortcut_news: 'Новини',
  shortcut_news_long: 'Стрічка операторів і Укренерго',
};

function withShortcutManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    const permissions = [
      'android.permission.POST_NOTIFICATIONS',
      // Установка скачанного APK: без разрешения системный установщик молча отказывает.
      // Пользователь всё равно подтверждает установку в системном окне.
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ];
    for (const permission of permissions) {
      if (!manifest['uses-permission'].some((item) => item.$['android:name'] === permission)) {
        manifest['uses-permission'].push({ $: { 'android:name': permission } });
      }
    }

    // Android 11+ прячет чужие приложения: без `<queries>` система может ответить
    // ActivityNotFoundException на VIEW-интент установщика APK.
    manifest.queries = manifest.queries ?? [];
    const hasInstallQuery = manifest.queries.some((entry) =>
      (entry.intent ?? []).some((intent) =>
        (intent.data ?? []).some(
          (data) => data.$?.['android:mimeType'] === 'application/vnd.android.package-archive',
        ),
      ),
    );
    if (!hasInstallQuery) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [{ $: { 'android:mimeType': 'application/vnd.android.package-archive' } }],
          },
        ],
      });
    }

    const application = manifest.application?.[0];
    const activity = application?.activity?.find((item) => item.$['android:name'] === '.MainActivity');
    if (activity) {
      activity['meta-data'] = activity['meta-data'] ?? [];
      if (!activity['meta-data'].some((item) => item.$['android:name'] === 'android.app.shortcuts')) {
        activity['meta-data'].push({
          $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' },
        });
      }
    }
    return cfg;
  });
}

function withShortcutStrings(config) {
  return withStringsXml(config, (cfg) => {
    const strings = (cfg.modResults.resources.string = cfg.modResults.resources.string ?? []);
    for (const [name, value] of Object.entries(SHORTCUT_STRINGS)) {
      if (!strings.some((item) => item.$?.name === name)) {
        strings.push({ $: { name }, _: value });
      }
    }
    return cfg;
  });
}

function withOtaLoader(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    // Нативный перезапуск для OTA: JS не может перезапустить процесс сам, а без нового
    // процесса свежий бандл не подхватится (путь к нему читается один раз в MainApplication).
    if (!contents.includes('add(AppRestartPackage())')) {
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply \{)/,
        '$1\n          add(AppRestartPackage())',
      );
    }
    if (!contents.includes('OtaBundle.resolve')) {
      contents = contents.replace(
        'override val reactHost: ReactHost by lazy {',
        'override val reactHost: ReactHost by lazy {\n    // В release сначала пробуем тихий OTA-бандл; в debug всегда идём в Metro.\n    val otaBundle = if (BuildConfig.DEBUG) null else OtaBundle.resolve(applicationContext)',
      );
      contents = contents.replace(
        /(packageList =\s*\n\s*PackageList\(this\)\.packages\.apply \{[\s\S]*?\n\s*\})/,
        '$1,\n      jsBundleFilePath = otaBundle?.absolutePath',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withNightMode(config) {
  return withMainActivity(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('AppCompatDelegate')) {
      contents = contents.replace(
        'import android.os.Bundle',
        'import android.os.Bundle\n\nimport androidx.appcompat.app.AppCompatDelegate',
      );
      contents = contents.replace(
        '  override fun onCreate(savedInstanceState: Bundle?) {\n',
        '  override fun onCreate(savedInstanceState: Bundle?) {\n    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)\n',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withProguard(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes(PROGUARD_MARKER)) {
        fs.writeFileSync(file, `${current.trimEnd()}\n\n${PROGUARD_RULES}`);
      }
      return cfg;
    },
  ]);
}

/**
 * Релизный APK: только arm64-v8a + подпись постоянным ключом, если он передан окружением.
 *
 * Почему ABI-фильтр, а не `reactNativeArchitectures` в `gradle.properties`: это свойство общее для
 * всех build type, и dev-сборка перестала бы ставиться в x86_64-эмулятор. Поэтому ограничение
 * живёт в `buildTypes.release`, а скорость сборки даёт `-PreactNativeArchitectures=arm64-v8a`
 * из `tools/build-android-apk.sh`.
 *
 * Почему подпись через env: ключ и пароли не должны попадать ни в репозиторий, ни в
 * сгенерированный `android/` (он в .gitignore, но всё равно уезжает в docker-контекст).
 * Без `SVITLO_KEYSTORE` release остаётся на debug-подписи — скрипт сборки об этом предупреждает.
 */
const GRADLE_MARKER = '// svitlo-native:gradle:begin';
const GRADLE_MARKER_END = '// svitlo-native:gradle:end';
const GRADLE_RELEASE_CONFIG = `${GRADLE_MARKER}
// ARM64 — единственная ABI, которая нужна телефонам. x86/x86_64 (эмулятор) и armeabi-v7a
// (32-бит) добавляли в APK 2.25.0 ~60 МБ .so-библиотек из 107 МБ.
def svitloReleaseAbis = (findProperty('svitlo.releaseAbis') ?: 'arm64-v8a').split(',').collect { it.trim() }
def svitloKeystore = System.getenv('SVITLO_KEYSTORE')

android {
    signingConfigs {
        if (svitloKeystore) {
            release {
                storeFile file(svitloKeystore)
                storePassword System.getenv('SVITLO_STORE_PASSWORD')
                keyAlias System.getenv('SVITLO_KEY_ALIAS') ?: 'svitlo'
                keyPassword System.getenv('SVITLO_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            ndk { abiFilters(*svitloReleaseAbis) }
            if (svitloKeystore) {
                signingConfig = signingConfigs.release
            }
        }
    }
}

dependencies {
    // JVM-тест логики OTA (native-android/test): проверяет подхват бандла и откат по маркеру
    // без телефона и эмулятора.
    testImplementation 'junit:junit:4.13.2'
}
${GRADLE_MARKER_END}
`;

function withReleaseGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (contents.includes(GRADLE_MARKER)) return cfg;
    cfg.modResults.contents = `${contents.trimEnd()}\n\n${GRADLE_RELEASE_CONFIG}`;
    return cfg;
  });
}

/**
 * R8 вырезает неиспользуемые ресурсы: иконки/splash/shortcuts дают несколько мегабайт.
 *
 * `expo.useLegacyPackaging=true` сжимает `.so` внутри APK. Для Svitlo это важнее скорости
 * первого старта: приложение скачивают во время блэкаута на слабом LTE, поэтому ~36 МБ
 * arm64-сборки против ~20 МБ — лишний трафик для каждого нового пользователя. Цена —
 * одноразовая распаковка native libs при установке. Решение зафиксировано в HANDOFF.
 *
 * `reactNativeArchitectures=arm64-v8a` — primary defense: даже ручной
 * `./gradlew assembleRelease` не соберёт x86/x86_64/armeabi-v7a. Скрипт сборки всё равно
 * передаёт `-PreactNativeArchitectures` для debug-эмулятора и проверяет ABI в готовом APK.
 */
function withReleaseProperties(config) {
  return withGradleProperties(config, (cfg) => {
    const properties = cfg.modResults;
    const wanted = [
      { key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
      { key: 'expo.useLegacyPackaging', value: 'true' },
      { key: 'reactNativeArchitectures', value: 'arm64-v8a' },
    ];
    for (const { key, value } of wanted) {
      const existing = properties.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) existing.value = value;
      else properties.push({ type: 'property', key, value });
    }
    return cfg;
  });
}

/**
 * Копіювання нативних джерел у згенерований `ios/Svitlo/`.
 *
 * `withDangerousMod` потрібен, бо prebuild створює `ios/` з нуля й не знає про
 * `native-ios/`. Копіюємо рівно `.swift` і `.m` (міст до React Native), щоб випадкові
 * файли (README, скриншоти) не потрапляли в target.
 */
function withIosNativeSources(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const sourceRoot = path.join(cfg.modRequest.projectRoot, 'native-ios');
      if (!fs.existsSync(sourceRoot)) return cfg;

      const targetRoot = path.join(cfg.modRequest.platformProjectRoot, 'Svitlo');
      fs.mkdirSync(targetRoot, { recursive: true });

      let copied = 0;
      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isFile() || (!entry.name.endsWith('.swift') && !entry.name.endsWith('.m'))) continue;
        fs.copyFileSync(path.join(sourceRoot, entry.name), path.join(targetRoot, entry.name));
        copied += 1;
      }
      if (copied > 0) {
        console.log(`withSvitloNative: скопійовано ${copied} нативних файлів у ios/Svitlo`);
      }
      return cfg;
    },
  ]);
}

/**
 * Реєстрація Swift-файлів у Xcode-проєкті.
 *
 * `addBuildSourceFileToGroup` створює PBXFileReference, PBXBuildFile і рядок у
 * PBXSourcesBuildPhase, а також додає дитину в PBXGroup `Svitlo`. Повторний запуск
 * prebuild безпечний: якщо файл із таким ім'ям уже є в групі, він пропускається.
 */
function withIosXcodeSources(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const group = project.pbxGroupByName('Svitlo');
    if (!group) {
      console.warn('withSvitloNative: у Xcode-проєкті немає групи Svitlo — Swift-файли не додано');
      return cfg;
    }

    const registered = new Set(
      (group.children ?? []).filter((child) => child?.comment).map((child) => child.comment),
    );

    for (const file of IOS_NATIVE_SOURCES) {
      if (registered.has(file)) continue;
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `Svitlo/${file}`,
        groupName: 'Svitlo',
        project,
      });
      console.log(`withSvitloNative: додано ${file} до Xcode target`);
    }
    return cfg;
  });
}

/**
 * App Group для майбутнього iOS-віджета.
 *
 * `aps-environment` та інші entitlements не чіпаємо: prebuild/`expo-notifications`
 * можуть додати свої ключі, плагін має лише доповнювати словник.
 */
function withIosAppGroup(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const key = 'com.apple.security.application-groups';
    const current = cfg.modResults[key];
    const groups = Array.isArray(current) ? current : [];
    if (!groups.includes(IOS_APP_GROUP)) {
      groups.push(IOS_APP_GROUP);
    }
    cfg.modResults[key] = groups;
    return cfg;
  });
}

/**
 * Підключення OTA-завантажувача в `AppDelegate.bundleURL()`.
 *
 * Патчимо лише release-гілку: у debug застосунок мусить ходити в Metro, інакше
 * `expo start` перестане оновлювати JS. Ідемпотентність — за наявністю виклику.
 */
function withIosOtaAppDelegate(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'Svitlo', 'AppDelegate.swift');
      if (!fs.existsSync(file)) return cfg;

      const contents = fs.readFileSync(file, 'utf8');
      if (contents.includes('SvitloOtaLoader.bundleURL()')) return cfg;

      const fallbackRe = /return Bundle\.main\.url\(forResource:\s*"main",\s*withExtension:\s*"jsbundle"\)/u;
      if (!fallbackRe.test(contents)) {
        console.warn(
          'withSvitloNative: не знайдено release-рядок bundleURL() в AppDelegate.swift',
        );
        return cfg;
      }

      const patched = contents.replace(
        fallbackRe,
        'return SvitloOtaLoader.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")',
      );
      fs.writeFileSync(file, patched);
      console.log('withSvitloNative: AppDelegate.swift підключено до SvitloOtaLoader');
      return cfg;
    },
  ]);
}

const withSvitloNative = (config) =>
  withIosOtaAppDelegate(
    withIosXcodeSources(
      withIosAppGroup(
        withIosNativeSources(
          withReleaseProperties(
            withReleaseGradle(
              withProguard(
                withNightMode(
                  withOtaLoader(withShortcutStrings(withShortcutManifest(config))),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

module.exports = withSvitloNative;
