package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.device.AppLock
import erp.app.device.BiometricVault
import erp.app.device.WidgetLinker
import erp.app.nav.ScreenTitle
import erp.app.nav.ThemeChoice
import erp.app.ui.ActionRow
import erp.app.ui.DeleteCode
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.SmallPrint
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * This phone's own settings (owners): which notifications it gets (lib/push, kept on the server per phone, so the ERP's
 * Settings → Alerts switches for WhatsApp are not touched), how it looks, the lock, the delete code kept behind the
 * fingerprint, and the home-screen widget's place. Settings for the whole shop stay the ERP's (/settings).
 *
 * Push is built against [PushStatus] (device/DeviceLinks.kt's `Push` behind it); the widget's key is minted by [WidgetLinker].
 */
@Composable
fun PhoneSettings() {
    ScreenTitle("This phone")
    if (!LocalSession.current.isOwner) {
        NotAvailableState("Owners only", why = "Settings are the owners’.")
        return
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val push = PhonePush.current

    var allowed by remember { mutableStateOf(NotificationPermission.state(context)) }
    var off by remember { mutableStateOf<Set<String>>(emptySet()) }
    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val registering by push.registering.collectAsStateWithLifecycle()
    val registrationError by push.registrationError.collectAsStateWithLifecycle()
    val linked by push.registeredOnServer.collectAsStateWithLifecycle()
    val deviceTheme by ThemeChoice.device.collectAsStateWithLifecycle()

    var widgetLinked by remember { mutableStateOf(runCatching { WidgetLinker.isLinked() }.getOrDefault(false)) }
    var linking by remember { mutableStateOf(false) }
    var linkFailed by remember { mutableStateOf(false) }

    var lockOn by rememberSaveable { mutableStateOf(AppLock.enabled) }
    val canLock = remember { runCatching { AppLock.available(context) }.getOrDefault(false) }
    val canFace = remember { runCatching { BiometricVault.biometry().first }.getOrDefault(false) }
    var codeKept by remember { mutableStateOf(runCatching { BiometricVault.has(DeleteCode.FACE_KEY) }.getOrDefault(false)) }

    // Coming back to the app re-reads quietly: the switches stay up while asking, and only a decided answer changes them
    // (a failed read keeps what was shown, with the error).
    suspend fun refresh() {
        allowed = NotificationPermission.state(context)
        if (allowed == NotificationAccess.Allowed) {
            try {
                off = push.kindsOff().toSet()
                loaded = true
                error = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            }
        } else {
            loaded = false
            error = null
        }
    }
    LaunchedEffect(Unit) { refresh() }
    LaunchedEffect(linked) { if (linked) refresh() }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { scope.launch { refresh() } }

    fun register() {
        scope.launch {
            if (allowed == NotificationAccess.NotAsked && !NotificationPermission.request()) { refresh(); return@launch }
            push.register()
            refresh()
        }
    }

    fun save(next: Set<String>) {
        val before = off
        off = next
        saving = true
        error = null
        scope.launch {
            try {
                push.setKindsOff(next.sorted())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                off = before
                error = e.message ?: e.toString()
            }
            saving = false
        }
    }

    SettingsPage {
        SettingsSectionWith("Notifications on this phone", { Text("The shop's WhatsApp alerts are set in the ERP's Settings → Alerts.") }) {
            when (allowed) {
                NotificationAccess.Denied -> {
                    StatusRow("Notifications are off for this app", Icons.Filled.NotificationsOff)
                    ActionRow("Open Settings", onClick = { NotificationPermission.openSettings(context) })
                }
                NotificationAccess.NotAsked -> ActionRow("Turn on notifications", onClick = { register() })
                NotificationAccess.Allowed -> {
                    if (!loaded) {
                        StatusRow(if (registering) "Registering this phone…" else "Phone not linked", Icons.Filled.NotificationsActive)
                        ActionRow("Register again", onClick = { register() }, enabled = !registering)
                    } else {
                        StatusRow("This phone is linked", Icons.Filled.CheckCircle)
                        PhoneLogic.kinds.forEach { k ->
                            ToggleRow(k.title, !off.contains(k.id), { on -> if (!saving) save(PhoneLogic.toggled(off, k.id, on)) }, sub = k.detail)
                        }
                        ActionRow(
                            if (testing) "Sending…" else "Send a test notification",
                            onClick = {
                                scope.launch {
                                    testing = true; testResult = null; error = null
                                    try {
                                        push.sendTest()
                                        testResult = "The push service accepted the test. Check this phone's notifications."
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        error = e.message ?: e.toString()
                                    }
                                    testing = false
                                }
                            },
                            enabled = !testing && !saving,
                        )
                        testResult?.let { SmallPrint(it, modifier = Modifier.fillMaxWidth().ledgerRow()) }
                    }
                }
            }
            registrationError?.let { SmallPrint(it, Tone.problem, Modifier.fillMaxWidth().ledgerRow()) }
        }
        error?.let { SettingsSection { ErrorRow(it) } }

        SettingsSection("Appearance", "The theme for this phone. If not chosen, it follows the shop's appearance in the ERP.") {
            PickerRow(
                "Appearance", deviceTheme,
                listOf("" to "Follow the shop", "default" to "Light", "taheri" to "Dark"),
            ) { ThemeChoice.setDevice(it) }
        }

        SettingsSection(
            footer = if (canLock) "Asks for your fingerprint, face or the phone's screen lock when the app is opened after a minute away. The recent apps screen never shows the books."
            else "Set a screen lock on this phone to lock the app.",
        ) {
            Column(Modifier.alpha(if (canLock) 1f else 0.5f)) {
                ToggleRow("Lock with fingerprint or screen lock", lockOn && canLock, { on -> if (canLock) { lockOn = on; AppLock.enabled = on } })
            }
        }

        // The delete code kept behind the fingerprint (the shell's BiometricVault): the iPhone's Face ID offer is made in the
        // delete sheet itself; this is where it is taken back.
        if (canFace) {
            SettingsSection("Delete code", "Offered once after a delete asks for the code. The ERP still checks the code every time.") {
                ValueRow("Delete code") { ReadOnly(if (codeKept) "Kept behind your fingerprint" else "Not kept on this phone") }
                if (codeKept) {
                    ActionRow("Forget the saved delete code", onClick = {
                        runCatching { BiometricVault.delete(DeleteCode.FACE_KEY) }
                        codeKept = false
                    }, tone = Tone.problem)
                }
            }
        }

        SettingsSection(footer = "Add it from the home screen: touch and hold, then Widgets → ${erp.app.config.House.storeName}.") {
            ValueRow("Home-screen widget") { ReadOnly(if (widgetLinked) "Linked" else "Not linked") }
            SettingsNavRow("Preview widgets", Icons.Filled.Widgets, "/app/widgets")
            ActionRow(
                if (linking) "Linking…" else if (widgetLinked) "Link again" else "Link the widget",
                onClick = {
                    scope.launch {
                        linking = true
                        linkFailed = !WidgetLinker.link(force = true)
                        widgetLinked = WidgetLinker.isLinked()
                        linking = false
                    }
                },
                enabled = !linking,
            )
            if (linkFailed) {
                SmallPrint("Couldn't reach the ERP to link the widget. The widget keeps its current link.", modifier = Modifier.fillMaxWidth().ledgerRow())
            }
        }
    }
}

@Composable
private fun StatusRow(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}
