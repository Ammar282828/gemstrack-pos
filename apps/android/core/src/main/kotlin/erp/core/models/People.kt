package erp.core.models

import erp.core.Container
import erp.core.Decodable

/**
 * A customer: Firestore `customers/<id>` (src/lib/store.ts `Customer`).
 * Surprising: removal hides, it does not destroy: a removed customer keeps `deletedAt` and
 * every invoice, order and hisaab row, and the ERP keeps them out of every list (Settings >
 * Recently removed puts them back), so the app must filter `deletedAt == null` itself. Sizes are
 * free text on purpose ("12.5", "US 6", "usual"). `phone` can be stored as a number in old
 * imports; it decodes as text. `tags` are carried over from the phone book (tj, hom, tc).
 */
data class Customer(
    val id: String,
    val name: String,
    val phone: String?,
    /** A spare number; never overwritten by an import. */
    val altPhone: String?,
    val email: String?,
    val address: String?,
    val city: String?,
    val country: String?,
    val source: CustomerSource?,
    val shopifyCustomerId: String?,
    val ringSize: String?,
    val bangleSize: String?,
    val braceletSize: String?,
    val chainLength: String?,
    /** ISO "yyyy-mm-dd". */
    val birthday: String?,
    val anniversary: String?,
    /** What they like, in the shop's own words. */
    val preference: String?,
    val tags: List<String>,
    val notes: String?,
    /** Present when the customer has been removed. */
    val deletedAt: String?,
) {
    companion object : Decodable<Customer> {
        override fun fromMap(m: Map<String, Any?>): Customer {
            val c = Container(m)
            return Customer(
                id = c.string("id") ?: "",
                name = c.string("name", ""),
                phone = c.string("phone"),
                altPhone = c.string("altPhone"),
                email = c.string("email"),
                address = c.string("address"),
                city = c.string("city"),
                country = c.string("country"),
                source = c.word("source", CustomerSource),
                shopifyCustomerId = c.string("shopifyCustomerId"),
                ringSize = c.string("ringSize"),
                bangleSize = c.string("bangleSize"),
                braceletSize = c.string("braceletSize"),
                chainLength = c.string("chainLength"),
                birthday = c.string("birthday"),
                anniversary = c.string("anniversary"),
                preference = c.string("preference"),
                tags = c.strings("tags"),
                notes = c.string("notes"),
                deletedAt = c.string("deletedAt"),
            )
        }
    }
}

/**
 * A karigar (workshop craftsman): Firestore `karigars/<id>` (src/lib/store.ts `Karigar`).
 * Surprising: removal hides, as for customers (`deletedAt`); `email` is the Google account the
 * karigar signs in with, which grants their own work list and hisaab only, through the server.
 */
data class Karigar(
    val id: String,
    val name: String,
    val contact: String?,
    val altPhone: String?,
    /** What he makes: setting, polish, chain, meena. */
    val specialty: String?,
    val workshop: String?,
    val address: String?,
    val city: String?,
    val country: String?,
    val notes: String?,
    val email: String?,
    val deletedAt: String?,
) {
    companion object : Decodable<Karigar> {
        override fun fromMap(m: Map<String, Any?>): Karigar {
            val c = Container(m)
            return Karigar(
                id = c.string("id") ?: "",
                name = c.string("name", ""),
                contact = c.string("contact"),
                altPhone = c.string("altPhone"),
                specialty = c.string("specialty"),
                workshop = c.string("workshop"),
                address = c.string("address"),
                city = c.string("city"),
                country = c.string("country"),
                notes = c.string("notes"),
                email = c.string("email"),
                deletedAt = c.string("deletedAt"),
            )
        }
    }
}

/**
 * A standalone piece of work for a karigar that does not come from a customer order: stock
 * pieces, repairs, samples, re-polish jobs. Firestore `karigar_jobs/<id>`
 * (src/lib/store.ts `KarigarJob`).
 * Surprising: order-sourced work is NOT here; it is derived from `OrderItem.karigarId` (and
 * `InvoiceItem.karigarId`), and the Workshop screen merges all three (lib/workshop.ts).
 * Status words are lower-case with a hyphen ("in-progress"), unlike the order statuses.
 */
