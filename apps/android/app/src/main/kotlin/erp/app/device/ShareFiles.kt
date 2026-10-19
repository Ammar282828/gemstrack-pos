package erp.app.device

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import erp.app.config.House
import java.io.File
import java.util.UUID

/**
 * Handing a file or some words to the system share sheet (Print, Save to Files, WhatsApp are all in it): the one
 * place the app does it. Files go out through our FileProvider from `cache/erp-share/` (res/xml/file_paths.xml),
 * each in a folder of its own so it keeps the exact name the person will see and two never meet.
 */
private const val DIR = "erp-share"
private const val KEEP_MILLIS = 24L * 60 * 60 * 1000

/** A file's name, never a path: no slashes or colons, never empty. */
fun shareFileName(name: String, extension: String? = null): String {
    val n = name.replace("/", " ").replace("\\", " ").replace(":", " ").trim().ifEmpty { "Document" }
    return if (extension == null || n.lowercase().endsWith(".${extension.lowercase()}")) n else "$n.$extension"
}

/** Copies [file] under the shared cache folder (as [name], default its own) and offers it. */
fun shareFile(context: Context, file: File, mime: String, title: String, name: String = file.name) {
    val dir = freshDir(context)
    val copy = File(dir, shareFileName(name)).also { file.copyTo(it, overwrite = true) }
    send(context, copy, mime, title)
}

/** Writes [bytes] under the shared cache folder as [name] and offers them. */
fun shareBytes(context: Context, bytes: ByteArray, name: String, mime: String, title: String) {
    val dir = freshDir(context)
    val file = File(dir, shareFileName(name)).also { it.writeBytes(bytes) }
    send(context, file, mime, title)
}

/** Writes each of [files] (name, bytes) under one shared folder and offers them together (every size of a design). */
fun shareManyBytes(context: Context, files: List<Pair<String, ByteArray>>, mime: String, title: String) {
    if (files.isEmpty()) return
    if (files.size == 1) return shareBytes(context, files[0].second, files[0].first, mime, title)
    val dir = freshDir(context)
    val uris = ArrayList<Uri>()
    val used = HashSet<String>()
    for ((name, bytes) in files) {
        var n = shareFileName(name)
        // Two sizes never share a name: the second would overwrite the first.
        if (!used.add(n)) { n = "${UUID.randomUUID().toString().take(4)}-$n"; used.add(n) }
        val file = File(dir, n).also { it.writeBytes(bytes) }
        uris.add(FileProvider.getUriForFile(context, "${House.applicationId}.files", file))
    }
    val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mime
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        putExtra(Intent.EXTRA_SUBJECT, title)
        clipData = ClipData.newRawUri("", uris[0]).also { c -> uris.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    start(context, Intent.createChooser(send, title))
}

/** Shares words and an address (the iPhone's ShareLink: a subject, a message and the link). */
fun shareText(context: Context, subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    start(context, Intent.createChooser(send, subject))
}

/** Opens a web address (wa.me, tel:) in whatever handles it; nothing happens where nothing does. */
fun openAddress(context: Context, action: String, uri: String) {
    start(context, Intent(action, Uri.parse(uri)))
}

/** Opens a kept file in a viewer chosen from the sheet (a PDF slip). */
fun viewFile(context: Context, bytes: ByteArray, name: String, mime: String, title: String) {
    val dir = freshDir(context)
    val file = File(dir, shareFileName(name)).also { it.writeBytes(bytes) }
    val uri = FileProvider.getUriForFile(context, "${House.applicationId}.files", file)
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    start(context, Intent.createChooser(view, title))
}

private fun send(context: Context, file: File, mime: String, title: String) {
    val uri = FileProvider.getUriForFile(context, "${House.applicationId}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, title)
        clipData = ClipData.newRawUri("", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    start(context, Intent.createChooser(send, title))
}

/** A folder for one share. A customer's bill is not left on the phone: anything older than a day is swept first. */
private fun freshDir(context: Context): File {
    val base = File(context.cacheDir, DIR)
    val now = System.currentTimeMillis()
    base.listFiles()?.forEach { if (now - it.lastModified() > KEEP_MILLIS) it.deleteRecursively() }
    return File(base, UUID.randomUUID().toString()).apply { mkdirs() }
}

private fun start(context: Context, intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // Nothing on the phone handles it: the button simply opened nothing, as an unopenable link does on the iPhone.
    }
}
