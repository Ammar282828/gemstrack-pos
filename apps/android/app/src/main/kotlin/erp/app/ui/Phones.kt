package erp.app.ui

/**
 * A number as WhatsApp's wa.me wants it: digits only, with the country code (Phones.swift `toWhatsAppNumber`,
 * src/lib/phone.ts). Not in :core yet; move it there with its tests when Phones is ported.
 */
fun toWhatsAppNumber(phone: String?): String {
    val raw = (phone ?: "").trim()
    val digits = raw.filter { it in '0'..'9' }
    if (digits.isEmpty()) return ""
    if (raw.startsWith("+")) return digits
    // /^00[1-9]/
    if (digits.startsWith("00") && digits.length > 2 && digits[2] != '0') return digits.drop(2)
    if (digits.startsWith("92")) return digits
    if (digits.startsWith("0")) return "92" + digits.dropWhile { it == '0' }
    // A Pakistani mobile written without its 0: 3xx xxxxxxx.
    if (digits.length == 10 && digits.startsWith("3")) return "92$digits"
    // Longer than any Pakistani number without a code: it carries its own.
    if (digits.length >= 11) return digits
    return "92$digits"
}
