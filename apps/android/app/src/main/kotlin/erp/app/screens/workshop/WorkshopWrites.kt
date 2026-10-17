package erp.app.screens.workshop

import erp.core.models.Customer
import erp.core.models.Karigar
import erp.core.models.KarigarJobStatus
import erp.core.models.GivenItem
import erp.core.models.GivenItemRecipientType

// What each Workshop write sends: the op and its fields, key for key as the iPhone sends them (Workshop*.swift,
// ERPAPI.shared.write). Kept apart from the views so a test can hold them to the Swift's payloads.

/** One write: the ERP's op name and its fields (`requestId` is added by `ErpApi.write`). */
class WorkshopWrite(val op: String, val fields: Map<String, Any?>) {
    override fun toString(): String = "$op $fields"
}

object WorkshopWrites {
    /** Nobody to have given it to: refused here as on the web. */
    const val nobodyYet = "Nobody is on this piece yet, so there is no one to have given it to. Assign a karigar first."

    /**
     * Done: an order's piece (its order moves on when every piece is), a sold piece (it leaves the board), or a stock
     * job (Completed, or back to Pending).
     */
    fun done(job: WorkshopJob, done: Boolean): WorkshopWrite? = when (val t = WorkshopLogic.writeTarget(job)) {
        is WorkshopLogic.WriteTarget.Order -> WorkshopWrite("setPieceDone", mapOf("orderId" to t.id, "index" to t.index, "done" to done))
        is WorkshopLogic.WriteTarget.Invoice -> WorkshopWrite("setInvoicePieceDone", mapOf("invoiceId" to t.id, "index" to t.index, "done" to done))
        is WorkshopLogic.WriteTarget.Stock ->
            WorkshopWrite("setStockJobStatus", mapOf("jobId" to t.id, "status" to (if (done) KarigarJobStatus.completed.rawValue else KarigarJobStatus.pending.rawValue)))
        null -> null
    }

    fun given(job: WorkshopJob, given: Boolean): WorkshopWrite? = when (val t = WorkshopLogic.writeTarget(job)) {
        is WorkshopLogic.WriteTarget.Order -> WorkshopWrite("setPieceGiven", mapOf("orderId" to t.id, "index" to t.index, "given" to given))
        is WorkshopLogic.WriteTarget.Invoice -> WorkshopWrite("setInvoicePieceGiven", mapOf("invoiceId" to t.id, "index" to t.index, "given" to given))
        is WorkshopLogic.WriteTarget.Stock -> WorkshopWrite("setStockJobGiven", mapOf("jobId" to t.id, "given" to given))
        null -> null
    }

    /** "none" clears the karigar; a stock job is written for its karigar, and the web offers no reassigning it either. */
    fun karigar(job: WorkshopJob, karigarId: String): WorkshopWrite? = when (val t = WorkshopLogic.writeTarget(job)) {
        is WorkshopLogic.WriteTarget.Order -> WorkshopWrite("setPieceKarigar", mapOf("orderId" to t.id, "index" to t.index, "karigarId" to karigarId))
        is WorkshopLogic.WriteTarget.Invoice -> WorkshopWrite("setInvoicePieceKarigar", mapOf("invoiceId" to t.id, "index" to t.index, "karigarId" to karigarId))
        is WorkshopLogic.WriteTarget.Stock, null -> null
    }

    fun status(job: WorkshopJob, status: KarigarJobStatus): WorkshopWrite? {
        val t = WorkshopLogic.writeTarget(job) as? WorkshopLogic.WriteTarget.Stock ?: return null
        return WorkshopWrite("setStockJobStatus", mapOf("jobId" to t.id, "status" to status.rawValue))
    }

    fun deleteStockJob(id: String, code: String) = WorkshopWrite("deleteStockJob", mapOf("jobId" to id, "deleteCode" to code))

    // MARK: Assign Stock Work

