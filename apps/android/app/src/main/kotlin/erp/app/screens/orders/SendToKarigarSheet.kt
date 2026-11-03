package erp.app.screens.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.screens.workshop.workshopLive
import erp.app.ui.Button
import erp.app.ui.ContactPickButton
import erp.app.ui.PickerRow
import erp.app.ui.TextButton
import erp.app.ui.TextField
import erp.app.ui.ToggleRow
import erp.app.ui.icons.Symbols
import erp.app.ui.toWhatsAppNumber
import erp.core.models.Order
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** An order's piece asked to be sent (the Workshop's): the order as the shelf holds it, the piece, its karigar. */
class SendPieceAsk(val order: Order, val index: Int, val karigarId: String?)

/**
 * Send to karigar (the order page's Share section, the Workshop's piece menu): an order's pieces to a karigar on WhatsApp from the shop's
 * line (SendToKarigarSheet.swift; the words are the ERP's, src/lib/karigar-message.ts). The photos go first, then the details: description,
 * weight, wastage in grams, size, stones, the instructions and the due date. Never a price, and the customer only by first name.
 *
 * Each ticked piece's words are in a box under its switch, filled from the server's builder (Reset puts the generated words back); only the
 * edited ones go in the request (`texts`). Send closes the sheet at once and the send runs in the background ([KarigarSendQueue]), its
 * result said app-wide with Retry.
 */
@Composable
fun SendToKarigarSheet(order: Order, onDismiss: () -> Unit, pieces: List<Int>? = null, karigarId: String? = null) {
    val book = LocalBook.current
    val karigars = workshopLive(rememberShelf(book.karigars).value)
    var chosen by remember { mutableStateOf(KarigarSendLogic.firstKarigar(order, karigarId, pieces)) }
    var ticked by remember { mutableStateOf(KarigarSendLogic.initialPieces(order, pieces, chosen)) }
    var phone by remember { mutableStateOf("") }
    // What the server would send per piece, and the owner's edits over it (by piece index).
    val generated = remember { mutableStateMapOf<Int, String>() }
    val edits = remember { mutableStateMapOf<Int, String>() }
    var photoCount by remember { mutableStateOf(0) }

    val karigar = karigars.firstOrNull { it.id == chosen }
    val onFile = KarigarSendLogic.onFile(karigar)
    val number = toWhatsAppNumber(phone.ifEmpty { onFile })
    val indexes = ticked.sorted()
    fun words(i: Int) = edits[i] ?: generated[i].orEmpty()

    LaunchedEffect(chosen, indexes) {
        if (chosen.isEmpty() || indexes.isEmpty()) { photoCount = 0; return@LaunchedEffect }
        delay(250)
        try {
            val out = ErpApi.shared.send(KarigarSendLogic.PATH, body = KarigarSendLogic.body(order.id, indexes, chosen, phone, emptyMap(), preview = true))
            val p = KarigarSendLogic.preview(out)
            photoCount = p.photos
            generated.putAll(p.words)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The words stay as they were; Send still works, the ERP builds them again.
        }
    }

    OrdersSheet(
        title = "Send to karigar",
        onDismiss = onDismiss,
        bottom = { close ->
            Button(
                onClick = {
                    KarigarSendQueue.send(KarigarSendLogic.body(order.id, indexes, chosen, phone, edits, preview = false), karigar?.name ?: "the karigar")
                    close()
                },
                enabled = chosen.isNotEmpty() && indexes.isNotEmpty() && KarigarSendLogic.numberOk(number),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Symbols.Send, null, Modifier.size(18.dp))
                Text("Send on WhatsApp", Modifier.padding(start = 8.dp))
            }
        },
    ) {
        OrdersFormSection(
            title = "Send to",
            footer = if (chosen.isNotEmpty() && onFile.isEmpty() && phone.isEmpty()) "No number on file for ${karigar?.name ?: "him"}. Add one here or on his profile." else null,
        ) {
            PickerRow(
                "Karigar", chosen, listOf("" to "Pick a karigar") + karigars.map { it.id to it.name },
                onSelect = { id ->
                    chosen = id
                    phone = ""
                    if (pieces.isNullOrEmpty()) ticked = KarigarSendLogic.initialPieces(order, pieces, id)
                },
            )
            if (chosen.isNotEmpty()) {
                if (onFile.isEmpty() || phone.isNotEmpty()) {
                    TextField(
                        value = phone, onValueChange = { phone = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                        label = { Text("WhatsApp number") }, placeholder = { Text("0300 1234567") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        trailingIcon = { ContactPickButton { pick -> if (pick.phone.isNotEmpty()) phone = pick.phone } },
                    )
                } else {
                    OrdersLabeled("Number", onFile)
                }
            }
        }
        OrdersFormSection(
            title = "Pieces",
            footer = if (photoCount > 0) "$photoCount reference photo${if (photoCount == 1) "" else "s"} go first; each piece's words ride on its first photo. No prices are sent."
            else "No prices are sent.",
        ) {
            for ((i, item) in order.items.withIndex()) {
                val on = i in ticked
                ToggleRow(
                    "${i + 1}. " + KarigarSendLogic.pieceTitle(item.description), on,
                    onChange = { ticked = if (it) ticked + i else ticked - i },
                    sub = if (chosen.isNotEmpty() && item.karigarId == chosen) "Assigned to him" else null,
                )
                if (on) {
                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextField(
                            value = words(i), onValueChange = { edits[i] = it }, modifier = Modifier.fillMaxWidth(),
                            minLines = 4, label = { Text("Message for piece ${i + 1}") },
                        )
                        if (edits.containsKey(i)) {
                            Row { TextButton(onClick = { edits.remove(i) }) { Text("Reset", style = MaterialTheme.typography.labelLarge) } }
                        }
                    }
                }
            }
        }
    }
}
