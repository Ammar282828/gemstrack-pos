package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import erp.app.ui.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House
import erp.app.data.Outbox
import erp.app.data.ErpApi
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.DividedColumn
import erp.app.ui.FailureAlert
import erp.app.ui.FieldRow
import erp.app.ui.FormSection
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.Decodable
import erp.core.Json
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// What the Website screens share (Add photos, Edit a piece, Photo weights, Investments): a form with files to the ERP's
// routes that take one, the house's website settings, and the set of the day (WebsiteKit.swift). Nothing here writes to
// the website itself: every change goes through the same ERP route the web page calls, which holds the site's secret
// (CONVENTIONS.md: the phone never talks to the site).

// MARK: Talking to the ERP

/** The ERP's routes as the Website screens call them: the answer read as the model, leniently. */
object WebsiteApi {
    suspend fun <T : Any> get(path: String, model: Decodable<T>): T = model.from(Json.parse(ErpApi.shared.data(path))) ?: model.fromMap(emptyMap())

    suspend fun <T : Any> post(path: String, body: Map<String, Any?>, model: Decodable<T>, timeoutMs: Long = 60_000): T =
        model.from(Json.parse(ErpApi.shared.data(path, "POST", body, timeoutMs))) ?: model.fromMap(emptyMap())

    /**
     * A multipart form to the ERP, as the web pages send theirs with FormData: Add photos' photograph, Edit a piece's words,
     * Investments' cards, the AI's retouch (`WebsiteForm.json`). The answer read as the route's model.
     */
    suspend fun <T : Any> form(
        path: String, fields: List<Pair<String, String>>, model: Decodable<T>, files: List<ErpApi.FormFile> = emptyList(), timeoutMs: Long = 120_000,
    ): T = model.from(Json.parse(ErpApi.shared.upload(path, fields, files, timeoutMs = timeoutMs))) ?: model.fromMap(emptyMap())

    /** A dictionary as the JSON text a form field carries (Edit a piece's `words`), keys sorted. */
    fun text(obj: Map<String, Any?>): String = MarketingValue.of(obj).text
}

// MARK: The house's website

data class WebsiteStoreState(
    val settings: WebsiteSettings? = null,
    /** False until the set of the day has been read; then `featured` is it, or null for none. */
    val featuredRead: Boolean = false,
    val featured: WebsiteFeatured? = null,
) {
    val siteName: String get() = settings?.siteName ?: "the website"
    val hasFeatured: Boolean get() = settings?.featured ?: false
}

/**
 * The house's website settings and its set of the day, read once for every Website screen, as the web keeps one state per
 * page for the set of the day (components/website/set-of-the-day.tsx).
 */
object WebsiteStore {
    private val _state = MutableStateFlow(WebsiteStoreState())
    val state: StateFlow<WebsiteStoreState> = _state.asStateFlow()

