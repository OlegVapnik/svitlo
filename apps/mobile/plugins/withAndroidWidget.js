/**
 * Config plugin: переносит нативный Android-код виджета в сгенерированный prebuild.
 *
 * `expo prebuild` перезаписывает android/, поэтому виджет и фоновые receivers нельзя держать
 * внутри него. Исходники лежат в apps/mobile/native-android/ и при каждом prebuild копируются:
 *   native-android/java/**  → android/app/src/main/java/**
 *   native-android/res/**   → android/app/src/main/res/**
 *
 * Манифест (receiver'ы, permissions) и строки добавляются следующими шагами фазы 4 — здесь
 * только копирование файлов, чтобы scaffold уже был готов к переносу кода.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

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

const withAndroidWidget = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const nativeRoot = path.join(projectRoot, 'native-android');
      const mainRoot = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main');

      const copied =
        copyDir(path.join(nativeRoot, 'java'), path.join(mainRoot, 'java')) +
        copyDir(path.join(nativeRoot, 'res'), path.join(mainRoot, 'res'));

      if (copied > 0) {
        console.log(`withAndroidWidget: скопійовано ${copied} нативних файлів у android/app/src/main`);
      }
      return cfg;
    },
  ]);

module.exports = withAndroidWidget;
