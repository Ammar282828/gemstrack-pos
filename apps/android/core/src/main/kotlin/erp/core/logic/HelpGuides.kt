// Ported from src/app/help/page.tsx (tests: HelpGuidesTests). Decision: docs/decisions.md#staff-see-no-money.
//
// Help: how to do each thing an employee can do, in a few plain steps ("add a help feature so employees can understand
// everything", the owner, 2026-11-05). One section per job; the marketing guides only for someone who has marketing.
// The words match the buttons on the screens they describe: change a guide when its screen's buttons change.

package erp.core.logic

/** One guide. `where` is the ERP path it is done at, with the label of the "Open …" button. */
data class HelpGuide(
    val id: String,
    val title: String,
    val steps: List<String>,
    val tip: String? = null,
    val whereHref: String? = null,
    val whereLabel: String? = null,
    /** Only for someone with the marketing tools. */
    val marketing: Boolean = false,
)

data class HelpSection(val section: String, val guides: List<HelpGuide>)

object HelpGuides {
    fun all(shop: String, metal: String): List<HelpSection> = listOf(
        HelpSection(
            "Selling",
            listOf(
                HelpGuide(
                    "sale", "Make a sale (an invoice)", whereHref = "/new", whereLabel = "New sale",
                    steps = listOf(
                        "Tap New sale (top of the menu), or scan the piece's tag with Scan a tag.",
                        "Add each piece: scan or search it in stock, or add a custom piece with its weight, karat and charges. The price is worked out from today's rate.",
                        "Choose the customer (search by name or number), or leave it as a walk-in.",
                        "Add a discount or gold taken in exchange if there is one.",
                        "Enter what the customer paid and how (cash, card, bank transfer). Anything left shows as due.",
                        "Tap Create invoice. The invoice opens: from there you can send it to the customer on WhatsApp or print it.",
                    ),
                    tip = "Leave a sale halfway and it waits in Drafts under its own name. New sale always starts blank.",
                ),
                HelpGuide(
                    "payment", "Take a payment on an invoice", whereHref = "/invoices", whereLabel = "Invoices",
                    steps = listOf(
                        "Open Invoices and tap the customer's invoice (search by name or invoice number).",
                        "Tap Record a payment, enter the amount and how it was paid, then Confirm.",
                        "The balance due goes down; paid in full when nothing is left.",
                    ),
                ),
                HelpGuide(
                    "send", "Send an invoice or order to the customer",
                    steps = listOf(
                        "Open the invoice or order.",
                        "Tap Send to customer: the PDF goes on WhatsApp from $shop's own number. Check the WhatsApp number first.",
                        "Or use the printer button to print it, or Share to send it another way.",
                    ),
                ),
            ),
        ),
        HelpSection(
            "Orders",
            listOf(
                HelpGuide(
                    "order", "Take an order", whereHref = "/orders/add", whereLabel = "New order",
                    steps = listOf(
                        "Tap New order.",
                        "Choose the customer (or add a new one).",
                        "Add each piece: what it is, size, stones, finish, the expected weight, and a reference photo or several.",
                        "Set the date the customer was promised.",
                        "If the customer pays something now, record it as the advance with how it was paid.",
                        "Save. The order appears in Orders under its stage.",
                    ),
                    tip = "Sizes you enter can be saved to the customer's profile when you are asked, so next time they are already there.",
                ),
                HelpGuide(
                    "find-order", "Check and update an order", whereHref = "/orders", whereLabel = "Orders",
                    steps = listOf(
                        "Open Orders: orders are grouped by stage, each card shows its next step and when it is due.",
                        "Tap an order to open it. Use the ⋯ menu to Record an advance for money received, or Mark ready when the karigar has finished.",
                        "When a piece comes back from the karigar, enter its final weight; the price follows.",
                        "When every piece is ready the card says Ready; when the customer collects, tap Finalize & invoice: the advances come across as payments and the rest is taken on the invoice.",
                    ),
                    tip = "Late orders are marked red, due today amber. Home lists what is due first.",
                ),
                HelpGuide(
                    "karigar", "Send an order's pieces to a karigar",
                    steps = listOf(
                        "Open the order.",
                        "Tap Send to karigar and choose the karigar.",
                        "They get the photo and the description on WhatsApp (never a price). The piece shows in Workshop as with them.",
                    ),
                ),
            ),
        ),
        HelpSection(
            "Repairs",
            listOf(
                HelpGuide(
                    "repair", "Take in a repair", whereHref = "/repairs?new=1", whereLabel = "New repair",
                    steps = listOf(
                        "Tap New repair.",
                        "Enter the customer and phone, then each piece and what needs doing. Add another piece for more than one.",
                        "Set Ready by, the charge, and any advance received.",
                        "Save. The ticket is In the shop.",
                    ),
                ),
                HelpGuide(
                    "repair-ready", "Repair ready and collected", whereHref = "/repairs", whereLabel = "Repairs",
                    steps = listOf(
                        "When the work is done, tap Ready on the ticket, then Tell them to message the customer that it is ready.",
                        "When they collect, take the balance due and tap Hand back.",
                    ),
                ),
            ),
        ),
        HelpSection(
            "Workshop",
            listOf(
                HelpGuide(
                    "workshop", "Follow work with the karigars", whereHref = "/workshop", whereLabel = "Workshop",
                    steps = listOf(
                        "Workshop shows every piece being made, by karigar, oldest first. A piece sitting too long is marked.",
                        "Each piece shows its status: Pending, In Progress or Completed. Change it as the work moves; tap a piece to see its order.",
                        "Given items lists what metal or pieces are out with each karigar.",
                    ),
                ),
            ),
        ),
        HelpSection(
            "Customers",
            listOf(
                HelpGuide(
                    "customer", "Add or find a customer", whereHref = "/customers", whereLabel = "Customers",
                    steps = listOf(
                        "Open Customers and search by name or phone number.",
                        "Tap New customer to add one: name and WhatsApp number at least.",
                        "A customer's page shows their orders, invoices and sizes. The Contact button calls or messages them.",
                    ),
                ),
                HelpGuide(
                    "drafts", "Finish something you started", whereHref = "/drafts", whereLabel = "Drafts",
                    steps = listOf(
                        "A sale or order you did not save waits in Drafts, saved as you typed.",
                        "Open it to carry on where you left off, or delete it if it is not needed.",
                    ),
                ),
            ),
        ),
        HelpSection(
            "Marketing",
            listOf(
                HelpGuide(
                    "photos", "Add photos of pieces to the website", whereHref = "/website/photos", whereLabel = "Add photos", marketing = true,
                    steps = listOf(
                        "Open Website → Add photos.",
                        "Choose the photos, the collection, and the piece's details (${metal.lowercase()} weight, stones).",
                        "Upload. They appear on the website shortly after.",
                    ),
                ),
                HelpGuide(
                    "edit", "Edit a piece on the website", whereHref = "/website/edit", whereLabel = "Edit a piece", marketing = true,
                    steps = listOf("Open Website → Edit a piece, find the piece, change its name, words or photos, and save. The website keeps the change."),
                ),
                HelpGuide(
                    "design", "Make a post or story", whereHref = "/design", whereLabel = "Design", marketing = true,
                    steps = listOf(
                        "Open Posts → Design. Start from a piece on the website or your own photo.",
                        "Choose the shape (story, square), arrange the text, and Publish.",
                        "Publish sends it where you tick: Instagram, the WhatsApp community, the website.",
                        "Posts → Stories has a ready story for each day from the website's pieces: post it or skip it.",
                    ),
                ),
                HelpGuide(
                    "ads", "Make an ad", whereHref = "/ads/new", whereLabel = "New ad", marketing = true,
                    steps = listOf(
                        "Open Ads → New ad, choose the design and the words.",
                        "Save it. It is made paused: an owner sets the budget and turns it on.",
                        "Ad results and Insights show how ads and posts did (reach, clicks, followers).",
                    ),
                ),
            ),
        ),
    )

    /**
     * The sections a person sees for what they typed: every word must appear in the section, title, steps or tip (page.tsx `sections`);
     * the marketing guides only with `marketing`; a section with no guide left goes.
     */
    fun shown(shop: String, metal: String, query: String, marketing: Boolean): List<HelpSection> {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return all(shop, metal)
            .map { s ->
                s.copy(
                    guides = s.guides.filter { g ->
                        (marketing || !g.marketing) &&
                            run {
                                val hay = "${s.section} ${g.title} ${g.steps.joinToString(" ")} ${g.tip ?: ""}".lowercase()
                                words.all { hay.contains(it) }
                            }
                    },
                )
            }
            .filter { it.guides.isNotEmpty() }
    }

    /** Who has the marketing guides: owners, the marketing account, and staff who are also on the marketing list. */
    fun hasMarketing(role: String, alsoMarketing: Boolean): Boolean = role == "owner" || role == "marketing" || alsoMarketing
}