    /** The `job` of `addStockJob`: a box left empty is left out, as the web's form leaves it. */
    fun stockJob(
        karigarId: String, what: String, category: String, metal: String,
        weightText: String, quantityText: String, makingText: String, size: String, notes: String,
    ): WorkshopWrite {
        val job = LinkedHashMap<String, Any?>()
        job["karigarId"] = karigarId
        job["description"] = what.trim()
        job["metalType"] = metal
        if (category.isNotEmpty()) job["itemCategory"] = category
        WorkshopFigure.read(weightText)?.let { job["weightG"] = it }
        WorkshopFigure.read(quantityText, places = 0)?.let { job["quantity"] = it }
        erp.app.screens.money.MoneyParse.rupees(makingText)?.let { job["agreedCost"] = it }
        size.trim().takeIf { it.isNotEmpty() }?.let { job["size"] = it }
        notes.trim().takeIf { it.isNotEmpty() }?.let { job["notes"] = it }
        return WorkshopWrite("addStockJob", mapOf("job" to job))
    }

    /** `updateStockJobDetails`: an empty weight box leaves the weight as it is, as the web's dialog sends none. */
    fun jobDetails(jobId: String, name: String, size: String, weightText: String, instructions: String): WorkshopWrite {
        val patch = LinkedHashMap<String, Any?>()
        patch["description"] = name.trim()
        patch["size"] = size
        patch["notes"] = instructions
        WorkshopFigure.read(weightText)?.let { patch["weightG"] = it }
        return WorkshopWrite("updateStockJobDetails", mapOf("jobId" to jobId, "patch" to patch))
    }

    // MARK: The karigar form

    fun karigarWrite(karigar: Karigar?, patch: Map<String, String>): WorkshopWrite =
        if (karigar != null) WorkshopWrite("updateKarigar", mapOf("karigarId" to karigar.id, "patch" to patch))
        else WorkshopWrite("addKarigar", mapOf("karigar" to patch))

    fun removeKarigar(id: String, code: String) = WorkshopWrite("removeKarigar", mapOf("karigarId" to id, "deleteCode" to code))

    // MARK: Pay

    /** Paying him is an expense filed under his open batch (`addExpense`). */
    fun payment(isoDate: String, category: String, what: String, amount: Double, karigarId: String, batchId: String, partnership: Boolean, paidBy: String): WorkshopWrite {
        val f = LinkedHashMap<String, Any?>()
        f["date"] = isoDate
        f["category"] = category
        f["description"] = what
        f["amount"] = amount
        f["karigarId"] = karigarId
        f["batchId"] = batchId
        if (partnership) f["paidBy"] = paidBy
        return WorkshopWrite("addExpense", f)
    }

    fun silver(karigarId: String, grams: Double, perGram: Double, notes: String): WorkshopWrite {
        val f = LinkedHashMap<String, Any?>()
        f["karigarId"] = karigarId
        f["silverGrams"] = grams
        f["surchargePerGram"] = perGram
        notes.trim().takeIf { it.isNotEmpty() }?.let { f["description"] = it }
        return WorkshopWrite("addSilverEntry", f)
    }

    fun deleteSilver(id: String, code: String) = WorkshopWrite("deleteSilverEntry", mapOf("id" to id, "deleteCode" to code))

    fun startBatch(karigarId: String, label: String) = WorkshopWrite("startPayBatch", mapOf("karigarId" to karigarId, "label" to label.trim()))

    fun settleBatch(batchId: String, expectedTotal: Double, carryOver: String): WorkshopWrite {
        val f = LinkedHashMap<String, Any?>()
        f["batchId"] = batchId
        f["expectedTotal"] = expectedTotal
        carryOver.trim().takeIf { it.isNotEmpty() }?.let { f["carryOverLabel"] = it }
        return WorkshopWrite("settlePayBatch", f)
    }

    fun deleteBatch(batchId: String, code: String) = WorkshopWrite("deletePayBatch", mapOf("batchId" to batchId, "deleteCode" to code))

    // MARK: Given items

    fun deleteGiven(id: String, code: String) = WorkshopWrite("deleteGivenItem", mapOf("id" to id, "deleteCode" to code))

    fun markReturned(id: String, returnedIso: String) = WorkshopWrite("markGivenReturned", mapOf("id" to id, "returnedDate" to returnedIso))

