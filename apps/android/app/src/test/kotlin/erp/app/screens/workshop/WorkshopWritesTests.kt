package erp.app.screens.workshop

import erp.app.data.JsonText
import erp.core.ERPDecode
import erp.core.logic.KarigarPay
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.GivenItem
import erp.core.models.GivenItemRecipientType
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJobStatus
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What every Workshop write sends, key for key as the iPhone's views send it (Workshop*.swift, ERPAPI.shared.write).
class WorkshopWritesTests {
    private fun job(source: WorkshopJob.Source, id: String, orderId: String? = null, invoiceId: String? = null, index: Int? = null, karigarId: String = "K1") =
        WorkshopJob(
            id = id, source = source, karigarId = karigarId, karigarName = "Ustad Demo", description = "Piece", status = WorkshopJob.Status.pending,
            assignedDate = "2026-10-01T00:00:00.000Z", ageDays = 0, urgency = WorkshopJob.Urgency.ok, sortTime = 0.0,
            orderId = orderId, invoiceId = invoiceId, itemIndex = index,
        )

    private val orderPiece = job(WorkshopJob.Source.order, "order:O1:2", orderId = "O1", index = 2)
    private val invoicePiece = job(WorkshopJob.Source.invoice, "invoice:I1:0", invoiceId = "I1", index = 0)
    private val stockPiece = job(WorkshopJob.Source.manual, "job:J1")

    @Test fun doneIsOneOpPerKindOfPiece() {
        assertEquals("setPieceDone" to mapOf("orderId" to "O1", "index" to 2, "done" to true), WorkshopWrites.done(orderPiece, true)!!.let { it.op to it.fields })
        assertEquals("setInvoicePieceDone" to mapOf("invoiceId" to "I1", "index" to 0, "done" to false), WorkshopWrites.done(invoicePiece, false)!!.let { it.op to it.fields })
        // A stock job is Completed, or back to Pending.
        assertEquals("setStockJobStatus" to mapOf("jobId" to "J1", "status" to "completed"), WorkshopWrites.done(stockPiece, true)!!.let { it.op to it.fields })
        assertEquals("setStockJobStatus" to mapOf("jobId" to "J1", "status" to "pending"), WorkshopWrites.done(stockPiece, false)!!.let { it.op to it.fields })
    }

    @Test fun givenIsOneOpPerKindOfPiece() {
        assertEquals("setPieceGiven" to mapOf("orderId" to "O1", "index" to 2, "given" to true), WorkshopWrites.given(orderPiece, true)!!.let { it.op to it.fields })
        assertEquals("setInvoicePieceGiven" to mapOf("invoiceId" to "I1", "index" to 0, "given" to false), WorkshopWrites.given(invoicePiece, false)!!.let { it.op to it.fields })
        assertEquals("setStockJobGiven" to mapOf("jobId" to "J1", "given" to true), WorkshopWrites.given(stockPiece, true)!!.let { it.op to it.fields })
    }

    @Test fun onlyOrderAndSoldPiecesChangeKarigar() {
        assertEquals("setPieceKarigar" to mapOf("orderId" to "O1", "index" to 2, "karigarId" to "none"), WorkshopWrites.karigar(orderPiece, "none")!!.let { it.op to it.fields })
        assertEquals("setInvoicePieceKarigar" to mapOf("invoiceId" to "I1", "index" to 0, "karigarId" to "K2"), WorkshopWrites.karigar(invoicePiece, "K2")!!.let { it.op to it.fields })
        // A stock job is written for its karigar; the web offers no reassigning it either.
        assertNull(WorkshopWrites.karigar(stockPiece, "K2"))
        assertNull(WorkshopWrites.status(orderPiece, KarigarJobStatus.inProgress))
        assertEquals(mapOf("jobId" to "J1", "status" to "in-progress"), WorkshopWrites.status(stockPiece, KarigarJobStatus.inProgress)!!.fields)
    }

    @Test fun aPieceWithNothingToFindIsNotWritten() {
        val lost = orderPiece.copy(itemIndex = null)
        assertNull(WorkshopWrites.done(lost, true))
        assertNull(WorkshopWrites.given(lost, true))
        assertNull(WorkshopLogic.writeTarget(job(WorkshopJob.Source.manual, "x")))
    }

