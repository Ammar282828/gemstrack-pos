package erp.core

import erp.core.logic.JS
import erp.core.logic.jsSorted
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The JavaScript behaviours the ported rules lean on (logic/JSCompat.kt). Every expected
 * value here was printed by Node 20 (and tens of thousands of random cases were compared the
 * same way while writing the Swift port).
 */
class JSCompatTests {
    private fun parse(s: String): Instant = ERPDate.parse(s)!!

    @Test
    fun testMathRoundSendsAHalfUp() {
        assertEquals(listOf(-2.0, 0.0, 1.0, 2.0, 3.0, 2.0, -3.0), listOf(-2.5, -0.5, 0.5, 1.5, 2.5, 2.4999, -2.6).map { JS.round(it) })
        assertEquals(-111597898.0, JS.round(-111597897.50000001))
    }

    @Test
    fun testToFixedReadsTheExactValueAndRoundsATieUp() {
        assertEquals("7.3", JS.toFixed(7.25, 1))
        assertEquals("1", JS.toFixed(0.5, 0))
        assertEquals("3", JS.toFixed(2.5, 0))
        assertEquals("1.00", JS.toFixed(1.005, 2))
        assertEquals("8.35", JS.toFixed(8.345, 2))
        assertEquals("-0.0", JS.toFixed(-0.04, 1))
        assertEquals("0.00", JS.toFixed(0.0, 2))
        assertEquals("1234.57", JS.toFixed(1234.5678, 2))
        assertEquals("100.00", JS.toFixed(99.995, 2))
        assertEquals("10.0", JS.toFixed(10.0, 1))
    }

    @Test
    fun testNumberToTextTheWayEcmaScriptPrintsIt() {
        assertEquals(
            listOf("3", "5.2", "104000", "0.00001", "1e-7", "1e+21", "1.5e+21", "-12.5", "0.30000000000000004", "123456789012345680000", "100", "0.000001"),
            listOf(3.0, 5.2, 104000.0, 0.00001, 1e-7, 1e21, 1.5e21, -12.5, 0.1 + 0.2, 1.2345678901234568e20, 100.0, 0.000001).map { JS.number(it) },
        )
        assertEquals("0", JS.number(-0.0))
    }

    @Test
    fun testParseFloatTakesTheNumberTheTextStartsWith() {
        val text = listOf(" 26300abc", ".5", "5.", "1e3x", "1e", "-", "Infinityx", "0x10", "  -3.5e-2z", "+7")
        assertEquals(listOf("26300", "0.5", "5", "1000", "1", "NaN", "Infinity", "0", "-0.035", "7"), text.map { JS.number(JS.parseFloat(it)) })
    }

    @Test
    fun testParseIntTakesTheWholeNumberTheTextStartsWith() {
        assertEquals(listOf("21", "NaN", "24", "-3", "NaN", "3"), listOf("21k", "k21", " 24 ", "-3x", "", "3.9").map { JS.number(JS.parseInt(it)) })
    }

    @Test
    fun testNumberOfTextIsNaNUnlessTheWholeTextIsANumber() {
        val text = listOf("", " 12 ", "12abc", "1e3", "0x1f", "1,000", "Infinity", "-Infinity", ".5", "5.", "abc", "+0x1f", "inf", "nan")
        assertEquals(
            listOf("0", "12", "NaN", "1000", "31", "NaN", "Infinity", "-Infinity", "0.5", "5", "NaN", "NaN", "NaN", "NaN"),
            text.map { JS.number(JS.toNumber(it)) },
        )
    }

    @Test
    fun testLocaleCompareOrdersPunctuationDigitsThenLettersWithCaseLast() {
        val pairs = listOf(
            "a" to "B", "B" to "a", "a" to "A", "A" to "a", "cust-1" to "cust-a", "cust_2" to "cust-3", "2026-09-10" to "2026-09-10T10:00:00Z",
            "2026-10-01T10:00:00.000Z" to "2026-10-01T10:00:00+05:00", "" to "a", "a" to "a", "10" to "9", "Cust-3" to "cust-1", "x y" to "x-y",
        )
        assertEquals(listOf(-1, 1, -1, 1, -1, -1, -1, -1, -1, 0, -1, 1, -1), pairs.map { Integer.signum(JS.localeCompare(it.first, it.second)) })
    }

    @Test
    fun testTrimAndSpaceAreJavaScriptsNotSwifts() {
        assertEquals("a", JS.trim("﻿a "))
        assertEquals("\u0085x", JS.trim("\u0085x"))
        assertTrue(JS.isSpace('﻿'))
        assertFalse(JS.isSpace('\u0085'))
    }

    @Test
    fun testStableSortKeepsTiesInTheirOrder() {
        val items = listOf("b" to 1, "a" to 1, "c" to 0, "d" to 1)
        assertEquals(listOf("c", "b", "a", "d"), items.jsSorted { x, y -> (x.second - y.second).toDouble() }.map { it.first })
    }

    @Test
    fun testDatesLocalMeansKarachi() {
        // A bare day: parseISO reads it as the local midnight, `new Date` as UTC's.
        assertEquals(ERPDate.parse("2026-10-08T19:00:00Z"), JS.parseISO("2026-10-09"))
        assertEquals(ERPDate.parse("2026-10-09T00:00:00Z"), JS.newDate("2026-10-09"))
        // No zone on a date-time: local again.
        assertEquals(ERPDate.parse("2026-10-08T20:00:00Z"), JS.newDate("2026-10-09T01:00:00"))
        assertEquals(ERPDate.parse("2026-10-08T20:00:30Z"), JS.newDate("2026-10-09T01:00:30"))
        assertEquals(ERPDate.parse("2026-10-08T19:30:00Z"), JS.parseISO("2026-10-08T19:30:00.000Z"))
        assertNull(JS.parseISO("soon"))
        assertNull(JS.newDate(""))
        assertNull(JS.newDate("2026-10-09T25:00:00"))
        assertEquals(parse("2026-10-08T19:00:00Z"), JS.karachiStartOfDay(parse("2026-10-08T19:30:00Z")))
        assertEquals(parse("2026-10-07T19:00:00Z"), JS.karachiStartOfDay(parse("2026-10-08T18:59:59Z")))
        assertEquals(1, JS.calendarDays(parse("2026-10-08T20:00:00Z"), parse("2026-10-08T10:00:00Z")))
    }
}
