package erp.app.screens.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.BiometricVault
import erp.app.ui.Tone
import erp.app.ui.color
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * One delete waiting for its code: what is deleted (said in the sheet and in the ERP's log of who tried), what
 * goes with it, and the write that runs once the code is typed (the Owner group's `OwnerDeletion`; kept here until
 * that group's kit piece lands, see the Orders report).
 */
class OrdersDeletion(
    /** The store's own words for it ("Undo invoice INV-1 back to order ORD-1"). */
    val what: String,
    /** What else happens, said before the code is asked for (the web's confirmation). */
    val detail: String,
    /** The ERP's write, sent with the code; it throws the ERP's words when refused. */
    val run: suspend (code: String) -> Unit,
    /** False for a removal Settings, Recently removed can put back: the sheet then does not say it can't be undone. */
    val final: Boolean = true,
)

/** The key the ERP's own dialog uses (components/shared/delete-code-dialog.tsx FACE_KEY). */
private const val FACE_KEY = "delete-code"

/**
 * The delete code (decision "Delete code"): four digits the ERP's server checks with the delete itself, so
 * nothing is deleted unless the code was right. As on the web's dialog, a phone with a fingerprint or face can
 * keep the code behind it (the same place the web dialog keeps it inside the app, `delete-code`): offered once a
 * typed code has been taken, then asked for by finger, and forgotten when the shop changes the code.
 */
@Composable
fun OrdersDeleteCodeSheet(deletion: OrdersDeletion, onDismiss: () -> Unit, onDone: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var keep by remember { mutableStateOf(true) }
    var kept by remember { mutableStateOf(runCatching { BiometricVault.has(FACE_KEY) }.getOrDefault(false)) }
    val canFace = remember { runCatching { BiometricVault.biometry().first }.getOrDefault(false) }
    val scope = rememberCoroutineScope()

    suspend fun submit(given: String, byFace: Boolean, close: () -> Unit) {
        if (busy || given.length < 4) return
        busy = true
        error = null
        try {
            deletion.run(given)
            if (!byFace && canFace && !kept && keep) runCatching { BiometricVault.save(given, FACE_KEY) }
            busy = false
            onDone()
            close()
            return
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 403 && e.message == "Wrong code.") {
                if (byFace) {
                    // The shop changed the code: the phone's copy is no use any more.
                    BiometricVault.delete(FACE_KEY)
                    kept = false
                    error = "The delete code has changed. Type the new one."
                } else {
                    error = "Wrong code."
                }
                code = ""
            } else {
                error = e.message
            }
        } catch (e: Exception) {
            error = ordersSay(e)
        }
        busy = false
    }

    // Face unlocks the kept code and sends it; a closed prompt leaves the box to type in.
    suspend fun byFace(close: () -> Unit) {
        val saved = try {
            BiometricVault.read(FACE_KEY, deletion.what)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return
        submit(saved, true, close)
    }

    OrdersSheet(
        title = "Delete code",
        onDismiss = onDismiss,
        locked = busy,
        bottom = { close ->
            Button(
                onClick = { scope.launch { submit(code, false, close) } },
                enabled = !busy && code.length >= 4,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Tone.problem.color(), contentColor = androidx.compose.ui.graphics.Color.White),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 0.dp), strokeWidth = 2.dp, color = androidx.compose.ui.graphics.Color.White)
                Text("Delete")
            }
        },
    ) { close ->
        // Asked by finger as soon as the sheet opens, when this phone keeps the code.
        LaunchedEffect(Unit) { if (canFace && kept) byFace(close) }
        OrdersFormSection(
            title = deletion.what,
            footer = listOf(deletion.detail, if (deletion.final) "This can't be undone." else "", "Enter the code to go ahead.").filter { it.isNotEmpty() }.joinToString(" "),
        ) {
            OutlinedTextField(
                value = code,
                onValueChange = { typed ->
                    val digits = typed.filter { it in '0'..'9' }.take(8)
                    code = digits
                    // Typing again clears the last refusal; the box emptied after one keeps it said.
                    if (typed.isNotEmpty()) error = null
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Delete code") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                enabled = !busy,
            )
            if (canFace && kept) {
                OutlinedButton(onClick = { scope.launch { byFace(close) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Fingerprint, null, Modifier.padding(end = 8.dp))
                    Text("Use your fingerprint or face")
                }
            }
            if (canFace && !kept) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Use your fingerprint or face next time on this phone", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = keep, onCheckedChange = { keep = it })
                }
            }
        }
        error?.let { OrdersStatusLine(Icons.Filled.Warning, it, Tone.problem) }
    }
}
