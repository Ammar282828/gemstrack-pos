import SwiftUI

/// Help: how to do each thing an employee does, in a few plain steps (src/app/help/page.tsx; decision "Staff see no money":
/// "add a help feature so employees can understand everything"). A searchable list, one section per job, each guide a few
/// numbered steps in the screens' own button words; the marketing guides only for someone who has marketing
/// (`Session.marketingAccess`). Change a guide here and on the web when its screen's buttons change.
struct HelpScreen: View {
    @Environment(Session.self) private var session
    @State private var query = ""
    @State private var open: Set<String> = []

    var body: some View {
        let sections = shown
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        List {
            ForEach(sections) { (s: HelpSection) in
                LedgerSection(s.name) {
                    ForEach(s.guides) { (g: HelpGuide) in
                        DisclosureGroup(isExpanded: expanded(g.id, searching: searching)) {
                            steps(g)
                        } label: {
                            Text(g.title).font(.house(.subheadline).weight(.semibold))
                        }
                    }
                }
            }
            Section {
                Text("Something not here, or not working as it says? Ask an owner.")
                    .font(.house(.footnote))
                    .foregroundStyle(.secondary)
            }
            .listRowBackground(Color.clear)
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
        .scrollDismissesKeyboard(.interactively)
        .searchable(text: $query, prompt: "Search, e.g. payment, repair, photos")
        .overlay {
            if sections.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .navigationTitle("Help")
        .hubTitleDisplay()
    }

    private func expanded(_ id: String, searching: Bool) -> Binding<Bool> {
        Binding(
            get: { searching || open.contains(id) },
            set: { (on: Bool) in
                if on { open.insert(id) } else { open.remove(id) }
            })
    }

    @ViewBuilder
    private func steps(_ g: HelpGuide) -> some View {
        ForEach(Array(g.steps.enumerated()), id: \.offset) { pair in
            HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
                Text("\(pair.offset + 1).")
                    .font(.house(.subheadline).weight(.semibold))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Text(pair.element).font(.house(.subheadline))
            }
        }
        if let tip = g.tip {
            Text(tip)
                .font(.house(.footnote))
                .padding(pt(10))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.accent.opacity(0.08), in: .rect(cornerRadius: Radius.thumb, style: .continuous))
        }
        if let path = g.path, let label = g.pathLabel {
            NavigationLink(value: Route(path: path)) {
                Label("Open \(label)", systemImage: "arrow.right.circle")
                    .font(.house(.subheadline).weight(.medium))
            }
        }
    }

    /// The sections with the guides this person may read that match every word typed (title, steps, tip, section).
    private var shown: [HelpSection] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        let marketing = session.marketingAccess
        let metal = House.metal.lowercased() == "silver" ? "silver" : "gold"
        return HelpGuides.all(shop: session.shop.name, metal: metal).compactMap { (s: HelpSection) -> HelpSection? in
            let guides = s.guides.filter { (g: HelpGuide) in
                guard marketing || !g.marketing else { return false }
                let text = "\(s.name) \(g.title) \(g.steps.joined(separator: " ")) \(g.tip ?? "")".lowercased()
                return words.allSatisfy { (w: String) in text.contains(w) }
            }
            return guides.isEmpty ? nil : HelpSection(name: s.name, guides: guides)
        }
    }
}

struct HelpGuide: Identifiable {
    let id: String
    let title: String
    /// Where it is done, linked from the guide.
    var path: String?
    var pathLabel: String?
    let steps: [String]
    var tip: String?
    /// Only for someone with the marketing tools.
    var marketing = false
}

struct HelpSection: Identifiable {
    let name: String
    let guides: [HelpGuide]
    var id: String { name }
}

