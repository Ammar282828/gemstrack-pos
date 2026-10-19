package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesignProtocolTests {
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

    @Test fun thePageHasTheBundleAndTheRules() {
        val page = DesignProtocol.page("var a = '</script><b>';")
        assertTrue(page.startsWith("<!doctype html><meta http-equiv='Content-Security-Policy' content=\""))
        assertTrue(page.contains("connect-src 'none'"))
        assertTrue(page.contains("default-src 'none'"))
        // a closing tag inside the bundle cannot end the script early
        assertEquals(1, Regex("</script>").findAll(page).count())
        assertTrue(page.contains("<\\/script><b>"))
    }

    @Test fun inputCarriesTheOptionsThenTheDocumentPhotosFieldsAndHouse() {
        val doc = NativeArtwork.blank()
        val text = DesignProtocol.input(doc, mapOf("p1" to "data:image/jpeg;base64,AAAA"), mapOf("headline" to "Ruby"), "taheri", mapOf("action" to "preset", "value" to "stack-left", "px" to 540, "doc" to "ignored"))
        val v = MarketingValue.parse(text)
        assertEquals("preset", v.s("action"))
        assertEquals("stack-left", v.s("value"))
        assertEquals(540.0, v.n("px"))
        assertEquals("taheri", v.s("house"))
        assertEquals("Ruby", v["fields"].s("headline"))
        assertEquals("data:image/jpeg;base64,AAAA", v["photos"].s("p1"))
        // the document wins over an option of the same name, and a design is sent as it is
        assertEquals(doc, v["doc"])
        assertEquals(1080.0, v["doc"]["frame"].n("w"))
    }

    @Test fun theBrandRidesWithEveryCallAsTheSwiftSendsIt() {
        val v = MarketingValue.parse(DesignProtocol.input(NativeArtwork.blank(), emptyMap(), emptyMap(), "mina", mapOf("action" to "words"), DesignProtocol.brandOf("mina", "House of Mina")))
        assertEquals("mina", v["brand"].s("id"))
        assertEquals("House of Mina", v["brand"].s("name"))
        assertEquals("words", v.s("action"))
        // without one the key is absent, not null
        assertTrue(!MarketingValue.parse(DesignProtocol.input(NativeArtwork.blank(), emptyMap(), emptyMap(), "mina")).obj.containsKey("brand"))
    }

    @Test fun theNewActionsAndTheirOptionsPassThroughUntouched() {
        // resize, resizeMerge, words, siteLayouts and friends: the protocol only carries what the screens name.
        val options = mapOf(
            "action" to "resize", "targets" to listOf(mapOf("w" to 1080.0, "h" to 1920.0)), "photoMarked" to true,
            "swap" to mapOf("from" to "photo", "to" to "photo-x1"), "subject" to mapOf("x" to 0.2, "y" to 0.3, "w" to 0.5, "h" to 0.4),
        )
        val v = MarketingValue.parse(DesignProtocol.input(NativeArtwork.blank(), emptyMap(), mapOf("headline" to "Ruby"), "taheri", options))
        assertEquals("resize", v.s("action"))
        assertEquals(1920, v["targets"].array[0].n("h").toInt())
        assertTrue(v["photoMarked"].bool)
        assertEquals("photo-x1", v["swap"].s("to"))
        assertEquals(0.5, v["subject"].n("w"))
        val words = MarketingValue.parse(DesignProtocol.input(NativeArtwork.blank(null, 1080.0), emptyMap(), emptyMap(), "taheri", mapOf("action" to "words", "px" to 120, "texts" to mapOf("WhatsApp caption" to "hello"), "facts" to "21K")))
        assertEquals("hello", words["texts"].s("WhatsApp caption"))
        assertEquals("21K", words.s("facts"))
        assertEquals(1080.0, words["doc"]["frame"].n("h"))
    }

    @Test fun aNullDocumentIsSentAsNull() {
        val v = MarketingValue.parse(DesignProtocol.input(MarketingValue.NULL, emptyMap(), emptyMap(), "mina"))
        assertTrue(v["doc"].isNull)
        assertEquals("mina", v.s("house"))
    }

    @Test fun aPhotoIsSentAsADataAddressOfItsOwnType() {
        assertTrue(DesignProtocol.photoDataUrl(jpeg).startsWith("data:image/jpeg;base64,/9j/"))
        assertTrue(DesignProtocol.photoDataUrl(png).startsWith("data:image/png;base64,"))
        // unknown bytes are called JPEG, as the Swift does
        assertTrue(DesignProtocol.photoDataUrl(ByteArray(4)).startsWith("data:image/jpeg;base64,"))
    }

    @Test fun theCallTakesItsInputFromTheBridgeAndAnswersByRequestId() {
        val script = DesignProtocol.call("d7")
        assertTrue(script.contains("var id=\"d7\""))
        assertTrue(script.contains("JSON.parse(NativeDesign.input(id))"))
        assertTrue(script.contains("await window.nativeDesign(input)"))
        assertTrue(script.contains("catch(e){out=JSON.stringify({nativeError:String(e)});}"))
        assertTrue(script.contains("NativeDesign.done(id,out)"))
    }

    @Test fun anErrorFromTheEngineIsAFailureInTheSwiftsWords() {
        val e = assertFailsWith<DesignFailure> { DesignProtocol.parse("""{"nativeError":"TypeError: x is undefined"}""") }
        assertEquals("The design could not be drawn: TypeError: x is undefined", e.message)
        assertFailsWith<DesignFailure> { DesignProtocol.parse("null") }
        assertFailsWith<DesignFailure> { DesignProtocol.parse("") }
    }

    @Test fun anAnswerIsReadAsTheDocumentItIs() {
        val answer = DesignProtocol.parse("""{"doc":{"layers":[]},"image":"AAEC","boxes":[{"id":"a","x":1,"y":2,"w":3,"h":4}],"added":["a"],"caption":"Hello","catalogue":{"palettes":[{"id":"x","label":"X"}]}}""")
        assertEquals("Hello", answer.s("caption"))
        assertEquals("a", answer["boxes"].array.first().s("id"))
        assertEquals("X", answer["catalogue"]["palettes"].array.first().s("label"))
        assertEquals(listOf<Byte>(0, 1, 2), DesignProtocol.imageBytes(answer)?.toList())
        assertNull(DesignProtocol.imageBytes(MarketingValue.obj("x" to 1)))
    }

    @Test fun aBlankStoryAndSquareAreTheEnginesStartingPages() {
        val story = NativeArtwork.blank()
        assertEquals(1920.0, story["frame"].n("h"))
        assertEquals("#EDE6DA", story["bg"].s("color"))
        assertTrue(story["placements"].isNull)
        val square = NativeArtwork.blank("p1", 1080.0)
        assertEquals("p1", square["bg"].s("photoId"))
        assertEquals("{}", square["placements"].text)
        assertEquals("fill", square["bg"]["placement"].s("mode"))
    }
}
