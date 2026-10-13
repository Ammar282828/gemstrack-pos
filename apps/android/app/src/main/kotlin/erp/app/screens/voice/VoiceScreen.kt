package erp.app.screens.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ErpApp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.nav.AppRouter
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.neworder.NewOrderPhoneStore
import erp.app.screens.sale.SaleStore
import erp.app.screens.settings.SettingsPage
import erp.app.screens.settings.SettingsSection
import erp.app.ui.ActionRow
import erp.app.ui.FieldRow
import erp.app.ui.MoneyFeedback
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.SkeletonLoading
import erp.app.ui.SmallPrint
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Voice (NativeVoiceScreen): "Talk to the book". A sheet over the tabs, owners only. Speech only prepares a reading of
 * what was said (/api/voice/native); a change is saved only when the person confirms it, through the ERP's own write route.
 * The page the ERP chose opens after this sheet has closed.
 */
@Composable
fun VoiceScreen(model: VoiceModel? = null) {
    ScreenTitle("Voice")
    if (!LocalSession.current.isOwner) {
        NotAvailableState("Voice is for the owners", why = "The assistant reads the whole book, which only an owner’s sign-in may do.")
        return
    }
    val context = LocalContext.current
    val voice = remember(model) { model ?: VoiceModel(context, ErpApp.scope) }
    DisposableEffect(voice) { onDispose { voice.close() } }

    val book = LocalBook.current
    LaunchedEffect(book) { book.customers.need(); book.products.need(); book.settings.need() }
    val customersLoaded by book.customers.loaded.collectAsStateWithLifecycle()
    val productsLoaded by book.products.loaded.collectAsStateWithLifecycle()
    val settingsLoaded by book.settings.loaded.collectAsStateWithLifecycle()
    val formsReady = customersLoaded && productsLoaded && settingsLoaded
    val person = LocalSession.current.shop.person

    var language by rememberSaveable { mutableStateOf("en-PK") }
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    // Two sheets in one update can drop the second: this one closes, and the page the ERP chose opens after it.
    fun open(path: String) {
        scope.launch {
            navigator.back()
            delay(300)
            AppRouter.open(path)
        }
    }

    fun fill(card: VoiceCard, path: String) {
        try {
            val payload = VoiceHandoff.payload(card.handoff)
            when (VoiceHandoff.kind(card.handoff)) {
                "order" -> NewOrderPhoneStore.save(
                    VoiceHandoff.order(payload, { book.customers.item(it) }, book.settings.value.value, person, House.metal, NewOrderPhoneStore.load()),
                )
                "sale" -> SaleStore.save(
                    VoiceHandoff.sale(
                        payload, book.customers.items.value, { book.customers.item(it) }, book.products.items.value,
                        person, House.metal, SaleStore.load(),
                    ),
                )
                else -> throw VoiceHandoff.Failure("Open the native form and enter the details shown above.")
            }
            open(path)
        } catch (e: Exception) {
            voice.failure = e.message ?: e.toString()
        }
    }

    MoneyFeedback(success = voice.completed, failure = voice.failure)

    SettingsPage {
        SettingsSection {
            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                MicButton(listening = voice.listening, enabled = !voice.busy) { if (voice.listening) voice.finish() else voice.start(language) }
                Text(if (voice.listening) "Listening… tap stop when done" else "Talk to the book", style = MaterialTheme.typography.titleMedium)
                if (voice.listening) {
                    LevelBars(voice.level)
                } else {
                    Text(
                        "Ask a question, record a payment, or open a page.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }
            if (!voice.listening && !voice.busy) {
                PickerRow("Live words", language, VoiceLogic.languages) { language = it }
            } else {
                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Live words", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(VoiceLogic.languages.first { it.first == language }.second, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            ToggleRow("Read answers aloud", voice.readAloud, { on -> voice.readAloud = on; if (!on) voice.silence() })
        }

        val editable = !(voice.listening || voice.busy || voice.completed > 0)
        SettingsSection("Your words", footer = "Check the reading below before saving. Recording stops after one minute.") {
            FieldRow(
                "Or type what you need…", voice.words, { voice.words = it }, enabled = editable,
                singleLine = false, minLines = 3, maxLines = 8,
            )
            ActionRow(
                if (voice.plan == null) "Review" else "Read again",
                onClick = { voice.readText(voice.readAloud) },
                icon = Icons.Filled.Refresh,
                enabled = VoiceLogic.canRead(voice.words) && editable,
            )
        }

        if (voice.busy) {
            SettingsSection {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    SkeletonLoading(compact = true)
                    Text(if (voice.writing) "Saving…" else "Reading…")
                }
            }
        }
        voice.failure?.let { error ->
            SettingsSection { SmallPrint(error, Tone.problem, Modifier.fillMaxWidth().ledgerRow()) }
        }

        voice.plan?.let { plan ->
            plan.answer?.let { answer ->
                SettingsSection("Answer") {
                    Text(answer, Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodyLarge)
                    plan.href?.let { path -> ActionRow("Open page", onClick = { open(path) }, icon = Icons.AutoMirrored.Filled.ArrowForward) }
                }
            }
            plan.cards.forEach { card ->
                SettingsSection(VoiceLogic.heading(card.title)) {
                    Text(card.summary, Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodyLarge)
                    card.problem?.let { SmallPrint(it, Tone.owed, Modifier.fillMaxWidth().ledgerRow()) }
                    val path = card.href
                    if (card.operations.isEmpty() && path != null) {
                        ActionRow(
                            if (card.handoff == null) "Open record" else "Fill the form",
                            onClick = { if (card.handoff == null) open(path) else fill(card, path) },
                            icon = Icons.AutoMirrored.Filled.ArrowForward,
                            enabled = !voice.busy && formsReady,
                        )
                    }
                }
            }
            if (plan.operations.isNotEmpty()) {
                val words = voice.words
                SettingsSection(
                    footer = when {
                        !plan.ready -> "Resolve every step before saving, or change the sentence and read it again."
                        words != plan.reviewedWords -> "Your words changed. Read them again before saving."
                        else -> null
                    },
                ) {
                    if (voice.completed == plan.operations.size) {
                        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.CheckCircle, null, tint = Tone.settled.color())
                            Text("Saved", color = Tone.settled.color(), style = MaterialTheme.typography.bodyLarge)
                        }
                        plan.cards.lastOrNull()?.href?.let { path -> ActionRow("Open record", onClick = { open(path) }) }
                        ActionRow("Another request", onClick = { voice.reset() })
                    } else {
                        ActionRow(
                            if (voice.completed > 0) "Save remaining changes" else "Confirm and save",
                            onClick = { voice.save() },
                            icon = Icons.Filled.Check,
                            enabled = !voice.busy && plan.ready && words == plan.reviewedWords,
                        )
                        if (voice.completed > 0) {
                            SmallPrint("${voice.completed} of ${plan.operations.size} changes saved.", modifier = Modifier.fillMaxWidth().ledgerRow())
                        }
                    }
                }
            }
        }
    }
}

/** The 72 dp round button: a microphone to start, a square to stop (`Image(systemName: mic.fill / stop.fill)`). */
@Composable
private fun MicButton(listening: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val label = if (listening) "Stop and review" else "Start recording"
    Box(
        Modifier.size(72.dp).clip(CircleShape).background(if (enabled) ErpColors.accent else ErpColors.accent.copy(alpha = 0.4f))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(if (listening) Icons.Filled.Stop else Icons.Filled.Mic, null, Modifier.size(32.dp), tint = ErpColors.onAccent)
    }
}

/** Fifteen capsules that rise with the voice (the iPhone's `ForEach(0..<15)`). */
@Composable
private fun LevelBars(level: Float) {
    Row(Modifier.height(42.dp).semantics { contentDescription = "" }, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        for (n in 0 until 15) {
            Box(
                Modifier.width(4.dp).height((6 + level * (8 + (n * 7) % 29)).dp)
                    .clip(RoundedCornerShape(2.dp)).background(ErpColors.accent),
            )
        }
    }
}
