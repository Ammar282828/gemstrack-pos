package erp.app.screens.settings

import erp.core.Container
import erp.core.Decodable

// The ERP's plan for an address book (lib/contacts/triage.ts), as /api/app/imports answers it.

/** Someone already in the book (`ExistingRow`). */
data class ContactRow(val id: String, val kind: String, val name: String, val phone: String?, val altPhone: String?) {
    companion object : Decodable<ContactRow> {
        override fun fromMap(m: Map<String, Any?>): ContactRow {
            val c = Container(m)
            return ContactRow(c.string("id") ?: "", c.string("kind", "customer"), c.string("name", ""), c.string("phone"), c.string("altPhone"))
        }
    }
}

/** A contact from the file (`PendingContact`), and for a half-match (`Conflict`) why and with whom. */
data class PendingContact(
    val id: String,
    val kind: String,
    val name: String,
    val tags: List<String>,
    val phone: String?,
    val extraPhones: List<String>,
    /** "same_name" or "same_phone"; null for a new one. */
    val reason: String?,
    val matches: List<ContactRow>,
) {
    companion object : Decodable<PendingContact> {
        override fun fromMap(m: Map<String, Any?>): PendingContact {
            val c = Container(m)
            return PendingContact(
                c.string("id") ?: "", c.string("kind", "customer"), c.string("name", ""), c.strings("tags"),
                c.string("phone"), c.strings("extraPhones"), c.string("reason"), c.list("matches", ContactRow),
            )
        }
    }
}

data class ContactSummary(val cardsInFile: Int, val ignoredUntagged: Int, val mergedDuplicates: Int, val settled: Int, val conflicts: Int) {
    companion object : Decodable<ContactSummary> {
        override fun fromMap(m: Map<String, Any?>): ContactSummary {
            val c = Container(m)
            return ContactSummary(c.int("cardsInFile") ?: 0, c.int("ignoredUntagged") ?: 0, c.int("mergedDuplicates") ?: 0, c.int("settled") ?: 0, c.int("conflicts") ?: 0)
        }
    }
}

/** The names of those already saved. */
data class ContactSettled(val name: String) {
    companion object : Decodable<ContactSettled> {
        override fun fromMap(m: Map<String, Any?>) = ContactSettled(Container(m).string("name", ""))
    }
}

data class ContactPlan(val summary: ContactSummary, val fresh: List<PendingContact>, val settled: List<ContactSettled>, val conflicts: List<PendingContact>)

