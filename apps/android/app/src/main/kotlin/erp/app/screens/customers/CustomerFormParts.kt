package erp.app.screens.customers

import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.screens.neworder.QuietField
import erp.app.screens.neworder.formRow
import erp.app.ui.LedgerHeading
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors

// The form pieces the customer and stock forms share. The rows (QuietField, formRow) are the New order form's; the
// card around them is the same one.
// TODO(shared): replace with the kit's form rows when merged.

/**
 * A titled card of form rows with a footnote under it (the form's `Section`); [footerTone] colours a footnote that
 * is a refusal ("That doesn't look like an email address.").
 */
@Composable
fun FormSection(
    modifier: Modifier = Modifier,
    title: String? = null,
    footer: String? = null,
    footerTone: Tone = Tone.quiet,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) LedgerHeading(title, Modifier.padding(horizontal = 16.dp))
        SegmentedColumn(content = content)
        if (!footer.isNullOrEmpty()) {
            Text(
                footer, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall,
                color = if (footerTone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else footerTone.color(),
            )
        }
    }
}

/** A text box across the row with only its prompt for a label, as the iPhone's `TextField("Full name", prompt: …)`. */
@Composable
fun TextRow(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    prompt: String = "Optional",
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    autoCorrect: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = 1,
) {
    Column(Modifier.fillMaxWidth().formRow()) {
        QuietField(
            value, onChange, Modifier.fillMaxWidth(), placeholder = prompt, keyboardType = keyboardType,
            capitalization = capitalization, autoCorrect = autoCorrect, singleLine = maxLines == 1, minLines = minLines,
            maxLines = maxLines, label = label,
        )
    }
}

/** What a saved form says: a tick, "Saved", and what is on file (AddCustomer.swift `savedPage`). */
@Composable
fun SavedHeader(detail: String, modifier: Modifier = Modifier, title: String = "Saved") {
    Column(
        modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Symbols.CheckCircle, contentDescription = null, Modifier.size(48.dp), tint = Tone.settled.color())
        Text(title, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold))
        Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}
