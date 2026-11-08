import CoreFoundation
import CryptoKit
import Foundation

/**
 * Нативний завантажувач тихого OTA JS-бандла для iOS.
 *
 * JS-код кладе бандл у `Library/Application Support/ota/` і видаляє маркер `.booted`
 * лише після успішного монтування застосунку. Логіка старту повторює Android
 * (`native-android/java/ua/com/svitlo/app/OtaBundle.kt`):
 *  1. маркер `.booted` лишився з минулого запуску → бандл не піднявся, видаляємо його
 *     й маркер та повертаємось до вшитого `main.jsbundle`;
 *  2. бандла немає або він підозріло малий → вшитий бандл;
 *  3. підпис маніфесту невалідний або хеш/розмір не збігається → вважаємо файл битим,
 *     видаляємо його й теж ідемо у вшитий бандл (JS побачить відсутній бандл і позначить
 *     SHA як невдалий, як і на Android);
 *  4. інакше ставимо маркер і повертаємо URL OTA-файлу.
 *
 * Мережі тут немає: скачування, розпакування gzip і запис файлів робить JS (`src/lib/ota.ts`).
 */
@objc(SvitloOtaLoader)
final class SvitloOtaLoader: NSObject {
  private static let otaDirectoryName = "ota"
  private static let bundleFileName = "index.android.bundle"
  private static let manifestFileName = "version.json"
  private static let bootMarkerName = ".booted"
  private static let minimumBundleSize: Int64 = 100_000

  /// Мапа `keyId -> base64` (32 сирих байти Ed25519). Дзеркало `src/lib/ota-key.ts`.
  /// Новий ключ додаємо сюди до публікації манифесту з новим `keyId`.
  private static let publicKeys: [String: String] = [
    "svitlo-ota-2026-1": "AuwtZrLx1+Iao76JZI53UX/Wj9bItuB6Fo7XcOo7sRY=",
  ]

  /// Точка входу з `AppDelegate.bundleURL()`. Викликається лише в release-збірці.
  @objc static func bundleURL() -> URL? {
    let fileManager = FileManager.default
    guard let supportDirectory = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      return nil
    }

    let directory = supportDirectory.appendingPathComponent(otaDirectoryName, isDirectory: true)
    let bundle = directory.appendingPathComponent(bundleFileName)
    let marker = directory.appendingPathComponent(bootMarkerName)

    if fileManager.fileExists(atPath: marker.path) {
      // Минулого запуску JS не підтвердив успішний старт. Повторювати той самий бандл
      // небезпечно: краще один раз відкотитись, ніж потрапити в цикл падінь.
      discard(bundle, marker: marker)
      NSLog("[svitlo-ota] попередній OTA-бандл не підтвердив старт — відкат до вшитого")
      return nil
    }

    guard fileManager.fileExists(atPath: bundle.path) else {
      return nil
    }

    guard let attributes = try? fileManager.attributesOfItem(atPath: bundle.path),
          let bundleSize = (attributes[.size] as? NSNumber)?.int64Value,
          bundleSize >= minimumBundleSize else {
      discard(bundle, marker: marker)
      NSLog("[svitlo-ota] OTA-бандл відсутній або замалий — вшитий бандл")
      return nil
    }

    guard isValidBundle(bundle, size: bundleSize, in: directory) else {
      // Битий/непідписаний бандл не можна лишати на диску: інакше `confirmOtaBoot()`
      // вважав би його застосованим, хоча насправді працює вшитий JS.
      discard(bundle, marker: marker)
      return nil
    }

    guard fileManager.createFile(atPath: marker.path, contents: Data("1".utf8)) else {
      // Без маркера неможливо відкотитись після ймовірного падіння — не ризикуємо.
      NSLog("[svitlo-ota] не вдалося записати маркер старту — вшитий бандл")
      return nil
    }

