package erp.app.screens.money

import erp.app.auth.Session
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Quick expense: which business the small window files to, and when it refuses (QuickExpenseIntent.swift's `defaultBusinessID` and failures). */
class QuickExpenseTests {
    private val ids = listOf("taheri", "mina", "acme")

    @Test fun theLastUsedBusinessComesFirst() {
        assertEquals(listOf("acme", "mina", "taheri"), QuickExpense.candidates(ids, "acme", "taheri"))
    }

    @Test fun withNoLastHouseOfMinaIsFirstThenTheOpenOne() {
        assertEquals(listOf("mina", "taheri", "acme"), QuickExpense.candidates(ids, null, "taheri"))
    }

    @Test fun aLastUsedBusinessRemovedFromThePhoneIsIgnored() {
        assertEquals(listOf("mina", "taheri", "acme"), QuickExpense.candidates(ids, "gone", "taheri"))
    }

    @Test fun withoutMinaTheOpenBusinessStarts() {
        assertEquals("taheri", QuickExpense.choose(listOf("taheri", "acme"), null, "taheri") { true })
    }

    @Test fun minaStartsWhenItIsSignedIn() {
        assertEquals("mina", QuickExpense.choose(ids, null, "taheri") { true })
    }

    @Test fun aMinaNeverSignedInDoesNotStandInFrontOfASignedInTaheri() {
        assertEquals("taheri", QuickExpense.choose(ids, null, "taheri") { it == "taheri" })
    }

    @Test fun withNoneSignedInTheFirstCandidateSaysToSignIn() {
        assertEquals("mina", QuickExpense.choose(ids, null, "taheri") { false })
    }

    @Test fun noBusinessAtAllChoosesNothing() {
        assertNull(QuickExpense.choose(emptyList(), null, "taheri") { true })
    }

    @Test fun signedOutAndNotSetUpAreSaidInTheBusinessesName() {
        assertEquals("Sign in to House of Mina ERP in the ERP app first.", QuickExpense.refusal("House of Mina ERP", Session.State.SignedOut, false))
        assertEquals("Taheri ERP isn't set up on this phone yet. Open the ERP app to finish.", QuickExpense.refusal("Taheri ERP", Session.State.NeedsSetup, false))
    }

    @Test fun onlyAnOwnerSignedInMayFile() {
        assertNull(QuickExpense.refusal("Taheri ERP", Session.State.SignedIn, true))
        assertEquals("Only owners add expenses.", QuickExpense.refusal("Taheri ERP", Session.State.SignedIn, false))
    }

    @Test fun whileTheSignInIsBeingCheckedItWaitsInsteadOfRefusing() {
        assertNull(QuickExpense.refusal("Taheri ERP", Session.State.Starting, false))
        assertNull(QuickExpense.refusal("Taheri ERP", Session.State.SigningIn, false))
    }

    @Test fun whatIsSaidTrimsTheDescription() {
        assertEquals("Added Rs 1,200 for tea to Mina ERP.", QuickExpense.said("Rs 1,200", " tea ", "Mina ERP"))
    }
}
