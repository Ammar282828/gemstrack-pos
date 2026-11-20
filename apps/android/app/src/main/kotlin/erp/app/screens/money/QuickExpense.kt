package erp.app.screens.money

import erp.app.auth.Session

/**
 * Quick expense: the rules of the small dialog that files an expense without opening the app (the iPhone's `QuickExpense` in
 * QuickExpenseIntent.swift; decisions.md#quick-expense). Plain Kotlin so each runs on the JVM. The form itself is the Expenses
 * sheet's (`ExpenseFormSheet`), so its field rules (an amount of at least 0.01, a description, a category, a partner for a
 * salary, a karigar's hisaab) are the Expenses sheet's, not a copy.
 */
object QuickExpense {
    /** The business last filed to, kept for the whole phone (the key is phone-wide: `erp.phone.`). */
    const val LAST_KEY = "erp.phone.quickExpense.business"

    /** House of Mina: what the owner asked for first ("a way to very quickly add an expense for house of mina"). */
    const val MINA = "mina"

    /** The businesses to try, in order: the one last used, else House of Mina, else the open one, then the rest (ids on this phone only). */
    fun candidates(ids: List<String>, last: String?, open: String): List<String> =
        listOfNotNull(last, MINA, open).plus(ids).filter { it in ids }.distinct()

    /**
     * The business the dialog starts on: the first of [candidates] that is signed in on this phone, so a Mina that was never signed
     * in does not stand in front of a Taheri that is; with none signed in, the first candidate (the dialog then says to sign in there).
     * Null only with no business at all.
     */
    fun choose(ids: List<String>, last: String?, open: String, signedIn: (String) -> Boolean): String? {
        val all = candidates(ids, last, open)
        return all.firstOrNull(signedIn) ?: all.firstOrNull()
    }

    /** Why a business can't take an expense from here, in words the dialog says; null when it can (or the sign-in is still being checked). */
    fun refusal(businessName: String, state: Session.State, isOwner: Boolean): String? = when (state) {
        Session.State.SignedOut -> "Sign in to $businessName in the ERP app first."
        Session.State.NeedsSetup -> "$businessName isn't set up on this phone yet. Open the ERP app to finish."
        Session.State.SignedIn -> if (isOwner) null else "Only owners add expenses."
        Session.State.Starting, Session.State.SigningIn -> null
    }

    /** What a filed expense says (the iPhone's dialog): "Added ₨ 1,200 for tea to House of Mina ERP". */
    fun said(money: String, what: String, businessName: String): String = "Added $money for ${what.trim()} to $businessName."
}
