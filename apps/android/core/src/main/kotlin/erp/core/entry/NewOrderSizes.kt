package erp.core.entry

import erp.core.logic.Money
import erp.core.models.Customer
import erp.core.swiftDouble
import erp.core.swiftTrim

// A piece's size, by its category (store.ts SIZE_SCALES, components/shared/size-picker.tsx). A category with no
// scale has no size box at all, as on the web. A set with two parts keeps its size as one string,
// "Ring: 10 · Bangle: 2.4", which is what the rest of the ERP stores and reads. (NewOrderSizes.swift.)

// Sizes to the profile

// A size on an order is offered to the customer's profile (decisions.md "Sizes to the profile", the owner,
// 2026-10-05: "show a popup to save the size in the customer bio for the future if the customer size is not
// already in their bio. If it is in the bio then no popup"). Ported from src/lib/customer-sizes.ts.
//
// On the web the question comes a moment after a size is picked. On the phone it is asked once, after the order is
// saved: by then a new customer exists, and the pieces are final. Only when the house wants it (the shop's
// STORE_SIZE_TO_PROFILE: Taheri's, not Mina's).

/** The three sizes a customer's profile holds (Customer.ringSize, bangleSize, braceletSize). */
enum class NewOrderProfileField {
    ringSize, bangleSize, braceletSize;

    val rawValue: String get() = name

    /** PROFILE_SIZE_LABEL. */
    val label: String
        get() = when (this) {
            ringSize -> "Ring size"
            bangleSize -> "Bangle size"
            braceletSize -> "Bracelet size"
        }

    /** What the profile holds now. */
    fun current(c: Customer?): String? {
        val text: String? = when (this) {
            ringSize -> c?.ringSize
            bangleSize -> c?.bangleSize
            braceletSize -> c?.braceletSize
        }
        val t = NewOrderFormat.trim(text ?: "")
        return if (t.isEmpty()) null else t
    }
}

/** One size the profile could keep. */
data class NewOrderSizeSuggestion(
    val field: NewOrderProfileField,
    /** The size on the order. */
    val value: String,
    /** What the profile holds now, if anything. */
    val current: String?,
    /** For not asking twice: customer, field and value. */
    val key: String,
) {
    val id: String get() = this.field.rawValue
}

/** A size the profile could hold, with the field it belongs in. */
data class NewOrderProfileSize(val field: NewOrderProfileField, val value: String)

/** One piece's category and size, for `suggestions`. */
data class NewOrderSizedItem(val category: String, val size: String)

object NewOrderSizes {
    class Part(val key: String, val label: String, val options: List<String>) {
        val id: String get() = key
    }

    class Scale(
        /** Said under the box: "Indian ring size (0–25, 0.5 steps)". */
        val label: String,
        val parts: List<Part>,
        /** A set with a ring and a second part keeps "Ring: 10 · Bangle: 2.4"; the others keep the size as typed. */
        val multi: Boolean,
        /** A size saved before a set gained its second part is a bare "2.2", and belongs to this part. */
        val legacyPartKey: String?,
    )

    // 0, 0.5, 1 ... 25.
    private val ring: List<String> = (0..50).map { NewOrderFormat.trimmed(it.toDouble() / 2, digits = 1) }

    // 1.1 ... 3.0.
    private val bangle: List<String> = (11..30).map { Money.fixed(it.toDouble() / 10, 1) }

    // 4.5" to 9" in quarter inches, for the loose bracelet only (decisions.md "Sizes to the profile").
    private val looseBracelet: List<String> = (18..36).map { NewOrderFormat.trimmed(it.toDouble() / 4, digits = 2) + "\"" }
    private val string: List<String> = (14..30 step 2).map { "$it\"" }

    private fun single(label: String, options: List<String>): Scale =
        Scale(label, listOf(Part("", label, options)), multi = false, legacyPartKey = null)

    /** The scale for a category, or null when it has none. */
    fun scale(category: String): Scale? = when (category) {
        "cat001", "cat018" -> single("Indian ring size (0–25, 0.5 steps)", ring)
        "cat009" -> single("Band size (Indian 0–25, 0.5 steps)", ring)
        "cat010", "cat013", "cat016" -> single("Ring size (Indian 0–25, 0.5 steps)", ring)
        "cat005" -> single("Bracelet size (1.1–3.0)", bangle)
        "cat007" -> single("Bangle size (1.1–3.0)", bangle)
        "cat019" -> single("Loose bracelet (inches)", looseBracelet)
        "cat012" -> single("String length (inches)", string)
        "cat006", "cat014", "cat015" -> Scale(
            "Ring + Bracelet size",
            listOf(Part("Ring", "Ring size", ring), Part("Bracelet", "Bracelet size", bangle)),
            multi = true, legacyPartKey = "Bracelet",
        )
        "cat011" -> Scale(
            "Ring + Bangle size",
            listOf(Part("Ring", "Ring size", ring), Part("Bangle", "Bangle size", bangle)),
            multi = true, legacyPartKey = null,
        )
        else -> null
    }

    /** "Ring: 10 · Bangle: 2.4" → ["Ring": "10", "Bangle": "2.4"]; a bare size belongs to the legacy part. */
    fun parse(value: String, legacyKey: String?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (chunk in value.split('·').filter { it.isNotEmpty() }) {
            val pieces = chunk.split(':', limit = 2)
            if (pieces.size != 2) continue
            val key = swiftTrim(pieces[0])
            val v = swiftTrim(pieces[1])
            if (key.isNotEmpty() && v.isNotEmpty()) out[key] = v
        }
        val bare = swiftTrim(value)
        if (out.isEmpty() && legacyKey != null && bare.isNotEmpty()) out[legacyKey] = bare
        return out
    }

