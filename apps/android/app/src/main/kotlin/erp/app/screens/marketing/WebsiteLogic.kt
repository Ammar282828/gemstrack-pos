package erp.app.screens.marketing

import androidx.compose.ui.graphics.ImageBitmap
import erp.app.ui.AppClock
import erp.app.ui.ShopDate
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.roundToInt

// The Website screens' pure rules: numbers, words, filters and what is said before anything goes to the public site
// (WebsiteKit/WebsiteEdit/WebsiteWeights/WebsiteInvestments*.swift). Kept apart from the views so they are tested.

/** "12.5", "3" (a weight as the counter typed it: no trailing zeros). */
object WebsiteNumber {
    fun grams(v: Double): String {
        var s = String.format(Locale.ROOT, "%.3f", v)
        while (s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return s
    }

    /** What the counter typed, as grams the site takes (more than 0, under 5,000), or null. */
    fun parse(text: String): Double? {
        val t = text.trim().replace(",", ".")
        if (t.isEmpty()) return null
        val v = t.toDoubleOrNull() ?: return null
        return if (v > 0 && v < 5000 && v.isFinite()) v else null
    }

    /** A key or a name, escaped whole for a query (a site key is a path: "Rings/DSC0912.webp"). */
    fun query(s: String): String = MarketingKit.escape(s)

    /** "4.2 MB", "820 KB" (the web's prettyBytes). */
    fun size(n: Int): String =
        if (n > 1_048_576) String.format(Locale.ROOT, "%.1f MB", n / 1_048_576.0) else "${(n / 1024.0).roundToInt()} KB"
}

/** Times of the gold post, in the shop's clock (WebsiteGoldTime). */
object WebsiteGoldTime {
    private val long = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.UK)

    /** "2026-10-07" → "Wednesday 7 October". */
    fun longDate(day: String): String = try {
        long.format(LocalDate.parse(day))
    } catch (e: DateTimeParseException) {
        day
    }

    /** "13:05" → "1:05 pm" (investments-schedule.ts `clock`). */
    fun clock(hhmm: String): String {
        val parts = hhmm.split(':')
        val h = parts.getOrNull(0)?.toIntOrNull()
        val m = parts.getOrNull(1)?.toIntOrNull()
        if (parts.size != 2 || h == null || m == null || h !in 0..23 || m !in 0..59) return hhmm
        return "${if (h % 12 == 0) 12 else h % 12}:${String.format(Locale.ROOT, "%02d", m)} ${if (h < 12) "am" else "pm"}"
    }

    /** "HH:MM" to minutes since midnight (a time picker's start). */
    fun minutes(hhmm: String, fallback: String): Int {
        fun read(s: String): Int? {
            val p = s.split(':')
            val h = p.getOrNull(0)?.toIntOrNull() ?: return null
            val m = p.getOrNull(1)?.toIntOrNull() ?: return null
            return if (p.size == 2 && h in 0..23 && m in 0..59) h * 60 + m else null
        }
        return read(hhmm) ?: read(fallback) ?: (11 * 60 + 30)
    }

    fun hhmm(minutes: Int): String = String.format(Locale.ROOT, "%02d:%02d", minutes / 60, minutes % 60)

    fun minutesSince(iso: String?, now: Instant = AppClock.now()): Int? {
        val d = ERPDate.parse(iso) ?: return null
        return ((now.epochSecond - d.epochSecond) / 60.0).roundToInt()
    }

    /** "just now", "12 min ago", "3 h ago" (page.tsx `ago`). */
    fun ago(iso: String?, now: Instant = AppClock.now()): String {
        val m = minutesSince(iso, now) ?: return ""
        if (m < 1) return "just now"
        if (m < 60) return "$m min ago"
        return "${(m / 60.0).roundToInt()} h ago"
    }

    /** The day a date falls on in Karachi, "yyyy-MM-dd" (a filed day's key). */
    fun day(at: Instant): String = ERPDate.karachiDay(at)
}

/** The schedule in words (WebsiteGoldWords, page.tsx). */
object WebsiteGoldWords {
    val dayNames = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

