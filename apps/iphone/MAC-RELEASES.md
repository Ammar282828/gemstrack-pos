# Mac builds

A line added here on a `claude/` branch starts Xcode Cloud's "Mac release" workflow (docs/features/mac-app.md): the Mac
app archived for TestFlight's "Shop" group, and the iPhone app built beside it as a check. The "Mac build" GitHub workflow
(`.github/workflows/mac-status.yml`) prints the run's result and every compile error. One line per build, newest last.
- 2026-10-24: the first Mac build. Every iPhone screen in a Mac window (sidebar from the ERP's map, a window per place, the menu bar's shortcuts, Settings, today's figures in the menu bar), Label LIVE printing native.
- 2026-10-24: again, with every folder converted for the Mac (web views, PDFs, scanners as files and a USB scanner field, voice, keychain) and Print with Label LIVE on a piece's tag.
- 2026-10-24: round 2: windows by Codable route, the iPad pointer's highlight and iOS-only list and search details behind platform modifiers, launch diagnostics and the tab bar iPhone-only.
- 2026-10-24: round 3, every screen Mac-shaped (tables, record windows, inspectors, one-window New sale and New order, Settings as Mac preferences, right-click and keys everywhere), Connect an AI native.
- 2026-10-24: round 4, the split-out bodies as view builders; Marketing Mac-shaped.
- 2026-10-24: round 5, labels: the interactive tag designer (Label LIVE's elements, import a .lsc), Zebra straight from the app (Browser Print, a Mac printer, a network address) with every printer mode and number, the print-job sheet.
- 2026-10-25: the lock covers sheets and panels too (MacLockSheets).
- 2026-10-25: Change the rate (finalize, order and invoice pages, silver per order) from the iPhone's screens, on the Mac; the one-window forms open with the rates on top.
- 2026-10-25: Mac sizes: the kit's pointer sizes (Metrics, Radius, rows 28, push buttons not glass, regular controls), group-box cards, no pointing hand, New sale/order/repair/scan in their own window.
- 2026-10-25: a classic Mac application: every shared spacing at 77% (pt), the system's window and list backgrounds, native rows and selection, the house in the accent.
- 2026-10-25: main merged in (light and dark separated, drafts, Siri-grade voice) with the classic-Mac pass on top.
- 2026-10-25: fluid: tables, search and Analytics memoised, every list read at launch, no business picker on launch, the window reopens on its place, ⌘K Quick Open.
- 2026-10-25: redesign, the frame: sidebar of every place and tab with saved lists and counts, the record menu, File/Edit/View/Go/Window/Help menus, Settings as a sidebar window, the rate in every toolbar, the Mac's own appearance, the kit (Mac/Kit).
- 2026-10-25: redesign, every place: Invoices, New sale, Orders, New order, Repairs, Customers, Drafts, Money, Stock, Workshop, Today, Analytics, Design, Posts, Website, Ads, Insights.
- 2026-10-25: the Mac release workflow now hands its archive to TestFlight (Shop): the redesign, to the owner's Mac.
- 2026-10-25: the first real build's fixes: the sidebar's business logo drew 500 points wide (a Menu label's picture) and pushed the window off a 13-inch screen; the toolbar is the place's alone (New and one Filter); New Sale, New Order and Search ⌘K at the sidebar's head, the rate at its foot; the inspector's toggle above the inspector; money in tables as digits; Orders in seven columns.
- 2026-10-25: polish, the selling places: Invoices, Customers, New sale, Orders, New order, Repairs fit a 13-inch screen (seven columns at most, the windows' minimums down to about 620), toolbars of New and one Filter, record windows of four actions and a More menu, the lists' work memoised; money's formatter made once.
- 2026-10-25: polish, every other place: Stock, the Workshop, My work, Drafts, the Activity log, the Calendar, Today, Today's cash, Expenses, Hisaab, Analytics and its reports, the owner's pages, Settings, Design, Posts, Website, Ads and Insights to the same rules; reports lay out side by side or stacked by the window's width.
- 2026-10-25: the polish's one compile error (ContactImportSettings: a modifier left after #endif).
- 2026-10-25: the owner's screenshots: every toolbar's buttons were at the left (`.primaryAction` is the Mac's leading edge) and the title sat over the sidebar; the sidebar's head and foot were laid over the list. Now: buttons at the right, Back/Forward before the title, New Sale/New Order/Search as the sidebar's first rows, the rate and the business below its list, no zebra stripes, one empty state on Online orders; Help › Send Page Snapshots for the builders.
- 2026-10-26: Today as a dashboard of cards: four figure cards that open their places, the month's chart beside Needs you, Due to customers and Recent sales.
- 2026-10-27: the iPhone's look on the Mac (owner, after the page snapshots): the house's ground and cards, records as the iPhone's rows (monogram, name, amount, pill) grouped as the iPhone groups them, record panels and windows as the iPhone's record page, report heads as figure cards.
- 2026-10-27: the end-to-end review's fixes: menus answer from every window and never behind the lock, every New is its own window, a window closes when another business opens, a saved list in a window is that list, Back/Forward as a browser's, snapshots off in the demo.
- 2026-10-27: one look on every page (the owner's snapshots): one figure card and even grid, titles as the sidebar's with counts, opaque foot bars, inspectors on the ground, reports at one width with level cards, tables that never clip; ⌘K types at once; the window reopens on its last place.
- 2026-10-27: Return and double-click open the picked record in every list; ⌘K types at once; Live's and Plan's icons; the window reopens on its last place.
- 2026-10-27: every Mac check green (unit and UI, every page light and dark): Return in Stock opens the picked piece.
- 2026-10-31: the order's WhatsApp on the invoice (Confirmed on WhatsApp, Cancel requested, Awaiting transfer…) in the Invoices row and the inspector, as the ERP shows it.
