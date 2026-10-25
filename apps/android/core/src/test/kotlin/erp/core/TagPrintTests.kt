package erp.core

import erp.core.logic.Mqtt
import erp.core.logic.TagJob
import erp.core.logic.TagMethod
import erp.core.logic.TagPrint
import erp.core.logic.TagRoute
import erp.core.models.LabelLayout
import erp.core.models.LabelPrinterSettings
import erp.core.models.Product
import erp.core.models.Settings
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** The pure half of printing a tag from the phone (TagPrinter, ZebraTransport and LabelLivePrinter on the iPhone). */
class TagPrintTests {
    private val now = Instant.ofEpochSecond(1_792_868_709) // 25 Oct 2026, 00:05:09 in Karachi

    @Test
    fun aRouteIsKeptAsTextAndReadBack() {
        val r = TagRoute("192.168.1.50", 9100)
        assertEquals("""{"kind":"network","host":"192.168.1.50","port":9100}""", r.json)
        assertEquals(r, TagRoute.parse(r.json))
        assertEquals(TagRoute("printer.local", 9101), TagRoute.parse("""{"kind":"network","host":" printer.local ","port":9101}"""))
        // A way another device chose, a blank address, an odd port or nothing at all is no route here.
        assertNull(TagRoute.parse("""{"kind":"browserPrint","deviceUID":"x"}"""))
        assertNull(TagRoute.parse("""{"kind":"network","host":"  "}"""))
        assertEquals(9100, TagRoute.parse("""{"kind":"network","host":"a","port":0}""")?.port)
        assertNull(TagRoute.parse(null))
        assertNull(TagRoute.parse("not json"))
    }

    @Test
    fun theMethodDefaultsToLabelLive() {
        assertEquals(TagMethod.labelLive, TagMethod.of(null))
        assertEquals(TagMethod.labelLive, TagMethod.of("nonsense"))
        assertEquals(TagMethod.zebra, TagMethod.of("zebra"))
    }

    @Test
    fun theTestTagTakesTheShopsSizeAndPrinterOptionsButNoneOfItsFields() {
        val layout = LabelLayout(id = "t", name = "T", widthDots = 400, heightDots = 200, dpi = 300, tags = 2, printer = LabelPrinterSettings(darkness = 12, mode = "tear"))
        assertEquals(
            "^XA^CI28^PW400^LL200^LS0^MMT~SD12\n" +
                "^FO30,30^A0N,30,30^FH_^FDDemo Shop^FS\n" +
                "^FO30,90^A0N,24,24^FH_^FD25 Oct 2026^FS\n" +
                "^FO200,30^BQN,2,4,M^FH_^FDMA,TEST^FS\n" +
                "^PQ1,0,1,Y^XZ\n",
            TagPrint.testZpl("Demo Shop", layout, now),
        )
        // No size and no name: the standard tag's size, and words that still mean something.
        val blank = TagPrint.testZpl("", LabelLayout(id = "", name = "", widthDots = 0, heightDots = 0), now)
        assertEquals("^XA^CI28^PW664^LL296^LS0\n^FO30,30^A0N,30,30^FH_^FDTest print^FS\n^FO30,90^A0N,24,24^FH_^FD25 Oct 2026^FS\n^FO464,30^BQN,2,4,M^FH_^FDMA,TEST^FS\n^PQ1,0,1,Y^XZ\n", blank)
    }

    @Test
    fun aJobsZplIsTheShopsTagAtTodaysRates() {
        val settings = ERPDecode.model<Settings>(mapOf("shopName" to "Demo", "goldRatePerGram21k" to 26250, "goldRatePerGram24k" to 30000))!!
        val piece = ERPDecode.model<Product>(mapOf("sku" to "RIN-000101", "name" to "Demo ring", "categoryId" to "cat001", "metalType" to "gold", "karat" to "21k", "metalWeightG" to 4.25))!!
        val zpl = TagPrint.zpl(LabelLayout.standard, listOf(piece, piece), settings, TagJob(copies = 3, skip = 1), now)
        assertEquals(
            "^XA^CI28^PW664^LL296^LS0\n^PQ1,0,1,Y^XZ\n" +
                "^XA^CI28^PW664^LL296^LS0\n^FO100,150^A0R,20,20^FH_^FDSKU: RIN-000101^FS\n^FO450,80^BQN,2,4,M^FH_^FDMA,RIN-000101^FS\n^PQ3,0,1,Y^XZ\n" +
                "^XA^CI28^PW664^LL296^LS0\n^FO100,150^A0R,20,20^FH_^FDSKU: RIN-000101^FS\n^FO450,80^BQN,2,4,M^FH_^FDMA,RIN-000101^FS\n^PQ3,0,1,Y^XZ\n",
            zpl,
        )
    }

