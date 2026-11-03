package erp.app.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import erp.app.ui.icons.Symbols
import erp.core.logic.pakistanE164

// Owner, 2026-11-03: "when adding numbers for any customers or karigars let me choose from contacts". The system's own
// phone picker (ACTION_PICK on Phone.CONTENT_URI) hands back one chosen number with a temporary read grant on its row, so
// the app asks for no READ_CONTACTS permission (the iPhone's picker is out of process in the same way).

/** A name and a number from the address book. The number is kept as the ERP keeps it (+92…) when it is dialable. */
data class ContactPick(val name: String, val phone: String) {
    /** The name to write over [current]: only into an empty box, never over one already typed. */
    fun nameToFill(current: String): String? = if (current.isBlank() && name.isNotBlank()) name else null
}

/** Reads the one row the picker returned; null when it cannot be read. */
private fun readPick(context: Context, uri: Uri): ContactPick? = try {
    context.contentResolver.query(
        uri,
        arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
        null, null, null,
    )?.use { c ->
        if (!c.moveToFirst()) return@use null
        val name = (c.getString(0) ?: "").trim()
        val raw = (c.getString(1) ?: "").trim()
        val kept = pakistanE164(raw)
        ContactPick(name, if (kept.isNotBlank()) kept else raw)
    }
} catch (_: SecurityException) {
    null
}

/** A small icon button for the trailing edge of a phone field; [onPick] gets the chosen contact. */
@Composable
fun ContactPickButton(onPick: (ContactPick) -> Unit) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == Activity.RESULT_OK && uri != null) readPick(context, uri)?.let(onPick)
    }
    IconButton(onClick = {
        try {
            launcher.launch(Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI))
        } catch (_: ActivityNotFoundException) {
            // No address book on this device: the box stays typed by hand.
        }
    }) {
        Icon(Symbols.Contacts, contentDescription = "Choose from Contacts")
    }
}
