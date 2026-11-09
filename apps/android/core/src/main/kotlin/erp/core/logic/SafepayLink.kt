package erp.core.logic

/**
 * Payment links by Safepay (src/lib/safepay.ts, lib/writes/payment-links.ts; owner, 2026-11-09). The server makes the link and
 * records the money when it is paid; these are the words and the checks the apps share (iPhone `SafepayLink`).
 */
object SafepayLink {
    private val PUBLIC_KEY = Regex("^sec_[0-9a-f-]{20,64}$")

    /** Safepay's PUBLIC key as the server accepts it (`isSafepayPublicKey`: ^sec_[0-9a-f-]{20,64}$). The Secret key is never asked for. */
    fun isPublicKey(raw: String): Boolean = PUBLIC_KEY.matches(raw.trim())

    /** What the amount box starts with: what is owed, in whole rupees (0 when nothing is owed: no link). */
    fun defaultAmount(owed: Double): Double = if (owed >= 1) Math.round(owed).toDouble() else 0.0

    /** Whether a record may be asked for money by link: open (not Cancelled or Refunded) and something owed. */
    fun offered(status: String, owed: Double): Boolean = status != "Cancelled" && status != "Refunded" && owed >= 1

    /** The server takes 1 rupee up to 50,000,000. */
    fun isValidAmount(amount: Double): Boolean = amount.isFinite() && amount >= 1 && amount <= 50_000_000

    /** "Assalam o Alaikum Sara, please pay PKR 12,500 for INV-000123 here: https://… — TAHERI". A walk-in or nameless customer gets no name. */
    fun message(customerName: String?, amount: Double, id: String, url: String, shopName: String): String {
        var greeting = "Assalam o Alaikum"
        val name = (customerName ?: "").trim()
        if (name.isNotEmpty() && !isWalkInName(name)) greeting += " $name"
        return "$greeting, please pay ${Money.pkr(Math.round(amount).toDouble())} for $id here: $url — $shopName"
    }
}
