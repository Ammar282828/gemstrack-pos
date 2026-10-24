package erp.app.data

import erp.app.ErpApp
import java.io.File

/**
 * Where the write names (WriteIntents) and the Outbox's queue are kept: one small file per business in the app's own
 * files folder (private to the app, gone on uninstall; the iPhone's Application Support). A kill, a crash or a new
 * build loses nothing. Written whole through a temp file and renamed, so a kill mid-write leaves the old file.
 * A business's entries stay in its own file whichever business is open, so what one business has on its way is never
 * sent to another's server.
 */
internal object OutboxDisk {
    /** The file's name for `kind` ("write-intents", "outbox") of a business: the id is made safe for a file name. */
    fun name(kind: String, businessId: String): String = "$kind-${businessId.filter { it.isLetterOrDigit() || it == '-' }}.json"

    private fun dir(): File? {
        val app = runCatching { ErpApp.instance }.getOrNull() ?: return null
        return File(app.filesDir, "erp-outbox").apply { mkdirs() }
    }

    /** The file for `kind` of this business, or null before the app exists (unit tests). */
    fun file(kind: String, businessId: String): File? = dir()?.let { File(it, name(kind, businessId)) }

    /** Whether a business has anything kept for `kind`. */
    fun has(kind: String, businessId: String): Boolean = file(kind, businessId)?.exists() == true

    fun read(file: File?): String? = runCatching { file?.takeIf { it.exists() }?.readText() }.getOrNull()

    /** Null text removes the file (nothing left to keep). */
    fun write(file: File?, text: String?) {
        file ?: return
        runCatching {
            if (text == null) { file.delete(); return }
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(file)) { file.writeText(text); tmp.delete() }
        }
    }

    /** A business was removed from this phone: what it had on its way goes with its sign-in (nothing could send it). */
    fun forget(businessId: String) {
        for (kind in listOf("write-intents", "outbox")) file(kind, businessId)?.delete()
    }
}
