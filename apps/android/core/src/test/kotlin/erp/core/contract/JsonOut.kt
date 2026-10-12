package erp.core.contract

import erp.core.logic.JS

/**
 * JSON text the way Foundation's `JSONSerialization` writes it with `[.prettyPrinted, .sortedKeys]`, which is how
 * the iPhone's file is laid out (`"key" : value`, two-space indents, an empty list as a blank line, `/` escaped), so
 * the two files read alike in a diff. Numbers that are whole print without a point.
 */
internal object JsonOut {
    fun pretty(value: Any?): String = StringBuilder().also { put(it, value, 0) }.toString()

    private fun put(out: StringBuilder, v: Any?, depth: Int) {
        when (v) {
            null -> out.append("null")
            is String -> quote(out, v)
            is Boolean -> out.append(if (v) "true" else "false")
            is Int, is Long -> out.append(v.toString())
            is Number -> out.append(number(v.toDouble()))
            is Map<*, *> -> {
                if (v.isEmpty()) {
                    out.append("{\n\n").append("  ".repeat(depth)).append('}')
                    return
                }
                out.append("{\n")
                val keys = v.keys.map { it.toString() }.sorted()
                keys.forEachIndexed { i, k ->
                    out.append("  ".repeat(depth + 1))
                    quote(out, k)
                    out.append(" : ")
                    put(out, v[k], depth + 1)
                    out.append(if (i < keys.size - 1) ",\n" else "\n")
                }
                out.append("  ".repeat(depth)).append('}')
            }
            is List<*> -> {
                if (v.isEmpty()) {
                    out.append("[\n\n").append("  ".repeat(depth)).append(']')
                    return
                }
                out.append("[\n")
                v.forEachIndexed { i, x ->
                    out.append("  ".repeat(depth + 1))
                    put(out, x, depth + 1)
                    out.append(if (i < v.size - 1) ",\n" else "\n")
                }
                out.append("  ".repeat(depth)).append(']')
            }
            else -> error("not JSON: ${v::class}")
        }
    }

    private fun number(x: Double): String {
        require(x.isFinite()) { "a NaN or infinity in the cases" }
        if (x == Math.rint(x) && Math.abs(x) < 1e15) return x.toLong().toString()
        return JS.number(x)
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '/' -> out.append("\\/")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                else -> if (c < ' ') out.append("\\u%04X".format(c.code)) else out.append(c)
            }
        }
        out.append('"')
    }
}