    /** The settings once; the set of the day again on every screen that opens (another device may have changed it). */
    suspend fun loadSettings() {
        if (House.isDemo) {
            if (_state.value.settings == null) _state.update { it.copy(settings = WebsiteDemo.settings(House.id), featuredRead = true, featured = WebsiteDemo.featured(House.id)) }
            return
        }
        if (_state.value.settings == null) {
            try {
                val s = WebsiteApi.get("/api/app/website", WebsiteSettings)
                _state.update { it.copy(settings = s) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The screens read the house's flags again on their next visit.
            }
        }
        if (_state.value.hasFeatured) loadFeatured()
    }

    suspend fun loadFeatured() {
        if (!_state.value.hasFeatured || House.isDemo) return
        try {
            val a = WebsiteApi.get("/api/website/featured", WebsiteFeaturedAnswer)
            _state.update { it.copy(featured = a.featured, featuredRead = true) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Left as it was: the card says it is still reading.
        }
    }

    /** Feature a piece (Category/Collection/file); [note] is the line under it on the home page. */
    suspend fun feature(key: String, note: String? = null) {
        if (House.isDemo) {
            val now = _state.value.featured
            val parts = key.split('/')
            _state.update { it.copy(featured = WebsiteFeatured(key, note ?: now?.note ?: "", parts.getOrElse(1) { "" }, parts.last(), ""), featuredRead = true) }
            return
        }
        val body = LinkedHashMap<String, Any?>().apply { put("key", key); if (note != null) put("note", note) }
        val text = ErpApi.shared.data("/api/website/featured", "PUT", body)
        _state.update { it.copy(featured = WebsiteFeaturedAnswer.from(Json.parse(text))?.featured, featuredRead = true) }
    }

    suspend fun clearFeatured() {
        if (House.isDemo) { _state.update { it.copy(featured = null, featuredRead = true) }; return }
        ErpApi.shared.send("/api/website/featured", "DELETE")
        _state.update { it.copy(featured = null, featuredRead = true) }
    }

    /** Instant: taken off here at once, the DELETE goes through the Outbox (put back here if it is refused). */
    fun clearFeaturedNow() {
        val prev = _state.value.featured
        Outbox.post("Take the set of the day off ${_state.value.siteName}") {
            _state.update { it.copy(featured = null, featuredRead = true) }
            try {
                clearFeatured()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(featured = prev) }
                throw e
            }
            ""
        }
    }

    /** Instant: the PUT goes through the Outbox; the home page's set of the day shows here when the site has it. */
    fun featureNow(key: String, note: String? = null) {
        Outbox.post("Feature on ${_state.value.siteName}") {
            feature(key, note)
            ""
        }
    }

    /** The same piece whatever its file ending (the site keeps a .webp of every upload): set-of-the-day.tsx `sameFeaturedKey`. */
    fun sameKey(a: String?, b: String?): Boolean {
        if (a.isNullOrEmpty() || b.isNullOrEmpty()) return false
        return stem(a) == stem(b)
    }

    private fun stem(key: String): String {
        val dot = key.lastIndexOf('.')
        return if (dot < 0 || key.substring(dot).contains('/')) key else key.substring(0, dot)
    }
}

// MARK: Asking first

/** One button of a confirmation (`confirmationDialog`'s buttons). */
class WebsiteChoice(val label: String, val destructive: Boolean = false, val run: () -> Unit)

/**
 * A question with the exact words of what will change, and the ways to say yes (the iPhone's confirmationDialog). The
 * public site changes on every yes here, so each says where before it is sent.
 */
@Composable
fun WebsiteConfirm(title: String, message: String, choices: List<WebsiteChoice>, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                for (c in choices) {
                    TextButton(onClick = { onDismiss(); c.run() }) {
                        Text(c.label, color = if (c.destructive) Tone.problem.color() else ErpColors.accent)
                    }
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** The busy veil every Website screen shows while the ERP works (PostQueueSheet's, `websiteBusy`). */
@Composable
fun WebsiteBusy(doing: String?) {
    if (doing == null) return
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
        Box(Modifier.clip(Radius.cardShape).background(ErpColors.card).padding(20.dp)) { SkeletonLoading(label = doing) }
    }
}

/** A time of day, "HH:MM" as the schedule keeps it (the iPhone's hour-and-minute DatePicker). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebsiteTimeDialog(title: String, initial: String, fallback: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val start = WebsiteGoldTime.minutes(initial, fallback)
    val time = rememberTimePickerState(initialHour = start / 60, initialMinute = start % 60, is24Hour = false)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TimePicker(state = time) } },
        confirmButton = { TextButton(onClick = { onPick(WebsiteGoldTime.hhmm(time.hour * 60 + time.minute)) }) { Text("Use this time") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// MARK: The set of the day

/**
 * Feature this piece today, or take it down if it already is (set-of-the-day.tsx `FeatureToggle`). The set of the day
 * leads the website's home page for everyone, so each change says so before it is made.
 */
@Composable
fun WebsiteFeatureButton(key: String, name: String, modifier: Modifier = Modifier) {
    val store by WebsiteStore.state.collectAsStateWithLifecycle()
    if (!store.hasFeatured) return
    var asking by remember { mutableStateOf(false) }
    val on = WebsiteStore.sameKey(store.featured?.key, key)
    val enabled = store.featuredRead
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { asking = true }, enabled = enabled) {
            Icon(if (on) Symbols.Star else Symbols.StarBorder, contentDescription = null, Modifier.size(18.dp))
            Text(if (on) "Set of the day: on the home page" else "Feature today", Modifier.padding(start = 6.dp))
        }
    }
    if (asking) {
        val instead = store.featured?.let { ", in place of ${it.file}" } ?: ""
        val words = if (on) "${store.siteName}'s home page stops leading with $name, for everyone who opens it. Nothing takes its place until another piece is featured."
        else "$name becomes the set of the day: the first piece on ${store.siteName}'s home page, for everyone who opens it$instead."
        WebsiteConfirm(
            title = if (on) "Take it off the home page?" else "Lead the home page with it?",
            message = words,
            choices = listOf(WebsiteChoice(if (on) "Take it off" else "Feature today", destructive = on) {
                if (on) WebsiteStore.clearFeaturedNow() else WebsiteStore.featureNow(key)
            }),
            onDismiss = { asking = false },
        )
    }
}

/**
 * What the home page leads with now, with the line under it and a way to take it down (set-of-the-day.tsx
 * `SetOfTheDayCard`). Nothing where the house's website has no set of the day.
 */
@Composable
fun WebsiteSetOfTheDay(withNote: Boolean = true) {
    val store by WebsiteStore.state.collectAsStateWithLifecycle()
    if (!store.hasFeatured) return
    var note by remember { mutableStateOf("") }
    var asking by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(store.featured?.note) { note = store.featured?.note ?: "" }
    val f = store.featured

    FormSection("Set of the day · on the home page") {
        when {
            !store.featuredRead -> MarketingReading("Reading the set of the day…")
            f != null -> {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    StockImage(f.thumb, f.file, f.key, Modifier.size(52.dp).clip(Radius.thumbShape))
                    Box(Modifier.weight(1f)) { TwoLine(f.file, subtitle = f.collection) }
                }
                if (withNote) {
                    FieldRow("A line about it (optional)", note, { note = it.take(160) }, imeAction = androidx.compose.ui.text.input.ImeAction.Done)
                    if (note != f.note) ActionRow("Put this line on the home page", { asking = "note" })
                }
                ActionRow("Take it off the home page", { asking = "remove" }, Symbols.StarBorder, tone = Tone.problem)
            }
            else -> Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Symbols.StarBorder, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Nothing is the set of the day. Feature a photo to lead the home page with it.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    when (asking) {
        "remove" -> WebsiteConfirm(
            "Take it off the home page?", "${store.siteName}'s home page stops leading with ${f?.file ?: "it"}, for everyone who opens it.",
            listOf(WebsiteChoice("Take it off", destructive = true) { WebsiteStore.clearFeaturedNow() }), { asking = null },
        )
        "note" -> WebsiteConfirm(
            "Change the line on the home page?",
            if (note.trim().isEmpty()) "The line under the set of the day on ${store.siteName}'s home page is taken away."
            else "Under the set of the day on ${store.siteName}'s home page, for everyone: “${note.trim()}”",
            listOf(WebsiteChoice("Put it on the home page") { f?.let { WebsiteStore.featureNow(it.key, note.take(160)) } }), { asking = null },
        )
    }
}

/**
 * A card of rows with no heading (a `Section` with only a footer): the rows divided by hairlines, the footer small print
 * under it, exactly as a [FormSection] without its title.
 */
@Composable
fun WebsiteCard(modifier: Modifier = Modifier, footer: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SegmentedColumn { DividedColumn(content = content) }
        if (footer != null) {
            androidx.compose.material3.ProvideTextStyle(MaterialTheme.typography.bodySmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)) {
                Column(Modifier.padding(horizontal = 16.dp)) { footer() }
            }
        }
    }
}
