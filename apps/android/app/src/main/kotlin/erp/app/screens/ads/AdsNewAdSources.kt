package erp.app.screens.ads

import erp.app.ui.icons.Symbols
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.screens.stock.StockImage
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import java.io.FileInputStream
import kotlinx.coroutines.launch

// New ad's other sources and its folded-away bidding (AdsNewAdSources.swift); their data and the upload's logic are in
// AdsNewAdSourcesModel.kt.

/** A video the person chose, read in the pieces Meta asks for straight from where the phone keeps it. */
class AdsUriVideo(private val context: Context, private val uri: Uri) : AdsVideoSource {
    override val size: Long = run {
        val named = context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
        }
        named ?: context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length.takeIf { n -> n > 0 } } ?: 0L
    }

    override fun read(start: Long, length: Int): ByteArray {
        val pfd = context.contentResolver.openFileDescriptor(uri, "r") ?: throw java.io.IOException("Couldn't read that video.")
        pfd.use {
            FileInputStream(it.fileDescriptor).use { stream ->
                val channel = stream.channel
                channel.position(start)
                val out = java.nio.ByteBuffer.allocate(length)
                while (out.hasRemaining() && channel.read(out) >= 0) { /* until the piece or the file ends */ }
                return out.array().copyOf(out.position())
            }
        }
    }
}

// MARK: A new video

@Composable
fun AdsVideoSection(video: AdsVideoDraft?, onPick: () -> Unit) {
    AdsSection(
        "The video",
        footer = { Text("An MP4 or MOV from this phone; vertical 9:16 suits stories and reels, 4:5 the feed. Keep the app open while it sends. Meta is told not to crop, filter or re-word it.") },
    ) {
        if (video != null) {
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                StockImage(video.thumb, video.name, video.videoId.ifEmpty { video.name }, Modifier.size(56.dp).clip(Radius.thumbShape))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(video.name, maxLines = 2)
                    val small = MaterialTheme.typography.bodySmall
                    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
                    when (video.phase) {
                        AdsVideoDraft.Phase.sending -> {
                            LinearProgressIndicator(progress = { video.sent.toFloat() }, Modifier.fillMaxWidth())
                            Text("Sending to Meta… ${(video.sent * 100).toInt()}%", style = small, color = quiet)
                        }
                        AdsVideoDraft.Phase.processing -> Text("Meta is processing it (a minute or two)…", style = small, color = quiet)
                        AdsVideoDraft.Phase.ready -> Text("Ready, with Meta's cover frame", style = small, color = quiet)
                        AdsVideoDraft.Phase.failed -> Text(video.error ?: "It didn't reach Meta.", style = small, color = Tone.problem.color())
                    }
                }
            }
        }
        AdsActionRow(if (video == null) "Choose a video" else "A different video", onPick, icon = Symbols.VideoLibrary, enabled = video?.busy != true)
    }
}

// MARK: A creator's post

