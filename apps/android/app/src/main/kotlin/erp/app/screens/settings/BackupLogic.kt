package erp.app.screens.settings

import erp.app.data.JsonText
import erp.core.Container
import erp.core.Decodable
import java.util.Locale

/** /api/app/backup: one collection the backup copies. */
data class BackupCollection(
    val id: String,
    val label: String,
    val description: String,
    /** -1 when the ERP could not count it (the page's "err"). */
    val count: Int,
) {
    companion object : Decodable<BackupCollection> {
        override fun fromMap(m: Map<String, Any?>): BackupCollection {
            val c = Container(m)
            return BackupCollection(c.string("id") ?: "", c.string("label", ""), c.string("description", ""), c.int("count") ?: -1)
        }
    }
}

data class BackupList(val collections: List<BackupCollection>, val fileName: String) {
    companion object {
        fun from(value: Any?): BackupList {
            val m = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
            val c = Container(m)
            return BackupList(
                // A collection's id goes into the file as a key: only the ERP's own lower-case names.
                collections = c.list("collections", BackupCollection).filter { it.id.isNotEmpty() && it.id.all { ch -> ch == '_' || (ch in 'a'..'z') } },
                fileName = c.string("fileName", "backup.json"),
            )
        }
    }
}

/** The backup page's pure rules (BackupSettings.swift). */
object BackupLogic {
    /** "1,234", as the page's toLocaleString. */
    fun grouped(n: Int): String = String.format(Locale.US, "%,d", n)

    /** Records in the chosen collections; one the ERP could not count adds none. */
    fun totalDocs(collections: List<BackupCollection>, selected: Set<String>): Int =
        collections.filter { it.id in selected }.sumOf { maxOf(0, it.count) }

    fun countText(count: Int): String = if (count < 0) "err" else grouped(count)

    /** "Delete 3 Products". */
    fun deleteLabel(count: Int): String {
        val n = maxOf(count, 1)
        return "Delete $n Product${if (n == 1) "" else "s"}"
    }

    /** The number typed for the Danger zone, digits only. */
    fun deleteCount(typed: String): Int = typed.filter { it.isDigit() }.toIntOrNull() ?: 0

    /** The sold pieces whose SKU or name holds the search, the first fifty. */
    fun soldHits(sold: List<erp.core.models.Product>, search: String): List<erp.core.models.Product> {
        val q = search.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        return sold.asSequence().filter { it.sku.lowercase().contains(q) || it.name.lowercase().contains(q) }.take(50).toList()
    }

    /** Firestore's Point-in-Time Recovery page in the Cloud Console for this project. */
    fun consoleUrl(projectId: String): String =
        if (projectId.isEmpty()) "https://console.cloud.google.com/" else "https://console.cloud.google.com/firestore/databases/-default-/pitr?project=$projectId"

    /** `reAddSoldProduct`'s fields and the words it makes. */
    fun reAddPayload(sku: String): Map<String, Any?> = mapOf("sku" to sku)

    fun reAddDetail(name: String, newSku: String?): String =
        "$name has been re-added to inventory with a new SKU${newSku?.let { " ($it)" } ?: ""}."

    /** `deleteLatestProducts`'s fields. */
    fun deletePayload(count: Int, code: String): Map<String, Any?> = mapOf("count" to count, "deleteCode" to code)

    /** The file's head, up to where the first collection's documents go: `{ "exportedAt": …, "collections": […], "data": {`. */
    fun fileHead(exportedAt: String, collections: List<String>): String =
        "{\"exportedAt\":\"$exportedAt\",\"collections\":${JsonText.of(collections)},\"data\":{"

    /** Before a collection's documents in the file: a comma after the first, then its name as the key. */
    fun entryHead(collection: String, first: Boolean): String = (if (first) "" else ",") + "\"$collection\":"

    /** After the last collection: the data object and the file close. */
    const val FILE_TAIL = "}}"
}