/// The guides, as the web's /help has them (src/app/help/page.tsx GUIDES): the words match the buttons on the screens.
enum HelpGuides {
    static func all(shop: String, metal: String) -> [HelpSection] {
        [
            HelpSection(name: "Selling", guides: [
                HelpGuide(id: "sale", title: "Make a sale (an invoice)", path: "/invoices/new", pathLabel: "New sale", steps: [
                    "Tap New sale, or scan the piece's tag with Scan a tag.",
                    "Add each piece: scan or search it in stock, or add a custom piece with its weight, karat and charges. The price is worked out from today's rate.",
                    "Choose the customer (search by name or number), or leave it as a walk-in.",
                    "Add a discount or gold taken in exchange if there is one.",
                    "Enter what the customer paid and how (cash, card, bank transfer). Anything left shows as due.",
                    "Tap Create invoice. The invoice opens: from there you can send it to the customer on WhatsApp or print it.",
                ], tip: "Leave a sale halfway and it waits in Drafts under its own name. New sale always starts blank."),
                HelpGuide(id: "payment", title: "Take a payment on an invoice", path: "/invoices", pathLabel: "Invoices", steps: [
                    "Open Invoices and tap the customer's invoice (search by name or invoice number).",
                    "Tap Record a payment, enter the amount and how it was paid, then Confirm.",
                    "The balance due goes down; paid in full when nothing is left.",
                ]),
                HelpGuide(id: "send", title: "Send an invoice or order to the customer", steps: [
                    "Open the invoice or order.",
                    "Tap Send to customer: the PDF goes on WhatsApp from \(shop)'s own number. Check the WhatsApp number first.",
                    "Or use the printer button to print it, or Share to send it another way.",
                ]),
            ]),
            HelpSection(name: "Orders", guides: [
                HelpGuide(id: "order", title: "Take an order", path: "/orders/add", pathLabel: "New order", steps: [
                    "Tap New order.",
                    "Choose the customer (or add a new one).",
                    "Add each piece: what it is, size, stones, finish, the expected weight, and a reference photo or several.",
                    "Set the date the customer was promised.",
                    "If the customer pays something now, record it as the advance with how it was paid.",
                    "Save. The order appears in Orders under its stage.",
                ], tip: "Sizes you enter can be saved to the customer's profile when you are asked, so next time they are already there."),
                HelpGuide(id: "find-order", title: "Check and update an order", path: "/orders", pathLabel: "Orders", steps: [
                    "Open Orders: orders are grouped by stage, each card shows its next step and when it is due.",
                    "Tap an order to open it. Use the ⋯ menu to Record an advance for money received, or Mark ready when the karigar has finished.",
                    "When a piece comes back from the karigar, enter its final weight; the price follows.",
                    "When every piece is ready the card says Ready; when the customer collects, tap Finalize & invoice: the advances come across as payments and the rest is taken on the invoice.",
                ], tip: "Late orders are marked red, due today amber. Home lists what is due first."),
                HelpGuide(id: "karigar", title: "Send an order's pieces to a karigar", steps: [
                    "Open the order.",
                    "Tap Send to karigar and choose the karigar.",
                    "They get the photo and the description on WhatsApp (never a price). The piece shows in Workshop as with them.",
                ]),
            ]),
            HelpSection(name: "Repairs", guides: [
                HelpGuide(id: "repair", title: "Take in a repair", path: "/repairs?new=1", pathLabel: "New repair", steps: [
                    "Tap New repair.",
                    "Enter the customer and phone, then each piece and what needs doing. Add another piece for more than one.",
                    "Set Ready by, the charge, and any advance received.",
                    "Save. The ticket is In the shop.",
                ]),
                HelpGuide(id: "repair-ready", title: "Repair ready and collected", path: "/repairs", pathLabel: "Repairs", steps: [
                    "When the work is done, tap Ready on the ticket, then Tell them to message the customer that it is ready.",
                    "When they collect, take the balance due and tap Hand back.",
                ]),
            ]),
            HelpSection(name: "Workshop", guides: [
                HelpGuide(id: "workshop", title: "Follow work with the karigars", path: "/workshop", pathLabel: "Workshop", steps: [
                    "Workshop shows every piece being made, by karigar, oldest first. A piece sitting too long is marked.",
                    "Each piece shows its status: Pending, In Progress or Completed. Change it as the work moves; tap a piece to see its order.",
                    "Given items lists what metal or pieces are out with each karigar.",
                ]),
            ]),
            HelpSection(name: "Customers", guides: [
                HelpGuide(id: "customer", title: "Add or find a customer", path: "/customers", pathLabel: "Customers", steps: [
                    "Open Customers and search by name or phone number.",
                    "Tap New customer to add one: name and WhatsApp number at least.",
                    "A customer's page shows their orders, invoices and sizes. The Contact button calls or messages them.",
                ]),
                HelpGuide(id: "drafts", title: "Finish something you started", path: "/drafts", pathLabel: "Drafts", steps: [
                    "A sale or order you did not save waits in Drafts, saved as you typed.",
                    "Open it to carry on where you left off, or delete it if it is not needed.",
                ]),
            ]),
            HelpSection(name: "Marketing", guides: [
                HelpGuide(id: "photos", title: "Add photos of pieces to the website", path: "/website/photos", pathLabel: "Add photos", steps: [
                    "Open Website → Add photos.",
                    "Choose the photos, the collection, and the piece's details (\(metal) weight, stones).",
                    "Upload. They appear on the website shortly after.",
                ], marketing: true),
                HelpGuide(id: "edit", title: "Edit a piece on the website", path: "/website/edit", pathLabel: "Edit a piece", steps: [
                    "Open Website → Edit a piece, find the piece, change its name, words or photos, and save. The website keeps the change.",
                ], marketing: true),
                HelpGuide(id: "design", title: "Make a post or story", path: "/design", pathLabel: "Design", steps: [
                    "Open Posts → Design. Start from a piece on the website or your own photo.",
                    "Choose the shape (story, square), arrange the text, and Publish.",
                    "Publish sends it where you tick: Instagram, the WhatsApp community, the website.",
                    "Posts → Stories has a ready story for each day from the website's pieces: post it or skip it.",
                ], marketing: true),
                HelpGuide(id: "ads", title: "Make an ad", path: "/ads/new", pathLabel: "New ad", steps: [
                    "Open Ads → New ad, choose the design and the words.",
                    "Save it. It is made paused: an owner sets the budget and turns it on.",
                    "Ad results and Insights show how ads and posts did (reach, clicks, followers).",
                ], marketing: true),
            ]),
        ]
    }
}
