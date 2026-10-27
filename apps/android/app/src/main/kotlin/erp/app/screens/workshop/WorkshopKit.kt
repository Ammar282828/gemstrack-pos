package erp.app.screens.workshop

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import erp.app.ui.zoomSource
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import erp.app.ui.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import erp.app.ui.OutlinedButton
import androidx.compose.material3.SelectableDates
import erp.app.ui.Switch
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.BiometricVault
import erp.app.screens.neworder.FullScreenPage
import erp.app.screens.neworder.formRow
import erp.app.ui.CardColumns
import erp.app.ui.Pill
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.ERPDate
import erp.core.entry.NewOrderDay
import erp.core.models.Karigar
import erp.core.models.KarigarJobStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// The few views the Workshop screens share (WorkshopKit.swift). Types here carry the word Workshop so they cannot
// meet another group's helpers in the one module.
//
// TODO(shared): FullScreenPage, formRow and the customers' FormSection/TextRow stand in for the kit's form rows and
// FullScreenSheet; the delete-code sheet below for the shared owner delete-code sheet. Replace when merged.


fun workshopOrderPath(id: String) = "/orders/" + WorkshopLogic.piece(id)
fun workshopInvoicePath(id: String) = "/invoices/" + WorkshopLogic.piece(id)
fun workshopCustomerPath(id: String) = "/customers/" + WorkshopLogic.piece(id)

/** What an error says on screen: the ERP's own words. */
fun workshopSay(e: Throwable): String = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

/** How old a piece is, in the colour every workshop surface uses: grey, orange from a week, red from two. */
@Composable
fun WorkshopAgeBadge(job: WorkshopJob, modifier: Modifier = Modifier) {
    if (job.isDone) {
        Pill("Done", modifier, Tone.settled)
    } else {
        val tone = when (job.urgency) {
            WorkshopJob.Urgency.critical -> Tone.late
            WorkshopJob.Urgency.warning -> Tone.owed
            WorkshopJob.Urgency.ok -> Tone.quiet
        }
        Pill("${job.ageDays}d", modifier, tone)
    }
}

/** A count in the colour of its urgency, for section headers: "2 critical", "3 late". */
@Composable
fun WorkshopUrgencyBadges(critical: Int, late: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (critical > 0) Pill("$critical critical", tone = Tone.late)
        if (late > 0) Pill("$late late", tone = Tone.owed)
    }
}

/** Who a piece can be given to: the karigars with work first, then the others. */
class WorkshopChoices(karigars: List<Karigar>, busyIds: Set<String>) {
    val working: List<Karigar> = karigars.filter { it.id in busyIds }
    val others: List<Karigar> = karigars.filter { it.id !in busyIds }
}

/** A stock job's status in the Workshop's words (STATUS_LABEL). */
object WorkshopStatusWords {
    val choices: List<KarigarJobStatus> = listOf(KarigarJobStatus.pending, KarigarJobStatus.inProgress, KarigarJobStatus.completed)

    fun say(s: KarigarJobStatus): String = when (s) {
        KarigarJobStatus.pending -> "Pending"
        KarigarJobStatus.inProgress -> "In Progress"
        KarigarJobStatus.completed -> "Completed"
        else -> s.rawValue
    }

    fun icon(s: KarigarJobStatus): ImageVector = when (s) {
        KarigarJobStatus.completed -> Symbols.CheckCircle
        KarigarJobStatus.inProgress -> Symbols.Pending
        else -> Symbols.PanoramaFishEye
    }
}

/** What a piece's controls can do. Each is one write through the ERP; the shelf brings the change back. */
class WorkshopActions(
    val done: (WorkshopJob, Boolean) -> Unit,
    val given: (WorkshopJob, Boolean) -> Unit,
    /** "none" clears the karigar (an order's or a sold piece's; a stock job keeps the karigar it was written for). */
    val assign: (WorkshopJob, String) -> Unit,
    /** A stock job's status: Pending, In Progress, Completed. */
    val status: (WorkshopJob, KarigarJobStatus) -> Unit,
    /** A stock job's making details, in a sheet. */
    val details: (WorkshopJob) -> Unit,
    /** A stock job deleted, once the delete code is typed. */
    val delete: (WorkshopJob) -> Unit,
    val open: (String) -> Unit,
)

