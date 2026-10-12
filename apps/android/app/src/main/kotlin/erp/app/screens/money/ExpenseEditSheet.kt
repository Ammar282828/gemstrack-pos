package erp.app.screens.money

import androidx.compose.runtime.Composable
import erp.app.ui.Note
import erp.core.models.Expense

/**
 * Edit on an expense row: the web's expense form over the row (components/expense/expense-form.tsx, edit mode), filled
 * from it. The same fields and rules as Add expense (one form, `ExpenseFormSheet`): a date, a category, a description
 * and an amount of at least 0.01; paid by the business unless a partner's own cash was used; a salary says whose; a
 * karigar payment is filed under one of his hisaabs, and the hisaab it is in stays as it is until the karigar changes.
 *
 * The ERP writes it (`updateExpense`, lib/writes/expense-admin.ts) and keeps a partner's loan row true: the same
 * payer, amount and day keep the row, anything else draws it again. A karigar or a partner taken off the row goes
 * from it (the web's form kept the old karigar). The sheet stays open with the ERP's own words if it refuses (a
 * partner's drawing is the Shareholders page's).
 */
@Composable
fun ExpenseEditSheet(expense: Expense, categories: List<String>, partnership: Boolean, onDismiss: () -> Unit, onSaved: (Note) -> Unit) {
    ExpenseFormSheet(expense, categories, partnership, onDismiss, onSaved)
}
