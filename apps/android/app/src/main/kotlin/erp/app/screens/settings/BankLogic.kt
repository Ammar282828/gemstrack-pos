package erp.app.screens.settings

import erp.core.models.PaymentMethod

/** One account being typed. `id` is the stored one (the web's `pm-<time>`). */
data class BankAccountDraft(
    val id: String,
    val bankName: String = "",
    val accountName: String = "",
    val accountNumber: String = "",
    val iban: String = "",
) {
    val valid: Boolean get() = bankName.trim().isNotEmpty() && accountName.trim().isNotEmpty() && accountNumber.trim().isNotEmpty()

    /** As the ERP keeps it: an empty IBAN is left out. */
    val stored: Map<String, Any?>
        get() = buildMap {
            put("id", id)
            put("bankName", bankName.trim())
            put("accountName", accountName.trim())
            put("accountNumber", accountNumber.trim())
            if (iban.trim().isNotEmpty()) put("iban", iban.trim())
        }

    companion object {
        fun of(m: PaymentMethod) = BankAccountDraft(m.id, m.bankName, m.accountName, m.accountNumber, m.iban ?: "")

        fun new(nowMillis: Long = System.currentTimeMillis()) = BankAccountDraft("pm-$nowMillis")

        /** The confirmation's question for a removal. */
        fun removingTitle(names: List<String>): String {
            val named = names.filter { it.isNotEmpty() }
            return if (named.size == 1) "Remove ${named[0]}?" else "Remove these accounts?"
        }

        /** The banks the sheet offers (the web's list). */
        val banks = listOf(
            "Al Baraka Bank (Pakistan) Limited", "Allied Bank Limited", "Askari Bank", "Bank Alfalah", "Bank Al-Habib",
            "BankIslami Pakistan", "Bank of Khyber", "Bank of Punjab", "Dubai Islamic Bank", "Faysal Bank", "First Women Bank",
            "Habib Bank Limited (HBL)", "Habib Metropolitan Bank", "Industrial and Commercial Bank of China", "JS Bank",
            "MCB Bank", "MCB Islamic Bank", "Meezan Bank", "National Bank of Pakistan", "Samba Bank", "Silkbank Limited",
            "Sindh Bank", "Soneri Bank", "Standard Chartered Bank (Pakistan)", "Summit Bank", "United Bank Limited (UBL)",
            "Zarai Taraqiati Bank Limited",
        )
    }
}
