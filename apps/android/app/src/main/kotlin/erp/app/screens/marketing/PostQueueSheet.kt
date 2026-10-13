package erp.app.screens.marketing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** Where a queued piece goes, said in full before it goes, and what the sheet tells (pure, so it is tested). */
object PostQueueLogic {
    /** A place a piece goes, with the sends that make it up. */
    class Place(val id: String, val title: String, val detail: String, val kind: String, val units: List<String>)

    fun places(e: PostQueueEntry, state: PostsState): List<Place> {
        val out = ArrayList<Place>()
        val site = e.unitKeys.filter { it.startsWith("site-") || it == "featured" }
        if (e.toWebsite && site.isNotEmpty()) {
            val photos = "${e.sitePhotos} photo${if (e.sitePhotos == 1) "" else "s"}"
            val shelf = if (e.websiteCollection.isEmpty()) state.siteName else "${state.siteName} · ${e.websiteCollection}"
            out.add(Place("website", "Website", shelf + " · " + photos + (if (e.websiteFeatured) " · featured" else ""), "website", site))
        }
        if ("instagram" in e.unitKeys) out.add(Place("instagram", "Instagram story", "The story picture", "instagram", listOf("instagram")))
        for (key in e.whatsapp) {
            val units = e.unitKeys.filter { it.startsWith("wa:$key:") }
            if (units.isEmpty()) continue
            val photos = "${units.size} photo${if (units.size == 1) "" else "s"}, the caption on the first"
            out.add(Place("wa:$key", state.placeLabel(key), "WhatsApp · $photos", if (key == "channel") "channel" else "group", units))
        }
        return out
    }

    /** What the counter is told before anything goes: every place still to get it. */
    fun sendWords(e: PostQueueEntry, state: PostsState): String {
        val left = places(e, state).filter { p -> !p.units.all { it in e.doneKeys } }
        val list = left.joinToString("\n") { "${it.title} (${it.detail})" }
        val already = if (e.done > 0) "\n\nWhat already went is not sent again." else ""
        return "It goes now to:\n$list$already\n\nA post cannot be taken back."
    }

    fun statusWords(e: PostQueueEntry): String = when (e.status) {
        "scheduled" -> "Goes " + ShopDate.say(e.dueAt, withTime = true)
        "held" -> "Held: it waits for you"
        "sending" -> "Sending now"
        "sent" -> "Sent " + ShopDate.say(e.sentAt, withTime = true)
        "failed" -> "Not all of it went"
        "draft" -> "Still arriving from the device that made it"
        else -> e.status
    }

    fun removeWords(e: PostQueueEntry): String =
        if (e.done > 0) "What already went stays where it is; the rest will not go." else "Nothing of it has gone. Its photos are deleted with it."

    fun canSend(e: PostQueueEntry) = e.status in listOf("held", "scheduled", "failed")
    fun canTime(e: PostQueueEntry) = e.status in listOf("held", "scheduled", "failed")
}

/**
 * One queued piece, before and after it goes (the web hub's queue row and its menu, src/app/posts/page.tsx): the picture,
 * the caption word for word, and every place it goes with how many photos and what has gone. Send now, Hold, Send at a
 * time and Remove call the queue's own routes. The sending is the server's (lib/social/queue.ts `sendItem`): the phone
 * only asks for it, and only after saying exactly where it goes, because a post to the groups and the channel cannot be
 * taken back. [embedded] is the page at /marketing/queue?id=; otherwise a sheet over the screen that opened it.
 */
@Composable
fun PostQueueSheet(id: String, onClose: () -> Unit = {}, embedded: Boolean = false) {
    var busy by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { PostsStore.refreshQueue() }
    if (embedded) {
        ScreenTitle("In the queue")
        Box(Modifier.fillMaxSize().readableColumn(720.dp)) { QueueContent(id, onClose, busy) { busy = it } }
    } else {
        // Not swiped away mid-send: the answer (or the error) is shown here.
        FullScreenSheet(title = "In the queue", onCancel = { if (busy == null) onClose() }, cancelText = "Done") {
            Box(Modifier.fillMaxSize().readableColumn(720.dp)) { QueueContent(id, onClose, busy) { busy = it } }
        }
    }
}

