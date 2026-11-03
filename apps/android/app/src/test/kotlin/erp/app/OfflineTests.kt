package erp.app

import erp.app.config.BusinessRules
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.OutboxEngine
import erp.app.data.OutboxEngine.Status
import erp.app.data.PendingSummary
import erp.app.data.ReadCache
import erp.app.nav.BusinessCarry
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

// Offline (owner, 2026-11-03): orders, sales and payments taken with no connection are kept on the phone under the request name made at the
// first tap, and sent oldest first when the line is back. The engine's own behaviour (Outbox.swift's queueForLater / runDurable), plain Kotlin.
@OptIn(ExperimentalCoroutinesApi::class)
class OfflineTests {
    private class Sent(val op: String, val fields: Map<String, Any?>, val id: String)

    private var clock = 1_000L
    private var disk: String? = null
    private val sent = ArrayList<Sent>()
    private val cleared = ArrayList<String>()
    private var offline = false
    private var failWith: ((Sent) -> Exception?)? = null
    private var answer: Map<String, Any?> = emptyMap()

    private fun TestScope.engine() = OutboxEngine(
        scope = this,
        send = { op, fields, id ->
            val s = Sent(op, fields, id)
            sent += s
            failWith?.invoke(s)?.let { throw it }
            answer
        },
        businessId = "biz",
        isOffline = { offline },
        clearIntent = { cleared += it },
        load = { disk },
        save = { disk = it },
        now = { clock++ },
        newId = { "n-${sent.size}-${clock}" },
    )

    private val order = mapOf("order" to mapOf("customerName" to "Ali", "items" to listOf(mapOf("description" to "Ring")), "subtotal" to 50_000))

    @Test fun anOrderTakenOfflineIsKeptOnDiskAndSaysWaiting() = runTest {
        offline = true
        val o = engine()
        val out = o.queueForLater("createOrder", order, "req-1", "intent-1", null)
        assertEquals(true, out["queued"])
        assertEquals("req-1", out["requestId"])
        runCurrent()
        assertTrue(sent.isEmpty(), "nothing is tried with no line")
        val item = o.items.value.single()
        assertEquals(Status.Waiting, item.status)
        assertTrue(item.durable)
        assertEquals("Order for Ali", item.label)
        assertEquals("order", item.summary?.kind)
        assertNotNull(disk, "written before the call returned")
        assertEquals(1, o.waitingCount)
        assertEquals(listOf(item), o.records("order"))
        assertTrue(o.records("invoice").isEmpty())
    }

    @Test fun theTapIsStampedAndAPaymentIsDatedByIt() = runTest {
        offline = true
        val o = engine()
        o.queueForLater("recordPayment", mapOf("invoiceId" to "INV-1", "amount" to 100, "method" to "Cash"), "req-p", null, null)
        offline = false
        o.wake()
        advanceTimeBy(1_000)
        runCurrent()
        val body = sent.single().fields
        assertNotNull(body["clientAt"] as? String, "clientAt travels with it")
        assertEquals(body["clientAt"], body["date"], "a payment is dated by the tap")
        assertEquals("req-p", sent.single().id)
    }

