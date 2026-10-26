package erp.app.screens.neworder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.ui.MinTouchTarget
import erp.app.ui.rememberHaptics
import erp.app.ui.Tone
import erp.app.ui.color
import erp.core.entry.NewOrderSizeSuggestion
import erp.core.entry.NewOrderSizes
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// "Save to <name>'s profile?" (order-form.tsx's size dialog, decisions.md "Sizes to the profile"): asked once, after
// the order is saved, for the sizes on its pieces that the customer's profile doesn't hold or holds differently. What
// is ticked is written with `setCustomerSizes`, which the browser's profile edit does too. (NewOrderSizeAsk.swift.)

/** What is being asked: the customer, and the sizes on offer. */
class NewOrderSizeAsk(val customerId: String, val name: String, val rows: List<NewOrderSizeSuggestion>) {
    val id: UUID = UUID.randomUUID()
}

internal fun sizeWords(row: NewOrderSizeSuggestion): String =
    row.current?.let { "The profile says $it: this replaces it." } ?: "Not in the profile yet."

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SizeAskSheet(ask: NewOrderSizeAsk, onDismiss: () -> Unit) {
    var chosen by remember { mutableStateOf(ask.rows.map { it.id }.toSet()) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !saving })

    // Not money: the sheet closes at once and the Outbox carries the sizes.
    val haptics = rememberHaptics()
    fun save() {
        val picked = ask.rows.filter { chosen.contains(it.id) }
        ErpApi.shared.enqueue("setCustomerSizes", NewOrderSizes.request(ask.customerId, picked), "Customer sizes")
        haptics.success()
        onDismiss()
    }

    ModalBottomSheet(onDismissRequest = { if (!saving) onDismiss() }, sheetState = state) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Save to ${ask.name}'s profile?", style = MaterialTheme.typography.titleLarge)
            FormCard(footer = "So the size is there next time, on any order or sale for them.") {
                ask.rows.forEach { row ->
                    val on = chosen.contains(row.id)
                    Row(
                        Modifier.fillMaxWidth().formRow().defaultMinSize(minHeight = MinTouchTarget)
                            .toggleable(value = on, role = Role.Checkbox) { now -> chosen = if (now) chosen + row.id else chosen - row.id },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Checkbox(checked = on, onCheckedChange = null)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("${row.field.label}: ${row.value}")
                            Text(sizeWords(row), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            failure?.let { Text(it, color = Tone.problem.color()) }
            Row(
                Modifier.fillMaxWidth().padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onDismiss, enabled = !saving) { Text("Not now") }
                Button(onClick = ::save, enabled = chosen.isNotEmpty() && !saving, modifier = Modifier.weight(1f).defaultMinSize(minHeight = MinTouchTarget)) {
                    Text("Save to profile")
                }
            }
        }
    }
}