    /** "Mon–Sat", "Every day", "Mon, Wed, Fri" (investments-schedule.ts `daysLabel`). */
    fun days(days: List<Int>): String {
        val d = days.filter { it in 0..6 }.toSortedSet().toList()
        if (d.size == 7) return "Every day"
        if (d.isEmpty()) return "No days"
        if (d == listOf(1, 2, 3, 4, 5, 6)) return "Mon–Sat"
        if (d == listOf(1, 2, 3, 4, 5)) return "Mon–Fri"
        return d.joinToString(", ") { dayNames[it] }
    }

    /** "at 11:30 am", "as soon as it arrives". */
    fun `when`(at: String): String = if (at == "arrival") "As soon as it arrives" else clock(at)

    fun clock(at: String): String = WebsiteGoldTime.clock(at)

    /** "Post + square card → the Investments by Taheri group", in the server's words. */
    fun place(t: String, targets: List<WebsiteGoldStatus.Target>): String {
        val x = targets.firstOrNull { it.id == t } ?: return t
        return "${x.label} → ${x.to}"
    }

    /** "two", "three", "four". */
    fun count(n: Int): String = when (n) { 2 -> "two"; 3 -> "three"; 4 -> "four"; else -> "$n" }

    /** The schedule in a line (page.tsx `summary`). */
    fun summary(s: WebsiteGoldSchedule, targets: List<WebsiteGoldStatus.Target>): String {
        val short = mapOf("teaser" to "teaser", "instagram" to "Instagram", "channel" to "channel", "group" to "group")
        val parts = targets.filter { s.plan(it.id).on }.map { t ->
            val at = s.plan(t.id).at
            "${short[t.id] ?: t.id} ${if (at == "arrival") "on arrival" else clock(at)}"
        }
        return "${days(s.days)} · ${if (parts.isEmpty()) "nothing chosen" else parts.joinToString(" · ")}${if (s.mode == "approve") " · after your OK" else ""}"
    }

    /** What switching it on (or saving it on) sends, and where (page.tsx's "Send … automatically?"). */
    fun switchOn(s: WebsiteGoldSchedule, targets: List<WebsiteGoldStatus.Target>): String {
        val label = days(s.days)
        val lines = targets.filter { s.plan(it.id).on }.joinToString("\n") { t -> "• ${`when`(s.plan(t.id).at)}: ${t.label.lowercase()} to ${t.to}" }
        return "From now on, ${if (label == "Every day") "every day" else "on $label"}, once the routine has filed the day's post${if (s.mode == "approve") " and you've approved it" else ""}:\n$lines\n\nOnly that day's post, each part once. A late post still goes until ${clock(s.lateUntil)}. Hold any day from its card."
    }

    /** "Checked 3 min ago · set by owner@…" (the schedule card's footer). */
    fun checked(s: WebsiteGoldSchedule, now: Instant = AppClock.now()): String {
        val parts = ArrayList<String>()
        parts.add(if (s.lastTick == null) "Not checked yet" else "Checked " + WebsiteGoldTime.ago(s.lastTick, now))
        s.updatedBy?.let { parts.add("set by " + if (it == "counter") "the counter" else it) }
        return parts.joinToString(" · ")
    }

    /** The scheduler is silent: on, and not heard from in 15 minutes (or ever). */
    fun silent(s: WebsiteGoldSchedule, now: Instant = AppClock.now()): Boolean =
        s.enabled && (WebsiteGoldTime.minutesSince(s.lastTick, now)?.let { it > 15 } ?: true)

    /** A part with nothing to send (page.tsx `missing`): no teaser, no story card, no post. */
    fun missing(t: String, d: WebsiteGoldPost, post: String, teaser: String): Boolean = when (t) {
        "teaser" -> teaser.trim().isEmpty()
        "instagram" -> "story" !in d.cards
        else -> post.trim().isEmpty()
    }
}

/** What a day's sheet asks the counter before it does it (WebsiteGoldDaySheet.Ask). */
sealed interface WebsiteGoldAsk {
    data class Send(val list: List<String>, val force: Boolean) : WebsiteGoldAsk
    data object Approve : WebsiteGoldAsk
    data object LetGo : WebsiteGoldAsk
    data class Retry(val target: String) : WebsiteGoldAsk