    @Test fun assignStockWorkSendsWhatWasFilledIn() {
        val w = WorkshopWrites.stockJob("K1", "  4 stacked rings ", "cat001", "silver", "12.3456", "3", "1500.555", " 12 ", " stones ")
        assertEquals("addStockJob", w.op)
        @Suppress("UNCHECKED_CAST")
        val job = w.fields["job"] as Map<String, Any?>
        assertEquals(
            mapOf("karigarId" to "K1", "description" to "4 stacked rings", "metalType" to "silver", "itemCategory" to "cat001", "weightG" to 12.345, "quantity" to 3.0, "agreedCost" to 1501.0, "size" to "12", "notes" to "stones"),
            job,
        )
        assertEquals(listOf("karigarId", "description", "metalType", "itemCategory", "weightG", "quantity", "agreedCost", "size", "notes"), job.keys.toList())
        // Boxes left empty are left out, as the web's form leaves them.
        @Suppress("UNCHECKED_CAST")
        val bare = WorkshopWrites.stockJob("K1", "Repair", "", "gold", "", "", "", "  ", "").fields["job"] as Map<String, Any?>
        assertEquals(mapOf("karigarId" to "K1", "description" to "Repair", "metalType" to "gold"), bare)
        assertEquals("""{"job":{"karigarId":"K1","description":"Repair","metalType":"gold","quantity":1}}""", JsonText.of(mapOf("job" to mapOf("karigarId" to "K1", "description" to "Repair", "metalType" to "gold", "quantity" to WorkshopFigure.read("1", 0)))))
    }

    @Test fun makingDetailsSendBlankSizeAndNotesToRemoveThem() {
        val w = WorkshopWrites.jobDetails("J1", "  New name ", "", "", "")
        assertEquals("updateStockJobDetails", w.op)
        assertEquals(mapOf("jobId" to "J1", "patch" to mapOf("description" to "New name", "size" to "", "notes" to "")), w.fields)
        // An empty weight box leaves the weight as it is; a typed one is sent.
        assertEquals(2.5, (WorkshopWrites.jobDetails("J1", "n", "7", "2.5", "x").fields["patch"] as Map<*, *>)["weightG"])
    }

    @Test fun pieceDetailsOfAnOrderPieceCarryReferenceWeightAndPhoto() {
        val order = WorkshopPieceAsk.Target.Order("O1", 2)
        val w = WorkshopWrites.pieceDetails(order, "  Demo kara ", "12", "4.25", "ref-1", "Polish", null, false)
        assertEquals("updateOrderPieceDetails", w.op)
        assertEquals(mapOf("orderId" to "O1", "itemIndex" to 2), w.fields.filterKeys { it != "patch" })
        // The name is trimmed; size, instructions and reference go as typed.
        assertEquals(
            mapOf("name" to "Demo kara", "size" to "12", "instructions" to "Polish", "referenceSku" to "ref-1", "estimatedWeightG" to 4.25),
            w.fields["patch"],
        )
        // An empty weight box leaves the weight as it is; a new picture is sent as a JPEG data URI, once.
        val photo = WorkshopWrites.pieceDetails(order, "n", "", "", "", "", byteArrayOf(1, 2, 3), false).fields["patch"] as Map<*, *>
        assertFalse(photo.containsKey("estimatedWeightG"))
        assertEquals("data:image/jpeg;base64,AQID", photo["sampleImageDataUri"])
        // Removing the one on file sends an empty address; leaving it sends nothing.
        assertEquals("", (WorkshopWrites.pieceDetails(order, "n", "", "", "", "", null, true).fields["patch"] as Map<*, *>)["sampleImageDataUri"])
        assertFalse((WorkshopWrites.pieceDetails(order, "n", "", "", "", "", null, false).fields["patch"] as Map<*, *>).containsKey("sampleImageDataUri"))
    }

    @Test fun pieceDetailsOfASoldPieceSendNoWeightReferenceOrPhoto() {
        val w = WorkshopWrites.pieceDetails(WorkshopPieceAsk.Target.Invoice("I1", 0), "Demo ring", "", "9", "ref", "", byteArrayOf(1), true)
        assertEquals("updateInvoicePieceDetails", w.op)
        assertEquals(mapOf("invoiceId" to "I1", "itemIndex" to 0, "patch" to mapOf("name" to "Demo ring", "size" to "", "instructions" to "")), w.fields)
    }

