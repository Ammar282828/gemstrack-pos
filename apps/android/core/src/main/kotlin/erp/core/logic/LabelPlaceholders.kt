package erp.core.logic

// Ported from ERPCore's LabelPlaceholders.swift. The words the tag designer offers for a field's data: the piece's fields
// and the Tag CSV's columns as `{placeholders}` (`_1`, `_2` for a double tag), the date, the time and the counter, and the
// transforms after a pipe. The rules of how Zpl.kt fills them are there; this only writes the tokens. Sample values are
// made up, for a design with no piece.

data class LabelChip(val token: String, val label: String, val group: String) {
    val id: String get() = token
}

data class LabelTransform(val token: String, val help: String) {
    val id: String get() = token
}

object LabelPlaceholders {
    /** `{sku}` for one tag; `{sku_1}`, `{sku_2}` ... for a label of several. */
    fun tokens(key: String, tags: Int): List<String> {
        val name = if (key.startsWith("csv:")) key.substring(4) else key
        if (tags <= 1) return listOf("{$name}")
        return (1..minOf(12, tags)).map { "{${name}_$it}" }
    }

    fun pieceChips(tags: Int): List<LabelChip> = LabelLive.labelFields.flatMap { f ->
        tokens(f.key, tags).mapIndexed { i, t -> LabelChip(t, if (tags > 1) "${f.label} (tag ${i + 1})" else f.label, "Piece") }
    }

    fun csvChips(tags: Int): List<LabelChip> = LabelCSV.baseHeaders.flatMap { h ->
        tokens("csv:$h", tags).mapIndexed { i, t -> LabelChip(t, if (tags > 1) "$h (tag ${i + 1})" else h, "Tag CSV") }
    }

    /** Date, time and counter. */
    val specials: List<LabelChip> = listOf(
        LabelChip("{date}", "Today’s date", "Date and counter"),
        LabelChip("{date:dd/MM/yyyy}", "Date 24/10/2026", "Date and counter"),
        LabelChip("{time}", "Time", "Date and counter"),
        LabelChip("{counter:1:1:4}", "Counter 0001, 0002…", "Date and counter"),
    )

    /** What can follow a pipe, and what it does. */
    val transforms: List<LabelTransform> = listOf(
        LabelTransform("|prefix:Rs ", "Put words before the value (nothing if it is empty)"),
        LabelTransform("|suffix:/-", "Put words after the value"),
        LabelTransform("|upper", "CAPITALS"),
        LabelTransform("|lower", "small letters"),
        LabelTransform("|fixed:2", "Always 2 decimal places"),
        LabelTransform("|group", "12500 becomes 12,500"),
        LabelTransform("|max:18", "Cut to 18 letters"),
    )

    val help: List<String> = listOf(
        "{sku} puts the piece’s SKU; {sku_2} the second tag’s.",
        "{price|prefix:Rs |suffix:/-} adds words round a value.",
        "{date:d MMM yyyy} and {time:HH:mm} use letters: yyyy MM dd HH mm ss, MMMM, EEEE.",
        "{counter:START:STEP:PAD} counts up a label at a time: {counter:1:1:4} gives 0001, 0002.",
        "A word in braces the designer does not know prints as typed, so a typo shows.",
    )

    /** The placeholders a text holds (`{...}` with no new line or brace inside), in order. */
    fun tokens(text: String): List<String> {
        val out = ArrayList<String>()
        var current: StringBuilder? = null
        for (ch in graphemes(text)) {
            if (ch == "{") current = StringBuilder("{")
            else if (ch == "}" && current != null) { current.append("}"); out.add(current.toString()); current = null }
            else if (ch == "\n") current = null
            else current?.append(ch)
        }
        return out
    }

    /** The text with a token added at the end. */
    fun appending(token: String, text: String): String = text + token

    // MARK: Samples

    /** Made-up values for piece `n` of a label, every key a design can read; nothing here is a shop's. */
    fun sampleValues(piece: Int): LabelValues {
        val n = piece
        val suffix = n.toString().padStart(4, '0')
        val v = LinkedHashMap<String, String>()
        v["sku"] = "SAMPLE-$suffix"; v["name"] = "Sample piece $n"; v["price"] = "Rs 12,500"; v["priceNumber"] = "12500"
        v["weight"] = "4.250 g"; v["weightNumber"] = "4.250"; v["metal"] = "Silver 925"; v["karat"] = "925"; v["category"] = "Rings"
        v["stones"] = "Sample stones"; v["stoneWeight"] = "0.300"; v["diamonds"] = ""; v["size"] = "7"; v["plating"] = "Rhodium"
        v["shop"] = "Sample shop"; v["qr"] = "SAMPLE-$suffix"; v["date"] = "24 Oct 2026"
        val csv = mapOf(
            "sku" to "SAMPLE-$suffix", "product_name" to "Sample piece $n", "category_id" to "rings", "shop_name" to "Sample shop",
            "total_price_pkr" to "12500", "metal_type" to "silver", "metal_weight_g" to "4.250", "karat" to "925",
            "stone_weight_g" to "0.300", "stone_details" to "Sample stones", "stone_charges" to "300", "making_charges" to "1200",
            "qr_content" to "SAMPLE-$suffix",
        )
        for (h in LabelCSV.baseHeaders) v["csv:$h"] = csv[h] ?: ""
        return v
    }
}
