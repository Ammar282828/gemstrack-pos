package erp.app.screens.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.screens.workshop.workshopLive
import erp.app.ui.AlertDialog
import erp.app.ui.Button
import erp.app.ui.LedgerDivider
import erp.app.ui.Note
import erp.app.ui.LocalNoteState
import erp.app.ui.SegmentedColumn
import erp.app.ui.TextButton
import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.models.Order
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Send to karigar (the order page's ⋯ menu; the iPhone's SendToKarigarSheet): an order's pieces to a karigar on WhatsApp
 * from the shop's line, through `/api/app/orders/send-to-karigar`. The photos go first, then the details: description,
 * weight, wastage in grams, size, stones, the instructions and the due date. Never a price, and the customer only by
 * first name. The words are the route's own (`preview: true`), so they are shown, not rebuilt. Not a money op, so it is
 * sent straight, not through `/api/app/write`.
 */
@Composable
fun SendToKarigarSheet(order: Order, onDismiss: () -> Unit, pieces: List<Int>? = null, karigarId: String? = null) {
    val book = LocalBook.current
    val karigars = workshopLive(rememberShelf(book.karigars).value)
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()

    var chosen by remember { mutableStateOf(SendToKarigarLogic.firstKarigar(order.items, karigarId, pieces)) }
    var ticked by remember { mutableStateOf(SendToKarigarLogic.initialPieces(order.items, chosen, pieces)) }
    var phone by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var photoCount by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }

    val karigar = karigars.firstOrNull { it.id == chosen }
    val onFile = karigar?.contact?.trim().orEmpty().ifEmpty { karigar?.altPhone?.trim().orEmpty() }
    val numberOK = SendToKarigarLogic.numberOK(phone.ifEmpty { onFile })

    // The words for what is chosen, a quarter second after the last tick (the route reads the order and the karigar's name).
    LaunchedEffect(chosen, ticked) {
        if (chosen.isEmpty() || ticked.isEmpty()) { text = ""; photoCount = 0; return@LaunchedEffect }
        delay(250)
        try {
            val out = ErpApi.shared.send(SendToKarigarLogic.PATH, body = SendToKarigarLogic.body(order.id, chosen, ticked, phone, preview = true))
            val p = SendToKarigarLogic.preview(out)
            text = p.text; photoCount = p.photos
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The words are a convenience: Send still works and the route says what is wrong.
        }
    }

    OrdersSheet(
        title = "Send to karigar",
        onDismiss = onDismiss,
        locked = busy,
        bottom = { close ->
            Button(
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            // Photos go one by one from the server's line: a long order takes a while.
                            val out = ErpApi.shared.send(SendToKarigarLogic.PATH, body = SendToKarigarLogic.body(order.id, chosen, ticked, phone, preview = false), timeoutMs = 180_000)
                            note.show(Note("Sent to ${karigar?.name ?: "the karigar"}", SendToKarigarLogic.sentDetail(out)))
                            busy = false
                            close()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            busy = false
                            failure = ordersSay(e)
                        }
                    }
                },
                enabled = !busy && chosen.isNotEmpty() && ticked.isNotEmpty() && numberOK,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
            ) {
                Icon(Symbols.Send, null, Modifier.size(18.dp))
                Text(if (busy) "Sending…" else "Send on WhatsApp", Modifier.padding(start = 8.dp))
            }
        },
    ) {
        OrdersFormSection(
            title = "Send to",
            footer = if (chosen.isNotEmpty() && onFile.isEmpty() && phone.isEmpty()) "No number on file for ${karigar?.name ?: "him"}. Add one here or on his profile." else null,
        ) {
            Box {
                Row(
                    Modifier.fillMaxWidth().clickable { picking = true }.ledgerRow(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Karigar", Modifier.weight(1f))
                    Text(karigar?.name ?: "Pick a karigar", color = MaterialTheme.colorScheme.primary)
                    Icon(Symbols.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = picking, onDismissRequest = { picking = false }) {
                    for (k in karigars) {
                        DropdownMenuItem(text = { Text(k.name) }, onClick = {
                            picking = false
                            if (k.id != chosen) {
                                chosen = k.id
                                phone = ""
                                // Asked-for pieces stay; otherwise his pieces, else all.
                                if (pieces.isNullOrEmpty()) ticked = SendToKarigarLogic.initialPieces(order.items, k.id, null)
                            }
                        })
                    }
                }
            }
            if (chosen.isNotEmpty()) {
                if (onFile.isEmpty() || phone.isNotEmpty()) {
                    TextField(
                        phone, { phone = it }, Modifier.fillMaxWidth(), singleLine = true,
                        label = { Text("WhatsApp number") }, placeholder = { Text("0300 1234567") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    )
                } else {
                    Row(Modifier.fillMaxWidth()) {
                        Text("Number", Modifier.weight(1f))
                        Text(onFile, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        OrdersFormSection(title = "Pieces", footer = SendToKarigarLogic.photosNote(photoCount)) {
            SegmentedColumn {
                for (i in order.items.indices) {
                    val item = order.items[i]
                    val on = i in ticked
                    Row(
                        Modifier.fillMaxWidth().clickable { ticked = if (on) ticked - i else ticked + i }.ledgerRow(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(on, { ticked = if (it) ticked + i else ticked - i })
                        Column(Modifier.weight(1f)) {
                            Text("${i + 1}. " + SendToKarigarLogic.pieceTitle(item))
                            if (chosen.isNotEmpty() && item.karigarId == chosen) {
                                Text("Assigned to him", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (i < order.items.lastIndex) LedgerDivider()
                }
            }
        }
        if (text.isNotEmpty()) {
            OrdersFormSection(title = "The message") {
                SelectionContainer { Text(text, style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }

    failure?.let { why ->
        AlertDialog(onDismissRequest = { failure = null }, title = { Text("Not sent") }, text = { Text(why) },
            confirmButton = { TextButton(onClick = { failure = null }) { Text("OK") } })
    }
}