    @Test fun theDeletesCarryTheirCode() {
        assertEquals("deleteStockJob" to mapOf("jobId" to "J1", "deleteCode" to "1234"), WorkshopWrites.deleteStockJob("J1", "1234").let { it.op to it.fields })
        assertEquals("deleteSilverEntry" to mapOf("id" to "S1", "deleteCode" to "1234"), WorkshopWrites.deleteSilver("S1", "1234").let { it.op to it.fields })
        assertEquals("deletePayBatch" to mapOf("batchId" to "B1", "deleteCode" to "1234"), WorkshopWrites.deleteBatch("B1", "1234").let { it.op to it.fields })
        assertEquals("deleteGivenItem" to mapOf("id" to "G1", "deleteCode" to "1234"), WorkshopWrites.deleteGiven("G1", "1234").let { it.op to it.fields })
        assertEquals("removeKarigar" to mapOf("karigarId" to "K1", "deleteCode" to "1234"), WorkshopWrites.removeKarigar("K1", "1234").let { it.op to it.fields })
    }

    // MARK: Pay

    @Test fun aPaymentIsAnExpenseFiledUnderHisOpenBatch() {
        val w = WorkshopWrites.payment("2026-10-12T07:00:00.000Z", "Karigar", "Making", 40000.0, "K1", "B1", partnership = false, paidBy = "business")
        assertEquals("addExpense", w.op)
        assertEquals(
            mapOf("date" to "2026-10-12T07:00:00.000Z", "category" to "Karigar", "description" to "Making", "amount" to 40000.0, "karigarId" to "K1", "batchId" to "B1"),
            w.fields,
        )
        // "Paid by" only where the house keeps partner ledgers.
        assertEquals("mina", WorkshopWrites.payment("d", "c", "w", 1.0, "K1", "B1", partnership = true, paidBy = "mina").fields["paidBy"])
    }

    @Test fun silverNotesAreLeftOutWhenBlank() {
        assertEquals("addSilverEntry" to mapOf("karigarId" to "K1", "silverGrams" to 50.5, "surchargePerGram" to 35.0), WorkshopWrites.silver("K1", 50.5, 35.0, "  ").let { it.op to it.fields })
        assertEquals("March batch", WorkshopWrites.silver("K1", 50.5, 35.0, " March batch ").fields["description"])
    }

    @Test fun startingAndSettlingABatch() {
        assertEquals("startPayBatch" to mapOf("karigarId" to "K1", "label" to "March 2026"), WorkshopWrites.startBatch("K1", " March 2026 ").let { it.op to it.fields })
        assertEquals("settlePayBatch" to mapOf("batchId" to "B1", "expectedTotal" to 64000.0), WorkshopWrites.settleBatch("B1", 64000.0, " ").let { it.op to it.fields })
        assertEquals(mapOf("batchId" to "B1", "expectedTotal" to 64000.0, "carryOverLabel" to "April 2026"), WorkshopWrites.settleBatch("B1", 64000.0, " April 2026 ").fields)
    }

    @Test fun silverFormRulesAreCores() {
        assertEquals("Silver grams must be greater than 0", KarigarPay.silverProblem(0.0, 10.0))
        assertEquals("Surcharge must be non-negative", KarigarPay.silverProblem(5.0, -1.0))
        assertNull(KarigarPay.silverProblem(5.0, 0.0))
        assertEquals(1767.5, KarigarPay.silverSurcharge(50.5, 35.0))
    }

    @Test fun payCategoriesFollowTheHouseListThenTheBooks() {
        fun expense(c: String) = ERPDecode.model<Expense>(mapOf("id" to c + Math.random(), "category" to c, "amount" to 1))!!
        val books = listOf(expense("Rent"), expense("Karigar"), expense("Karigar"), expense("Other"), expense("Tea"))
        // No house list: most used first, "Other" last.
        assertEquals(listOf("Karigar", "Rent", "Tea", "Other"), WorkshopPayWords.formCategories(emptyList(), books))
        // A house list, then any other name the books carry.
        assertEquals(listOf("Karigar", "Salary", "Other", "Rent", "Tea"), WorkshopPayWords.formCategories(listOf("Karigar", "Salary", "Other"), books))
    }