    /** The parts that have a size, in the scale's order. */
    fun compose(values: Map<String, String>, order: List<String>): String =
        order
            .mapNotNull { key ->
                val v = swiftTrim(values[key] ?: "")
                if (v.isEmpty()) null else "$key: $v"
            }
            .joinToString(" · ")

    // Sizes to the profile

    /** Single-size categories, by what they measure (customer-sizes.ts SINGLE). */
    private val singleField: Map<String, NewOrderProfileField> = mapOf(
        "cat001" to NewOrderProfileField.ringSize, "cat018" to NewOrderProfileField.ringSize,
        "cat009" to NewOrderProfileField.ringSize, "cat010" to NewOrderProfileField.ringSize,
        "cat013" to NewOrderProfileField.ringSize, "cat016" to NewOrderProfileField.ringSize,
        "cat007" to NewOrderProfileField.bangleSize,
        "cat005" to NewOrderProfileField.braceletSize, "cat019" to NewOrderProfileField.braceletSize,
    )

    /** The part names a multi-part size is written with ("Ring: 10 · Bangle: 2.4"). */
    private val partField: Map<String, NewOrderProfileField> = mapOf(
        "Ring" to NewOrderProfileField.ringSize, "Bangle" to NewOrderProfileField.bangleSize, "Bracelet" to NewOrderProfileField.braceletSize,
    )

    /**
     * The profile sizes a piece's size gives, in the order its parts are written: ring 12, or ring 10 and bangle 2.4, or
     * none (a chain's length is none of them).
     */
    fun profileSizes(category: String, size: String): List<NewOrderProfileSize> {
        val value = NewOrderFormat.trim(size)
        if (category.isEmpty() || value.isEmpty()) return emptyList()
        val s = scale(category) ?: return emptyList()
        if (s.multi) {
            val parsed = parse(value, s.legacyPartKey)
            return s.parts.mapNotNull { part ->
                val field = partField[part.key] ?: return@mapNotNull null
                val v = parsed[part.key] ?: return@mapNotNull null
                val t = NewOrderFormat.trim(v)
                if (t.isEmpty()) null else NewOrderProfileSize(field, t)
            }
        }
        val field = singleField[category]
        if (field != null) return listOf(NewOrderProfileSize(field, value))
        return emptyList()
    }

    /**
     * Sizes compare as the counter writes them: "12", " 12 ", "12.0" are one size, "US 6" and "us 6" one, and a bracelet's
     * inches with or without the mark (7, 7", 7 in, 7 inches) one (`sameSize`).
     */
    fun same(a: String?, b: String?): Boolean = normal(a) == normal(b)

    private fun isNumberChar(c: Char): Boolean {
        val type = Character.getType(c)
        return type == Character.DECIMAL_DIGIT_NUMBER.toInt() || type == Character.LETTER_NUMBER.toInt() || type == Character.OTHER_NUMBER.toInt()
    }

    private fun normal(s: String?): String {
        val t = NewOrderFormat.trim(s ?: "").lowercase()
            .split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
        // A number, then nothing, or a mark for inches.
        for (mark in listOf("inches", "inch", "in", "''", "\"")) {
            if (!t.endsWith(mark)) continue
            val head = NewOrderFormat.trim(t.dropLast(mark.length))
            if (head.isNotEmpty() && head.all { isNumberChar(it) || it == '.' }) {
                val n = swiftDouble(head)
                if (n != null) return NewOrderFormat.trimmed(n, digits = 6)
            }
        }
        if (t.isNotEmpty() && t.all { isNumberChar(it) || it == '.' }) {
            val n = swiftDouble(t)
            if (n != null) return NewOrderFormat.trimmed(n, digits = 6)
        }
        return t
    }

    /**
     * What the order's pieces give that the profile doesn't hold yet: one per field, the last piece's size where two
     * differ (`sizeSuggestions`). `who` keys a decision to its customer.
     */
    fun suggestions(
        who: String,
        profile: Customer?,
        items: List<NewOrderSizedItem>,
        decided: Set<String> = emptySet(),
    ): List<NewOrderSizeSuggestion> {
        val order = ArrayList<NewOrderProfileField>()
        val latest = HashMap<NewOrderProfileField, String>()
        for (item in items) {
            for (s in profileSizes(item.category, item.size)) {
                if (latest[s.field] == null) order.add(s.field)
                latest[s.field] = s.value
            }
        }
        val out = ArrayList<NewOrderSizeSuggestion>()
        for (field in order) {
            val value = latest[field] ?: continue
            val current = field.current(profile)
            if (current != null && same(current, value)) continue
            val key = "$who|${field.rawValue}|${NewOrderFormat.trim(value).lowercase()}"
            if (decided.contains(key)) continue
            out.add(NewOrderSizeSuggestion(field, value, current, key))
        }
        return out
    }

    /**
     * The offer after a save: the sizes on the order's pieces that the customer's profile doesn't hold. Nothing for a
     * walk-in (no customer id), or where the house doesn't keep sizes on the profile.
     */
    fun offer(d: NewOrderDraft, customerId: String?, profile: Customer?, houseWants: Boolean): List<NewOrderSizeSuggestion> {
        if (!houseWants || customerId.isNullOrEmpty()) return emptyList()
        return suggestions(customerId, profile, d.pieces.map { NewOrderSizedItem(it.category, it.size) })
    }

    /** The fields of `setCustomerSizes` for the ones chosen. */
    fun request(customerId: String, chosen: List<NewOrderSizeSuggestion>): MutableMap<String, Any?> {
        val sizes = LinkedHashMap<String, Any?>()
        for (s in chosen) sizes[s.field.rawValue] = s.value
        return linkedMapOf("customerId" to customerId, "sizes" to sizes)
    }
}