    NSLog("[svitlo-ota] застосовано OTA-бандл \(bundle.lastPathComponent) (\(bundleSize) B)")
    return bundle
  }

  // MARK: - Перевірка маніфесту та файлів

  private static func isValidBundle(_ bundle: URL, size bundleSize: Int64, in directory: URL) -> Bool {
    let manifestURL = directory.appendingPathComponent(manifestFileName)
    guard let manifestData = try? Data(contentsOf: manifestURL),
          let manifest = (try? JSONSerialization.jsonObject(with: manifestData)) as? [String: Any],
          let keyId = manifest["keyId"] as? String,
          let signature = manifest["signature"] as? String,
          let publicKey = publicKeys[keyId],
          let jsBundle = manifest["jsBundle"] as? [String: Any],
          let expectedHash = (jsBundle["sha256"] as? String)?.lowercased(),
          let expectedSize = (jsBundle["sizeBytes"] as? NSNumber)?.int64Value else {
      NSLog("[svitlo-ota] немає валідного version.json — вшитий бандл")
      return false
    }

    guard verifySignature(manifest: manifest, signature: signature, publicKeyBase64: publicKey) else {
      NSLog("[svitlo-ota] підпис маніфесту не збігається — вшитий бандл")
      return false
    }

    // Варіант 1: манифест описує вже розпакований `index.android.bundle`.
    // Лишаємо цю перевірку першою — вона знадобиться, якщо формат манифесту зміниться.
    if bundleSize == expectedSize, let digest = try? sha256Hex(of: bundle), digest == expectedHash {
      return true
    }

    // Варіант 2 (поточний формат): `sha256`/`sizeBytes` манифесту описують скачаний `.gz`
    // (`tools/build-ota-bundle.sh`). Прив'язку до розпакованого файлу дає `meta.json`:
    // його `sha256` мусить дорівнювати підписаному хешу манифесту, а `bundleSha256` —
    // реальному хешу `index.android.bundle`. meta.json пише JS одразу після успішної
    // розпаковки, тому пара «манифест + meta» описує саме цей бандл.
    let metaURL = directory.appendingPathComponent("meta.json")
    guard let metaData = try? Data(contentsOf: metaURL),
          let meta = (try? JSONSerialization.jsonObject(with: metaData)) as? [String: Any],
          let metaHash = (meta["sha256"] as? String)?.lowercased(),
          metaHash == expectedHash,
          let metaSize = (meta["sizeBytes"] as? NSNumber)?.int64Value,
          metaSize == expectedSize,
          let metaBundleHash = (meta["bundleSha256"] as? String)?.lowercased(),
          let metaBundleSize = (meta["bundleSizeBytes"] as? NSNumber)?.int64Value,
          metaBundleSize == bundleSize,
          let digest = try? sha256Hex(of: bundle),
          digest == metaBundleHash else {
      NSLog("[svitlo-ota] sha256/розмір OTA-бандла не збігається — вшитий бандл")
      return false
    }
    return true
  }

  private static func verifySignature(
    manifest: [String: Any],
    signature signatureBase64: String,
    publicKeyBase64: String
  ) -> Bool {
    guard let signature = Data(base64Encoded: signatureBase64), signature.count == 64,
          let keyData = Data(base64Encoded: publicKeyBase64), keyData.count == 32,
          let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else {
      return false
    }

    // Підписується весь манифест без `signature`; `keyId` входить у підпис.
    var payload = manifest
    _ = payload.removeValue(forKey: "signature")
    let message = Data(canonicalJSON(payload).utf8)
    return publicKey.isValidSignature(signature, for: message)
  }

  // MARK: - Канонічний JSON

  /// Канонічний JSON: рекурсивно відсортовані ключі, без пробілів.
  ///
  /// Мусить збігатися з `canonicalizeJson()` у `packages/core/src/lib/ota-signature.ts`
  /// (і з `tools/ota-signing.mjs`), інакше підпис не зійдеться. Маніфест містить лише
  /// рядки, числа, булеві значення, масиви й об'єкти.
  private static func canonicalJSON(_ value: Any) -> String {
    if value is NSNull {
      return "null"
    }
    if let string = value as? String {
      return jsonString(string)
    }
    if let number = value as? NSNumber {
      if CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
        return number.boolValue ? "true" : "false"
      }
      return jsonNumber(number)
    }
    if let array = value as? [Any] {
      return "[\(array.map(canonicalJSON).joined(separator: ","))]"
    }
    if let object = value as? [String: Any] {
      let keys = object.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
      let fields = keys.map { key in
        "\(jsonString(key)):\(canonicalJSON(object[key]!))"
      }
      return "{\(fields.joined(separator: ","))}"
    }
    return "null"
  }

  private static func jsonString(_ value: String) -> String {
    var output = "\""
    for scalar in value.unicodeScalars {
      switch scalar.value {
      case 0x22: output += "\\\""
      case 0x5C: output += "\\\\"
      case 0x08: output += "\\b"
      case 0x0C: output += "\\f"
      case 0x0A: output += "\\n"
      case 0x0D: output += "\\r"
      case 0x09: output += "\\t"
      default:
        if scalar.value < 0x20 {
          output += String(format: "\\u%04x", scalar.value)
        } else {
          output.unicodeScalars.append(scalar)
        }
      }
    }
    return output + "\""
  }

  private static func jsonNumber(_ number: NSNumber) -> String {
    let value = number.doubleValue
    guard value.isFinite else {
      return "null"
    }
    // Цілі лишаємо цілими: `JSON.stringify(2838920)` не має експоненти.
    if value == value.rounded(.towardZero), abs(value) <= 9_007_199_254_740_991 {
      return String(number.int64Value)
    }
    return String(value)
  }

  // MARK: - Допоміжне

  private static func sha256Hex(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var hasher = SHA256()
    while true {
      let chunk = try handle.read(upToCount: 1 << 20) ?? Data()
      if chunk.isEmpty {
        break
      }
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func discard(_ bundle: URL, marker: URL) {
    let fileManager = FileManager.default
    try? fileManager.removeItem(at: bundle)
    try? fileManager.removeItem(at: marker)
  }
}
