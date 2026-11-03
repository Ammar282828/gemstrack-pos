package erp.core

import erp.core.logic.Money
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals

/** The hand parser reads exactly what the regex reading did; the whole-rupee fast path prints what the digit search printed. */
class ERPDateFastPathTests {
    private fun same(s: String?) = assertEquals(ERPDate.parseRegex(s), ERPDate.parse(s), "for <$s>")

    @Test fun fixedShapesAgreeWithTheRegex() {
        val samples = listOf(
            "2026-10-08T06:00:00.000Z", "2026-10-08T06:00:00Z", "2026-10-08T06:00:00.5Z", "2026-10-08T06:00:00.123456789Z",
            "2026-10-08T06:00:00.1234567891234Z", "2026-10-08T06:00:00+05:00", "2026-10-08T06:00:00.250-03:30", "2026-10-08T06:00:00-00:30",
            "2026-02-30T06:00:00Z", "2026-13-01T06:00:00Z", "2026-10-08T24:00:00Z", "2026-10-08T06:60:00Z", "2026-10-08T06:00:60Z",
            "2026-10-08T06:00:00+19:00", "2026-10-08T06:00:00+05:60", "2026-10-08T06:00:00.Z", "2026-10-08T06:00:00", "2026-10-08 06:00:00Z",
            "2026-10-08T06:00:00z", "2026-10-08T06:00:00ZZ", "2026-10-08T06:00:00+0500", "  2026-10-08T06:00:00.000Z  ", "2024-02-29T00:00:00Z",
            "2025-02-29T00:00:00Z", "2026-10-08", "2026-10-32", "soon", "", "   ", null, "0000-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z",
            "２０２６-10-08T06:00:00Z", "2026-10-08T06:00:00.12a4Z", "2026-10-08T06:00:00+05:0x",
        )
        for (s in samples) same(s)
    }

    @Test fun manyGeneratedInputsAgree() {
        val r = Random(7)
        val offsets = listOf("Z", "+05:00", "-05:00", "+00:00", "-12:30", "+14:00", "+18:00", "+18:30", "+05:75", "-00:59")
        repeat(20_000) {
            val frac = when (r.nextInt(4)) { 0 -> ""; 1 -> "." + r.nextInt(1000).toString().padStart(3, '0'); 2 -> "." + r.nextLong(1_000_000_000_000L); else -> "." + r.nextInt(10) }
            val text = "%04d-%02d-%02dT%02d:%02d:%02d%s%s".format(
                r.nextInt(0, 10_000), r.nextInt(0, 15), r.nextInt(0, 33), r.nextInt(0, 26), r.nextInt(0, 62), r.nextInt(0, 62), frac, offsets[r.nextInt(offsets.size)],
            )
            same(text)
        }
    }

    @Test fun groupedFastPathMatchesTheDigitSearch() {
        fun slow(n: Double): String {
            val r = Math.rint(n)
            return r.toString()
        }
        assertEquals("85,000", Money.grouped(85_000.0))
        assertEquals("-1,234,568", Money.grouped(-1_234_567.5))
        assertEquals("0", Money.grouped(0.4))
        assertEquals("999,999,999,999,999", Money.grouped(999_999_999_999_999.0))
        assertEquals("1,000,000,000,000,000", Money.grouped(1e15))
        assertEquals("100,000", Money.grouped(100_000.0))
        val r = Random(3)
        repeat(5_000) {
            val n = r.nextLong(0, 1_000_000_000_000_000L).toDouble()
            val g = Money.grouped(n).replace(",", "")
            assertEquals(n.toLong().toString(), g, "for $n ${slow(n)}")
        }
    }
}
