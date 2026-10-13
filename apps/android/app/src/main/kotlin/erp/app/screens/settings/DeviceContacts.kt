package erp.app.screens.settings

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import erp.app.device.Foreground
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * This phone's address book (ContactsContract) for the contact import, the Android way to what the iPhone does with a
 * .vcf from Files. READ_CONTACTS is asked for here, when the person presses the button, never at launch.
 */
object DeviceContacts {
    fun allowed(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    /** Asks for READ_CONTACTS if it is not held; true when it is. */
    suspend fun ensure(context: Context): Boolean {
        if (allowed(context)) return true
        val launchers = Foreground.launchers ?: return false
        return launchers.permission(Manifest.permission.READ_CONTACTS)
    }

    /** Every contact with its numbers, as the vCard text the ERP reads. */
    suspend fun vcf(context: Context): String = withContext(Dispatchers.IO) { VCards.fromContacts(read(context)) }

    private fun read(context: Context): List<VCards.DeviceContact> {
        val resolver = context.contentResolver
        val names = LinkedHashMap<Long, String>()
        resolver.query(
            ContactsContract.Contacts.CONTENT_URI,
            arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME),
            null, null, ContactsContract.Contacts._ID,
        )?.use { c ->
            while (c.moveToNext()) names[c.getLong(0)] = c.getString(1).orEmpty()
        }
        val phones = HashMap<Long, MutableList<String>>()
        resolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.CONTACT_ID, ContactsContract.CommonDataKinds.Phone.NUMBER),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) c.getString(1)?.let { phones.getOrPut(c.getLong(0)) { ArrayList() }.add(it) }
        }
        return names.map { (id, name) -> VCards.DeviceContact(name, phones[id].orEmpty()) }
    }
}
