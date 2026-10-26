package erp.app.screens.work

import erp.app.config.Prefs
import erp.app.nav.CreateSpec
import erp.app.nav.createItems
import erp.app.screens.neworder.NewOrderLogic
import erp.app.screens.neworder.NewOrderPhoneStore
import erp.app.screens.neworder.NewOrderRoutes
import erp.app.screens.sale.SaleLinks
import erp.app.screens.sale.SaleRoutes
import erp.app.screens.sale.SaleRouting
import erp.app.screens.sale.SaleStore
import erp.app.screens.stock.StockKit
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDraft
import erp.core.entry.SaleDraft
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Saved at every change, never auto-opened (decisions.md "Drafts", owner 2026-10-25): what a New order / New sale opens on,
 * which paths continue the phone's copy on purpose, how the copy is kept per business, and where the create menu's
 * New sale goes (straight to the sale, not the New chooser).
 */
class DraftsOpeningTests {
    @Before fun house() {
        EntryHouse.id = "taheri"
        Prefs.scope = { "taheri" }
        NewOrderPhoneStore.clear()
        NewOrderPhoneStore.clear("mina")
        SaleStore.clear()
        SaleStore.clear("mina")
    }

    // What a form opens on

    @Test fun aNewFormIsBlankAndTheHeldCopyGoesToDraftsFirst() {
        assertEquals(DraftOpen.ReleaseAndBlank, DraftOpening.decide(holdsCopy = true, resumes = false, kept = true))
        assertEquals(DraftOpen.Blank, DraftOpening.decide(holdsCopy = false, resumes = false, kept = true))
        assertEquals(DraftOpen.Blank, DraftOpening.decide(holdsCopy = false, resumes = true, kept = true))
    }

    @Test fun aDraftIsContinuedOnlyOnPurpose() {
        assertEquals(DraftOpen.Continue, DraftOpening.decide(holdsCopy = true, resumes = true, kept = true))
    }

    @Test fun whereTheWorkHasNoOtherPlaceToBeFoundThePhonesCopyIsContinuedAsBefore() {
        assertEquals(DraftOpen.Continue, DraftOpening.decide(holdsCopy = true, resumes = false, kept = false))
        assertFalse(DraftOpening.kept(autoDraftForms = false, demo = false))
        assertFalse(DraftOpening.kept(autoDraftForms = true, demo = true))
        assertFalse(DraftOpening.kept(autoDraftForms = true, demo = false, canRead = false), "staff cannot read Drafts")
        assertTrue(DraftOpening.kept(autoDraftForms = null, demo = false), "drafts are on unless the shop turned them off")
    }

    // The paths that continue

    @Test fun onlyTheResumePathContinuesTheOrderAndTheSale() {
        assertTrue(NewOrderLogic.asks("/orders/add?resume=1", "resume", "1"))
        assertTrue(NewOrderLogic.asks("/orders/add?scan=parchi&resume=1", "resume", "1"))
        assertFalse(NewOrderLogic.asks("/orders/add", "resume", "1"))
        assertTrue(SaleRouting.asks("/invoices/new?resume=1", "resume", "1"))
        assertFalse(SaleRouting.asks("/invoices/new", "resume", "1"))
        assertFalse(SaleRouting.asks("/invoices/new?resume=0", "resume", "1"))
        // Both still reach their form with the query on.
        assertTrue(NewOrderRoutes.any { it.matches("/orders/add?resume=1") })
        assertTrue(SaleRoutes.any { it.matches("/invoices/new?resume=1") })
    }

    @Test fun theScreensThatPutAPieceOnTheSaleOpenItContinued() {
        assertEquals("/invoices/new?resume=1", SaleLinks.continueSale)
        assertEquals("/invoices/new?resume=1", StockKit.newSalePath)
        assertEquals("/invoices/new", SaleLinks.newSale, "a plain New sale stays blank")
    }

    // The create menu

    @Test fun newSaleInTheCreateMenuOpensTheSaleNotTheChooser() {
        val owner = createItems(CreateSpec(sale = "/new", voice = true, open = {}))
        assertEquals(listOf("New sale", "New order", "Scan", "Voice"), owner.map { it.label })
        assertEquals("/invoices/new", owner.first { it.label == "New sale" }.path)
        assertEquals("/orders/add", owner.first { it.label == "New order" }.path)
        // Staff have no New sale (the server will not save one for them).
        val staff = createItems(CreateSpec(sale = null, voice = false, open = {}))
        assertEquals(listOf("New order", "Scan"), staff.map { it.label })
    }

    // Drafts' rows

    @Test fun theNoteSaysHowManyDrafts() {
        assertEquals("1 draft", DraftsNoteWords.say(1))
        assertEquals("3 drafts", DraftsNoteWords.say(3))
    }

    // What the phone keeps, per business

    @Test fun theOrderIsKeptForTheBusinessItWasTypedIn() {
        val d = NewOrderDraft.fresh()
        d.customerName = "Sana Demo"
        NewOrderPhoneStore.save(d.copy(), now = true, business = "mina")
        assertNull(NewOrderPhoneStore.load(), "the open business has nothing")
        assertEquals("Sana Demo", assertNotNull(NewOrderPhoneStore.load("mina")).customerName)
        NewOrderPhoneStore.clear("mina")
        assertNull(NewOrderPhoneStore.load("mina"))
    }

    @Test fun aBurstOfOrderChangesLeavesTheNewestOnThePhone() {
        val d = NewOrderDraft.fresh()
        for (name in listOf("S", "Sa", "San", "Sana")) {
            d.customerName = name
            NewOrderPhoneStore.save(d.copy())
        }
        // One letter of a name is already worth keeping (isBlank), and the last write wins.
        assertEquals("Sana", assertNotNull(NewOrderPhoneStore.load()).customerName)
        NewOrderPhoneStore.save(NewOrderDraft.fresh(), now = true)
        assertNull(NewOrderPhoneStore.load(), "emptied, it goes")
    }

    @Test fun aClearAfterAWriteLeavesNothingBehind() {
        val d = NewOrderDraft.fresh()
        d.customerName = "Sana Demo"
        NewOrderPhoneStore.save(d.copy())
        NewOrderPhoneStore.clear()
        assertNull(NewOrderPhoneStore.load())
    }

    @Test fun theSaleIsKeptForTheBusinessItWasTypedIn() {
        val d = SaleDraft()
        d.customerName = "Sana Demo"
        SaleStore.save(d, "mina")
        assertNull(SaleStore.load())
        assertEquals("Sana Demo", assertNotNull(SaleStore.load("mina")).customerName)
        SaleStore.clear("mina")
        assertNull(SaleStore.load("mina"))
    }
}