/** /api/app/imports `{ kind: 'contacts' }`. */
data class ContactPlanAnswer(
    val plan: ContactPlan,
    /** The answer each half-match starts on (triage.ts defaultChoice). */
    val defaults: Map<String, String>,
    val fingerprint: String,
) {
    companion object {
        /** Null unless the answer carries a plan with a summary. */
        fun from(value: Any?): ContactPlanAnswer? {
            val m = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return null
            val c = Container(m)
            val planMap = (m["plan"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return null
            val p = Container(planMap)
            val summary = p.obj("summary", ContactSummary) ?: return null
            val plan = ContactPlan(
                summary = summary,
                fresh = p.list("fresh", PendingContact),
                settled = p.list("settled", ContactSettled),
                conflicts = p.list("conflicts", PendingContact).filter { it.matches.isNotEmpty() },
            )
            return ContactPlanAnswer(plan, c.stringMap("defaults"), c.string("fingerprint", ""))
        }
    }
}

/** One answer the page offers a half-match, in its words. */
data class ContactAnswer(val value: String, val label: String, val hint: String)

/** What the contact import page works out and sends (ContactImportSettings.swift). */
object ContactImportLogic {
    /** The page's answers for each kind of half-match (its ConflictRow). */
    fun options(c: PendingContact): List<ContactAnswer> =
        if (c.reason == "same_name") {
            listOf(
                ContactAnswer("add_phone", "Same person, second phone", "Adds the number to the spare slot"),
                ContactAnswer("add_separately", "Different people", "Adds this one separately"),
                ContactAnswer("skip", "Leave the book alone", "Nothing changes"),
            )
        } else {
            listOf(
                ContactAnswer("adopt_name", "Same person, fuller name", "Renames to “${c.name}”"),
                ContactAnswer("add_separately", "Different people", "Adds this one separately"),
                ContactAnswer("skip", "Leave the book alone", "Nothing changes"),
            )
        }

    fun willAdd(plan: ContactPlan, dropped: Set<String>): Int = plan.fresh.count { it.id !in dropped }

    fun willResolve(plan: ContactPlan, choices: Map<String, String>): Int = plan.conflicts.count { (choices[it.id] ?: "skip") != "skip" }

    /** "Altaf · 0300…" — the numbers on file for the book's side of a half-match. */
    fun bookPhones(r: ContactRow): String = listOfNotNull(r.phone, r.altPhone).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "no number" }

    fun freshPhones(f: PendingContact): String = (f.phone ?: "no number") + (if (f.extraPhones.isEmpty()) "" else " (+${f.extraPhones.size} more)")

    /** The footer under the figures. */
    fun summaryLine(s: ContactSummary): String =
        "${s.cardsInFile} contacts in the file · ${s.ignoredUntagged} personal contacts ignored" +
            (if (s.mergedDuplicates > 0) " · ${s.mergedDuplicates} duplicate(s) merged" else "")

    /** The names already saved, as many as the page lists. */
    fun settledLine(settled: List<ContactSettled>): String =
        settled.take(30).joinToString(", ") { it.name } + (if (settled.size > 30) " and ${settled.size - 30} more" else "")

    /** `/api/app/imports` `{ kind: 'contacts', vcf }`. */
    fun planBody(vcf: String): Map<String, Any?> = mapOf("kind" to "contacts", "vcf" to vcf)

    /** `importContacts`: the file again with the answers (the ERP reads it again and refuses if what they were about changed). */
    fun importBody(vcf: String, fingerprint: String, dropped: Set<String>, choices: Map<String, String>): Map<String, Any?> =
        mapOf("vcf" to vcf, "fingerprint" to fingerprint, "dropped" to dropped.sorted(), "choices" to choices)

    fun finished(out: Map<String, Any?>, planSettled: Int): Pair<String, String> {
        val added = (out["added"] as? Number)?.toInt() ?: 0
        val updated = (out["updated"] as? Number)?.toInt() ?: 0
        val settled = (out["settled"] as? Number)?.toInt() ?: planSettled
        return "Import finished" to "$added added, $updated updated. $settled were already saved."
    }
}

/** The address book without its pictures, and an address book made from this phone's contacts. */
object VCards {
    /** The properties that carry pictures, sounds and keys: never read by the ERP, and most of a file's size. */
    private val media = setOf("PHOTO", "LOGO", "SOUND", "KEY")

    /**
     * Each such property and the folded lines that continue it (they start with a space or a tab) are left out; every
     * other line goes as it was, line endings and all (a phone's export ends its lines "\r\n": the "\r" stays on its line).
     */
    fun withoutMedia(text: String): String {
        val kept = ArrayList<String>()
        var skipping = false
        for (line in text.split('\n')) {
            if (line.startsWith(" ") || line.startsWith("\t")) {
                if (!skipping) kept.add(line)
                continue
            }
            val head = line.takeWhile { it != ':' && it != ';' }.uppercase()
            // "item1.PHOTO": a grouped property is named after its dot.
            val name = head.split('.').lastOrNull { it.isNotEmpty() } ?: head
            skipping = name in media
            if (!skipping) kept.add(line)
        }
        return kept.joinToString("\n")
    }

    /** A contact on this phone: its name as the Contacts app shows it, and its numbers. */
    data class DeviceContact(val name: String, val phones: List<String>)

    /**
     * The phone's contacts as the .vcf an export would make, with only what the ERP reads: the name and the numbers
     * (lib/contacts/vcard.ts reads FN, N and TEL). A line break in a name would end its line: it becomes a space.
     */
    fun fromContacts(contacts: List<DeviceContact>): String {
        val sb = StringBuilder()
        for (c in contacts) {
            val name = c.name.replace('\r', ' ').replace('\n', ' ').trim()
            if (name.isEmpty()) continue
            sb.append("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:").append(name).append("\r\n")
            c.phones.map { it.replace('\r', ' ').replace('\n', ' ').trim() }.filter { it.isNotEmpty() }.distinct()
                .forEach { sb.append("TEL;TYPE=CELL:").append(it).append("\r\n") }
            sb.append("END:VCARD\r\n")
        }
        return sb.toString()
    }
}
