package erp.core

import erp.core.logic.SaleCustomer
import erp.core.logic.WALK_IN_ENTITY
import erp.core.logic.WALK_IN_NAME
import erp.core.logic.isWalkInName
import erp.core.logic.phoneKey
import erp.core.logic.resolveSaleCustomer
import erp.core.logic.saleCustomerKey
import erp.core.logic.shouldCreateCustomer
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/walk-in.test.ts, case for case. The book is made up: the TS one is the shape of a real
 * one (a number shared by two people, one person twice), and these names and numbers are not.
 */
class WalkInTests {
    private fun customer(id: String, name: String, phone: String? = null): Customer {
        val fields = mutableMapOf<String, Any?>("id" to id, "name" to name)
        if (phone != null) fields["phone"] = phone
        return ERPDecode.model<Customer>(fields)!!
    }

    private val book: List<Customer> by lazy {
        listOf(
            customer("cust-zoya", "Zoya Example", "+923000000101"),
            customer("cust-maria-2", "Maria Sample", "+923000000202"),
            customer("cust-maria-1", "maria  sample", "03000000202"),
            customer("cust-tasneem", "Tasneem Test", "+923000000303"),
            customer("cust-ummehani", "Ummehani Test", "+923000000303"),
            customer("cust-noPhone", "Batool Placeholder"),
            customer("cust-walkin-old", "Walk-in Customer", ""),
        )
    }

    // MARK: isWalkInName

    @Test
    fun testThePlaceholderInAnySpellingTheCounterOrOldCodeUsed() {
        for (n in listOf("Walk-in Customer", "walk-in customer", "Walk-in", "walk in", "Walkin", "  Walk-In  Customer ")) {
            assertTrue(isWalkInName(n), n)
        }
    }

    @Test
    fun testARealNameANumberOnThePlaceholderOrNothingIsNotThePlaceholder() {
        for (n in listOf("Walk-in Customer - 03000000101", "Walker", "Zoya", "")) {
            assertFalse(isWalkInName(n), n)
        }
        assertFalse(isWalkInName(null))
    }

    // MARK: phoneKey

    @Test
    fun testLocalInternationalAndBareFormsOfOneNumberAgree() {
        assertEquals("3000000101", phoneKey("0300 0000101"))
        assertEquals("3000000101", phoneKey("+92 300-0000101"))
        assertEquals("3000000101", phoneKey("923000000101"))
    }

    @Test
    fun testTooFewDigitsIsNoNumber() {
        assertEquals("", phoneKey("12345"))
        assertEquals("", phoneKey(null))
    }

    // MARK: resolveSaleCustomer

    @Test
    fun testNothingTypedAWalkInAndNoCustomerIsMade() {
        assertEquals(SaleCustomer(name = WALK_IN_NAME, phone = "", isNew = false), resolveSaleCustomer(customers = book))
        assertFalse(resolveSaleCustomer(typedName = "  ", typedPhone = " ", customers = book).isNew)
    }

    @Test
    fun testAnEditedWalkInInvoicePutsThePlaceholderBackInTheNameBoxStillAWalkIn() {
        val r = resolveSaleCustomer(typedName = "Walk-in Customer", customers = book)
        assertEquals(SaleCustomer(name = WALK_IN_NAME, phone = "", isNew = false), r)
        assertFalse(shouldCreateCustomer(r))
    }

    @Test
    fun testAPickedCustomerIsThatCustomerWithTheirNumber() {
        assertEquals(
            SaleCustomer(id = "cust-zoya", name = "Zoya Example", phone = "+923000000101", isNew = false),
            resolveSaleCustomer(selectedId = "cust-zoya", typedName = "Zoya Example", typedPhone = "", customers = book),
        )
    }

    @Test
    fun testAPickedCustomerWithNoNumberOnFileTakesTheOneTyped() {
        assertEquals("03000000555", resolveSaleCustomer(selectedId = "cust-noPhone", typedPhone = "03000000555", customers = book).phone)
    }

    @Test
    fun testAPickedIdThisDeviceHasNotLoadedIsKeptForGenerateInvoiceToRead() {
        assertEquals(
            SaleCustomer(id = "cust-elsewhere", name = "Someone", phone = "", isNew = false),
            resolveSaleCustomer(selectedId = "cust-elsewhere", typedName = "Someone", customers = book),
        )
    }

    @Test
    fun testAPickedLeftoverWalkInCustomerIsLetGoOfNotKept() {
        val r = resolveSaleCustomer(selectedId = "cust-walkin-old", typedName = "Walk-in Customer", customers = book)
        assertNull(r.id)
        assertFalse(r.isNew)
    }

    @Test
    fun testALeftoverWalkInCustomerWithANumberTypedBecomesThePersonTheNumberSays() {
        assertEquals(
            "cust-zoya",
            resolveSaleCustomer(selectedId = "cust-walkin-old", typedName = "Walk-in Customer", typedPhone = "0300 0000101", customers = book).id,
        )
    }

