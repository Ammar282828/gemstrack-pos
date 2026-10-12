package erp.app.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors

// MARK: Reaching the customer

/**
 * Call, WhatsApp and Message for a number, as the round buttons under a contact's name in Contacts.
 * Nothing is shown without a number. The phone's own apps do the rest: no permission is asked.
 */
@Composable
fun ContactActions(phone: String?, modifier: Modifier = Modifier) {
    val raw = (phone ?: "").trim()
    val digits = raw.filter { it.isDigit() || it == '+' }
    if (digits.isEmpty()) return
    val context = LocalContext.current
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickAction("Call", Icons.Filled.Call, { open(context, Intent.ACTION_DIAL, "tel:$digits") }, Modifier.weight(1f))
        QuickAction("WhatsApp", Icons.Filled.Chat, {
            val wa = toWhatsAppNumber(raw)
            open(context, Intent.ACTION_VIEW, "https://wa.me/" + wa.ifEmpty { digits.filter { it.isDigit() } })
        }, Modifier.weight(1f))
        QuickAction("Message", Icons.Filled.Sms, { open(context, Intent.ACTION_SENDTO, "smsto:$digits") }, Modifier.weight(1f))
    }
}

private fun open(context: Context, action: String, uri: String) {
    val intent = Intent(action, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No app on the phone handles it: nothing to say, the button simply did not open anything.
    }
}

/** A round action with its word under it: the detail pages' row of what can be done at once. */
@Composable
fun QuickAction(
    title: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    prominent: Boolean = false,
) {
    val accent = ErpColors.accent
    Column(
        modifier
            .clip(Radius.chipShape)
            .clickable(role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = MinTouchTarget)
                .clip(Radius.chipShape)
                .background(if (prominent) accent else accent.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = if (prominent) ErpColors.onAccent else accent)
        }
        Text(
            title,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = if (prominent) accent else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

// MARK: The signed-in person's own

/**
 * "You", beside a row taken by whoever is signed in (decision "Signed-in defaults": lit in place, never
 * sorted or filtered). It replaces the tinted row and its bar.
 */
@Composable
fun MineTag(modifier: Modifier = Modifier) {
    val accent = ErpColors.accent
    Text(
        "You",
        modifier
            .border(1.dp, accent.copy(alpha = 0.5f), CircleShape)
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .clearAndSetSemantics { contentDescription = "Taken by you" },
        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
        color = accent,
    )
}

/**
 * A list row on the house's card colour, lit when it is the signed-in person's own: a short bar of the
 * house's accent at its leading edge, the row left in its place (src/lib/utils.ts `mineRowClass`; the owner,
 * 2026-10-05). The whole row tinted made a day's card look like a warning.
 */
@Composable
fun Modifier.mineRow(mine: Boolean): Modifier {
    val card = ErpColors.card
    val accent = ErpColors.accent
    return background(card).drawBehind {
        if (mine) {
            val inset = 10.dp.toPx()
            drawRoundRect(
                accent, Offset(0f, inset), Size(3.dp.toPx(), size.height - 2 * inset),
                CornerRadius(1.5.dp.toPx()),
            )
        }
    }
}
