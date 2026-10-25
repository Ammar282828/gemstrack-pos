package erp.app.device

import erp.app.config.Prefs
import erp.core.Json
import erp.core.ERPDate
import erp.core.logic.LabelLive
import erp.core.logic.LabelLiveConfig
import erp.core.logic.Mqtt
import erp.core.logic.TagJob
import erp.core.logic.TagMethod
import erp.core.logic.TagOutcome
import erp.core.logic.TagPrint
import erp.core.logic.TagRoute
import erp.core.logic.labelLiveConfig
import erp.core.models.LabelLayout
import erp.core.models.Product
import erp.core.models.Settings
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Printing the shop's own tag (Settings > Labels, core's `LabelLayout`) from the phone: the iPhone's TagPrinter.swift,
// ZebraTransport.swift and LabelLivePrinter.swift. The tag is drawn as ZPL by core (`Zpl.render`, the web's zebra-zpl.ts byte
// for byte, held by LabelGoldenTests) and sent the way this device is set to:
//
// - A Zebra on the shop's network (raw TCP, port 9100): the ZPL written and the connection closed. Zebra Browser Print and a
//   Mac's CUPS queues are the Mac's; Android has neither, so they are not offered.
// - Label LIVE: it has no Android app either, so a tag goes to it as the iPhone's does, through its MQTT broker (port 1883) on
//   the counter Mac, which takes the same labellive:// link on `$LL/url` and reports on `$LL/status`.
//
// Which one a print uses is this phone's choice (`TagPrinter.method`), kept per business like the iPhone's UserDefaults.

object TagPrinter {
    private const val METHOD = "erp.tagPrinter.method"
    private const val ROUTE = "erp.tagPrinter.route"

    /** This device's choice of method, per business (the web's print history is per browser too). */
    var method: TagMethod
        get() = TagMethod.of(Prefs.string(METHOD))
        set(value) = Prefs.putString(METHOD, value.raw)

    /** This device's Zebra, per business; null until chosen. */
    var route: TagRoute?
        get() = TagRoute.parse(Prefs.string(ROUTE))
        set(value) = Prefs.putString(ROUTE, value?.json)

    /**
     * Prints these pieces' tags by this device's method: the shop's tag as ZPL to its Zebra, or Label LIVE. Each piece is
     * noted in this device's print history either way.
     */
    suspend fun print(pieces: List<Product>, settings: Settings, job: TagJob = TagJob()): TagOutcome = when (method) {
        TagMethod.labelLive -> {
            val config = settings.labelLiveConfig
                ?: return TagOutcome(false, "Label LIVE isn't set up. Paste the design's Integrate link in Settings → Labels → Label LIVE.")
            LabelLivePrinter.print(pieces, settings, config, job.copies).let { TagOutcome(it.ok, it.message) }
        }
        TagMethod.zebra -> {
            val layout = settings.labelLayout ?: LabelLayout.standard
            val outcome = send(TagPrint.zpl(layout, pieces, settings, job))
            LabelPrintHistory.note(pieces.map { it.sku }, layout.name, LabelLivePrinter.Route.api, outcome.ok, outcome.message)
            outcome
        }
    }

    /** ZPL to this device's Zebra (the designer's test print sends its own). */
    suspend fun send(zpl: String): TagOutcome {
        val to = route ?: return TagOutcome(false, "Choose the Zebra first: Settings → Labels → Printer.")
        return ZebraTransport.send(zpl, to)
    }
}

/** One TCP conversation with a Zebra's raw port: connect, write, optionally listen for a moment, close. */
object ZebraTransport {
    /** Connecting is given six seconds, as the iPhone's. */
    private const val CONNECT_MS = 6000

    suspend fun send(zpl: String, to: TagRoute): TagOutcome = networkSend(zpl, to.host, to.port)

    /**
     * The printer's own answer to a status question (`~HS`), in the shop's words; null when the printer said nothing.
     * "Ready." when nothing is wrong.
     */
    suspend fun status(to: TagRoute): String? {
        val answer = try { exchange(to.host, to.port, "~HS".toByteArray(), replyMs = 2000) } catch (e: Exception) { return null }
        return TagPrint.describeHostStatus(String(answer, Charsets.UTF_8))
    }