    @Test fun thePaymentSheetsSayWhatTheyWrite() {
        val said = WorkshopPayWords.paymentConsequence("2026-10-01T05:00:00.000Z", "Karigar", "Making", "March 2026", WorkshopPartner("mina", "Mina"))
        assertEquals(
            "An expense of 1 Oct 2026 under Karigar, “Making”, filed to pay batch “March 2026”. Paid from Mina's own pocket, so it also goes on Mina's ledger as a loan to the business. Nothing is posted to Hisaab.",
            said,
        )
        val batch = ERPDecode.model<KarigarBatch>(mapOf("id" to "B1", "karigarId" to "K1", "label" to "March 2026", "startDate" to "2026-03-01T00:00:00Z"))!!
        val pay = ERPDecode.model<Expense>(mapOf("id" to "E1", "karigarId" to "K1", "batchId" to "B1", "amount" to 40000, "date" to "2026-03-05T00:00:00Z"))!!
        val figs = KarigarPay.figures("K1", listOf(pay), listOf(batch))
        val open = figs.open!!
        assertEquals(
            "“March 2026” is closed now at PKR 40,000, the total of its 1 payment, and kept under Settled pay batches. Paying him from his page then needs a new pay batch. Nothing is paid and nothing is posted to Hisaab.",
            WorkshopPayWords.settleConsequence(open, ""),
        )
        assertTrue(WorkshopPayWords.settleConsequence(open, "April 2026").contains("“April 2026” starts at the same moment"))
        assertEquals("Started 1 Mar 2026 · 1 payment", KarigarNow.startedWords(open))
    }

    // MARK: The karigar form

    private val on = ERPDecode.model<Karigar>(mapOf("id" to "K1", "name" to "Ustad Demo", "contact" to "0300 0000001", "email" to "Ustad@Example.com"))!!

    @Test fun aNewKarigarIsSentWhole() {
        val d = KarigarDraft(name = " Ustad Demo ", email = "Ustad@Example.com", city = "Karachi")
        val patch = d.patch(null)
        assertEquals(listOf("name", "contact", "email", "specialty", "altPhone", "workshop", "city", "address", "notes"), patch.keys.toList())
        assertEquals("Ustad Demo", patch["name"])
        assertEquals("ustad@example.com", patch["email"])
        assertEquals("", patch["contact"])
        val w = WorkshopWrites.karigarWrite(null, patch)
        assertEquals("addKarigar", w.op)
        assertEquals(mapOf("karigar" to patch), w.fields)
    }

    @Test fun anEditSendsOnlyWhatChanged() {
        val same = KarigarDraft.of(on)
        assertTrue(same.patch(on).isEmpty())
        assertFalse(same.canSave(false, on))
        val d = same.copy(contact = "0300 0000002", email = "USTAD@example.com ")
        // The email differs only by case: unchanged.
        assertEquals(mapOf("contact" to "0300 0000002"), d.patch(on))
        assertTrue(d.canSave(false, on))
        assertFalse(d.canSave(true, on))
        val w = WorkshopWrites.karigarWrite(on, d.patch(on))
        assertEquals("updateKarigar" to mapOf("karigarId" to "K1", "patch" to mapOf("contact" to "0300 0000002")), w.op to w.fields)
    }

    @Test fun theFormNeedsANameAndAnEmailThatLooksLikeOne() {
        assertFalse(KarigarDraft(name = "  ").nameOK)
        assertTrue(KarigarDraft(email = "").emailOK)
        assertTrue(KarigarDraft(email = "a@b.co").emailOK)
        assertFalse(KarigarDraft(email = "a@b").emailOK)
        assertFalse(KarigarDraft(email = "a b@c.de").emailOK)
        assertFalse(KarigarDraft(email = "@c.de").emailOK)
        assertFalse(KarigarDraft(name = "X", email = "nope").canSave(false, null))
        assertTrue(KarigarDraft(name = "X").canSave(false, null))
    }

    // MARK: Given items

    private val karigars = listOf(
        ERPDecode.model<Karigar>(mapOf("id" to "K1", "name" to "Ustad Demo"))!!,
        ERPDecode.model<Karigar>(mapOf("id" to "K2", "name" to "Twin"))!!,
        ERPDecode.model<Karigar>(mapOf("id" to "K3", "name" to " twin "))!!,
    )
    private val customers = listOf(ERPDecode.model<Customer>(mapOf("id" to "C1", "name" to "Demo Customer"))!!)