    companion object {
        fun title(a: WebsiteGoldAsk): String = when (a) {
            is Send -> if (a.force) "Send it again?" else if (a.list.size > 1) "Send all ${a.list.size} now?" else "Send it now?"
            Approve -> "Approve today's post?"
            LetGo -> "Let today's post send?"
            is Retry -> "Try it again?"
        }

        fun button(a: WebsiteGoldAsk): String = when (a) {
            is Send -> if (a.force) "Send again" else if (a.list.size > 1) "Send all" else "Send"
            Approve -> "Approve"
            LetGo -> "Let it send"
            is Retry -> "Try again"
        }

        /** Exactly where it goes. */
        fun words(a: WebsiteGoldAsk, day: WebsiteGoldPost?, schedule: WebsiteGoldSchedule?, targets: List<WebsiteGoldStatus.Target>): String {
            val date = WebsiteGoldTime.longDate(day?.date ?: "")
            return when (a) {
                is Send -> {
                    if (a.list.size > 1) {
                        val lines = a.list.joinToString("\n") { "• " + WebsiteGoldWords.place(it, targets) }
                        "$date, one after another:\n$lines\n\nNone of it can be unsent from here."
                    } else {
                        val t = a.list.firstOrNull() ?: ""
                        val target = targets.firstOrNull { it.id == t }
                        "${target?.label ?: t} for $date goes to ${target?.to ?: t}${if (a.force) " a second time: everyone will see it twice" else ""}. It can't be unsent from here."
                    }
                }
                Approve, LetGo -> {
                    if (schedule == null || day == null) return ""
                    val waits = a == LetGo && schedule.mode == "approve" && day.approvedAt == null
                    val lines = targets.filter { schedule.plan(it.id).on && day.sent[it.id] == null }
                        .joinToString("\n") { "• " + WebsiteGoldWords.`when`(schedule.plan(it.id).at) + ": " + WebsiteGoldWords.place(it.id, targets) }
                    val what = if (lines.isEmpty()) "Nothing of it is set to go by itself." else "It goes by itself at its times, saved words only:\n$lines"
                    what + if (waits) "\n\nIt still waits for your OK." else ""
                }
                is Retry -> "The next check (within 5 minutes) tries ${WebsiteGoldWords.place(a.target, targets)} again."
            }
        }
    }
}

/** Edit a piece's grid and form rules (WebsiteEdit.swift, WebsiteEditPiece.swift). */
object WebsiteEditLogic {
    enum class Filter { All, Changed, Hidden }

    const val PAGE_SIZE = 60

    /** One piece's own screen. Its id is a path on the site ("Rings/DSC0912.webp"), escaped whole. */
    fun piecePath(id: String): String = "/website/edit?id=${WebsiteNumber.query(id)}"

    /** Open in Design takes the photograph to the designer, as the web's button does. */
    fun designPath(id: String): String = "/design?v=make&site=" + WebsiteNumber.query(id)

    fun collections(pieces: List<WebsiteEditPiece>): List<String> = pieces.map { it.collection }.filter { it.isNotEmpty() }.toSet().sorted()

    fun filtered(pieces: List<WebsiteEditPiece>, search: String, filter: Filter, collection: String): List<WebsiteEditPiece> {
        val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
        return pieces.filter { p ->
            if (collection.isNotEmpty() && p.collection != collection) return@filter false
            when (filter) {
                Filter.All -> Unit
                Filter.Changed -> if (!p.changed) return@filter false
                Filter.Hidden -> if (!p.hidden) return@filter false
            }
            if (words.isEmpty()) return@filter true
            val text = "${p.words.name} ${p.collection} ${p.facts.joinToString(" ")} ${p.id}".lowercase()
            words.all { text.contains(it) }
        }
    }

    /** "Rings · 4.2g". */
    fun detail(p: WebsiteEditPiece): String {
        val parts = ArrayList<String>()
        if (p.collection.isNotEmpty()) parts.add(p.collection)
        p.weightGrams?.let { parts.add(WebsiteNumber.grams(it) + "g") }
        return parts.joinToString(" · ")
    }