@Composable
private fun QueueContent(id: String, onClose: () -> Unit, busy: String?, setBusy: (String?) -> Unit) {
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val entry = state.queue.firstOrNull { it.id == id }
    if (entry == null) {
        NotAvailableState("No longer in the queue", why = "It was sent, removed, or changed on another device.", icon = Icons.Filled.Inbox)
        return
    }
    QueuePage(entry, state, onClose, busy, setBusy)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QueuePage(e: PostQueueEntry, state: PostsState, onClose: () -> Unit, busy: String?, setBusy: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var said by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var confirmingSend by remember { mutableStateOf(false) }
    var confirmingRemove by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    var whenAt by remember { mutableStateOf(AppClock.now().plusSeconds(3600)) }

    fun run(doing: String, work: suspend () -> String?) {
        scope.launch {
            setBusy(doing); failure = null; said = null
            try {
                said = work()
            } catch (c: CancellationException) {
                throw c
            } catch (ex: Exception) {
                failure = ex.message ?: "Something went wrong."
            } finally {
                setBusy(null)
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            QueueHeader(e)
            said?.let { Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Filled.CheckCircle, null, tint = Tone.settled.color()); Text(it, color = Tone.settled.color()) } }
            failure?.let { Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Filled.Warning, null, tint = Tone.problem.color()); Text(it, color = Tone.problem.color()) } }
            FormSection(
                "Where it goes",
                footer = { Text(if (e.toWebsite && e.websiteNames.isNotEmpty()) "On the website as " + e.websiteNames.joinToString(", ") + "." else "") },
            ) {
                for (p in PostQueueLogic.places(e, state)) PlaceRow(p, e)
            }
            if (e.caption.isNotEmpty()) {
                FormSection("Caption") { SelectionContainer { Text(e.caption, Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium) } }
            }
            val canSend = PostQueueLogic.canSend(e)
            val canTime = PostQueueLogic.canTime(e)
            if (canSend || canTime || e.status != "sending") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (canSend) {
                        Button(
                            onClick = { confirmingSend = true }, enabled = busy == null, modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Send, null, Modifier.size(18.dp))
                            Text(if (e.status == "failed") "Send what is left now" else "Send now", Modifier.padding(start = 8.dp))
                        }
                    }
                    RowsCard {
                        if (canTime) {
                            if (picking) {
                                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                                    Text("Send at", Modifier.weight(1f))
                                    TextButton(onClick = { choosing = true }) { Text(ShopDate.stamp(whenAt, withTime = true)) }
                                }
                                ActionRow("Schedule for this time", {
                                    run("Scheduling…") { PostsStore.schedule(e.id, whenAt); picking = false; "It goes " + ShopDate.stamp(whenAt, withTime = true) + "." }
                                })
                            } else {
                                ActionRow("Send at a time…", { picking = true }, Icons.Filled.Schedule)
                            }
                            if (e.status == "scheduled") ActionRow("Hold it", { run("Holding…") { PostsStore.hold(e.id); "Held. It waits for you." } }, Icons.Filled.PauseCircle)
                        }
                        if (e.status != "sent") ActionRow("Remove from the queue", { confirmingRemove = true }, Icons.Filled.Delete, tone = Tone.problem)
                    }
                }
            }
        }
        if (busy != null) Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
            Box(Modifier.clip(Radius.cardShape).background(ErpColors.card).padding(20.dp)) { SkeletonLoading(label = busy) }
        }
    }

    if (confirmingSend) {
        AlertDialog(
            onDismissRequest = { confirmingSend = false },
            title = { Text("Send this now?") },
            text = { Text(PostQueueLogic.sendWords(e, state)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingSend = false
                    run("Sending…") {
                        val all = PostsStore.sendNow(e.id)
                        if (all) "Sent to every place." else { failure = "Not all of it went. What failed is marked; Send what is left tries only those."; null }
                    }
                }) { Text("Send now") }
            },
            dismissButton = { TextButton(onClick = { confirmingSend = false }) { Text("Cancel") } },
        )
    }
    if (confirmingRemove) {
        AlertDialog(
            onDismissRequest = { confirmingRemove = false },
            title = { Text("Take it out of the queue?") },
            text = { Text(PostQueueLogic.removeWords(e)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingRemove = false
                    run("Removing…") { PostsStore.remove(e.id); onClose(); null }
                }) { Text("Remove", color = Tone.problem.color()) }
            },
            dismissButton = { TextButton(onClick = { confirmingRemove = false }) { Text("Cancel") } },
        )
    }
    if (choosing) KarachiTimeDialog(whenAt, onDismiss = { choosing = false }, onPick = { whenAt = it; choosing = false })
}

