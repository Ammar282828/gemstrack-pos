package erp.app.auth

import erp.app.data.JsonText
import erp.core.Json

/** Who the ERP says this account is (/api/app/me), and the house's own settings that came with it. */
data class Me(
    val email: String,
    val role: String,
    val karigar: Karigar?,
    /** The house's own settings; missing from an answer cached by an older build. */
    val shop: Shop?,
) {
    data class Karigar(val id: String, val name: String)

    fun toJson(): String = JsonText.of(
        buildMap {
            put("email", email)
            put("role", role)
            karigar?.let { put("karigar", mapOf("id" to it.id, "name" to it.name)) }
            shop?.let { put("shop", it.toMap()) }
        },
    )!!

    companion object {
        /** Null unless the answer is an object with an email and a role. */
        fun fromJson(text: String?): Me? = text?.let { from(Json.parse(it)) }

        fun from(value: Any?): Me? {
            val m = value as? Map<*, *> ?: return null
            val email = m["email"] as? String ?: return null
            val role = m["role"] as? String ?: return null
            val k = (m["karigar"] as? Map<*, *>)?.let { k ->
                val id = k["id"] as? String
                val name = k["name"] as? String
                if (id != null && name != null) Karigar(id, name) else null
            }
            return Me(email, role, k, (m["shop"] as? Map<*, *>)?.let { Shop.from(it) })
        }
    }
}

/** What the web reads from its build (lib/store-config.ts) and the screens must follow, per house. */
data class Shop(
    /** The shop's own name ("TAHERI"), for what goes to a customer or a karigar: never "… ERP". */
    val name: String,
    /** This account's counter name, when it has one on the house's list (lib/people.ts). */
    val person: String?,
    /** The counter names "Taken by" offers (STORE_TAKEN_BY). */
    val takenBy: List<String>,
    val expenseCategories: List<String>,
    /** Partners pay expenses and draw (STORE_PARTNERSHIP, House of Mina). */
    val partnership: Boolean,
    /** The website takes orders, so online orders wait to be confirmed (STORE_WEBSITE_SELLING). */
    val websiteSelling: Boolean,
    /** An invoice is named after its customer ("Invoice - <name>") (STORE_INVOICE_BY_CUSTOMER). */
    val invoiceByCustomer: Boolean,
    val invoiceWhatsappPdf: Boolean,
    /** Sizes on an order are offered to the customer's profile (STORE_SIZE_TO_PROFILE). */
    val sizeToProfile: Boolean,
) {
    fun toMap(): Map<String, Any?> = buildMap {
        put("name", name)
        person?.let { put("person", it) }
        put("takenBy", takenBy)
        put("expenseCategories", expenseCategories)
        put("partnership", partnership)
        put("websiteSelling", websiteSelling)
        put("invoiceByCustomer", invoiceByCustomer)
        put("invoiceWhatsappPdf", invoiceWhatsappPdf)
        put("sizeToProfile", sizeToProfile)
    }

    companion object {
        /** Before the ERP has answered (the demo, an old cached answer): nothing assumed beyond the house. */
        fun fallback(house: String): Shop {
            val mina = house == "mina"
            return Shop(
                name = if (mina) "MINA" else "TAHERI", person = null, takenBy = emptyList(), expenseCategories = emptyList(),
                partnership = mina, websiteSelling = !mina, invoiceByCustomer = !mina, invoiceWhatsappPdf = !mina, sizeToProfile = !mina,
            )
        }

        fun demo(house: String): Shop {
            val f = fallback(house)
            return f.copy(
                name = "DEMO", person = "Demo", takenBy = listOf("Demo", "Counter Two", "Counter Three"),
                expenseCategories = listOf("Shop", "Utilities", "Karigar", "Rent", "Partner Drawings", "Partner Salary", "Other"),
            )
        }

        /** A field the answer lacks is the house's default, not a refusal to read the rest. */
        fun from(m: Map<*, *>, house: String = erp.app.config.House.id): Shop {
            val f = fallback(house)
            fun strings(k: String, d: List<String>) = (m[k] as? List<*>)?.mapNotNull { it as? String } ?: d
            return Shop(
                name = m["name"] as? String ?: f.name,
                person = m["person"] as? String,
                takenBy = strings("takenBy", f.takenBy),
                expenseCategories = strings("expenseCategories", f.expenseCategories),
                partnership = m["partnership"] as? Boolean ?: f.partnership,
                websiteSelling = m["websiteSelling"] as? Boolean ?: f.websiteSelling,
                invoiceByCustomer = m["invoiceByCustomer"] as? Boolean ?: f.invoiceByCustomer,
                invoiceWhatsappPdf = m["invoiceWhatsappPdf"] as? Boolean ?: f.invoiceWhatsappPdf,
                sizeToProfile = m["sizeToProfile"] as? Boolean ?: f.sizeToProfile,
            )
        }
    }
}
