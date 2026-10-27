package erp.app.screens.neworder

import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.ui.NotAvailableState
import erp.app.ui.SkeletonLoading
import erp.app.ui.TwoLine
import erp.core.entry.SaleLookup
import erp.core.models.Product

// "Add from stock" (order-form.tsx's inventory dialog): a piece in stock as the start of an order piece, its category,
// metal, weights, charges and details copied and its SKU kept as the reference, so a copy of a piece in the case is
// ordered in a tap. Found as the sale finds stock (SaleLookup). (NewOrderStockPicker.swift.)

/** The pieces on offer for what is typed: the first forty in stock before anything is, else the sale's own search. */
internal fun stockFound(query: String, products: List<Product>): List<Product> {
    val q = query.trim(' ', '\t')
    return if (q.isEmpty()) products.take(40) else SaleLookup.matches(q, products, emptySet(), limit = 40)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StockPickerSheet(onPick: (Product) -> Unit, onDismiss: () -> Unit) {
    val book = LocalBook.current
    val status = rememberShelfStatus(book.products)
    var query by remember { mutableStateOf("") }
    val found = remember(status.revision, query) { stockFound(query, status.items) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Add from stock", style = MaterialTheme.typography.titleLarge)
            SearchBarField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("SKU or name") },
                leadingIcon = { Icon(Symbols.Search, null) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
            )
            Box(Modifier.fillMaxWidth().heightIn(min = 240.dp, max = 520.dp)) {
                if (!status.loaded) {
                    SkeletonLoading()
                } else if (found.isEmpty()) {
                    NotAvailableState("No results", why = "Nothing in stock matches “${query.trim()}”.", icon = Symbols.Search)
                } else {
                    LazyColumn {
                        items(found, key = { it.sku }) { p ->
                            Box(Modifier.animateItem().fillMaxWidth().clickable(role = Role.Button) { onPick(p); onDismiss() }.padding(vertical = 6.dp)) {
                                TwoLine(title = p.name, subtitle = p.sku)
                            }
                        }
                    }
                }
            }
            TextButton(onClick = onDismiss, Modifier.padding(bottom = 12.dp)) { Text("Cancel") }
        }
    }
}
