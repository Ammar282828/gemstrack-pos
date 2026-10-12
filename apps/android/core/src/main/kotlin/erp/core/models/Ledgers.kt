package erp.core.models

import erp.core.Container
import erp.core.Decodable
import erp.core.logic.Overheads
import erp.core.logic.Partnership

/**
 * One line of the overhead sheet (src/lib/overheads.ts `OverheadItem`): what the shop has to cover
 * each month before anything is profit. Kept in `app_settings/global.overheadPlans`, never in Expenses.
 * Surprising: the id is stable across edits ("rent", "item-3"), so a line can change without being replaced.
 */
data class OverheadItem(
    val id: String,
    val label: String,
    /** PKR per month. */
    val amount: Double,
) {
    companion object : Decodable<OverheadItem> {
        override fun fromMap(m: Map<String, Any?>): OverheadItem {
            val c = Container(m)
            // `Number(i.amount) || 0`: anything that is not a figure counts as nothing.
            return OverheadItem(id = c.string("id", ""), label = c.string("label", ""), amount = c.double("amount", 0.0))
        }
    }
}

/**
 * A version of the sheet, in force from `from` ("YYYY-MM") until the next one starts (`OverheadPlan`).
 * Versioned because the sheet is also a record: a raise in November must not rewrite September's target.
 */
data class OverheadPlan(val from: String, val items: List<OverheadItem>) {
    companion object : Decodable<OverheadPlan> {
        override fun fromMap(m: Map<String, Any?>): OverheadPlan {
            val c = Container(m)
            return OverheadPlan(from = c.string("from", ""), items = c.list("items", OverheadItem))
        }
    }
}

/**
 * What /api/app/overheads answers: the plans resolved as the page resolves them (saved, else the
 * first-shape list, else the ERP's starting sheet, which only the ERP keeps), and the month the
 * benchmark starts. `saved` is false while the shop has never saved a sheet of its own.
 */
data class OverheadPlansAnswer(val start: String, val plans: List<OverheadPlan>, val saved: Boolean) {
    companion object : Decodable<OverheadPlansAnswer> {
        override fun fromMap(m: Map<String, Any?>): OverheadPlansAnswer {
            val c = Container(m)
            return OverheadPlansAnswer(
                start = c.string("start", Overheads.benchmarkStart),
                plans = c.list("plans", OverheadPlan),
                saved = c.bool("saved", false),
            )
        }
    }
}

/** How a ledger entry counts (lib/partnership.ts `LedgerCategory`): a stake in the business, or a loan it repays first. Entries logged before the loan/equity split read as equity. */
enum class PartnerLedgerCategory { equity, loan }

/** Money in from the partner, or out to them (`LedgerType`). */
enum class PartnerLedgerType { payment, withdrawal }

/**
 * One row of a partner's own book: Firestore `mina_ledger/<id>` or `ammar_ledger/<id>`, read as
 * lib/shareholders.ts `loadLedger` reads it. Surprising: `date` is a Firestore Timestamp there
 * (the app's Firestore hook turns it into ISO text), and the web's read is ordered by it, so a row
 * with no date is not on its page (`ShareholderFigures.shown` leaves it out here too). A withdrawal
 * carries the id of the "Partner Drawings" expense written beside it; "pending" is no link; an
 * expense a partner paid for shows here as a loan ("Expense paid: …"), linked to that expense.
 */
data class ShareholderLedgerRow(
    val id: String,
    val description: String,
    val amount: Double,
    /** ISO instant; "" when the document has none. */
    val date: String,
    val category: PartnerLedgerCategory,
    val type: PartnerLedgerType,
    val linkedExpenseId: String? = null,
) {
    companion object : Decodable<ShareholderLedgerRow> {
        override fun fromMap(m: Map<String, Any?>): ShareholderLedgerRow {
            val c = Container(m)
            val link = c.string("linkedExpenseId") ?: ""
            return ShareholderLedgerRow(
                id = c.string("id") ?: "",
                description = c.string("description", ""),
                amount = c.double("amount", 0.0),
                date = c.string("date", ""),
                category = if (c.string("category") == "loan") PartnerLedgerCategory.loan else PartnerLedgerCategory.equity,
                type = if (c.string("type") == "withdrawal") PartnerLedgerType.withdrawal else PartnerLedgerType.payment,
                linkedExpenseId = if (link.isEmpty() || link == "pending") null else link,
            )
        }
    }
}

/** One change of the working-capital floor (lib/partnership-settings.ts `FloorHistoryEntry`). */
data class FloorHistoryEntry(
    val value: Double,
    /** ISO instant of when it was set. */
    val date: String,
    /** Who set it; the Shareholders page names itself ("Shareholders"). */
    val by: String?,
) {
    companion object : Decodable<FloorHistoryEntry> {
        override fun fromMap(m: Map<String, Any?>): FloorHistoryEntry {
            val c = Container(m)
            return FloorHistoryEntry(value = c.double("value", 0.0), date = c.string("date", ""), by = c.string("by"))
        }
    }
}

/**
 * `app_settings/partnership` as `loadPartnershipSettings` reads it: the cash the business keeps before
 * anything is distributed, and its history. A missing or zero floor is the default, five lac.
 */
data class PartnershipSettings(
    val workingCapitalFloor: Double,
    /** ISO: the latest entry in `floorHistory`. */
    val floorLastSetAt: String?,
    val floorHistory: List<FloorHistoryEntry>,
) {
    companion object : Decodable<PartnershipSettings> {
        /** No document yet. */
        val none = PartnershipSettings(Partnership.defaultWorkingCapitalFloor, null, emptyList())

        override fun fromMap(m: Map<String, Any?>): PartnershipSettings {
            val c = Container(m)
            val floor = c.double("workingCapitalFloor") ?: 0.0
            val last = c.string("floorLastSetAt") ?: ""
            return PartnershipSettings(
                // `Number(data.workingCapitalFloor) || DEFAULT_WORKING_CAPITAL_FLOOR`
                workingCapitalFloor = if (floor != 0.0) floor else Partnership.defaultWorkingCapitalFloor,
                floorLastSetAt = if (last.isEmpty()) null else last,
                floorHistory = c.list("floorHistory", FloorHistoryEntry),
            )
        }
    }
}
