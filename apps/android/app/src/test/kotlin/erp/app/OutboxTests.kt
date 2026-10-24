package erp.app

import erp.app.data.ErpApi
import erp.app.data.OutboxEngine
import erp.app.data.OutboxEngine.Status
import org.junit.Test
import kotlin.test.assertEquals
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

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxTests {
    private class Sent(val op: String, val fields: Map<String, Any?>, val id: String)

    private var next = 0
    private var disk: String? = null
    private val sent = ArrayList<Sent>()
    private var failWith: ((Int) -> Exception?)? = null

    private fun TestScope.engine() = OutboxEngine(
        scope = this,
        send = { op, fields, id ->
            sent += Sent(op, fields, id)
            failWith?.invoke(sent.size)?.let { throw it }
        },
        load = { disk },
        save = { disk = it },
        newId = { "entry-${next++}" },
    )

    @Test fun aSaveReturnsAtOnceAndGoesInTheBackground() = runTest {
        val o = engine()
        o.enqueue("setOrderStatus", mapOf("orderId" to "O1", "status" to "ready"), "Order O1")
        assertEquals(1, o.pending, "queued before anything is sent")
        assertTrue(sent.isEmpty())
        runCurrent()
        assertEquals(listOf("setOrderStatus"), sent.map { it.op })
        assertEquals(0, o.pending)
        assertNull(disk, "nothing left on disk once it landed")
    }

    @Test fun everyTryCarriesTheEntrysOwnName() = runTest {
        val o = engine()
        failWith = { n -> if (n < 3) ErpApi.Failure(0, "No connection") else null }
        o.enqueue("setRates", mapOf("rates" to mapOf("gold24" to 1)), "Rates")
        advanceUntilIdle()
        assertEquals(3, sent.size)
        assertEquals(1, sent.map { it.id }.toSet().size, "a retry is the same change to the ERP")
    }

    @Test fun retriesAfterTwoAndEightSecondsThenGivesUpWithABanner() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(0, "No connection") }
        o.enqueue("updateCustomer", mapOf("customerId" to "C1"), "Customer C1")
        runCurrent()
        assertEquals(1, sent.size)
        assertEquals(Status.Retrying, o.status("Customer C1"))
        advanceTimeBy(2_000); runCurrent()
        assertEquals(2, sent.size)
        advanceTimeBy(8_000); runCurrent()
        assertEquals(3, sent.size)
        advanceTimeBy(25_000); runCurrent()
        assertEquals(4, sent.size)
        advanceTimeBy(80_000); runCurrent()
        assertEquals(5, sent.size, "now, then 2, 8, 25 and 80 seconds")
        assertEquals(Status.Failed, o.status("Customer C1"))
        assertEquals("Customer C1", o.failure.value?.label)
        assertEquals("No connection", o.failure.value?.message)
        assertEquals(0, o.pending)
    }

    @Test fun aRefusalIsNotRetried() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(400, "Wrong code") }
        o.enqueue("updateKarigar", mapOf("karigarId" to "K1"), "Karigar K1")
        advanceUntilIdle()
        assertEquals(1, sent.size)
        assertEquals("Wrong code", o.failure.value?.message)
    }

    @Test fun aTimeoutAndAnExpiredTokenAreRetried() = runTest {
        for (status in listOf(401, 408, 425, 429, 500, 503)) {
            sent.clear()
            val o = engine()
            failWith = { n -> if (n == 1) ErpApi.Failure(status, "later") else null }
            o.enqueue("setRates", mapOf("n" to status), "Rates $status")
            advanceUntilIdle()
            assertEquals(2, sent.size, "$status")
            assertNull(o.failure.value, "$status")
        }
    }

    @Test fun alreadyRecordedCountsAsSaved() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(409, "already sent and recorded") }
        o.enqueue("setPieceDone", mapOf("orderId" to "O1"), "Piece")
        advanceUntilIdle()
        assertEquals(1, sent.size)
        assertNull(o.failure.value)
        assertEquals(0, o.pending)
    }

    @Test fun retryTriesAgainFromTheStart() = runTest {
        val o = engine()
        failWith = { ErpApi.Failure(422, "Nope") }
        o.enqueue("addKarigar", mapOf("karigar" to mapOf("name" to "Test")), "New karigar")
        advanceUntilIdle()
        val failed = assertNotNull(o.failure.value)
        failWith = null
        o.retry(failed.id)
        assertNull(o.failure.value)
        advanceUntilIdle()
        assertEquals(2, sent.size)
        assertEquals(sent[0].id, sent[1].id)
        assertEquals(0, o.items.value.size)
    }

    @Test fun whatAKillLeftIsSentAgainByTheSameName() = runTest {
        // First run: no line, and the app is killed while the change waits.
        failWith = { ErpApi.Failure(0, "No connection") }
        val first = engine()
        first.enqueue("updateProduct", mapOf("sku" to "S1", "piece" to mapOf("name" to "x")), "Piece S1")
        runCurrent()
        val id = sent.single().id
        assertNotNull(disk, "kept on disk")
        // Second run: a new Outbox over the same file, the line is back.
        failWith = null
        sent.clear()
        val second = engine()
        second.resume()
        runCurrent()
        assertEquals(listOf("updateProduct"), sent.map { it.op })
        assertEquals(id, sent.single().id)
        assertEquals(mapOf("name" to "x"), sent.single().fields["piece"])
        assertNull(disk)
    }

    @Test fun moneyIsNeverQueued() = runTest {
        val o = engine()
        o.enqueue("recordPayment", mapOf("invoiceId" to "I1", "amount" to 100), "Payment")
        assertEquals(0, o.pending, "not held in the outbox")
        assertNull(disk)
        runCurrent()
        assertEquals(1, sent.size, "sent at once, its own name")
    }

    @Test fun aPostSaysItsWordsAndIsNotKept() = runTest {
        val o = engine()
        val said = ArrayList<String>()
        val job = backgroundScope.launch { o.notices.collect { said += it } }
        runCurrent()
        o.post("Post 2 pieces") { "Posted to 3 places" }
        runCurrent()
        assertEquals(listOf("Posted to 3 places"), said)
        assertNull(disk)
        job.cancel()
    }
}
