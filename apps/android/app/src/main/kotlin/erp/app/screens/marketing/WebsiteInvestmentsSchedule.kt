package erp.app.screens.marketing

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.device.Foreground
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.Radius
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Investments' automatic sending (page.tsx `SchedulePanel`) and a day filed by hand (`AddByHand`). The rules of the schedule
// (what is due, when) stay the server's (lib/investments-schedule.ts, read through /api/investments/status); what is here is
// only how the page says a schedule in words (WebsiteInvestmentsSchedule.swift).

/**
 * The owner's schedule: the days, each part's time (or as soon as it arrives), the late cut-off, and whether each day waits
 * for an OK. Saved whole (PUT /api/investments/schedule); while it is on, or to switch it on, the save says exactly what will
 * go out.
 */
@Composable
fun WebsiteGoldScheduleSheet(onClose: () -> Unit) {
    val gold by WebsiteGold.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(gold.schedule) }
    var asking by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var timeFor by remember { mutableStateOf<String?>(null) }
    val saved = gold.schedule
    val d = draft
    val changed = d != null && saved != null && !d.sameChoices(saved)
    val wasOn = saved?.enabled ?: false
    val going = gold.targets.count { d?.plan(it.id)?.on ?: false }

    fun save(on: Boolean) {
        val s = draft ?: return
        scope.launch {
            busy = "Saving the schedule…"
            try {
                WebsiteGold.saveSchedule(s.copy(enabled = on))
                onClose()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong."
            } finally {
                busy = null
            }
        }
    }

    fun ask(how: String) {
        val s = draft ?: return
        if (s.days.isEmpty() || going == 0) { failure = "Choose what goes first: switch on at least one part, and pick its days."; return }
        asking = how
    }

    // The sheet's one action sits in its bar, as the iPhone's confirmation button does.
    FullScreenSheet(
        title = "Automatic sending", onCancel = { if (busy == null) onClose() },
        confirmText = if (d != null) (if (wasOn) "Save changes" else "Save and switch on") else null,
        confirmEnabled = busy == null && !(wasOn && !changed),
        onConfirm = { ask(if (wasOn) "keepOn" else "switchOn") },
    ) {
        Box(Modifier.fillMaxSize()) {
            if (d == null) {
                erp.app.ui.NotAvailableState("The schedule couldn't be read", icon = Symbols.Image)
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    FormSection("Which days") {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            for (n in listOf(1, 2, 3, 4, 5, 6, 0)) {
                                MarketingChip(WebsiteGoldWords.dayNames[n], n in d.days, {
                                    draft = d.copy(days = (if (n in d.days) d.days - n else d.days + n).sorted())
                                })
                            }
                        }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { draft = d.copy(days = listOf(0, 1, 2, 3, 4, 5, 6)) }) { Text("Every day") }
                            TextButton(onClick = { draft = d.copy(days = listOf(1, 2, 3, 4, 5, 6)) }) { Text("Mon–Sat") }
                            TextButton(onClick = { draft = d.copy(days = listOf(1, 2, 3, 4, 5)) }) { Text("Mon–Fri") }
                        }
                    }
                    FormSection("What goes, and when · Karachi time") {
                        for (t in gold.targets) PartRow(t, d, { draft = it }) { timeFor = t.id }
                    }
                    FormSection("If the post comes late", footer = { Text("After that, a part that hasn't gone waits for someone to press Send.") }) {
                        Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { timeFor = "late" }.ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Still send it until", Modifier.weight(1f))
                            Text(WebsiteGoldTime.clock(d.lateUntil), color = ErpColors.accent)
                        }
                    }
                    FormSection(
                        "Each day",
                        footer = { Text(if (d.mode == "approve") "Each day's post waits until you press Approve on it; then it goes at its times." else "It goes at its times unless you hold the day.") },
                    ) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MarketingChip("Send by itself", d.mode == "auto", { draft = d.copy(mode = "auto") })
                            MarketingChip("Wait for my OK", d.mode == "approve", { draft = d.copy(mode = "approve") })
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (wasOn) {
                            TextButton(onClick = { save(false) }, modifier = Modifier.fillMaxWidth()) { Text("Switch automatic sending off", color = Tone.problem.color()) }
                        } else {
                            TextButton(onClick = { save(false) }, enabled = changed && busy == null, modifier = Modifier.fillMaxWidth()) { Text("Save, keep it off") }
                        }
                        Text(
                            if (wasOn) "It's on: what you save here is what goes out." else "Off: nothing goes out unless someone presses Send.",
                            Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            WebsiteBusy(busy)
        }
    }
    timeFor?.let { which ->
        val s = draft
        if (s != null) {
            val initial = if (which == "late") s.lateUntil else s.plan(which).at
            val fallback = if (which == "late") "20:00" else (WebsiteGoldSchedule.defaults[which]?.at ?: "11:30")
            WebsiteTimeDialog(
                title = if (which == "late") "Still send it until" else "At", initial = initial, fallback = fallback, onDismiss = { timeFor = null },
                onPick = { hhmm ->
                    draft = if (which == "late") s.copy(lateUntil = hhmm) else s.withPlan(which, s.plan(which).copy(at = hhmm))
                    timeFor = null
                },
            )
        }
    }
    asking?.let { how ->
        WebsiteConfirm(
            "Send Investments by Taheri automatically?", draft?.let { WebsiteGoldWords.switchOn(it, gold.targets) } ?: "",
            listOf(WebsiteChoice(if (how == "switchOn") "Switch it on" else "Save changes") { save(true) }),
            onDismiss = { asking = null },
        )
    }
    FailureAlert(failure, { failure = null }, title = "Not saved")
}