// MARK: Cards

/**
 * Each piece has its own surface (`WorkshopCards`). The queue uses the window's width: as many columns as fit at
 * [minimumWidth] each, one at large text. Emitted as a row per `columns` cards so the list stays lazy.
 */
fun <T : Any> LazyListScope.workshopCardRows(
    items: List<T>,
    columns: Int,
    keyPrefix: String,
    key: (T) -> String,
    zoomId: ((T) -> String)? = null,
    content: @Composable (T) -> Unit,
) {
    val n = maxOf(1, columns)
    val rows = items.chunked(n)
    items(rows.size, key = { "$keyPrefix:" + key(rows[it].first()) }) { r ->
        val row = rows[r]
        Row(Modifier.animateItem().fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
            for (item in row) Column(Modifier.weight(1f).let { m -> if (zoomId != null) m.zoomSource(zoomId(item)) else m }.ledgerCard()) { content(item) }
            repeat(n - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

/** How many card columns a width has room for (a job card needs more room than a recipient's). */
fun workshopColumns(widthDp: Float, large: Boolean, minimumDp: Float = 340f): Int =
    if (large) 1 else CardColumns.count(widthDp.dp, minimum = minimumDp.dp, spacing = 16.dp, limit = 3)

// MARK: Sharing and dialling

/** The share sheet with a karigar's work list (the web copies it and opens WhatsApp to him; the sheet does both). */
fun workshopShare(context: Context, text: String, title: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    try {
        context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        // No app to share with: the button does nothing.
    }
}

/** Opens the dial pad on a number. */
fun workshopDial(context: Context, phone: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, android.net.Uri.parse("tel:" + WorkshopLogic.dialable(phone))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        // No dialler: nothing happens.
    }
}

// MARK: Forms

/**
 * A full-window form with its Cancel (the back arrow) and its one action in the bar: the iPhone's
 * `NavigationStack { Form … }` sheet at `.page` size. [locked] keeps it open while a write is out.
 */
@Composable
fun WorkshopFormSheet(
    title: String,
    onDismiss: () -> Unit,
    confirmLabel: String,
    confirmEnabled: Boolean,
    onConfirm: () -> Unit,
    locked: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    FullScreenPage(
        title = title,
        onBack = { if (!locked) onDismiss() },
        actions = { TextButton(onClick = onConfirm, enabled = confirmEnabled && !locked) { Text(confirmLabel) } },
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn(720.dp).imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            content = content,
        )
    }
}

/** A refusal in a form, under its fields, in the problem tone. */
@Composable
fun WorkshopFormError(message: String?) {
    if (message != null) Text(message, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium)
}

/** A line of words in a form's footer slot (a refusal in red, otherwise quiet). */
@Composable
fun WorkshopFootnote(text: String, tone: Tone = Tone.quiet) {
    Text(
        text, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall,
        color = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else tone.color(),
    )
}

/** A confirmation before money moves: the dialog says what is written (the iPhone's `confirmationDialog`). */
@Composable
fun WorkshopConfirm(title: String, message: String, confirmLabel: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * A day (no later than today) the shop's way; a tap opens the calendar. Dates the ERP stores keep the time of day the
 * form was opened at ([WorkshopDay.instant]), as the iPhone's date box does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkshopDayRow(title: String, day: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val said = NewOrderDay.date(day)?.let { ShopDate.stamp(it) } ?: "Choose"
    Row(
        Modifier.fillMaxWidth().formRow().clickable(role = Role.Button) { open = true }.semantics { contentDescription = "$title, $said" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(said, color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
    }
    if (open) {
        val todayMillis = remember { LocalDate.parse(NewOrderDay.today).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
        val start = remember(day) { LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
        val state = rememberDatePickerState(
            initialSelectedDateMillis = start,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis <= todayMillis
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onPick(java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                    open = false
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}

/** A picked Karachi day as the instant the ERP stores: that day at the time of day the form was opened. */
object WorkshopDay {
    fun instant(day: String, openedAt: Instant): Instant {
        val midnight = NewOrderDay.date(day) ?: return openedAt
        val openedDay = NewOrderDay.date(NewOrderDay.string(openedAt)) ?: return openedAt
        return midnight.plusSeconds(openedAt.epochSecond - openedDay.epochSecond).plusNanos(openedAt.nano.toLong())
    }

    fun iso(day: String, openedAt: Instant): String = ERPDate.iso(instant(day, openedAt))
}

// MARK: The delete code

/**
 * One delete waiting for its code: what is deleted (said in the sheet and in the ERP's log of who tried), what goes
 * with it, and the write that runs once the code is typed.
 */
class WorkshopDeletion(
    /** The store's own words for it ("Delete this karigar job"). */
    val what: String,
    /** What else happens, said before the code is asked for (the web's confirmation). */
    val detail: String,
    /** The ERP's write, sent with the code; it throws the ERP's words when refused. */
    val run: suspend (code: String) -> Unit,
    /** False for a removal Settings, Recently removed can put back: the sheet then does not say it can't be undone. */
    val final: Boolean = true,
)

private const val FACE_KEY = "delete-code"

/**
 * The delete code (decision "Delete code"): four digits the ERP's server checks with the delete itself, so nothing
 * is deleted unless the code was right. A phone with a fingerprint or face can keep the code behind it (the same
 * place the web dialog keeps it inside the app), offered once a typed code has been taken, then asked for by finger,
 * and forgotten when the shop changes the code.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkshopDeleteCodeSheet(deletion: WorkshopDeletion, onDismiss: () -> Unit, onDone: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var keep by remember { mutableStateOf(true) }
    var kept by remember { mutableStateOf(runCatching { BiometricVault.has(FACE_KEY) }.getOrDefault(false)) }
    val canFace = remember { runCatching { BiometricVault.biometry().first }.getOrDefault(false) }
    val scope = rememberCoroutineScope()
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy })

    suspend fun close() {
        state.hide()
        onDismiss()
    }

    suspend fun submit(given: String, byFace: Boolean) {
        if (busy || given.length < 4) return
        busy = true
        error = null
        try {
            deletion.run(given)
            if (!byFace && canFace && !kept && keep) runCatching { BiometricVault.save(given, FACE_KEY) }
            busy = false
            onDone()
            close()
            return
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 403 && e.message == "Wrong code.") {
                if (byFace) {
                    // The shop changed the code: the phone's copy is no use any more.
                    BiometricVault.delete(FACE_KEY)
                    kept = false
                    error = "The delete code has changed. Type the new one."
                } else {
                    error = "Wrong code."
                }
                code = ""
            } else {
                error = e.message
            }
        } catch (e: Exception) {
            error = workshopSay(e)
        }
        busy = false
    }

    // Face unlocks the kept code and sends it; a closed prompt leaves the box to type in.
    suspend fun byFace() {
        val saved = try {
            BiometricVault.read(FACE_KEY, deletion.what)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return
        submit(saved, true)
    }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = state, containerColor = ErpColors.ground) {
        LaunchedEffect(Unit) { if (canFace && kept) byFace() }
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Delete code", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(deletion.what, style = MaterialTheme.typography.titleSmall)
                Text(
                    listOf(deletion.detail, if (deletion.final) "This can't be undone." else "", "Enter the code to go ahead.").filter { it.isNotEmpty() }.joinToString(" "),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextField(
                    value = code,
                    onValueChange = { typed ->
                        code = typed.filter { it in '0'..'9' }.take(8)
                        // Typing again clears the last refusal; the box emptied after one keeps it said.
                        if (typed.isNotEmpty()) error = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Delete code") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                    enabled = !busy,
                )
                if (canFace && kept) {
                    OutlinedButton(onClick = { scope.launch { byFace() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Icon(Symbols.Fingerprint, null, Modifier.padding(end = 8.dp))
                        Text("Use your fingerprint or face")
                    }
                }
                if (canFace && !kept) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Use your fingerprint or face next time on this phone", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Switch(checked = keep, onCheckedChange = { keep = it })
                    }
                }
            }
            error?.let {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                    Icon(Symbols.Warning, null, Modifier.size(20.dp), tint = Tone.problem.color())
                    Text(it, Modifier.weight(1f), color = Tone.problem.color())
                }
            }
            Button(
                onClick = { scope.launch { submit(code, false) } },
                enabled = !busy && code.length >= 4,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Tone.problem.color(), contentColor = Color.White),
            ) {
                if (busy) Loading(Modifier.size(24.dp), color = Color.White)
                Text("Delete")
            }
        }
    }
}
