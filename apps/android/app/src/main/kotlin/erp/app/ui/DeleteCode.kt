package erp.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.BiometricVault
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * One delete waiting for its code (OwnerKit.swift `OwnerDeletion`): what is deleted (said in the sheet and in the
 * ERP's log of who tried), what goes with it, and the write that runs once the code is typed.
 */
class OwnerDeletion(
    /** The store's own words for it ("Delete invoice INV-000123"). */
    val what: String,
    /** What else happens, said before the code is asked for (the web's confirmation). */
    val detail: String,
    /** The ERP's write, sent with the code; it throws the ERP's words when refused. */
    val run: suspend (code: String) -> Unit,
    /** False for a removal Settings, Recently removed can put back: the sheet then does not say it can't be undone. */
    val final: Boolean = true,
)

/** The delete code's small rules, apart from the sheet so they are tested (OwnerKit.swift `OwnerDeleteCodeSheet`). */
object DeleteCode {
    /** The key the ERP's own dialog uses (components/shared/delete-code-dialog.tsx FACE_KEY). */
    const val FACE_KEY = "delete-code"

    /** Digits only, at most eight, as the box takes them. */
    fun digits(typed: String): String = typed.filter { it in '0'..'9' }.take(8)

    /** The ERP's refusal for a code that is not the shop's. */
    fun isWrong(e: Throwable): Boolean = e is ErpApi.Failure && e.status == 403 && e.message == "Wrong code."

    /** The sheet's footer: what else happens, that it can't be undone, and what to do. */
    fun footer(d: OwnerDeletion): String =
        listOf(d.detail, if (d.final) "This can't be undone." else "", "Enter the code to go ahead.").filter { it.isNotEmpty() }.joinToString(" ")
}

/**
 * The delete code (decision "Delete code"): four digits the ERP's server checks with the delete itself, so nothing is
 * deleted unless the code was right. As on the web's dialog, a phone with a fingerprint or face can keep the code
 * behind it (the shell's BiometricVault, the iPhone's FaceIDVault): offered once a typed code has been taken, then
 * asked for by finger, and forgotten when the shop changes the code. [onDone] runs once the delete has gone through.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OwnerDeleteCodeSheet(deletion: OwnerDeletion, onDismiss: () -> Unit, onDone: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var keep by remember { mutableStateOf(true) }
    var kept by remember { mutableStateOf(runCatching { BiometricVault.has(DeleteCode.FACE_KEY) }.getOrDefault(false)) }
    val canFace = remember { runCatching { BiometricVault.biometry().first }.getOrDefault(false) }
    // Asking for the code is the step before something that cannot be taken back.
    DestructiveFeedback(deletion)

    suspend fun submit(given: String, byFace: Boolean) {
        if (busy || given.length < 4) return
        busy = true
        error = null
        try {
            deletion.run(given)
            if (!byFace && canFace && !kept && keep) runCatching { BiometricVault.save(given, DeleteCode.FACE_KEY) }
            haptics.success()
            busy = false
            sheetState.hide()
            onDone()
            onDismiss()
            return
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (DeleteCode.isWrong(e)) {
                if (byFace) {
                    // The shop changed the code: the phone's copy is no use any more.
                    runCatching { BiometricVault.delete(DeleteCode.FACE_KEY) }
                    kept = false
                    error = "The delete code has changed. Type the new one."
                } else {
                    error = "Wrong code."
                }
                code = ""
            } else {
                error = e.message ?: e.toString()
            }
            haptics.failure()
        }
        busy = false
    }

    /** The fingerprint unlocks the kept code and sends it; a closed prompt leaves the box to type in. */
    suspend fun byFace() {
        val saved = try {
            BiometricVault.read(DeleteCode.FACE_KEY, deletion.what)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return
        submit(saved, byFace = true)
    }

    // Asked by finger as soon as the sheet opens, when this phone keeps the code.
    LaunchedEffect(Unit) { if (canFace && kept) byFace() }

    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding().imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { if (!busy) scope.launch { sheetState.hide(); onDismiss() } }) { Text("Cancel") }
                Text("Delete code", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                Button(
                    onClick = { scope.launch { submit(code, byFace = false) } },
                    enabled = !busy && code.length >= 4,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) {
                    if (busy) Loading(Modifier.size(24.dp), color = MaterialTheme.colorScheme.onError) else Text("Delete")
                }
            }
            Text(deletion.what, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
            OutlinedTextField(
                value = code,
                onValueChange = {
                    val digits = DeleteCode.digits(it)
                    code = digits
                    // Typing again clears the last refusal; the box emptied after one keeps it said.
                    if (digits.isNotEmpty()) error = null
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Delete code") },
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                singleLine = true,
                enabled = !busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            )
            if (canFace && kept) {
                OutlinedButton(onClick = { scope.launch { byFace() } }, enabled = !busy) {
                    Icon(Icons.Filled.Fingerprint, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Use fingerprint")
                }
            }
            if (canFace && !kept) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Use fingerprint next time on this phone", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = keep, onCheckedChange = { keep = it })
                }
            }
            Text(DeleteCode.footer(deletion), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = Tone.problem.color())
                    Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
