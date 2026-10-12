package erp.app.screens.customers

import erp.core.models.Customer
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CustomerFormsTests {
    private val sana = CustFix.customer(
        "c1", "Sana Demo", "0300 1111111",
        mapOf("email" to "sana@example.com", "city" to "Karachi", "source" to "walkin", "ringSize" to "14", "birthday" to "1990-10-06T00:00:00.000Z"),
    )

    @Test fun anUntouchedFormSendsNothing() {
        val d = CustomerDraft.of(sana)
        assertTrue(d.patch(sana).isEmpty())
        assertFalse(d.canSave(saving = false, was = sana))
    }

    @Test fun onlyWhatChangedIsSent() {
        val d = CustomerDraft.of(sana).copy(city = "  Lahore ", ringSize = "", notes = "likes studs", source = "referral")
        assertEquals(mapOf("city" to "Lahore", "ringSize" to "", "notes" to "likes studs", "source" to "referral"), d.patch(sana))
        assertTrue(d.canSave(false, sana))
        assertFalse(d.canSave(true, sana))
    }

    @Test fun anOddDateIsNeverOverwrittenWithABlank() {
        // The form shows the day in the first ten characters; typed text equal to what is on file after trimming is no change.
        val d = CustomerDraft.of(sana)
        assertFalse(d.patch(sana).containsKey("birthday"))
        assertEquals("1990-10-06", EditDay.string(EditDay.date(d.birthday)!!.let { it.plusSeconds(3600) }))
    }

    @Test fun aBlankNameIsNamedAfterTheNumberByTheErp() {
        val d = CustomerDraft.of(sana).copy(name = "   ")
        // The ERP needs the number to say it, changed or not.
        assertEquals(mapOf("name" to "", "phone" to "0300 1111111"), d.patch(sana))
    }

    @Test fun aBadEmailCannotBeSaved() {
        val d = CustomerDraft.of(sana).copy(email = "nope", city = "Lahore")
        assertFalse(d.emailOK())
        assertFalse(d.canSave(false, sana))
    }

    @Test fun editDaysAreKarachisDay() {
        // 1 Oct 2026 20:00 UTC is already 2 Oct in Karachi.
        assertEquals("2026-10-02", EditDay.string(Instant.parse("2026-10-01T20:00:00Z")))
        assertNull(EditDay.date("sometime"))
        assertNull(EditDay.date("1990-6-3"))
        assertEquals(Instant.parse("1990-06-29T19:00:00Z"), EditDay.date("1990-06-30"))
        assertEquals(Instant.parse("1990-06-29T19:00:00Z"), EditDay.date("1990-06-30T10:00:00.000Z"))
    }

    // The new customer form

    @Test fun aBlankNameBecomesTheNumberOrUnnamed() {
        assertEquals("Unnamed Customer", NewCustomerForm().nameToSave)
        assertEquals("Customer - 0300 1", NewCustomerForm(phone = " 0300 1 ").nameToSave)
        assertEquals("Sana", NewCustomerForm(name = " Sana ", phone = "1").nameToSave)
    }

    @Test fun aWalkInIsNotACustomer() {
        assertTrue(NewCustomerForm(name = "Walk-in Customer").walkIn)
        assertTrue(NewCustomerForm(name = "walk in").walkIn)
        assertFalse(NewCustomerForm(name = "Sana").walkIn)
        assertFalse(NewCustomerForm().walkIn)
        assertFalse(NewCustomerForm(name = "walk-in").canSave(saving = false))
        assertTrue(NewCustomerForm(name = "Sana").canSave(false))
        assertFalse(NewCustomerForm(name = "Sana").canSave(true))
        assertFalse(NewCustomerForm(name = "Sana", email = "bad").canSave(false))
    }

    @Test fun addCustomerSendsWhatIsFilled() {
        assertEquals(mapOf("name" to "Unnamed Customer"), NewCustomerForm().fields())
        val f = NewCustomerForm(name = "Sana", phone = " 0300 1 ", email = "", address = "House 1", source = "referral").fields()
        assertEquals(mapOf("name" to "Sana", "phone" to "0300 1", "address" to "House 1", "source" to "referral"), f)
        assertEquals(listOf("name", "phone", "address", "source"), f.keys.toList())
    }

    @Test fun theSameNumberIsAHintNotABlock() {
        val book = listOf(
            sana,
            CustFix.customer("c2", "Walk-in Customer", "0300 2222222"),
            CustFix.customer("c3", "Gone", "0300 3333333", mapOf("deletedAt" to "2026-09-01T00:00:00.000Z")),
        )
        assertEquals("c1", NewCustomerForm(phone = "+92 300 1111111").sameNumber(book)?.id)
        assertEquals("c1", NewCustomerForm(phone = "03001111111").sameNumber(book)?.id)
        assertNull(NewCustomerForm(phone = "0300 2222222").sameNumber(book))
        assertNull(NewCustomerForm(phone = "0300 3333333").sameNumber(book))
        assertNull(NewCustomerForm(phone = "").sameNumber(book))
        assertTrue(NewCustomerForm(phone = "0300 1111111", name = "Other").canSave(false))
    }

    @Test fun aSeededCustomerIsFoundByItsId() {
        val c: Customer = CustFix.customer("seed-1", "Seeded")
        CustomerSeeds.put(c)
        assertEquals("Seeded", CustomerSeeds["seed-1"]?.name)
        assertNull(CustomerSeeds["nobody"])
    }
}
