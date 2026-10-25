package erp.core.logic

import erp.core.Json
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import java.time.Instant

// The pure half of printing a tag from the app (the iPhone's TagPrinter.swift, ZebraTransport.swift and LabelLivePrinter.swift):
// what a device is set to, the test tag, the printer's own words, and the few MQTT packets Label LIVE's broker is spoken to
// with. How the bytes travel (a socket) is the app's (erp.app.device); everything that decides what they are is here, so a
// JVM test holds it.

/** How a tag reaches the printer: Label LIVE's design (its Integrate link), or the shop's own tag as ZPL straight to a Zebra. */
enum class TagMethod(val raw: String) {
    labelLive("labelLive"), zebra("zebra");

    companion object {
        fun of(raw: String?): TagMethod = entries.firstOrNull { it.raw == raw } ?: labelLive
    }
}

/**
 * Where ZPL goes. Android has the network address only: Zebra Browser Print and a Mac's CUPS queues are the Mac's (and
 * Android has no CUPS), so a route kept by another device's setting is not read here.
 */
data class TagRoute(val host: String, val port: Int = 9100) {
    val json: String get() = "{\"kind\":\"network\",\"host\":${LabelLive.jsonString(host)},\"port\":$port}"

    companion object {
        fun parse(text: String?): TagRoute? {
            val m = Json.parse(text ?: return null) as? Map<*, *> ?: return null
            if (m["kind"] != "network") return null
            val host = (m["host"] as? String)?.trim().orEmpty()
            val port = (m["port"] as? Number)?.toInt() ?: 9100
            return if (host.isEmpty()) null else TagRoute(host, if (port in 1..65535) port else 9100)
        }
    }
}

/** What one print job asks of the printer. */
data class TagJob(
    val copies: Int = 1,
    /** Blank labels first, for a roll that is part used. */
    val skip: Int = 0,
    /** The first number a `{counter}` takes; null keeps the design's own. */
    val counterStart: Int? = null,
)

/** What a send answered: whether it went, and the shop's words for it. */
data class TagOutcome(val ok: Boolean, val message: String)

object TagPrint {
    /** The pieces' values a tag is filled from (Label LIVE's fields and the Tag CSV's columns, as the web fills them). */
    fun values(pieces: List<erp.core.models.Product>, settings: erp.core.models.Settings, today: Instant = Instant.now()): List<LabelValues> =
        pieces.map { LabelLive.valuesFor(it, settings, today) }

    /** The ZPL for these pieces on this layout (TagPrinter.zpl). */
    fun zpl(layout: LabelLayout, pieces: List<erp.core.models.Product>, settings: erp.core.models.Settings, job: TagJob = TagJob(), now: Instant = Instant.now()): String =
        Zpl.render(layout, values(pieces, settings, now), job.copies, job.skip, job.counterStart, now)

    /**
     * A small tag to prove the Zebra works: the shop's name, today's date, a QR of "TEST". It takes the shop's tag size and
     * printer options (so media, darkness and offsets are tried too) but none of its fields.
     */
    fun testZpl(shopName: String, layout: LabelLayout, now: Instant = Instant.now()): String {
        val w = if (layout.hasSize) layout.widthDots else 664
        val h = if (layout.hasSize) layout.heightDots else 296
        val test = LabelLayout(
            id = "test", name = "Test", widthDots = w, heightDots = h, dpi = layout.dpi, tags = 1, printer = layout.printer,
            fields = listOf(
                LabelLayoutField(id = "shop", type = LabelFieldType.text, x = 30, y = 30, data = shopName.ifEmpty { "Test print" }, fontSize = 30),
                LabelLayoutField(id = "date", type = LabelFieldType.text, x = 30, y = 90, data = "{date:d MMM yyyy}", fontSize = 24),
                LabelLayoutField(id = "qr", type = LabelFieldType.qr, x = maxOf(30, w - 200), y = 30, data = "TEST", qrMagnification = 4),
            ),
        )
        return Zpl.render(test, listOf(emptyMap()), now = now)
    }

