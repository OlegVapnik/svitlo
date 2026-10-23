#import <React/RCTBridgeModule.h>

/**
 * RN-міст до `SvitloSharedDefaults` (App Group `group.ua.com.svitlo.app`).
 *
 * JS викликає `NativeModules.SvitloSharedDefaults.setPayload(json)` на iOS, щоб
 * майбутній віджет міг читати той самий payload, що й Android-віджет із
 * `SharedPreferences`. Реєстрація через `RCT_EXTERN_MODULE` не потребує правок
 * AppDelegate: React Native знаходить модуль під час створення bridge.
 */
@interface RCT_EXTERN_MODULE(SvitloSharedDefaults, NSObject)

RCT_EXTERN_METHOD(setPayload:(NSString *)payload)

@end