    /**
     * The Given page's form. Linked when the name is one live karigar's or customer's, exactly (lib/given.ts); two of
     * one name stay unlinked rather than guessed. An edit writes the note even when blank, as the web's does, and
     * sending no id clears the old link. Who gave it: a new entry sends a name or nothing; an edit sends it only when
     * it was changed, nobody as null, which clears it.
     */
    fun given(
        isoDate: String, what: String, type: GivenItemRecipientType, name: String, pickedId: String?, pickedName: String,
        karigars: List<Karigar>, customers: List<Customer>, notes: String, givenBy: String, editing: GivenItem?,
    ): WorkshopWrite {
        val trimmedName = name.trim()
        val f = LinkedHashMap<String, Any?>()
        f["date"] = isoDate
        f["description"] = what.trim()
        f["recipientType"] = type.rawValue
        f["recipientName"] = trimmedName
        recipientId(type, trimmedName, pickedId, pickedName, karigars, customers)?.let { f["recipientId"] = it }
        val note = notes.trim()
        if (editing != null || note.isNotEmpty()) f["notes"] = note
        val by = givenBy.trim()
        if (editing != null) {
            if (by != (editing.givenBy ?: "")) f["givenBy"] = if (by.isEmpty()) null else by
        } else if (by.isNotEmpty()) {
            f["givenBy"] = by
        }
        return if (editing != null) WorkshopWrite("updateGivenItem", mapOf("id" to editing.id, "item" to f)) else WorkshopWrite("addGivenItem", f)
    }

    fun recipientId(
        type: GivenItemRecipientType, trimmedName: String, pickedId: String?, pickedName: String,
        karigars: List<Karigar>, customers: List<Customer>,
    ): String? {
        if (type == GivenItemRecipientType.other) return null
        if (pickedId != null && pickedName == trimmedName) return pickedId
        val wanted = WorkshopPosition.norm(trimmedName)
        if (type == GivenItemRecipientType.karigar) {
            val hits = karigars.filter { WorkshopPosition.norm(it.name) == wanted }
            return if (hits.size == 1) hits[0].id else null
        }
        val hits = customers.filter { WorkshopPosition.norm(it.name) == wanted }
        return if (hits.size == 1) hits[0].id else null
    }
}

/** What is typed on the karigar form, as text, from the karigar on file (or nothing, for a new one). */
data class KarigarDraft(
    val name: String = "",
    val contact: String = "",
    val email: String = "",
    val specialty: String = "",
    val altPhone: String = "",
    val workshop: String = "",
    val city: String = "",
    val address: String = "",
    val notes: String = "",
) {
    /**
     * What `addKarigar` or `updateKarigar` takes: for a new karigar every field of the form; for an edit only what
     * differs from the karigar on file. The login email is kept in lower case.
     */
    fun patch(karigar: Karigar?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        fun put(key: String, now: String, was: String?, lower: Boolean = false) {
            val n = if (lower) now.trim().lowercase() else now.trim()
            val old = if (lower) (was ?: "").trim().lowercase() else (was ?: "").trim()
            if (karigar == null || n != old) out[key] = n
        }
        put("name", name, karigar?.name)
        put("contact", contact, karigar?.contact)
        put("email", email, karigar?.email, lower = true)
        put("specialty", specialty, karigar?.specialty)
        put("altPhone", altPhone, karigar?.altPhone)
        put("workshop", workshop, karigar?.workshop)
        put("city", city, karigar?.city)
        put("address", address, karigar?.address)
        put("notes", notes, karigar?.notes)
        return out
    }

    /** The web's `z.string().email()`, loosely: something, an @, something with a dot. Blank is fine. */
    val emailOK: Boolean
        get() {
            val e = email.trim()
            if (e.isEmpty()) return true
            val parts = e.split("@")
            return parts.size == 2 && parts[0].isNotEmpty() && parts[1].contains('.') && !e.contains(' ')
        }

    val nameOK: Boolean get() = name.trim().isNotEmpty()

    fun canSave(saving: Boolean, karigar: Karigar?): Boolean = !saving && nameOK && emailOK && patch(karigar).isNotEmpty()

    companion object {
        fun of(k: Karigar?): KarigarDraft =
            if (k == null) KarigarDraft()
            else KarigarDraft(
                name = k.name, contact = k.contact ?: "", email = k.email ?: "", specialty = k.specialty ?: "",
                altPhone = k.altPhone ?: "", workshop = k.workshop ?: "", city = k.city ?: "", address = k.address ?: "", notes = k.notes ?: "",
            )
    }
}
