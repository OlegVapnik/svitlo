import Foundation

/**
 * Міст між React Native та майбутнім iOS-віджетом через App Group.
 *
 * Аналог Android `WidgetPrefs` (`svitlo_widget` / ключ `payload`): віджет читає той самий
 * JSON, який JS готує для домашнього екрана. `UserDefaults(suiteName:)` переживає смерть
 * процесу й доступний розширенню, на відміну від сховища всередині контейнера застосунку.
 *
 * Розширення віджета ще немає — клас існує, щоб майбутній target і RN-міст не дублювали
 * формат. Ім'я групи мусить збігатися з `entitlements` (див. `plugins/withSvitloNative.js`).
 */
@objc(SvitloSharedDefaults)
final class SvitloSharedDefaults: NSObject {
  static let appGroupIdentifier = "group.ua.com.svitlo.app"
  private static let payloadKey = "payload"

  /// Записує payload у спільне сховище. Порожній рядок — це валідний стан «даних немає».
  @objc static func store(_ payload: String) {
    guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
      NSLog("[svitlo-widget] App Group \(appGroupIdentifier) недоступна")
      return
    }
    defaults.set(payload, forKey: payloadKey)
  }

  /// Instance-версія для RN-моста (`RCT_EXTERN_METHOD(setPayload:)`).
  @objc func setPayload(_ payload: String) {
    Self.store(payload)
  }

  /// Читає payload. Потрібен і RN-мосту, і майбутньому віджету.
  @objc static func payload() -> String? {
    UserDefaults(suiteName: appGroupIdentifier)?.string(forKey: payloadKey)
  }
}