@Composable
private fun QueueHeader(e: PostQueueEntry) {
    Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        StockImage(e.thumb, e.headline, e.id, Modifier.size(84.dp).clip(Radius.chipShape), decodeDataUri = true)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(e.headline.ifEmpty { "A piece" }, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
            Text(PostQueueLogic.statusWords(e), style = MaterialTheme.typography.bodyMedium, color = if (e.status == "failed") Tone.problem.color() else MaterialTheme.colorScheme.onSurfaceVariant)
            if (e.units > 0) {
                LinearProgressIndicator(progress = { e.done.toFloat() / e.units }, Modifier.fillMaxWidth(), color = ErpColors.accent)
                Text("${e.done} of ${e.units} gone", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun PlaceRow(p: PostQueueLogic.Place, e: PostQueueEntry) {
    val gone = p.units.count { it in e.doneKeys }
    val problem = p.units.firstNotNullOfOrNull { e.unitErrors[it] }
    val icon: ImageVector = when (p.kind) { "website" -> Icons.Filled.Public; "instagram" -> Icons.Filled.CameraAlt; "channel" -> Icons.Filled.Campaign; else -> Icons.Filled.Groups }
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(32.dp).clip(Radius.thumbShape).background(ErpColors.accent), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, Modifier.size(20.dp), tint = ErpColors.onAccent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.title, style = MaterialTheme.typography.bodyLarge)
            Text(problem ?: p.detail, style = MaterialTheme.typography.bodySmall, color = if (problem == null) MaterialTheme.colorScheme.onSurfaceVariant else Tone.problem.color())
        }
        when {
            gone == p.units.size -> Icon(Icons.Filled.CheckCircle, contentDescription = "Gone", tint = Tone.settled.color())
            problem != null -> Icon(Icons.Filled.Error, contentDescription = "Failed", tint = Tone.problem.color())
            gone > 0 -> Text("$gone/${p.units.size}", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A day then a time of day in the shop's own clock (Karachi), not before now: the iPhone's date picker in two steps. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KarachiTimeDialog(initial: Instant, onDismiss: () -> Unit, onPick: (Instant) -> Unit) {
    val local = initial.atOffset(ERPDate.karachi)
    val todayStart = AppClock.now().atOffset(ERPDate.karachi).toLocalDate()
    val dates = rememberDatePickerState(
        initialSelectedDateMillis = local.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = Instant.ofEpochMilli(utcTimeMillis).atOffset(ZoneOffset.UTC).toLocalDate() >= todayStart
        },
    )
    val time = rememberTimePickerState(initialHour = local.hour, initialMinute = local.minute, is24Hour = false)
    var step by remember { mutableStateOf(0) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (step == 0) "Send on" else "Send at") },
        text = {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (step == 0) DatePicker(state = dates, title = null, headline = null, showModeToggle = false)
                else TimePicker(state = time)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (step == 0) { step = 1; return@TextButton }
                val day = Instant.ofEpochMilli(dates.selectedDateMillis ?: return@TextButton).atOffset(ZoneOffset.UTC).toLocalDate()
                onPick(LocalDate.of(day.year, day.month, day.dayOfMonth).atTime(LocalTime.of(time.hour, time.minute)).toInstant(ERPDate.karachi))
            }) { Text(if (step == 0) "Next" else "Use this time") }
        },
        dismissButton = { TextButton(onClick = { if (step == 0) onDismiss() else step = 0 }) { Text(if (step == 0) "Cancel" else "Back") } },
    )
}