    @Test
    fun theZebrasHostStatusIsPutInTheShopsWords() {
        val ready = "\u0002030,0,0,1280,000,0,0,0,000,0,0,0\u0003\r\n\u0002000,0,0,0,0,2,4,0,00000000,1,000\u0003\r\n\u00020000,0\u0003\r\n"
        assertEquals("Ready.", TagPrint.describeHostStatus(ready))
        val stuck = "\u0002030,1,1,1280,000,0,0,0,000,0,0,0\u0003\r\n\u0002000,0,1,1,0,2,4,0,00000000,1,000\u0003\r\n\u00020000,0\u0003\r\n"
        assertEquals("Out of labels, the print head is open, out of ribbon, paused.", TagPrint.describeHostStatus(stuck))
        assertEquals("The print head is open.", TagPrint.describeHostStatus("030,0,0,1\n000,0,1,0"))
        // Not a Zebra's answer.
        assertNull(TagPrint.describeHostStatus(""))
        assertNull(TagPrint.describeHostStatus("HTTP/1.1 400 Bad Request"))
        assertNull(TagPrint.describeHostStatus("1,2\n3,4"))
    }

    // MARK: MQTT

    private fun hex(b: ByteArray) = b.joinToString("") { "%02X".format(it.toInt() and 255) }

    @Test
    fun theMqttPacketsAreThoseOfVersion311() {
        // CONNECT: 0x10, 17 bytes left: "MQTT", level 4, clean session, keep-alive 30, the client id "erp-1".
        assertEquals("1011" + "00044D515454" + "0402001E" + "0005" + "6572702D31", hex(Mqtt.connect("erp-1")))
        // SUBSCRIBE: 0x82, packet id 1, the topic, QoS 0.
        assertEquals("820C" + "0001" + "0007" + "244C4C2F75726C" + "00", hex(Mqtt.subscribe("\$LL/url", 1)))
        // PUBLISH at QoS 0: 0x30, the topic, then the payload as it is.
        assertEquals("300B" + "0007" + "244C4C2F75726C" + "6869", hex(Mqtt.publish("\$LL/url", "hi".toByteArray())))
        assertEquals("E000", hex(Mqtt.disconnect))
        // A length of 200 takes two bytes (C8 01), as MQTT's variable length does.
        assertEquals("30C801", hex(Mqtt.publish("a", ByteArray(197))).substring(0, 6))
    }

    @Test
    fun theBrokersAnswersAreTakenOffTheFrontOfWhatHasArrived() {
        val buffer = ByteArrayOutputStream()
        // Half a packet is no packet yet.
        buffer.write(byteArrayOf(0x20))
        assertNull(Mqtt.take(buffer))
        buffer.write(byteArrayOf(0x02, 0x00))
        assertNull(Mqtt.take(buffer))
        // CONNACK, then the start of a PUBLISH on the status topic.
        buffer.write(byteArrayOf(0x00))
        val status = Mqtt.publish("\$LL/status", "printed".toByteArray())
        buffer.write(status, 0, 5)
        val ack = assertNotNull(Mqtt.take(buffer))
        assertEquals(2, ack.type)
        assertContentEquals(byteArrayOf(0, 0), ack.body)
        assertNull(Mqtt.take(buffer))
        buffer.write(status, 5, status.size - 5)
        val published = assertNotNull(Mqtt.take(buffer))
        assertEquals(3, published.type)
        assertEquals("printed", Mqtt.publishedText(published))
        assertEquals(0, buffer.size())
        // Only a PUBLISH has text; an empty one has none.
        assertNull(Mqtt.publishedText(ack))
        val empty = ByteArrayOutputStream().also { it.write(Mqtt.publish("t", ByteArray(0))) }
        assertNull(Mqtt.publishedText(assertNotNull(Mqtt.take(empty))))
    }
}
