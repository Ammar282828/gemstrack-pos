package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Businesses
import erp.app.config.UpdateGate

/** Whether this build is out of date for the open business, for a Save that must shut (`UpdateGate.blocked`, read live). */
@Composable
fun rememberUpdateBlocked(): Boolean {
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    return UpdateGate.blocked(business)
}

/**
 * One quiet line, nothing when the app is current (UpdateBanner in UpdateGate.swift). Read from the open business as a
 * flow, so a switch to one with another floor shows at once.
 */
@Composable
fun UpdateBanner(modifier: Modifier = Modifier) {
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    if (UpdateGate.blocked(business)) UpdateNotice(modifier)
}

/** The line itself, apart from whether it is due (the screenshots draw it as it reads). */
@Composable
internal fun UpdateNotice(modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Symbols.ArrowCircleDown, null, Modifier.size(18.dp), tint = Tone.owed.color())
            Text(UpdateGate.words, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = Tone.owed.color())
        }
    }
}
