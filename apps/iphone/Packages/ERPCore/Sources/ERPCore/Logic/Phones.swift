// Ported from src/lib/utils.ts normalizePhoneNumber and src/lib/whatsapp.ts toWhatsAppNumber / whatsAppLink
// (tests: PhonesTests, from whatsapp-number.test.ts).

import Foundation

/// The phone as the book keeps it: Pakistani numbers become +92…, a number with its "+" stays, anything
/// else is returned as typed.
public func normalizePhoneNumber(_ phone: String?) -> String {
    guard let phone, !phone.isEmpty else { return "" }
    // utils.ts strips /[\s\-().]/.
    let clean = String(phone.unicodeScalars.filter { s in
        !CharacterSet.whitespacesAndNewlines.contains(s) && !"-().".unicodeScalars.contains(s)
    })
    if clean.hasPrefix("+") { return clean }
    // Pakistani local: 03xxxxxxxxx.
    if clean.hasPrefix("0") && clean.utf16.count >= 10 { return "+92" + clean.dropFirst() }
    // Pakistani without the leading zero: 923xxxxxxxxx.
    if clean.hasPrefix("92") && clean.utf16.count >= 12 { return "+" + clean }
    return phone
}

/// A number as WhatsApp dials it: digits with the country code. A number written with its "+" or "00" is
/// international and stays as written (no 92 in front: the owner, 2026-10-05); only a domestic one gets Pakistan's.
public func toWhatsAppNumber(_ phone: String?) -> String {
    let raw = (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let digits = String(raw.unicodeScalars.filter { $0.value >= 48 && $0.value <= 57 })
    if digits.isEmpty { return "" }
    if raw.hasPrefix("+") { return digits }
    // /^00[1-9]/
    if digits.hasPrefix("00"), digits.count > 2, digits.dropFirst(2).first != "0" { return String(digits.dropFirst(2)) }
    if digits.hasPrefix("92") { return digits }
    if digits.hasPrefix("0") { return "92" + String(digits.drop(while: { $0 == "0" })) }
    // A Pakistani mobile written without its 0: 3xx xxxxxxx.
    if digits.count == 10 && digits.hasPrefix("3") { return "92" + digits }
    // Longer than any Pakistani number without a code: it carries its own.
    if digits.count >= 11 { return digits }
    return "92" + digits
}

/// wa.me link for a number and a prefilled message; "" if the number is unusable.
public func whatsAppLink(_ phone: String?, message: String = "") -> String {
    let num = toWhatsAppNumber(phone)
    if num.isEmpty { return "" }
    guard !message.isEmpty else { return "https://wa.me/\(num)" }
    // encodeURIComponent leaves A-Z a-z 0-9 - _ . ! ~ * ' ( ).
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-_.!~*'()")
    return "https://wa.me/\(num)?text=" + (message.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
}
