package erp.app.screens.customers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.screens.invoices.InvoiceDeleteCodeSheet
import erp.app.screens.invoices.InvoiceDeletion
import erp.app.ui.isLargeText
import erp.app.ui.ledgerRow

/** How a phone number is opened: the phone's own apps do the rest, and nothing is asked. */
object CustomerLinks {
    fun open(context: Context, action: String, uri: String?) {
        if (uri == null) return
        val intent = Intent(action, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No app handles it: the button simply opens nothing.
        }
    }

    fun call(context: Context, phone: String?) = open(context, Intent.ACTION_DIAL, CustomerKit.callUri(phone))
    fun whatsApp(context: Context, phone: String?) = open(context, Intent.ACTION_VIEW, CustomerKit.whatsAppUri(phone))
    fun message(context: Context, phone: String?) = open(context, Intent.ACTION_SENDTO, CustomerKit.messageUri(phone))
}

/**
 * One delete waiting for its code (the Owner group's `OwnerDeletion`). The sheet is the Invoices group's, which asks
 * the very same question of the ERP; this is the one place the Customers group names it.
 */
// TODO(shared): replace with the shared delete-code sheet when merged.
typealias CustomerDeletion = InvoiceDeletion

@Composable
fun CustomerDeleteCodeSheet(deletion: CustomerDeletion, onDismiss: () -> Unit, onDone: () -> Unit = {}) =
    InvoiceDeleteCodeSheet(deletion, onDismiss = onDismiss, onDone = onDone)

/** A label and what it says, the value wrapping at the right (SwiftUI's `LabeledContent`). */
@Composable
fun DetailRow(label: String, value: String, modifier: Modifier = Modifier) {
    if (isLargeText()) {
        Column(modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    } else {
        Row(
            modifier.fillMaxWidth().ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Text(label, Modifier.weight(0.4f), style = MaterialTheme.typography.bodyLarge)
            Text(
                value, Modifier.weight(0.6f), style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End,
            )
        }
    }
}

/** A fold with a title (SwiftUI's `DisclosureGroup`): closed until it is touched. */
@Composable
fun Disclosure(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(false) }
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Icon(
                Icons.Filled.ExpandMore, contentDescription = null,
                Modifier.rotate(if (open) 0f else -90f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AnimatedVisibility(open) { Column(Modifier.padding(top = 4.dp)) { content() } }
    }
}
