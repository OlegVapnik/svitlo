package ua.com.svitlo.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Регистрация `AppRestart` в списке пакетов `MainApplication`.
 *
 * Пакет добавляет сам config-plugin `withSvitloNative` — проект собирается из `expo prebuild`,
 * и правки в сгенерированном `android/` исчезли бы при следующей сборке.
 */
class AppRestartPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(AppRestartModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