    @Test
    fun testATypedNameIsANewCustomer() {
        assertEquals(
            SaleCustomer(name = "Sana Example", phone = "", isNew = true),
            resolveSaleCustomer(typedName = "  Sana Example ", customers = book),
        )
    }

    @Test
    fun testANumberAloneThatNobodyHasIsANewCustomerNamedByItAsBefore() {
        val r = resolveSaleCustomer(typedPhone = "03000009999", customers = book)
        assertEquals(SaleCustomer(name = "Walk-in Customer - 03000009999", phone = "03000009999", isNew = true), r)
        assertTrue(shouldCreateCustomer(r))
    }

    @Test
    fun testANumberOnFileNoNameTypedThatCustomerNotACopy() {
        assertEquals("cust-zoya", resolveSaleCustomer(typedPhone = "0300-0000101", customers = book).id)
    }

    @Test
    fun testANumberOnFileWithTheirNameTypedAnyCaseOrSpacingThatCustomer() {
        assertEquals("cust-zoya", resolveSaleCustomer(typedName = "zoya  example", typedPhone = "+923000000101", customers = book).id)
    }

    @Test
    fun testTheSamePersonTwiceAlreadyTheFirstOfThemNeverAThird() {
        assertEquals("cust-maria-1", resolveSaleCustomer(typedName = "Maria Sample", typedPhone = "03000000202", customers = book).id)
        assertEquals("cust-maria-1", resolveSaleCustomer(typedPhone = "03000000202", customers = book).id)
    }

    @Test
    fun testANumberOnFileUnderAnotherNameIsLeftAloneTwoPeopleCanShareAPhone() {
        assertEquals(
            SaleCustomer(name = "Zainab Example", phone = "03000000101", isNew = true),
            resolveSaleCustomer(typedName = "Zainab Example", typedPhone = "03000000101", customers = book),
        )
    }

    @Test
    fun testANumberTwoDifferentPeopleShareNoNameTypedNeitherIsGuessed() {
        val r = resolveSaleCustomer(typedPhone = "03000000303", customers = book)
        assertNull(r.id)
        assertTrue(r.isNew)
    }

    @Test
    fun testANameAloneIsNeverMatchedToSomeoneInTheBookThatIsAGuess() {
        assertNull(resolveSaleCustomer(typedName = "Batool Placeholder", customers = book).id)
    }

    // MARK: shouldCreateCustomer

    @Test
    fun testOnlyAnIdLessRealName() {
        assertTrue(shouldCreateCustomer(name = "Sana Example"))
        assertFalse(shouldCreateCustomer(id = "cust-zoya", name = "Zoya"))
        assertFalse(shouldCreateCustomer(name = WALK_IN_NAME))
        assertFalse(shouldCreateCustomer(name = ""))
    }

    // MARK: saleCustomerKey

    private val names: Map<String, String> get() = book.associate { it.id to it.name }

    @Test
    fun testACustomerIsKeyedByTheirId() {
        assertEquals("cust-zoya", saleCustomerKey(customerId = "cust-zoya", customerName = "Zoya Example", currentName = { names[it] }))
    }

    @Test
    fun testANameWithNoAccountIsKeyedByTheName() {
        assertEquals("name:Shopify Buyer", saleCustomerKey(customerName = "Shopify Buyer"))
    }

    @Test
    fun testEveryShapeOfWalkInIsTheOneWalkInRow() {
        assertEquals(WALK_IN_ENTITY, saleCustomerKey())
        assertEquals(WALK_IN_ENTITY, saleCustomerKey(customerName = "Walk-in Customer"))
        assertEquals(WALK_IN_ENTITY, saleCustomerKey(customerId = WALK_IN_ENTITY, customerName = "Walk-in Customer"))
        assertEquals(
            WALK_IN_ENTITY,
            saleCustomerKey(customerId = "cust-walkin-old", customerName = "Walk-in Customer", currentName = { names[it] }),
        )
    }

    @Test
    fun testAnOldWalkInCustomerSinceRenamedToARealPersonCountsAsThatPerson() {
        assertEquals("cust-old", saleCustomerKey(customerId = "cust-old", customerName = "Walk-in Customer", currentName = { "Test Person" }))
    }

    @Test
    fun testACustomerNoLongerInTheBookFallsBackToTheNameOnTheSale() {
        assertEquals(WALK_IN_ENTITY, saleCustomerKey(customerId = "cust-gone", customerName = "Walk-in Customer", currentName = { names[it] }))
        assertEquals("cust-gone", saleCustomerKey(customerId = "cust-gone", customerName = "Hamid Test", currentName = { names[it] }))
    }

    // Not in the TS tests: the same key from the documents themselves.
    @Test
    fun testTheKeyOfAnInvoiceAndOfAnOrder() {
        val invoice = ERPDecode.model<Invoice>(mapOf("customerId" to "c1", "customerName" to "Sana Example"))!!
        val order = ERPDecode.model<Order>(mapOf("customerName" to "Fatima Sample"))!!
        assertEquals("c1", saleCustomerKey(invoice))
        assertEquals("name:Fatima Sample", saleCustomerKey(order))
    }
}