    /** "name, hidden · owner@… · Today 4:05 pm". */
    fun recentWords(r: WebsiteEditRecent, now: Instant = AppClock.now()): String =
        listOf(r.what.joinToString(", "), r.by, ShopDate.say(r.at, withTime = true, now = now)).filter { it.isNotEmpty() }.joinToString(" · ")

    /** "Rings · hidden from the website · changed Today 4:05 pm". */
    fun headerWords(p: WebsiteEditPiece, now: Instant = AppClock.now()): String {
        val parts = ArrayList<String>()
        if (p.collection.isNotEmpty()) parts.add(p.collection)
        if (p.hidden) parts.add("hidden from the website")
        val at = p.change?.at
        if (p.changed && at != null) parts.add("changed " + ShopDate.say(at, withTime = true, now = now))
        return parts.joinToString(" · ")
    }

    /** What the editor would warn about this photograph (edit/page.tsx, beside the layouts). */
    fun photoNote(p: WebsiteEditPiece, lastAI: List<String>, house: String): String {
        val notes = ArrayList<String>()
        if (lastAI.isNotEmpty()) notes.add("Last time: ${lastAI.joinToString(", ")}. Editing starts from the original photo: run the AI again if you want it on this one.")
        if (house == "mina" && p.photoSource != null) {
            notes.add(
                if (p.sourceMarked) "This photo carries the house's mark already: add nothing more, or clear it first in the editor (AI → Enhance and clear old labels)."
                else "The editor starts from the photo before the catalogue framed it and put the MINA mark on; the mark goes back top right.",
            )
        } else if (p.weightOnPhoto && !(p.change?.weightOnPhoto ?: false)) {
            notes.add("This photo already shows its weight and logo: a stamp would show them twice, unless the old labels are cleared first.")
        }
        return notes.joinToString(" ")
    }

    /** The form's fields (what the counter has typed, held as text, as the page's state holds them). */
    data class Form(
        val name: String = "",
        val about: String = "",
        val factsText: String = "",
        val tags: WebsiteWords = WebsiteWords(),
        val weight: String = "",
        val hidden: Boolean = false,
    ) {
        val factsLines: List<String> get() = factsText.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val weightValue: Double? get() = WebsiteNumber.parse(weight)
    }

    /** caption.ts weightLabel: the weight as typed, "12.4g", or nothing for no weight. */
    fun weightLabel(weight: String): String {
        var w = weight.trim().replace(",", ".")
        if (w.lowercase().endsWith("g")) w = w.dropLast(1).trim()
        val v = w.toDoubleOrNull() ?: return ""
        return if (v.isFinite() && v > 0) w + "g" else ""
    }

    /**
     * What the photo's bound words read (edit/page.tsx `fields`): the collection, the name, the weight, and the karat, metal
     * and stone (taheri.shop) or the catalogue's facts.
     */
    fun photoFields(p: WebsiteEditPiece, f: Form): Map<String, String> {
        val details = if (p.hasTags) {
            val metal = listOf(f.tags.karat, f.tags.metal).filter { it.isNotEmpty() }.joinToString(" ")
            listOf(metal, f.tags.stone).filter { it.isNotEmpty() && it.lowercase() != "none" }.joinToString(" | ")
        } else {
            p.facts.joinToString(" | ")
        }
        return mapOf("kicker" to p.collection, "headline" to f.name, "weight" to weightLabel(f.weight), "details" to details)
    }

    /** A photo re-made here that goes with the save: whether the weight is stamped on it, and what the AI did. */
    class PhotoChange(val stamped: Boolean, val weightLabel: String, val ai: List<String>)

    /** The form a piece fills (take). */
    fun formOf(p: WebsiteEditPiece): Form = Form(
        name = p.words.name, about = p.words.about, factsText = p.words.facts.joinToString("\n"), tags = p.words,
        weight = p.weightGrams?.let { WebsiteNumber.grams(it) } ?: "", hidden = p.hidden,
    )

    fun tagChanged(p: WebsiteEditPiece, f: Form): List<Pair<String, String>> {
        if (!p.hasTags) return emptyList()
        return WebsiteWords.tags.filter { f.tags.tag(it.key) != p.words.tag(it.key) }.map { it.label to f.tags.tag(it.key) }
    }