@Composable
private fun PartRow(t: WebsiteGoldStatus.Target, d: WebsiteGoldSchedule, set: (WebsiteGoldSchedule) -> Unit, pickTime: () -> Unit) {
    val plan = d.plan(t.id)
    Column(Modifier.fillMaxWidth()) {
        ToggleRow(t.label, plan.on, { set(d.withPlan(t.id, plan.copy(on = it))) }, sub = "to " + t.to)
        if (plan.on) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                MarketingChip("On arrival", plan.at == "arrival", { set(d.withPlan(t.id, plan.copy(at = "arrival"))) })
                MarketingChip("At a time", plan.at != "arrival", {
                    if (plan.at == "arrival") set(d.withPlan(t.id, plan.copy(at = WebsiteGoldSchedule.defaults[t.id]?.at ?: "11:30")))
                })
            }
            if (plan.at != "arrival") {
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = pickTime).ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("At", Modifier.weight(1f))
                    Text(WebsiteGoldTime.clock(plan.at), color = ErpColors.accent)
                }
            }
        }
    }
}

// MARK: A day by hand

/**
 * The routine's four things, from the phone: the post, the teaser, the square card and the story card, filed under a day
 * (POST /api/investments). Nothing is sent on filing; a day that already exists is replaced, and what already went stays
 * marked as sent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebsiteGoldAddSheet(onClose: () -> Unit) {
    val gold by WebsiteGold.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var day by rememberSaveable { mutableStateOf(erp.core.ERPDate.karachiDay(AppClock.now())) }
    var post by rememberSaveable { mutableStateOf("") }
    var teaser by rememberSaveable { mutableStateOf("") }
    var square by remember { mutableStateOf<ByteArray?>(null) }
    var story by remember { mutableStateOf<ByteArray?>(null) }
    var squareThumb by remember { mutableStateOf<ImageBitmap?>(null) }
    var storyThumb by remember { mutableStateOf<ImageBitmap?>(null) }
    var pickingDate by remember { mutableStateOf(false) }
    var confirmingReplace by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    val exists = gold.posts.any { it.date == day }

    /** A card as the ERP reads it: a JPEG (the server sizes it), whatever Photos hands over. */
    fun choose(isSquare: Boolean) {
        val launchers = Foreground.launchers ?: run { failure = "Photos can't open here."; return }
        scope.launch {
            try {
                val result = launchers.intent(Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE))
                val uri = (if (result.resultCode == Activity.RESULT_OK) result.data?.data else null) ?: return@launch
                val raw = withContext(Dispatchers.IO) { try { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null } }
                if (raw == null) { failure = "Couldn't read that picture."; return@launch }
                val ready = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(raw, 2400)?.let { it to MarketingPhotos.decode(it, 160)?.asImageBitmap() } }
                if (ready == null) { failure = "Couldn't use that picture."; return@launch }
                if (isSquare) { square = ready.first; squareThumb = ready.second } else { story = ready.first; storyThumb = ready.second }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Photos couldn't open."
            }
        }
    }

    fun file() {
        scope.launch {
            busy = "Filing it…"
            try {
                WebsiteGold.file(day, post.trim(), teaser.trim(), square, story)
                onClose()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong."
            } finally {
                busy = null
            }
        }
    }

    FullScreenSheet(
        title = "Add a day by hand", onCancel = { if (busy == null) onClose() },
        confirmText = "File it", confirmEnabled = post.trim().isNotEmpty() && busy == null,
        onConfirm = { if (exists) confirmingReplace = true else file() },
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                FormSection(
                    "Date",
                    footer = { Text(if (exists) "${WebsiteGoldTime.longDate(day)} is filed already: this replaces it, and anything sent stays marked as sent." else "Paste the post and the teaser, and attach the routine's two cards.") },
                ) {
                    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { pickingDate = true }.ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Date", Modifier.weight(1f))
                        Text(WebsiteGoldTime.longDate(day), color = ErpColors.accent)
                    }
                }
                FormSection("The WhatsApp post") { Field(post, { post = it }, "The post", 6, 20) }
                FormSection("The teaser (optional)") { Field(teaser, { teaser = it }, "The teaser", 3, 12) }
                FormSection("Cards") {
                    CardRow("Square card (1080 × 1080)", squareThumb, square != null, { choose(true) }) { square = null; squareThumb = null }
                    CardRow("Story card (1080 × 1920)", storyThumb, story != null, { choose(false) }) { story = null; storyThumb = null }
                }
            }
            WebsiteBusy(busy)
        }
    }
    if (pickingDate) {
        val parsed = try { LocalDate.parse(day) } catch (e: Exception) { LocalDate.now() }
        val state = rememberDatePickerState(initialSelectedDateMillis = parsed.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickingDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { day = java.time.Instant.ofEpochMilli(it).atOffset(ZoneOffset.UTC).toLocalDate().toString() }
                    pickingDate = false
                }) { Text("Use this date") }
            },
            dismissButton = { TextButton(onClick = { pickingDate = false }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
    if (confirmingReplace) {
        WebsiteConfirm(
            "Replace ${WebsiteGoldTime.longDate(day)}?", "The day's post, teaser and cards are replaced by these. Nothing is sent; what already went stays marked as sent.",
            listOf(WebsiteChoice("Replace it") { file() }), onDismiss = { confirmingReplace = false },
        )
    }
    FailureAlert(failure, { failure = null }, title = "Not filed")
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, min: Int, max: Int) {
    TextField(
        value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        placeholder = { Text(placeholder) }, minLines = min, maxLines = max,
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
    )
}

@Composable
private fun CardRow(title: String, thumb: ImageBitmap?, has: Boolean, pick: () -> Unit, clear: () -> Unit) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp).clip(Radius.thumbShape).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
            if (thumb != null) Image(thumb, contentDescription = null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else Icon(Symbols.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = pick) { Text(if (has) "Replace" else "Choose") }
                if (has) TextButton(onClick = clear) { Text("Remove", color = Tone.problem.color()) }
            }
        }
    }
}
