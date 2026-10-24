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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import erp.app.ErpApp
import erp.app.data.ErpApi
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.core.logic.Album
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
        if ("ig-post" in e.unitKeys) {
            // The WhatsApp photos as one carousel, the first ten (album.ts); its own send, so its own line.
            val n = minOf(e.waPhotos, Album.igCarouselMax)
            val cut = if (e.waPhotos > Album.igCarouselMax) " · the first ${Album.igCarouselMax} of ${e.waPhotos}" else ""
            out.add(Place("ig-post", "Instagram (${Album.photosLabel(n)})", "One post, the caption once$cut", "instagram", listOf("ig-post")))
        }
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
    LaunchedEffect(id) { PostsStore.refreshQueue() }
    if (embedded) {
        ScreenTitle("In the queue")
        Box(Modifier.fillMaxSize().readableColumn(720.dp)) { QueueContent(id, onClose, true) }
    } else {
        // Sends run in the background (the iPhone's Outbox), so the sheet is free at once: its result comes back as a toast.
        FullScreenSheet(title = "In the queue", onCancel = onClose, cancelText = "Done") {
            Box(Modifier.fillMaxSize().readableColumn(720.dp)) { QueueContent(id, onClose, false) }
        }
    }
}

@Composable
private fun QueueContent(id: String, onClose: () -> Unit, embedded: Boolean) {
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val entry = state.queue.firstOrNull { it.id == id }
    if (entry == null) {
        NotAvailableState("No longer in the queue", why = "It was sent, removed, or changed on another device.", icon = Icons.Filled.Inbox)
        return
    }
    QueuePage(entry, state, onClose, embedded)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QueuePage(e: PostQueueEntry, state: PostsState, onClose: () -> Unit, embedded: Boolean) {
    val note = LocalNoteState.current
    var said by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var confirmingSend by remember { mutableStateOf(false) }
    var confirmingRemove by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    var whenAt by remember { mutableStateOf(AppClock.now().plusSeconds(3600)) }

    // Handed to the app's own scope (the iPhone's Outbox): the sheet is free at once and the words, or the failure, come back as a toast.
    fun hand(label: String, saying: String, close: Boolean = false, work: suspend () -> String) {
        said = saying
        failure = null
        ErpApp.scope.launch {
            try {
                note.show(Note(work()))
            } catch (c: CancellationException) {
                throw c
            } catch (ex: Exception) {
                note.show(Note("$label didn't go through", ex.message ?: "Something went wrong.", failed = true))
            }
        }
        if (close && !embedded) onClose()
    }

    val haptics = erp.app.ui.rememberHaptics()
    LaunchedEffect(said) { if (said != null) haptics.success() }
    // Send now is the page's one action, pinned (the iPhone's ActionBar): only where there is something left to send.
    val sendBar: (@Composable () -> Unit)? = if (PostQueueLogic.canSend(e)) ({
        MarketingActionBar(
            if (e.status == "failed") "Send what is left now" else "Send now", Icons.AutoMirrored.Filled.Send, { confirmingSend = true }, busy = false,
        )
    }) else null
    MarketingPinned(sendBar) { Box(Modifier.fillMaxSize()) {
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
                    RowsCard {
                        if (canTime) {
                            if (picking) {
                                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                                    Text("Send at", Modifier.weight(1f))
                                    TextButton(onClick = { choosing = true }) { Text(ShopDate.stamp(whenAt, withTime = true)) }
                                }
                                ActionRow("Schedule for this time", {
                                    val id = e.id
                                    val at = whenAt
                                    picking = false
                                    hand("Scheduling the piece", "Scheduling…") { PostsStore.schedule(id, at); "It goes " + ShopDate.stamp(at, withTime = true) + "." }
                                })
                            } else {
                                ActionRow("Send at a time…", { picking = true }, Icons.Filled.Schedule)
                            }
                            if (e.status == "scheduled") ActionRow("Hold it", { val id = e.id; hand("Holding the piece", "Holding…") { PostsStore.hold(id); "Held. It waits for you." } }, Icons.Filled.PauseCircle)
                        }
                        if (e.status != "sent") ActionRow("Remove from the queue", { confirmingRemove = true }, Icons.Filled.Delete, tone = Tone.problem)
                    }
                }
            }
        }
    } }

    if (confirmingSend) {
        AlertDialog(
            onDismissRequest = { confirmingSend = false },
            title = { Text("Send this now?") },
            text = { Text(PostQueueLogic.sendWords(e, state)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingSend = false
                    val id = e.id
                    val n = PostQueueLogic.places(e, state).count { p -> !p.units.all { it in e.doneKeys } }
                    hand("Sending “${e.headline.ifEmpty { "a piece" }}”", "Sending to $n ${if (n == 1) "place" else "places"}…", close = true) {
                        // Not sent twice: "sendNow" sends only what has not gone, so sending again after a failure posts nothing twice.
                        if (PostsStore.sendNow(id)) "Posted to $n ${if (n == 1) "place" else "places"}"
                        else throw ErpApi.Failure(400, "Not all of it went. What failed is marked; Send what is left tries only those.")
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
                    val id = e.id
                    hand("Removing the piece", "Removing…", close = true) { PostsStore.remove(id); "Removed from the queue" }
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
            // Only part-way: each place below says what of it went, so the whole is shown once, as a bar.
            if (e.done > 0 && e.done < e.units) {
                LinearProgressIndicator(
                    progress = { e.done.toFloat() / e.units }, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${e.done} of ${e.units} gone" },
                    color = ErpColors.accent,
                )
            }
        }
    }
}

@Composable
private fun PlaceRow(p: PostQueueLogic.Place, e: PostQueueEntry) {
    val gone = p.units.count { it in e.doneKeys }
    val problem = p.units.firstNotNullOfOrNull { e.unitErrors[it] }
    // Two lines, no icon per row; gone is a quiet word, only a failure is coloured (the iPhone's rule 15).
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(problem ?: p.detail, style = MaterialTheme.typography.bodySmall, color = if (problem == null) MaterialTheme.colorScheme.onSurfaceVariant else Tone.problem.color(), maxLines = 1)
        }
        when {
            gone == p.units.size -> Text("Gone", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            problem != null -> Icon(Icons.Filled.Error, contentDescription = "Failed", tint = Tone.problem.color())
            gone > 0 -> Text("$gone/${p.units.size}", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A day then a time of day in the shop's own clock (Karachi), not before now: the iPhone's date picker in two steps. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun KarachiTimeDialog(initial: Instant, onDismiss: () -> Unit, onPick: (Instant) -> Unit) {
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