    private fun factsDiffer(p: WebsiteEditPiece, f: Form) = f.factsLines.joinToString("\n") != p.words.facts.joinToString("\n").trim()

    fun dirty(p: WebsiteEditPiece, f: Form): Boolean =
        f.name != p.words.name || f.about != p.words.about ||
            (if (p.hasTags) tagChanged(p, f).isNotEmpty() else factsDiffer(p, f)) ||
            f.hidden != p.hidden || f.weightValue != p.weightGrams

    /** The whole of what the piece should say (the route sends back "put back" for anything equal to the site's own). */
    fun wordsNow(p: WebsiteEditPiece, f: Form): Map<String, Any?> {
        val w = LinkedHashMap<String, Any?>()
        w["name"] = f.name
        w["about"] = f.about
        w["hidden"] = f.hidden
        if (p.hasTags) for (t in WebsiteWords.tags) w[t.key] = f.tags.tag(t.key) else w["facts"] = f.factsLines
        w["weightGrams"] = f.weightValue
        return w
    }

    enum class Confirm { Save, Photo, All }

    fun confirmTitle(c: Confirm, siteName: String): String = when (c) {
        Confirm.Photo -> "Put the original photo back?"
        Confirm.All -> "Undo every change to this piece?"
        Confirm.Save -> "Change it on $siteName?"
    }

    /** Exactly what changes on the public site. */
    fun confirmWords(c: Confirm, p: WebsiteEditPiece, f: Form, siteName: String, photo: PhotoChange? = null): String {
        val after = "\n\nPages opened from about a minute later show it, for everyone."
        return when (c) {
            Confirm.Photo -> "$siteName shows the photo as it was built. The design made here is forgotten; the words stay as they are.$after"
            Confirm.All -> "The photo, the name, the words and hiding all go back to what $siteName was built with." +
                (if (p.hasTags) " A weight typed here stays (it's the piece's weight)." else "") + after
            Confirm.Save -> {
                val lines = ArrayList<String>()
                if (photo != null) {
                    val w = if (photo.stamped) ", with ${photo.weightLabel} on it" else ""
                    val ai = if (photo.ai.isEmpty()) "" else " (${photo.ai.joinToString(", ").lowercase()})"
                    lines.add("The photo is replaced$w$ai. The original is kept.")
                }
                if (f.name != p.words.name) lines.add("Name: “${f.name.trim()}”")
                if (f.about != p.words.about) lines.add("A new description")
                for ((label, value) in tagChanged(p, f)) lines.add("$label: ${value.ifEmpty { "(none)" }}")
                if (!p.hasTags && factsDiffer(p, f)) lines.add("New details")
                if (f.weightValue != p.weightGrams) lines.add("Weight: " + (f.weightValue?.let { "${WebsiteNumber.grams(it)}g" } ?: "none"))
                if (f.hidden != p.hidden) lines.add(if (f.hidden) "Hidden from the website" else "Shown on the website again")
                "On $siteName:\n" + lines.joinToString("\n") { "• $it" } + after
            }
        }
    }
}

/** Photo weights' queue and words (WebsiteWeights.swift). */
object WebsiteWeightsLogic {
    class Pending(val key: String, val file: String, val grams: Double?, val label: Double?, val advance: Boolean)

    fun collections(pieces: List<WebsiteWeightPiece>): List<String> = pieces.map { it.collection }.filter { it.isNotEmpty() }.toSet().sorted()

    fun queue(pieces: List<WebsiteWeightPiece>, collection: String, onlyMissing: Boolean, search: String): List<WebsiteWeightPiece> {
        var q = pieces
        if (collection.isNotEmpty()) q = q.filter { it.collection == collection }
        if (onlyMissing) q = q.filter { it.weightGrams == null }
        val s = search.trim().lowercase()
        if (s.isNotEmpty()) q = q.filter { it.key.lowercase().contains(s) }
        return q
    }

