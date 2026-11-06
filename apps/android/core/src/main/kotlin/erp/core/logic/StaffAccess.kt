// Ported from src/lib/roles.ts (seesMoney, spendHidden, alsoMarketing) and src/lib/staff-pages.ts (tests: StaffAccessTests,
// from roles.test.ts and staff-pages.test.ts). Decision: docs/decisions.md#staff-see-no-money.
//
// Staff see an amount only on the one bill in hand: Orders, Invoices, Repairs, Drafts and search. Home's figures, the
// Calendar's amounts, customers' totals, karigars' pay, the margin and Analytics are the owners'. The server is the real
// boundary; the app hides. A staff member who is also on the marketing list (`alsoMarketing`, from /api/app/me) gets
// Marketing, Ads and Insights without spend, budgets or settings.

package erp.core.logic

object StaffAccess {
    /** Whether the person may see an amount outside the one bill in hand: owners only (roles.ts `seesMoney`). */
    fun seesMoney(role: String): Boolean = role == "owner"

    /** Staff who also run the marketing see no spend, budget, cost per result, ROAS or sales value (roles.ts `spendHidden`). */
    fun spendHidden(role: String, alsoMarketing: Boolean): Boolean = role == "staff" && alsoMarketing

    /** Who may use the marketing places: an owner, a marketing account, or staff who are also on the marketing list. */
    fun marketingAccess(role: String, alsoMarketing: Boolean): Boolean =
        role == "owner" || role == "marketing" || (role == "staff" && alsoMarketing)

    /** Never for staff: the books, settings, analytics, stock and the lists of what the shop earns (staff-pages.ts BLOCKED). */
    private val blocked = listOf(
        "/analytics", "/expenses", "/additional-revenue", "/overheads", "/hisaab", "/shareholders", "/settings", "/activity-log", "/today",
        "/products", "/ads/setup", "/ads/audiences", "/ads/rules", "/ads/tests",
    )

    /** Only for marketing: reachable by a staff member listed in the marketing list too. */
    private val marketingOnly = listOf("/ads", "/insights", "/website/interest")

    /** nav.ts `within`: is the path `href` or beneath it? ('/' matches only itself; a query is ignored.) */
    fun within(pathname: String, href: String): Boolean {
        val p = pathname.substringBefore('?')
        val h = href.substringBefore('?')
        return p == h || (h != "/" && p.startsWith("$h/"))
    }

    /** Whether a staff member must not open `pathname` (staff-pages.ts `staffBlocked`). */
    fun staffBlocked(pathname: String, alsoMarketing: Boolean): Boolean {
        val p = pathname.substringBefore('?')
        // A piece's own page is how a scanned tag is sold; the stock lists are not.
        if (Regex("^/products/[^/]+$").matches(p) && p != "/products/add" && p != "/products/bulk-add") return false
        if (blocked.any { within(p, it) }) return true
        if (!alsoMarketing && marketingOnly.any { within(p, it) }) return true
        return false
    }

    /** The daily budget her new ad is saved with when the account names no smallest one (spend.ts DEFAULT_PAUSED_BUDGET). */
    const val DEFAULT_PAUSED_BUDGET = 500
}
