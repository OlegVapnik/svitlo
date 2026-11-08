package ua.com.svitlo.app.live

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Региструет `SvitloLive` в React Native. Добавку в MainApplication делает config-plugin
 * `withAndroidWidget` при каждом prebuild — рядом с SvitloWidgetPackage.
 */
class SvitloLivePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SvitloLiveModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