    private fun given(
        type: GivenItemRecipientType, name: String, pickedId: String? = null, pickedName: String = "", notes: String = "", givenBy: String = "", editing: GivenItem? = null,
    ) = WorkshopWrites.given("2026-10-12T07:00:00.000Z", " Ring sample ", type, name, pickedId, pickedName, karigars, customers, notes, givenBy, editing)

    @Test fun aNewGivenItemLinksAnExactName() {
        val w = given(GivenItemRecipientType.karigar, " ustad  DEMO ", givenBy = "Ammar")
        assertEquals("addGivenItem", w.op)
        assertEquals(
            mapOf(
                "date" to "2026-10-12T07:00:00.000Z", "description" to "Ring sample", "recipientType" to "karigar", "recipientName" to "ustad  DEMO",
                "recipientId" to "K1", "givenBy" to "Ammar",
            ),
            w.fields,
        )
        // Two of one name stay unlinked rather than guessed; Other is never linked.
        assertFalse(given(GivenItemRecipientType.karigar, "Twin").fields.containsKey("recipientId"))
        assertFalse(given(GivenItemRecipientType.other, "Ustad Demo").fields.containsKey("recipientId"))
        assertEquals("C1", given(GivenItemRecipientType.customer, "demo customer").fields["recipientId"])
        // A picked name wins while the name still says it.
        assertEquals("K2", given(GivenItemRecipientType.karigar, "Twin", pickedId = "K2", pickedName = "Twin").fields["recipientId"])
        assertFalse(given(GivenItemRecipientType.karigar, "Twin x", pickedId = "K2", pickedName = "Twin").fields.containsKey("recipientId"))
        // Notes and Given by are left out when blank on a new entry.
        assertFalse(given(GivenItemRecipientType.other, "x").fields.containsKey("notes"))
        assertFalse(given(GivenItemRecipientType.other, "x").fields.containsKey("givenBy"))
    }

    @Test fun anEditWritesTheNoteAndClearsGivenByOnlyWhenChanged() {
        val item = ERPDecode.model<GivenItem>(mapOf("id" to "G1", "description" to "Ring", "recipientType" to "karigar", "recipientName" to "Ustad Demo", "givenBy" to "Ammar", "status" to "out"))!!
        val same = given(GivenItemRecipientType.karigar, "Ustad Demo", givenBy = "Ammar", editing = item)
        assertEquals("updateGivenItem", same.op)
        assertEquals("G1", same.fields["id"])
        @Suppress("UNCHECKED_CAST")
        val sent = same.fields["item"] as Map<String, Any?>
        // The note goes even when blank; Given by only when it changed.
        assertEquals("", sent["notes"])
        assertFalse(sent.containsKey("givenBy"))
        @Suppress("UNCHECKED_CAST")
        val cleared = given(GivenItemRecipientType.karigar, "Ustad Demo", givenBy = "", editing = item).fields["item"] as Map<String, Any?>
        assertTrue(cleared.containsKey("givenBy"))
        assertNull(cleared["givenBy"])
        @Suppress("UNCHECKED_CAST")
        val changed = given(GivenItemRecipientType.karigar, "Ustad Demo", givenBy = "Mina", editing = item).fields["item"] as Map<String, Any?>
        assertEquals("Mina", changed["givenBy"])
        // The cleared one goes out as JSON null, which the ERP reads as nobody.
        assertTrue(JsonText.of(cleared)!!.contains("\"givenBy\":null"))
    }

    @Test fun markingBackSendsTheMoment() {
        assertEquals("markGivenReturned" to mapOf("id" to "G1", "returnedDate" to "2026-10-12T07:00:00.000Z"), WorkshopWrites.markReturned("G1", "2026-10-12T07:00:00.000Z").let { it.op to it.fields })
    }

    @Test fun aPickedDayKeepsTheTimeOfDayTheFormOpenedAt() {
        val opened = Instant.parse("2026-10-12T07:30:15Z") // 12:30:15 in Karachi
        assertEquals("2026-10-12T07:30:15.000Z", WorkshopDay.iso("2026-10-12", opened))
        assertEquals("2026-10-09T07:30:15.000Z", WorkshopDay.iso("2026-10-09", opened))
        assertEquals("2026-10-12T07:30:15.000Z", WorkshopDay.iso("not a day", opened))
    }

    @Test fun nobodyYetIsTheWebsWords() {
        assertEquals("Nobody is on this piece yet, so there is no one to have given it to. Assign a karigar first.", WorkshopWrites.nobodyYet)
    }
}
