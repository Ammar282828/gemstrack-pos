package erp.app.screens.settings

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.ui.ActionRow
import erp.app.ui.TextRow
import erp.app.ui.ValueRow
import erp.app.ui.ledgerRow
import erp.app.ui.theme.TabularDigits
import erp.core.models.Settings
import kotlinx.coroutines.launch

/**
 * Settings → Alerts (NotificationsCard, settings-sections.tsx): who gets the shop's WhatsApp alerts and which reports go
 * out when. The gateway's health check, the test message and "Send now" stay the ERP's page. The phone's own push
 * notifications are "This phone".
 */
@Composable
fun AlertSettings() {
    SettingsGate("Alerts") { AlertsForm(it) }
}

@Composable
internal fun AlertsForm(settings: Settings) {
    val writer = rememberSettingsWriter()
    // The numbers as the person has left them; the book catches up a moment later.
    var phones by remember { mutableStateOf(settings.notifPhones) }
    var newNumber by remember { mutableStateOf("") }
    var checklist by remember { mutableStateOf(settings.notifDailyChecklistTime ?: AlertsLogic.CHECKLIST_DEFAULT) }
    var endOfDay by remember { mutableStateOf(settings.notifEndOfDayTime ?: AlertsLogic.END_OF_DAY_DEFAULT) }
    var report by remember { mutableStateOf(settings.notifDailyReportTime ?: AlertsLogic.REPORT_DEFAULT) }
    var asking by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(settings) {
        phones = settings.notifPhones
        checklist = settings.notifDailyChecklistTime ?: AlertsLogic.CHECKLIST_DEFAULT
        endOfDay = settings.notifEndOfDayTime ?: AlertsLogic.END_OF_DAY_DEFAULT
        report = settings.notifDailyReportTime ?: AlertsLogic.REPORT_DEFAULT
        writer.settled()
    }

    fun savePhones(next: List<String>) {
        val before = phones
        phones = next
        ErpApp.scope.launch { if (!writer.save(mapOf("notifPhones" to next))) phones = before }
    }

    fun addNumber() {
        val n = AlertsLogic.international(newNumber)
        if (n == null) { writer.error = "Add the number with its country code, like 92 300 1234567."; return }
        if (phones.contains(n)) { writer.error = "$n is already in the list."; return }
        newNumber = ""
        savePhones(phones + n)
    }

    // Saved when the time is chosen (the iPhone's wheel waits for it to rest).
    fun saveTimes(c: String, e: String, r: String) {
        checklist = c; endOfDay = e; report = r
        val patch = AlertsLogic.timePatch(c, e, r, settings)
        if (patch.isNotEmpty()) ErpApp.scope.launch { writer.save(patch) }
    }

    val enabled = writer.isOn("notifEnabled", settings.notifEnabled)
    SettingsPage {
        SettingsSection(footer = if (enabled) "Every alert and report arrives on WhatsApp as a PDF." else "Turn on to choose who gets what.") {
            SettingToggle("Alerts on", "notifEnabled", settings.notifEnabled, writer)
        }

        if (enabled) {
            SettingsSection("Recipients", "A number from Pakistan can start with 0; any other with its country code.") {
                phones.forEach { p ->
                    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(p, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
                        IconButton(onClick = { savePhones(phones - p) }) {
                            Icon(Symbols.Close, "Remove $p", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                TextRow("WhatsApp number", newNumber, { newNumber = it }, "0300 1234567", keyboard = KeyboardType.Phone)
                ActionRow("Add number", onClick = { addNumber() }, enabled = newNumber.trim().isNotEmpty())
            }
            Switches("As it happens", AlertsLogic.live, settings, writer)
            Switches("Reports", AlertsLogic.reports, settings, writer)
            Switches("Checks", AlertsLogic.checks, settings, writer)

            SettingsSection("Times", "Karachi time. The checks, the weekly and the monthly reports go with the checklist.") {
                TimeRow("Daily checklist", checklist) { asking = "checklist" }
                TimeRow("End of day", endOfDay) { asking = "endOfDay" }
                TimeRow("Daily report", report) { asking = "report" }
            }

            SettingsSection(footer = "Whether WhatsApp is linked, and sending a report by hand.") {
                SettingsNavRow("Connection, test and send now", path = "/settings/alerts?web=1")
            }
        }

        SettingsErrorSection(writer)
    }

    asking?.let { which ->
        val current = when (which) { "checklist" -> checklist; "endOfDay" -> endOfDay; else -> report }
        TimeDialog(
            title = when (which) { "checklist" -> "Daily checklist"; "endOfDay" -> "End of day"; else -> "Daily report" },
            hhmm = current,
            onDismiss = { asking = null },
        ) { picked ->
            asking = null
            when (which) {
                "checklist" -> saveTimes(picked, endOfDay, report)
                "endOfDay" -> saveTimes(checklist, picked, report)
                else -> saveTimes(checklist, endOfDay, picked)
            }
        }
    }
}

@Composable
private fun Switches(title: String, rows: List<AlertSwitch>, settings: Settings, writer: SettingsWriter) {
    SettingsSection(title) {
        rows.forEach { r -> SettingToggle(r.title, r.key, r.value(settings), writer, detail = r.detail) }
    }
}

@Composable
private fun TimeRow(label: String, hhmm: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(AlertsLogic.say(hhmm), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeDialog(title: String, hhmm: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val (h, m) = AlertsLogic.parse(hhmm)
    val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = false)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { TimePicker(state) },
        confirmButton = { TextButton(onClick = { onPick(AlertsLogic.hhmm(state.hour, state.minute)) }) { Text("Set") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