data class KarigarJob(
    val id: String,
    val karigarId: String,
    val karigarName: String,
    val description: String,
    val itemCategory: String?,
    val metalType: MetalType?,
    val karat: KaratValue?,
    val weightG: Double?,
    val quantity: Double?,
    val size: String?,
    val status: KarigarJobStatus,
    /** ISO; when the job was written up. */
    val assignedDate: String,
    /** ISO; when the piece actually left the shop. */
    val givenAt: String?,
    val completedDate: String?,
    /** Making charges agreed with the karigar. */
    val agreedCost: Double?,
    val notes: String?,
) {
    companion object : Decodable<KarigarJob> {
        override fun fromMap(m: Map<String, Any?>): KarigarJob {
            val c = Container(m)
            return KarigarJob(
                id = c.string("id") ?: "",
                karigarId = c.string("karigarId", ""),
                karigarName = c.string("karigarName", ""),
                description = c.string("description", ""),
                itemCategory = c.string("itemCategory"),
                metalType = c.word("metalType", MetalType),
                karat = c.word("karat", KaratValue),
                weightG = c.double("weightG"),
                quantity = c.double("quantity"),
                size = c.string("size"),
                status = c.word("status", KarigarJobStatus, KarigarJobStatus.unknown("")),
                assignedDate = c.string("assignedDate", ""),
                givenAt = c.string("givenAt"),
                completedDate = c.string("completedDate"),
                agreedCost = c.double("agreedCost"),
                notes = c.string("notes"),
            )
        }
    }
}

/**
 * One of a karigar's hisaabs, a run of work and payments settled together ("March 2026"):
 * Firestore `karigar_batches/<id>` (src/lib/store.ts `KarigarBatch`). Expenses paid to the karigar
 * are filed under one by `Expense.batchId`.
 * Surprising: no `closedDate` means the hisaab is still open, and a karigar normally has one open.
 */
data class KarigarBatch(
    val id: String,
    val karigarId: String,
    val label: String,
    /** ISO. */
    val startDate: String,
    /** ISO; null while open. */
    val closedDate: String?,
    /** Written when the hisaab is closed. */
    val totalPaid: Double?,
) {
    val isOpen: Boolean get() = closedDate == null

    companion object : Decodable<KarigarBatch> {
        override fun fromMap(m: Map<String, Any?>): KarigarBatch {
            val c = Container(m)
            return KarigarBatch(
                id = c.string("id") ?: "",
                karigarId = c.string("karigarId", ""),
                label = c.string("label", ""),
                startDate = c.string("startDate", ""),
                closedDate = c.string("closedDate"),
                totalPaid = c.double("totalPaid"),
            )
        }
    }
}

/**
 * Silver received from a karigar, at a surcharge per gram: Firestore `silver_transactions/<id>`
 * (src/lib/store.ts `SilverTransaction`), written from his page's Silver form.
 * Surprising: `totalSurcharge` is stored, not worked out on reading (lib/karigar-pay.ts
 * `silverSurcharge` made it, grams at the rate), and the karigar's name is copied in.
 */
data class KarigarSilverTransaction(
    val id: String,
    val karigarId: String,
    val karigarName: String,
    /** ISO instant. */
    val date: String,
    val silverGrams: Double,
    val surchargePerGram: Double,
    val totalSurcharge: Double,
    val description: String?,
) {
    companion object : Decodable<KarigarSilverTransaction> {
        override fun fromMap(m: Map<String, Any?>): KarigarSilverTransaction {
            val c = Container(m)
            return KarigarSilverTransaction(
                id = c.string("id") ?: "",
                karigarId = c.string("karigarId", ""),
                karigarName = c.string("karigarName", ""),
                date = c.string("date", ""),
                silverGrams = c.double("silverGrams", 0.0),
                surchargePerGram = c.double("surchargePerGram", 0.0),
                totalSurcharge = c.double("totalSurcharge", 0.0),
                description = c.string("description"),
            )
        }
    }
}

