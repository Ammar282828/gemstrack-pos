package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MarketingValueTests {
    private val doc = MarketingValue.parse("""{"frame":{"w":1080,"h":1920},"bg":{"photoId":null,"dim":0.5},"layers":[{"id":"a","x":10,"flag":true,"name":"Hi"}],"webOnly":{"newField":[1,2,3]}}""")

    @Test fun readsLikeTheSwiftEnum() {
        assertEquals(1080.0, doc["frame"].n("w"))
        assertEquals(7.0, doc["frame"].n("missing", 7.0))
        assertEquals("Hi", doc["layers"].array.first().s("name"))
        assertEquals("fallback", doc["bg"].s("photoId", "fallback"))
        assertTrue(doc["layers"].array.first()["flag"].bool)
        // A number is not text, and text that reads as a number is a number.
        assertEquals("", doc["frame"]["w"].string)
        assertEquals(12.5, MarketingValue.string("12.5").number)
        assertEquals(0.0, MarketingValue.string("twelve").number)
        // true is a bool, never the number 1
        assertEquals(0.0, MarketingValue.bool(true).number)
        assertFalse(MarketingValue.number(1.0).bool)
    }

    @Test fun aSaveKeepsFieldsItDoesNotKnow() {
        val changed = doc.withPath(listOf("bg", "photoId"), MarketingValue.string("p1"))
        assertEquals("p1", changed["bg"].s("photoId"))
        assertEquals(doc["webOnly"], changed["webOnly"])
        assertEquals(0.5, changed["bg"].n("dim"))
        // the original is untouched
        assertTrue(doc["bg"]["photoId"].isNull)
    }

    @Test fun setOnANonObjectMakesAnObject() {
        val v = MarketingValue.NULL.with("a", 1)
        assertEquals(1.0, v.n("a"))
        assertEquals("""{"a":1}""", v.text)
    }

    @Test fun textIsCanonicalSoEqualDocumentsAgree() {
        val a = MarketingValue.parse("""{"b":1,"a":{"d":2,"c":3}}""")
        val b = MarketingValue.parse("""{"a":{"c":3,"d":2},"b":1}""")
        assertEquals(a.text, b.text)
        assertEquals("""{"a":{"c":3,"d":2},"b":1}""", a.text)
        assertEquals(a, b)
    }

    @Test fun wholeNumbersAreWrittenWithoutADecimalPoint() {
        assertEquals("1080", MarketingValue.number(1080.0).text)
        assertEquals("0.5", MarketingValue.number(0.5).text)
        assertEquals("null", MarketingValue.number(Double.NaN).text)
        val made = MarketingValue.of(mapOf("w" to 1080.0, "h" to 1920, "x" to 0.25))
        assertEquals("""{"h":1920,"w":1080,"x":0.25}""", made.text)
    }

    @Test fun ofTakesPlainValuesAndOtherValues() {
        val v = MarketingValue.of(mapOf("a" to listOf(1, "two", null, true), "b" to MarketingValue.string("x"), "c" to mapOf("d" to 2.5)))
        assertEquals("""{"a":[1,"two",null,true],"b":"x","c":{"d":2.5}}""", v.text)
        assertEquals(listOf(1L, "two", null, true), (v.any as Map<*, *>)["a"])
    }

    @Test fun anAnswerThatIsNotJsonIsNull() {
        assertTrue(MarketingValue.parse("<html>").isNull)
        assertTrue(MarketingValue.parse("").isNull)
    }

    @Test fun withoutDropsAKey() {
        assertEquals("""{"b":2}""", MarketingValue.obj("a" to 1, "b" to 2).without("a").text)
    }
}
