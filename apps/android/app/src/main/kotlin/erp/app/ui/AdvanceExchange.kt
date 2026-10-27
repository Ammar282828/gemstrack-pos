package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.ExchangeRow
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.Money
import erp.core.logic.applyExchangeRowChange
import erp.core.logic.blankExchangeRow
import erp.core.logic.exchangeRowsTotal

/**
 * The advance sheet's "Exchanged gold" (the iPhone's `OrderAdvanceExchange`): the New order exchange line (what it is +
 * the amount; karat, grams and rate fold away and fill the amount until someone types their own, core's
 * `applyExchangeRowChange`), for a sheet that holds plain rows rather than a draft (components/shared/exchange-rows.tsx
 * in RecordAdvanceDialog).
 */
@Composable
fun AdvanceExchange(rows: List<ExchangeRow>, onRows: (List<ExchangeRow>) -> Unit, modifier: Modifier = Modifier) {
    var opened by remember { mutableStateOf(setOf<String>()) }
    val total = exchangeRowsTotal(rows)

    fun patch(id: String, p: ExchangeRowPatch) = onRows(rows.map { if (it.id == id) applyExchangeRowChange(it, p) else it })
    fun remove(id: String) = onRows(if (rows.size > 1) rows.filter { it.id != id } else listOf(blankExchangeRow()))

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Exchanged gold", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        rows.forEach { row ->
            val showDetails = row.id in opened || row.karat.isNotEmpty() || row.weightG.isNotEmpty() || row.ratePerGram.isNotEmpty()
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextField(
                        value = row.description,
                        onValueChange = { patch(row.id, ExchangeRowPatch(description = it)) },
                        modifier = Modifier.weight(1f),
                        label = { Text("What it is") },
                        placeholder = { Text("e.g. old ring") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    )
                    TextField(
                        value = PaymentText.whole(row.value),
                        onValueChange = { patch(row.id, ExchangeRowPatch(value = PaymentText.whole(it))) },
                        modifier = Modifier.width(120.dp),
                        label = { Text("Amount") },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits, textAlign = TextAlign.End),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    IconButton(onClick = { remove(row.id) }, Modifier.defaultMinSize(48.dp, 48.dp)) {
                        Icon(Symbols.Close, "Remove this exchange", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (showDetails) {
                    val computed = !row.valueTyped && erp.core.entry.NewOrderFormat.num(row.weightG) > 0 && erp.core.entry.NewOrderFormat.num(row.ratePerGram) > 0
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Karat only means something where the house sells gold; a silver house weighs without it.
                        if (House.metal == "gold") {
                            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                listOf("22k", "24k", "21k", "18k").forEach { k ->
                                    FilterChip(k, chosen = row.karat == k, onClick = { patch(row.id, ExchangeRowPatch(karat = if (row.karat == k) "" else k)) })
                                }
                            }
                        }
                        TextField(
                            value = row.weightG,
                            onValueChange = { patch(row.id, ExchangeRowPatch(weightG = it)) },
                            modifier = Modifier.weight(1f),
                            label = { Text("Grams") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        )
                        TextField(
                            value = row.ratePerGram,
                            onValueChange = { patch(row.id, ExchangeRowPatch(ratePerGram = it)) },
                            modifier = Modifier.weight(1f),
                            label = { Text("Rate / g") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        )
                    }
                    if (computed) {
                        Text("Amount = grams × rate: type an amount to change it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    TextButton(onClick = { opened = opened + row.id }) { Text("+ Weight & rate", color = ErpColors.accent) }
                }
            }
        }
        TextButton(onClick = { onRows(rows + blankExchangeRow()) }) { Text("+ Add another exchange", color = ErpColors.accent) }
        if (rows.size > 1 && total > 0) {
            Row(Modifier.fillMaxWidth()) {
                Text("Exchange total", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(Money.pkr(total), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits))
            }
        }
        Text(
            "Gold handed over now comes off the balance, and goes to the invoice with the order.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
