const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Standalone-репозиторий держит общие пакеты внутри `packages/*` (file:-зависимости
// npm разворачивает симлинками). Metro должен видеть оба корня — и корень приложения,
// и каталог пакетов, иначе импорты `@svitlo/core` не разрешаются.
config.watchFolders = [path.resolve(projectRoot, 'packages')];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, 'packages/core/node_modules'),
  path.resolve(projectRoot, 'packages/shared/node_modules'),
  path.resolve(projectRoot, 'packages/domain/node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
