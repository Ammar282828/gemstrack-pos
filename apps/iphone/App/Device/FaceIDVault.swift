import Foundation
import LocalAuthentication
import Security

/// Small secrets this phone keeps behind Face ID (or Touch ID): the delete code, so a delete asks
/// for a face instead of four digits typed in front of a customer. Kept for this phone only,
/// readable only after Face ID, and forgotten by the phone itself if the enrolled faces change.
/// The server still checks the code every time (/api/auth/delete-code): this only types it.
enum FaceIDVault {
    private static let service = "erp.secret"

    struct Failure: Error {
        let code: String
        let message: String
    }

    /// Whether Face ID or Touch ID can be used, and which.
    static func biometry() -> (available: Bool, type: String) {
        let context = LAContext()
        var error: NSError?
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        switch context.biometryType {
        case .faceID: return (ok, "faceID")
        case .touchID: return (ok, "touchID")
        case .opticID: return (ok, "opticID")
        default: return (ok, "none")
        }
    }

    private static func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    static func save(_ value: String, for key: String) throws {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
            throw Failure(code: "unavailable", message: "This phone can't keep it behind Face ID.")
        }
        SecItemDelete(base(key) as CFDictionary)
        var item = base(key)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure(code: "failed", message: "Not saved (\(status)).") }
    }

    /// The secret after Face ID, or nil when none is kept. Face ID's sheet shows while this waits.
    static func read(_ key: String, reason: String) async throws -> String? {
        let context = LAContext()
        context.localizedReason = reason
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        let q = query
        return try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                var out: CFTypeRef?
                let status = SecItemCopyMatching(q as CFDictionary, &out)
                switch status {
                case errSecSuccess: cont.resume(returning: (out as? Data).flatMap { String(data: $0, encoding: .utf8) })
                case errSecItemNotFound: cont.resume(returning: nil)
                case errSecUserCanceled: cont.resume(throwing: Failure(code: "cancelled", message: "Cancelled"))
                default: cont.resume(throwing: Failure(code: "failed", message: "Face ID didn't unlock it (\(status))."))
                }
            }
        }
    }

    /// Whether a secret is kept, without asking for a face.
    static func has(_ key: String) -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        var query = base(key)
        query[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // A kept item that needs a face answers "interaction not allowed".
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    static func delete(_ key: String) {
        SecItemDelete(base(key) as CFDictionary)
    }
}