    /** (how many in the collection, how many with a weight). */
    fun counts(pieces: List<WebsiteWeightPiece>, collection: String): Pair<Int, Int> {
        val scoped = if (collection.isEmpty()) pieces else pieces.filter { it.collection == collection }
        return scoped.size to scoped.count { it.weightGrams != null }
    }

    /** The next twelve after the current one. */
    fun upcoming(queue: List<WebsiteWeightPiece>, index: Int): List<Pair<Int, WebsiteWeightPiece>> {
        if (index + 1 >= queue.size) return emptyList()
        return (index + 1 until minOf(queue.size, index + 13)).map { it to queue[it] }
    }

    /** What the site would draw: what is typed, else the weight already recorded. */
    fun preview(p: WebsiteWeightPiece, value: String): String? {
        val typed = value.filter { it.isDigit() || it == '.' || it == ',' }.replace(",", ".")
        if (typed.isNotEmpty()) return typed
        return p.weightGrams?.let { WebsiteNumber.grams(it) }
    }

    /** The field starts with the weight typed here before (never the photo's own label). */
    fun prefill(p: WebsiteWeightPiece?): String = if (p?.source == "pos") (p.weightGrams?.let { WebsiteNumber.grams(it) } ?: "") else ""

    /** Exactly what changes on the site, for every visitor. */
    fun words(p: Pending, siteName: String): String {
        if (p.grams != null) {
            return "${WebsiteNumber.grams(p.grams)} g for ${p.file}. $siteName draws it on the photograph's corner (unless the photo carries its own) and prices the piece from it at the day's rate, for everyone who opens it."
        }
        val own = p.label?.let { " The photo's own ${WebsiteNumber.grams(it)}g stays." } ?: ""
        return "The weight typed for ${p.file} comes off $siteName: the site stops drawing it and pricing from it.$own"
    }

    /** The list as a save leaves it (the piece takes the weight, or goes back to the photo's label). */
    fun saved(pieces: List<WebsiteWeightPiece>, key: String, grams: Double?, now: Instant): List<WebsiteWeightPiece> =
        pieces.map { x ->
            if (x.key != key) x
            else x.copy(
                weightGrams = grams ?: x.labelWeightGrams,
                source = if (grams != null) "pos" else if (x.labelWeightGrams != null) "label" else null,
                enteredBy = if (grams != null) "you" else null,
                enteredAt = if (grams != null) ERPDate.iso(now) else null,
            )
        }
}

/** One photograph in the tray, from Photos or the camera. */
data class WebsitePhotoItem(
    val id: String,
    val data: ByteArray,
    val kind: MarketingPhotos.Kind,
    val thumb: ImageBitmap?,
    /** The name it goes up under, without its ending (the ending says what the bytes are). */
    val stem: String,
    val house: String = "",
    val model: String = "",
    val status: Status = Status.Queued,
    val error: String? = null,
    /** Its key on the site once there ("Category/Collection/file"), for the set of the day. */
    val rel: String? = null,
    val retouching: Boolean = false,
    val original: Original? = null,
    val check: WebsiteRetouched? = null,
) {
    enum class Status { Queued, Uploading, Done, Failed }

    /** The photograph as it came, kept while a retouched one stands in for it. */
    class Original(val data: ByteArray, val kind: MarketingPhotos.Kind, val thumb: ImageBitmap?)

    val modelName: String get() = model.trim()
    val editable: Boolean get() = status == Status.Queued || status == Status.Failed
}

/** Add photos' tray rules (WebsitePhotos.swift). */
object WebsitePhotosLogic {
    /** The photos route's own limit (25 MB). */
    const val MAX_BYTES = 25 * 1024 * 1024
    const val MAX_PICK = 24

    class Shelf(val id: String, val list: List<WebsiteCollection>)

    /** The site's collections by category, narrowed by what was typed. */
    fun shelves(collections: List<WebsiteCollection>, search: String): List<Shelf> {
        val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
        val shown = collections.filter { c -> words.all { "${c.category} ${c.collection}".lowercase().contains(it) } }
        val order = ArrayList<String>()
        val by = LinkedHashMap<String, MutableList<WebsiteCollection>>()
        for (c in shown) {
            if (c.category !in by) order.add(c.category)
            by.getOrPut(c.category) { ArrayList() }.add(c)
        }
        return order.map { Shelf(it, by.getValue(it)) }
    }