/**
 * Something the shop handed out and expects back: Firestore `given_items/<id>`
 * (src/lib/store.ts `GivenItem`): a sample, a bangle sent for repair, gold to a karigar.
 * Surprising: the Given page used to write only the name, so older rows have no `recipientId`
 * and are found by `recipientName` (lib/given.ts links one only when exactly one live record
 * carries the name). A customer merge moves rows by `recipientId`.
 */
data class GivenItem(
    val id: String,
    /** ISO; the date given. */
    val date: String,
    /** What was given ("gold ring sample", "repair bangle"). */
    val description: String,
    val recipientType: GivenItemRecipientType,
    /** Free text or the resolved name. */
    val recipientName: String,
    /** The karigar's or customer's id, when linked. */
    val recipientId: String?,
    /** Who at the shop handed it over (a Taken by name; the owner, 2026-10-10). Older rows have none. */
    val givenBy: String?,
    val notes: String?,
    val status: GivenItemStatus,
    /** ISO; when it came back. */
    val returnedDate: String?,
) {
    companion object : Decodable<GivenItem> {
        override fun fromMap(m: Map<String, Any?>): GivenItem {
            val c = Container(m)
            return GivenItem(
                id = c.string("id") ?: "",
                date = c.string("date", ""),
                description = c.string("description", ""),
                recipientType = c.word("recipientType", GivenItemRecipientType, GivenItemRecipientType.unknown("")),
                recipientName = c.string("recipientName", ""),
                recipientId = c.string("recipientId"),
                givenBy = c.string("givenBy"),
                notes = c.string("notes"),
                status = c.word("status", GivenItemStatus, GivenItemStatus.unknown("")),
                returnedDate = c.string("returnedDate"),
            )
        }
    }
}

/**
 * One row of a customer's or karigar's ledger: Firestore `hisaab/<id>` (src/lib/store.ts
 * `HisaabEntry`). The rows of one `entityId` are that person's hisaab; the balance is never
 * stored, it is debit less credit over the rows (lib/owed.ts, lib/karigar-position.ts).
 * Surprising: the words are the shop's. `cashDebit` is what the person owes us (raised when we
 * give goods or services on credit, e.g. an invoice); `cashCredit` what we owe them (raised by
 * their payment or goods). Gold is kept in grams alongside: `goldDebitGrams` we gave them,
 * `goldCreditGrams` they gave us. A row with `linkedInvoiceId` is the auto-managed outstanding
 * balance of that invoice: it is that invoice's `balanceDue` again, so the hand-written
 * balance leaves it out (`ledgerBalances`).
 */
data class HisaabEntry(
    val id: String,
    /** Customer or karigar id. */
    val entityId: String,
    val entityType: HisaabEntityType,
    val entityName: String,
    /** ISO instant. */
    val date: String,
    val description: String,
    val cashDebit: Double,
    val cashCredit: Double,
    val goldDebitGrams: Double,
    val goldCreditGrams: Double,
    val linkedInvoiceId: String?,
) {
    companion object : Decodable<HisaabEntry> {
        override fun fromMap(m: Map<String, Any?>): HisaabEntry {
            val c = Container(m)
            return HisaabEntry(
                id = c.string("id") ?: "",
                entityId = c.string("entityId", ""),
                entityType = c.word("entityType", HisaabEntityType, HisaabEntityType.unknown("")),
                entityName = c.string("entityName", ""),
                date = c.string("date", ""),
                description = c.string("description", ""),
                cashDebit = c.double("cashDebit", 0.0),
                cashCredit = c.double("cashCredit", 0.0),
                goldDebitGrams = c.double("goldDebitGrams", 0.0),
                goldCreditGrams = c.double("goldCreditGrams", 0.0),
                linkedInvoiceId = c.string("linkedInvoiceId"),
            )
        }
    }
}