    @Test fun theLineComingBackSendsItOnceByTheSameNameAndForgetsTheIntent() = runTest {
        offline = true
        val o = engine()
        answer = mapOf("order" to mapOf("id" to "ORD-000042"))
        val said = ArrayList<String>()
        val job = backgroundScope.launch { o.notices.collect { said += it } }
        runCurrent()
        o.queueForLater("createOrder", order, "req-1", "intent-1", null)
        runCurrent()
        offline = false
        o.wake()
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf("createOrder"), sent.map { it.op })
        assertEquals("req-1", sent.single().id)
        assertEquals(listOf("intent-1"), cleared)
        assertTrue(o.items.value.isEmpty())
        assertNull(disk, "nothing left once it landed")
        assertTrue(said.any { it == "Order ORD-000042 sent" }, said.toString())
        job.cancel()
    }

    @Test fun theSameTapAskedTwiceIsOneEntry() = runTest {
        offline = true
        val o = engine()
        o.queueForLater("createInvoice", mapOf("cart" to listOf(1)), "req-1", null, null)
        o.queueForLater("createInvoice", mapOf("cart" to listOf(1)), "req-1", null, null)
        assertEquals(1, o.items.value.size)
    }

    @Test fun theyGoOneAtATimeOldestFirst() = runTest {
        offline = true
        val o = engine()
        o.queueForLater("createInvoice", mapOf("customer" to mapOf("name" to "A")), "first", null, null)
        o.queueForLater("createInvoice", mapOf("customer" to mapOf("name" to "B")), "second", null, null)
        o.queueForLater("recordPayment", mapOf("invoiceId" to "INV-1", "amount" to 5), "third", null, null)
        offline = false
        o.wake()
        advanceUntilIdle()
        assertEquals(listOf("first", "second", "third"), sent.map { it.id })
        assertTrue(o.items.value.isEmpty())
    }

    @Test fun aLostLineIsNeverAFailureItWaits() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(0, "No connection", offline = true) }
        o.queueForLater("createInvoice", mapOf("cart" to listOf(1)), "req-1", null, null)
        advanceTimeBy(10 * 60_000)
        assertNull(o.failure.value)
        assertEquals(Status.Waiting, o.items.value.single().status)
        assertTrue(sent.size > 3, "it keeps trying")
        failWith = null
        o.wake()
        advanceUntilIdle()
        assertTrue(o.items.value.isEmpty())
        assertEquals(1, sent.map { it.id }.toSet().size, "every try is the same name")
    }

    @Test fun aServerThatIsStillRecordingTheEarlierTryIsAskedAgain() = runTest {
        val o = engine()
        failWith = { s -> if (sent.size < 3) ErpApi.Failure(409, "This was already sent a moment ago and is being recorded.") else null }
        o.queueForLater("createInvoice", mapOf("cart" to listOf(1)), "req-1", null, null)
        advanceUntilIdle()
        assertEquals(3, sent.size)
        assertNull(o.failure.value)
        assertTrue(o.items.value.isEmpty())
    }

    @Test fun aRefusalKeepsTheDataWithRetryAndDiscard() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(409, "SKU RNG-1 was sold meanwhile.") }
        o.queueForLater("createInvoice", mapOf("customer" to mapOf("name" to "Sara"), "cart" to listOf(1)), "req-1", null, null)
        advanceUntilIdle()
        val item = o.items.value.single()
        assertEquals(Status.Failed, item.status)
        assertEquals("SKU RNG-1 was sold meanwhile.", item.message)
        assertEquals("Sale to Sara", o.failure.value?.label)
        assertTrue(item.durable)
        assertNotNull(disk, "kept with its data")
        assertEquals(1, sent.size, "a refusal is not tried again by itself")
        // Retry sends it again, by the same name.
        failWith = null
        o.retry(item.id)
        advanceUntilIdle()
        assertEquals(listOf("req-1", "req-1"), sent.map { it.id })
        assertTrue(o.items.value.isEmpty())
        assertNull(disk)
    }

    @Test fun discardLetsItGo() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(422, "Nope") }
        o.queueForLater("createOrder", order, "req-1", null, null)
        advanceUntilIdle()
        val id = o.items.value.single().id
        o.discard(id)
        assertTrue(o.items.value.isEmpty())
        assertNull(o.failure.value)
        assertNull(disk)
    }

    @Test fun aRefusedOneDoesNotHoldTheRestBack() = runTest {
        val o = engine()
        failWith = { s -> if (s.id == "bad") ErpApi.Failure(422, "Nope") else null }
        o.queueForLater("createInvoice", mapOf("cart" to listOf(1)), "bad", null, null)
        o.queueForLater("createInvoice", mapOf("cart" to listOf(2)), "good", null, null)
        advanceUntilIdle()
        assertEquals(listOf("bad", "good"), sent.map { it.id })
        assertEquals(listOf(Status.Failed), o.items.value.map { it.status })
    }

    @Test fun whatAKillLeftIsWaitingAndGoesByTheSameName() = runTest {
        offline = true
        val first = engine()
        first.queueForLater("createOrder", order, "req-1", "intent-1", null)
        runCurrent()
        // Killed. A new Outbox over the same file, the line is back.
        offline = false
        sent.clear()
        val second = engine()
        second.resume()
        runCurrent()
        assertEquals(listOf("req-1"), sent.map { it.id })
        assertEquals(listOf("intent-1"), cleared)
        assertTrue(second.items.value.isEmpty())
        assertNull(disk)
    }

    @Test fun aRefusedOneIsNotSentAtEveryLaunch() = runTest {
        val first = engine()
        failWith = { ErpApi.Failure(422, "Nope") }
        first.queueForLater("createOrder", order, "req-1", null, null)
        advanceUntilIdle()
        sent.clear()
        failWith = null
        val second = engine()
        second.resume()
        advanceUntilIdle()
        assertTrue(sent.isEmpty())
        val item = second.items.value.single()
        assertEquals(Status.Failed, item.status)
        assertEquals("Nope", item.message)
        assertEquals("Order for Ali", item.label)
    }

    @Test fun paymentsOnAnInvoiceAreKnown() = runTest {
        offline = true
        val o = engine()
        o.queueForLater("recordPayment", mapOf("invoiceId" to "INV-9", "amount" to 5000, "method" to "Cash"), "p1", null, null)
        o.queueForLater("recordOrderAdvance", mapOf("orderId" to "ORD-3", "amount" to 100, "method" to "Cash"), "p2", null, null)
        assertEquals(listOf("Payment on INV-9"), o.payments("INV-9").map { it.label })
        assertEquals(listOf("Advance on ORD-3"), o.payments("ORD-3").map { it.label })
    }

    @Test fun aChangeThatCannotBeSentIsRefusedAtOnce() = runTest {
        val o = engine()
        val failure = runCatching { o.queueForLater("createOrder", mapOf("x" to Any()), "req-1", null, null) }.exceptionOrNull()
        assertTrue(failure is ErpApi.Failure)
        assertTrue(o.items.value.isEmpty())
    }

    // MARK: The line

    @Test fun lostIsNoLineATimeoutOrTheServerDown() {
        assertTrue(Connection.lost(UnknownHostException("x")))
        assertTrue(Connection.lost(SocketTimeoutException("x")))
        assertTrue(Connection.lost(ErpApi.Failure(0, "x", offline = true)))
        assertTrue(Connection.lost(ErpApi.Failure(503, "x")))
        assertTrue(Connection.lost(ErpApi.Failure(504, "x")))
        assertFalse(Connection.lost(ErpApi.Failure(0, "demo")))
        assertFalse(Connection.lost(ErpApi.Failure(422, "x")))
        assertFalse(Connection.lost(ErpApi.Failure(409, "x")))
    }

    @Test fun neverLeftIsOnlyWhatCertainlyDidNotLeave() {
        assertTrue(Connection.neverLeft(UnknownHostException("x")))
        assertTrue(Connection.neverLeft(ConnectException("x")))
        assertFalse(Connection.neverLeft(SocketTimeoutException("x")))
        assertTrue(Connection.neverLeft(ErpApi.Failure.needsConnection()))
        assertFalse(Connection.neverLeft(ErpApi.Failure(0, "x", offline = true)))
    }

    @Test fun needsAConnectionSaysItPlainly() {
        val f = ErpApi.Failure.needsConnection()
        assertEquals("Needs a connection. This will work when you're back online.", f.message)
        assertTrue(f.offline)
        assertEquals("Needs a connection. Deleting it will work when you're back online.", ErpApi.Failure.needsConnection("Deleting it").message)
    }

    @Test fun theBannerSaysWhatIsWaiting() {
        assertEquals("Offline — changes will send when you're back", erp.app.screens.offline.offlineWords(true, 0))
        assertEquals("Offline — 2 waiting to send", erp.app.screens.offline.offlineWords(true, 2))
        assertNull(erp.app.screens.offline.offlineWords(false, 0))
        assertEquals("1 waiting to send", erp.app.screens.offline.offlineWords(false, 1))
        assertEquals("3 waiting to send", erp.app.screens.offline.offlineWords(false, 3))
    }

    // MARK: Words

    @Test fun pendingRowsReadLikeTheIPhones() {
        val order = PendingSummary.make("createOrder", order)
        assertEquals("order", order.kind)
        assertEquals("Ali", order.title)
        assertEquals("1 piece", order.detail)
        assertEquals(50_000.0, order.amount)
        assertEquals("Order for Ali", order.label)
        val walkIn = PendingSummary.make("createInvoice", mapOf("cart" to listOf(1, 2)))
        assertEquals("Sale to Walk-in", walkIn.label)
        assertEquals("2 pieces", walkIn.detail)
        assertEquals("Changes to INV-000001", PendingSummary.make("createInvoice", mapOf("existingInvoiceId" to "INV-000001")).title)
        assertEquals("Payment on INV-9", PendingSummary.make("recordPayment", mapOf("invoiceId" to "INV-9", "amount" to 5, "method" to "Cash")).label)
        assertEquals("Add extra revenue", PendingSummary.make("addExtraRevenue", emptyMap()).label)
    }

    @Test fun aSummaryRoundTripsThroughTheFile() {
        val s = PendingSummary("invoice", "Sara", "2 pieces", 90_000.0, null)
        assertEquals(s, PendingSummary.fromMap(s.toMap()))
    }

    // MARK: Reads from the cache

    @Test fun onlyBooksAreKept() {
        assertTrue(ReadCache.keeps("/api/app/describe?category=cat001"))
        assertTrue(ReadCache.keeps("/api/app/catalogue"))
        assertFalse(ReadCache.keeps("/api/agent/keys"))
        assertFalse(ReadCache.keeps("/api/app/pdf?id=1"))
        assertFalse(ReadCache.keeps("/api/karigar/portal"))
        assertFalse(ReadCache.keeps("https://elsewhere.example/api/x"))
    }

    // MARK: Switching business

    @Test fun theNextBusinessGoesRoundAndNeedsTwo() {
        fun b(id: String) = erp.app.config.Business.decode(
            """{"version":1,"id":"$id","name":"$id","shortName":"$id ERP","serverURL":"https://erp.$id.example","metal":"gold","margin":{"kind":"percent","percent":10},
               "palette":{"light":{"accent":"#8A6B42","ground":"#ECE8E1","card":"#FFFFFF","elevated":"#FFFFFF","onAccent":"#FFFFFF"},"dark":{"accent":"#D3B47F","ground":"#030606","card":"#172020","elevated":"#202A29","onAccent":"#0B1414"}},
               "logo":{"light":"https://erp.$id.example/l.png","dark":"https://erp.$id.example/d.png","aspect":4.5},"icon":"https://erp.$id.example/i.png","android":null,"flags":{}}""",
        )!!
        val list = listOf(b("a"), b("b"), b("c"))
        assertEquals("b", BusinessRules.nextAfter(list, "a")?.id)
        assertEquals("c", BusinessRules.nextAfter(list, "b")?.id)
        assertEquals("a", BusinessRules.nextAfter(list, "c")?.id)
        assertNull(BusinessRules.nextAfter(listOf(b("a")), "a"))
        assertNull(BusinessRules.nextAfter(list, "zzz"))
    }

    @Test fun aSwitchLandsOnTheSameTabAndPageWhereTheOtherBusinessHasIt() {
        BusinessCarry.settled()
        assertNull(BusinessCarry.carriedTab(), "a cold start carries nothing")
        BusinessCarry.noteTab("orders")
        BusinessCarry.arm()
        assertEquals("orders", BusinessCarry.carriedTab())
        BusinessCarry.settled()
        assertNull(BusinessCarry.carriedTab())
    }
}