    /**
     * `~HS` answers three lines, each framed STX ... ETX: line 1 `comm,paper out,pause,...`, line 2 `...,head up,ribbon out,...`
     * (Zebra's ZPL guide, Host Status Return). Not enough fields means it wasn't a Zebra's answer. "Ready." when nothing is wrong.
     */
    fun describeHostStatus(text: String): String? {
        val lines = text.split('\n', '\r', '\u000B', '\u000C', '\u0085', ' ', ' ', '\u0002', '\u0003')
            .map { it.trim { c -> c == ' ' || c == '\t' } }
            .filter { it.isNotEmpty() }
        if (lines.size < 2) return null
        val a = lines[0].split(",").map { it.trim { c -> c == ' ' || c == '\t' } }
        val b = lines[1].split(",").map { it.trim { c -> c == ' ' || c == '\t' } }
        if (a.size < 3 || b.size < 4) return null
        val problems = ArrayList<String>()
        if (a[1] == "1") problems.add("out of labels")
        if (b[2] == "1") problems.add("the print head is open")
        if (b[3] == "1") problems.add("out of ribbon")
        if (a[2] == "1") problems.add("paused")
        if (problems.isEmpty()) return "Ready."
        val first = problems[0].take(1).uppercase() + problems[0].drop(1)
        return (listOf(first) + problems.drop(1)).joinToString(", ") + "."
    }
}

/**
 * The least of MQTT 3.1.1 (Label LIVE's broker speaks only that): connect, subscribe to the status topic, publish one
 * message at QoS 0, read what comes back for a moment, disconnect. The packets only; the socket is the app's.
 */
object Mqtt {
    private fun string(s: String): ByteArray {
        val b = s.toByteArray(Charsets.UTF_8)
        return byteArrayOf((b.size shr 8).toByte(), (b.size and 0xFF).toByte()) + b
    }

    private fun length(n: Int): ByteArray {
        var left = n
        val out = ArrayList<Byte>()
        do {
            var byte = left % 128
            left /= 128
            if (left > 0) byte = byte or 0x80
            out.add(byte.toByte())
        } while (left > 0)
        return out.toByteArray()
    }

    private fun packet(header: Int, body: ByteArray): ByteArray = byteArrayOf(header.toByte()) + length(body.size) + body

    /** "MQTT", level 4 (3.1.1), clean session, keep-alive 30 s, the client id. */
    fun connect(clientId: String): ByteArray = packet(0x10, string("MQTT") + byteArrayOf(4, 0x02, 0, 30) + string(clientId))

    fun subscribe(topic: String, id: Int): ByteArray = packet(0x82, byteArrayOf((id shr 8).toByte(), (id and 0xFF).toByte()) + string(topic) + byteArrayOf(0))

    fun publish(topic: String, payload: ByteArray): ByteArray = packet(0x30, string(topic) + payload)

    val disconnect: ByteArray = byteArrayOf(0xE0.toByte(), 0)

    /** One whole packet: its type (the header's top four bits) and its body. */
    class Packet(val type: Int, val body: ByteArray)

    /** The next whole packet in the buffer, taken off its front; null when it is not all there yet. */
    fun take(buffer: java.io.ByteArrayOutputStream): Packet? {
        val bytes = buffer.toByteArray()
        if (bytes.size < 2) return null
        var length = 0
        var multiplier = 1
        var i = 1
        while (true) {
            if (i >= bytes.size) return null
            val b = bytes[i].toInt() and 255
            length += (b and 0x7F) * multiplier
            i += 1
            if (b and 0x80 == 0) break
            multiplier *= 128
            if (i > 4) { buffer.reset(); return null }
        }
        if (bytes.size < i + length) return null
        val body = bytes.copyOfRange(i, i + length)
        val type = (bytes[0].toInt() and 255) shr 4
        buffer.reset()
        buffer.write(bytes, i + length, bytes.size - (i + length))
        return Packet(type, body)
    }

    /** The text of a PUBLISH packet's payload (two bytes of topic length, the topic, then the payload; QoS 0, no id). */
    fun publishedText(p: Packet): String? {
        if (p.type != 3 || p.body.size < 2) return null
        val n = ((p.body[0].toInt() and 255) shl 8) or (p.body[1].toInt() and 255)
        if (p.body.size < 2 + n) return null
        val text = String(p.body, 2 + n, p.body.size - 2 - n, Charsets.UTF_8)
        return text.ifEmpty { null }
    }
}