    suspend fun networkSend(zpl: String, host: String, port: Int): TagOutcome {
        val h = host.trim()
        if (h.isEmpty()) return TagOutcome(false, "Type the Zebra's address first (Settings → Labels → Printer).")
        return try {
            exchange(h, port, zpl.toByteArray(Charsets.UTF_8), replyMs = 0)
            TagOutcome(true, "Sent to $h.")
        } catch (e: SocketTimeoutException) {
            TagOutcome(false, "No answer from $h in six seconds. Is the Zebra on, and on the same network as this phone?")
        } catch (e: Exception) {
            TagOutcome(false, "Couldn't reach the Zebra at $h (port $port): is it on, on this network, and the address right? (${e.message ?: e.javaClass.simpleName})")
        }
    }

    /** Writes `data`; when `replyMs` > 0 waits up to that long for the printer to say something and returns it. */
    private suspend fun exchange(host: String, port: Int, data: ByteArray, replyMs: Int): ByteArray = withContext(Dispatchers.IO) {
        Socket().use { s ->
            s.connect(InetSocketAddress(host, if (port > 0) port else 9100), CONNECT_MS)
            s.getOutputStream().apply { write(data); flush() }
            if (replyMs <= 0) return@use ByteArray(0)
            s.soTimeout = replyMs
            val buf = ByteArray(4096)
            val out = ByteArrayOutputStream()
            try {
                // A status answer is three short lines: read until it goes quiet.
                while (true) {
                    val n = s.getInputStream().read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n)
                    s.soTimeout = 400
                }
            } catch (e: SocketTimeoutException) {
                // Quiet: whatever came is the answer.
            }
            out.toByteArray()
        }
    }
}

/**
 * Tags printed through Label LIVE (label.live), the label printer's app on the Mac at the counter
 * (docs/features/label-live.md). The tag's words and the link are core's (`LabelLive`, the web's label-live.ts case for case);
 * this is only how the link reaches Label LIVE: its MQTT broker on the counter Mac (port 1883, switched on in Label LIVE's
 * settings), which takes the link on `$LL/url` and reports on `$LL/status`. The counter Mac has to be on and on the same
 * network.
 */
object LabelLivePrinter {
    enum class Route { api, link, mqtt }

    class Outcome(val ok: Boolean, val route: Route, /** What Label LIVE said, or why it could not be reached, in the shop's words. */ val message: String)

    private const val MQTT_PORT = 1883
    private const val COUNTER = "erp.labelLive.counterHost"

    /** Where this device sends tags: the counter Mac's name or address for MQTT ("counter-mac.local"), per business. */
    var counterHost: String
        get() = Prefs.string(COUNTER) ?: ""
        set(value) = Prefs.putString(COUNTER, value.trim().ifEmpty { null })

    /** The tags of these pieces, at today's rates, as one Label LIVE job (a two-tag design fills both tags of a label). */
    fun link(pieces: List<Product>, settings: Settings, config: LabelLiveConfig, copies: Int? = null, today: Instant = Instant.now()): String =
        LabelLive.printURL(config, pieces.map { LabelLive.valuesFor(it, settings, today) }, copies)

    /** Sends the link by the best way this device has, and notes each piece in this device's print history. */
    suspend fun print(pieces: List<Product>, settings: Settings, config: LabelLiveConfig, copies: Int? = null): Outcome {
        val outcome = send(link(pieces, settings, config, copies))
        LabelPrintHistory.note(pieces.map { it.sku }, config.design, outcome.route, outcome.ok, outcome.message)
        return outcome
    }

    /** The link itself: a test print, or tags already worked out. */
    suspend fun send(url: String): Outcome {
        val host = counterHost
        if (host.isEmpty()) return Outcome(false, Route.mqtt, "Name the Mac at the counter in Settings → Labels first (Label LIVE runs there).")
        return mqtt(url, host)
    }

    /** One link to `$LL/url`, then up to four seconds of `$LL/status` for Label LIVE's answer. */
    suspend fun mqtt(link: String, host: String): Outcome = withContext(Dispatchers.IO) {
        try {
            val status = publish(host, "\$LL/url", link, "\$LL/status", 4000)
            val lower = status?.lowercase()
            if (lower != null && (lower.contains("error") || lower.contains("fail"))) Outcome(false, Route.mqtt, status)
            else Outcome(true, Route.mqtt, status ?: "Sent to Label LIVE on $host.")
        } catch (e: Exception) {
            Outcome(false, Route.mqtt, "Couldn't reach Label LIVE on $host: is the Mac on, Label LIVE open, and MQTT switched on in its settings? (${e.message ?: e.javaClass.simpleName})")
        }
    }

