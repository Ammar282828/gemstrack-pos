package erp.app.data

import erp.app.ErpApp
import erp.app.config.House
import java.io.File

/**
 * Where the write names (WriteIntents) and the Outbox's queue are kept: one small file per house in the app's own
 * files folder (private to the app, gone on uninstall; the iPhone's Application Support). A kill, a crash or a new
 * build loses nothing. Written whole through a temp file and renamed, so a kill mid-write leaves the old file.
 */
internal object OutboxDisk {
    /** The file for `kind` ("write-intents", "outbox") of this house, or null before the app exists (unit tests). */
    fun file(kind: String): File? {
        val app = runCatching { ErpApp.instance }.getOrNull() ?: return null
        val dir = File(app.filesDir, "erp-outbox").apply { mkdirs() }
        val safe = House.id.filter { it.isLetterOrDigit() || it == '-' }
        return File(dir, "$kind-$safe.json")
    }

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
}