@Composable
fun AdsPartnerSection(
    code: String,
    onCode: (String) -> Unit,
    checked: AdsPartnerCheck?,
    onChecked: (AdsPartnerCheck) -> Unit,
    link: String,
    onLink: (String) -> Unit,
    button: String,
    onButton: (String) -> Unit,
    toSite: Boolean,
    buttons: List<AdsChoice>,
) {
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    val trimmed = code.trim()
    AdsSection(
        "The creator's post",
        footer = { Text("The post runs as it is, under both names (Instagram's partnership ads). The creator makes the code on the post: ⋯ → Partnership label and ads → Get ad code, and sends it to you.") },
        divided = false,
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    code, onCode, Modifier.weight(1f), placeholder = { Text("Paste the ad code") }, singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                )
                TextButton(
                    onClick = {
                        scope.launch {
                            checking = true
                            onChecked(AdsPartnerCheck.check(backend, trimmed))
                            checking = false
                        }
                    },
                    enabled = trimmed.isNotEmpty() && !checking,
                ) {
                    if (checking) SkeletonLoading(compact = true, label = "Checking") else Text("Check")
                }
            }
            val c = checked
            if (c != null && c.code == trimmed) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (c.thumb != null) StockImage(c.thumb, c.creator ?: "Post", c.mediaId ?: c.code, Modifier.size(48.dp).clip(Radius.thumbShape))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        if (c.ok) Text(c.creator?.let { "Ready: @$it's post" } ?: "Ready", style = MaterialTheme.typography.bodyMedium)
                        else Text(c.why ?: "Meta couldn't check the code. It can still be tried.", style = MaterialTheme.typography.bodyMedium, color = Tone.owed.color())
                        val permalink = c.permalink
                        if (!permalink.isNullOrEmpty()) {
                            val context = androidx.compose.ui.platform.LocalContext.current
                            TextButton(onClick = { erp.app.device.openAddress(context, android.content.Intent.ACTION_VIEW, permalink) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                                Text("See the post", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            if (toSite) {
                OutlinedTextField(
                    link, onLink, Modifier.fillMaxWidth(), placeholder = { Text("https://… the page the button opens") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                )
            }
        }
        if (toSite) PickerRow("Button", button, buttons.map { it.key to it.label }, onButton)
    }
}

// MARK: The catalogue

@Composable
fun AdsCatalogSection(choice: AdsCatalogChoice, onChoice: (AdsCatalogChoice) -> Unit) {
    AdsSection(
        "The catalogue",
        footer = {
            Text(
                if (choice.who == "viewers") "People who looked at or carted a piece in the last 14 days and didn't buy see those pieces again."
                else "Meta finds new people for the pieces; anyone who bought in the last 14 days is left out. Each ad is built from the catalogue's own photos, names and prices.",
            )
        },
    ) {
        choice.problem?.let { AdsWarningRow(it, Tone.problem, Symbols.Warning) }
        val catalogs = choice.catalogs
        if (catalogs != null) {
            if (catalogs.isEmpty()) {
                AdsRow { Text("The Meta business has no catalogue yet: connect one in Shopify's Facebook & Instagram app.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else if (catalogs.size > 1) {
                PickerRow("Catalogue", choice.catalogId, listOf("" to "Choose one") + catalogs.map { it.id to it.words }) { onChoice(choice.copy(catalogId = it)) }
            }
        } else if (choice.problem == null) {
            AdsReading("Reading the catalogues…")
        }
        if (choice.catalogId.isNotEmpty()) {
            val sets = choice.sets
            if (sets != null) PickerRow("Pieces", choice.setId, sets.map { it.id to it.words }) { onChoice(choice.copy(setId = it)) }
            else AdsReading("Reading its product sets…")
        }
        AdsRow {
            AdsChips {
                FilterChip("Bring back lookers", choice.who == "viewers", { onChoice(choice.copy(who = "viewers")) })
                FilterChip("Find new buyers", choice.who == "everyone", { onChoice(choice.copy(who = "everyone")) })
            }
        }
    }
}

// MARK: Bidding and hours

private val dayNames = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

@Composable
fun AdsAdvancedSection(advanced: AdsAdvanced, onAdvanced: (AdsAdvanced) -> Unit, needsTotal: () -> Unit, sales: Boolean, currency: String) {
    AdsSection(null, footer = { if (advanced.open) Text(advanced.note) }) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { onAdvanced(advanced.copy(open = !advanced.open)) }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (advanced.isSet) "Advanced: bidding and hours · set" else "Advanced: bidding and hours",
                Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
            )
            Icon(
                Symbols.ExpandMore, if (advanced.open) "Fold" else "Unfold", Modifier.rotate(if (advanced.open) 0f else -90f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (advanced.open) {
            val bids = listOf("lowest" to "Most results", "cost_cap" to "Cost per result about…", "bid_cap" to "Never bid more than…") +
                (if (sales) listOf("min_roas" to "Sales of at least … × spend") else emptyList())
            PickerRow("Bidding", advanced.bid, bids) { onAdvanced(advanced.copy(bid = it)) }
            if (advanced.bid == "cost_cap" || advanced.bid == "bid_cap") {
                val label = if (advanced.bid == "cost_cap") "Per result ($currency)" else "Highest bid ($currency)"
                ValueRow(label) {
                    ValueInput(advanced.amount, { onAdvanced(advanced.copy(amount = it)) }, prompt = "Amount", label = label, keyboard = KeyboardType.Decimal)
                }
            }
            if (advanced.bid == "min_roas") {
                ValueRow("Sales ×") {
                    ValueInput(advanced.roas, { onAdvanced(advanced.copy(roas = it)) }, prompt = "3", label = "Sales ×", keyboard = KeyboardType.Decimal)
                }
            }
            ToggleRow("Run only on set days and hours", advanced.hoursOn, { on ->
                onAdvanced(advanced.copy(hoursOn = on))
                if (on) needsTotal()
            })
            if (advanced.hoursOn) {
                AdsRow {
                    AdsChips {
                        for (day in 0..6) {
                            FilterChip(dayNames[day], day in advanced.days, {
                                onAdvanced(advanced.copy(days = if (day in advanced.days) advanced.days - day else advanced.days + day))
                            })
                        }
                    }
                }
                PickerRow("From", advanced.from.toString(), (0..23).map { it.toString() to "%02d:00".format(it) }) { onAdvanced(advanced.copy(from = it.toInt())) }
                PickerRow("Until", advanced.to.toString(), (1..24).map { it.toString() to (if (it == 24) "Midnight" else "%02d:00".format(it)) }) { onAdvanced(advanced.copy(to = it.toInt())) }
            }
        }
    }
}
