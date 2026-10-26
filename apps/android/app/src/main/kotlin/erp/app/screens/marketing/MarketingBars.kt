package erp.app.screens.marketing

import erp.app.ui.Loading
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors

// The pinned action of a page (the iPhone's `ActionBar`, `safeAreaBar(edge: .bottom)`): the page's one action, always
// in reach, with what it will do said under it.

/**
 * A page and its bar: the content scrolls above, the bar stays under it with a hairline between. [bar] is null where
 * there is nothing to do (no bar at all, not a disabled one).
 */
@Composable
fun MarketingPinned(bar: (@Composable () -> Unit)?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
        if (bar != null) {
            HorizontalDivider(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f))
            Column(Modifier.fillMaxWidth().background(ErpColors.ground).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { bar() }
        }
    }
}

/** The bar's filled button in the house's accent, a spinner while it works, and a line under it when there is something to say. */
@Composable
fun MarketingActionBar(title: String, icon: ImageVector, onClick: () -> Unit, busy: Boolean = false, enabled: Boolean = true, summary: String? = null) {
    Button(
        onClick = onClick, enabled = enabled && !busy,
        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
    ) {
        if (busy) Loading(Modifier.size(26.dp), color = ErpColors.onAccent)
        else Icon(icon, null, Modifier.size(18.dp))
        Text(title, Modifier.padding(start = 8.dp))
    }
    if (!summary.isNullOrEmpty()) {
        Text(summary, Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}
