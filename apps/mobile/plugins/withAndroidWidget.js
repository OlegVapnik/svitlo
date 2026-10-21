/**
 * Config plugin: переносит нативный Android-код виджета в сгенерированный prebuild.
 *
 * `expo prebuild` перезаписывает android/, поэтому виджет и фоновые receivers нельзя держать
 * внутри него. Исходники лежат в apps/mobile/native-android/ и при каждом prebuild копируются:
 *   native-android/java/**  → android/app/src/main/java/**
 *   native-android/res/**   → android/app/src/main/res/**
 *
 * Манифест (receiver'ы виджетов и meta-data) и регистрация модуля `SvitloWidget` добавляются
 * здесь же: prebuild генерирует `MainApplication` и манифест с нуля, поэтому правки, сделанные
 * руками в android/, потерялись бы при следующей сборке.
 */
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');

function copyDir(source, target) {
  if (!fs.existsSync(source)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copied += copyDir(from, to);
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

/** Три размера — три receiver'а: лаунчер показывает их отдельными пунктами в списке виджетов. */
const WIDGET_RECEIVERS = [
  { name: '.widget.SvitloWidget2x1', info: '@xml/svitlo_widget_2x1' },
  { name: '.widget.SvitloWidget4x1', info: '@xml/svitlo_widget_4x1' },
  { name: '.widget.SvitloWidget4x2', info: '@xml/svitlo_widget_4x2' },
];

function withWidgetReceivers(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    application.receiver = application.receiver ?? [];

    for (const widget of WIDGET_RECEIVERS) {
      if (application.receiver.some((item) => item.$?.['android:name'] === widget.name)) continue;
      application.receiver.push({
        $: {
          'android:name': widget.name,
          // `exported=true` обязателен: APPWIDGET_UPDATE приходит от системного лаунчера.
          'android:exported': 'true',
          'android:label': '@string/widget_label',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': widget.info,
            },
          },
        ],
      });
    }
    return cfg;
  });
}

/**
 * Регистрация `SvitloWidgetPackage` рядом с `AppRestartPackage`.
 *
 * Импорт нужен отдельно: модуль живёт в подпакете `widget`, а `MainApplication` — в корне
 * `ua.com.svitlo.app`, поэтому одного `add(...)` без import недостаточно.
 */
function withWidgetPackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('import ua.com.svitlo.app.widget.SvitloWidgetPackage')) {
      contents = contents.replace(
        /^package ua\.com\.svitlo\.app\n/,
        'package ua.com.svitlo.app\n\nimport ua.com.svitlo.app.widget.SvitloWidgetPackage\n',
      );
    }
    if (!contents.includes('add(SvitloWidgetPackage())')) {
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply \{)/,
        '$1\n          add(SvitloWidgetPackage())',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

const withAndroidWidget = (config) =>
  withWidgetPackage(
    withWidgetReceivers(
      withDangerousMod(config, [
        'android',
        async (cfg) => {
          const projectRoot = cfg.modRequest.projectRoot;
          const nativeRoot = path.join(projectRoot, 'native-android');
          const mainRoot = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main');

          const copied =
            copyDir(path.join(nativeRoot, 'java'), path.join(mainRoot, 'java')) +
            copyDir(path.join(nativeRoot, 'res'), path.join(mainRoot, 'res')) +
            // JVM-тесты (`./gradlew :app:testReleaseUnitTest`) живут рядом с исходниками, но
            // prebuild их не создаёт: без копирования тестовая папка остаётся пустой.
            copyDir(
              path.join(nativeRoot, 'test'),
              path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'test'),
            );

          if (copied > 0) {
            console.log(
              `withAndroidWidget: скопійовано ${copied} нативних файлів у android/app/src/main`,
            );
          }
          return cfg;
        },
      ]),
    ),
  );

module.exports = withAndroidWidget;