    fun pending(items: List<WebsitePhotoItem>) = items.filter { it.editable }
    fun done(items: List<WebsitePhotoItem>) = items.filter { it.status == WebsitePhotoItem.Status.Done }

    /** How many in a Maisons tray still need a house and a model's name. */
    fun unnamed(items: List<WebsitePhotoItem>, maison: Boolean): Int =
        if (!maison) 0 else pending(items).count { it.house.isEmpty() || it.modelName.isEmpty() }

    fun canSend(
        folder: String, configured: Boolean, items: List<WebsitePhotoItem>, maison: WebsiteMaisonAnswer?, maisonUnknown: Boolean,
        sending: Boolean, reading: Boolean,
    ): Boolean {
        val unnamed = unnamed(items, maison?.maison ?: false)
        return folder.isNotEmpty() && configured && pending(items).isNotEmpty() && unnamed == 0 &&
            items.none { it.retouching } && !sending && !reading && !maisonUnknown && maison != null
    }

    fun displayName(i: WebsitePhotoItem, maison: Boolean): String =
        if (maison && i.house.isNotEmpty() && i.modelName.isNotEmpty()) "${i.house} — ${i.modelName}" else i.stem + "." + i.kind.ext

    /** "IMG-20261012-130000-3ab1": when it was added, and a count, so a tray never sends two under one name. */
    fun nextStem(count: Int, now: Instant = AppClock.now(), tag: String = java.util.UUID.randomUUID().toString().take(4).lowercase()): String {
        val f = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT).withZone(ERPDate.karachi)
        return "IMG-${f.format(now)}-${count + 1}$tag"
    }

    /** Where the photographs go, said before anything is sent: they are public the moment they arrive. */
    fun sendWords(pending: List<WebsitePhotoItem>, shelf: String, siteName: String): String {
        val n = pending.size
        val retouched = pending.count { it.original != null }
        val ai = if (retouched > 0) "\n\n$retouched of them retouched by the AI: check ${if (retouched == 1) "it" else "them"} against the originals." else ""
        return "$n photograph${if (n == 1) "" else "s"} go${if (n == 1) "es" else ""} to $siteName, into $shelf, and ${if (n == 1) "is" else "are"} public at once: anyone who opens the site sees ${if (n == 1) "it" else "them"}.$ai"
    }

    fun shelfName(c: WebsiteCollection?, folder: String): String = c?.let { "${it.category} → ${it.collection}" } ?: folder

    /** The collection's page on the site (the web's own guess when the site doesn't say). */
    fun collectionUrl(c: WebsiteCollection?, site: String?): String? {
        if (c == null || site.isNullOrEmpty()) return null
        val slug = c.collection.lowercase().replace(Regex("[^a-z0-9]+"), "-")
        return site + (c.path ?: "/$slug")
    }

    /** What the retouch said, for the line under the tray. */
    fun retouchSaid(r: WebsiteRetouched): String = when {
        !r.checked -> "Retouched, not checked: compare it with the original before sending."
        r.passes -> "Retouched: " + if (r.steps.isEmpty()) "the same piece." else r.steps.joinToString(" → ")
        else -> "Retouched. Check it closely: " + (r.differences.firstOrNull() ?: "it may not be the same piece.")
    }

    /** What was left out of a pick, in one sentence. */
    fun skippedWords(skipped: Int, tooBig: Int): String? {
        if (skipped + tooBig == 0) return null
        val why = ArrayList<String>()
        if (skipped > 0) why.add("$skipped couldn't be read: only JPEG, PNG, WebP and HEIC photographs can go on the website")
        if (tooBig > 0) why.add("$tooBig ${if (tooBig == 1) "is" else "are"} over 25 MB")
        return "Skipped ${skipped + tooBig}. " + why.joinToString("; ") + "."
    }

    /** The line under a sent tray. */
    fun sentWords(sent: Int, siteName: String, collection: String): String =
        "$sent photograph${if (sent == 1) "" else "s"} sent: on $siteName in $collection now."
}