    /** The status Label LIVE published after the link, if any came within `waitMs`. Connecting is given six seconds. */
    private fun publish(host: String, topic: String, message: String, listen: String, waitMs: Int): String? {
        Socket().use { s ->
            s.connect(InetSocketAddress(host, MQTT_PORT), 6000)
            val out = s.getOutputStream()
            val input = s.getInputStream()
            val buffer = ByteArrayOutputStream()
            fun next(timeoutMs: Int): Mqtt.Packet? {
                val deadline = System.currentTimeMillis() + timeoutMs
                while (true) {
                    Mqtt.take(buffer)?.let { return it }
                    val left = (deadline - System.currentTimeMillis()).toInt()
                    if (left <= 0) return null
                    s.soTimeout = left
                    val chunk = ByteArray(64 * 1024)
                    val n = try { input.read(chunk) } catch (e: SocketTimeoutException) { return null }
                    if (n < 0) throw java.io.IOException("the connection closed")
                    buffer.write(chunk, 0, n)
                }
            }
            out.write(Mqtt.connect("erp-" + UUID.randomUUID().toString().take(8))); out.flush()
            val ack = next(5000) ?: throw java.io.IOException("no answer")
            if (ack.type != 2 || ack.body.size < 2) throw java.io.IOException("the connection closed")
            if (ack.body[1].toInt() != 0) throw java.io.IOException("the broker refused the connection (${ack.body[1].toInt() and 255})")
            out.write(Mqtt.subscribe(listen, 1))
            out.write(Mqtt.publish(topic, message.toByteArray(Charsets.UTF_8))); out.flush()
            val deadline = System.currentTimeMillis() + waitMs
            while (System.currentTimeMillis() < deadline) {
                val p = next((deadline - System.currentTimeMillis()).toInt().coerceAtLeast(1)) ?: break
                val text = Mqtt.publishedText(p)
                if (text != null) { runCatching { out.write(Mqtt.disconnect); out.flush() }; return text }
            }
            runCatching { out.write(Mqtt.disconnect); out.flush() }
            return null
        }
    }
}

/** The tags this device printed, newest first, per business (the web keeps its print history per browser too). */
object LabelPrintHistory {
    class Entry(val sku: String, val timestamp: String, val design: String, val route: String, val ok: Boolean, val message: String) {
        val id: String get() = sku + timestamp
    }

    private const val KEY = "erp.labelLive.history"

    fun all(): List<Entry> {
        val list = Json.parse(Prefs.string(KEY) ?: return emptyList()) as? List<*> ?: return emptyList()
        return list.mapNotNull { e ->
            val m = e as? Map<*, *> ?: return@mapNotNull null
            Entry(
                sku = m["sku"] as? String ?: return@mapNotNull null, timestamp = m["timestamp"] as? String ?: "", design = m["design"] as? String ?: "",
                route = m["route"] as? String ?: "mqtt", ok = m["ok"] as? Boolean ?: false, message = m["message"] as? String ?: "",
            )
        }
    }

    fun note(skus: List<String>, design: String, route: LabelLivePrinter.Route, ok: Boolean, message: String, now: Instant = Instant.now()) {
        val stamp = ERPDate.iso(now)
        val added = skus.map { Entry(it, stamp, design, route.name, ok, message) }
        // The last 50, as the web keeps.
        save((added + all()).take(50))
    }

    fun clear() = Prefs.remove(KEY)

    private fun save(list: List<Entry>) {
        val text = "[" + list.joinToString(",") {
            "{" + listOf("sku" to it.sku, "timestamp" to it.timestamp, "design" to it.design, "route" to it.route, "message" to it.message)
                .joinToString(",") { (k, v) -> "\"$k\":${LabelLive.jsonString(v)}" } + ",\"ok\":${it.ok}}"
        } + "]"
        Prefs.putString(KEY, text)
    }
}
