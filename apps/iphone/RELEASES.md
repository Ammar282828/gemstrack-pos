# Native builds asked for by hand

A line added here sends each house whose Firebase iOS app is registered (`houses.json`, `firebase.iosAppId`) to
TestFlight as version 2.0 (`.github/workflows/iphone-native.yml`), as "Run workflow" with *testflight* ticked does: a
cloud session cannot press that button, but it can push. One line per build, newest last.
- 2026-10-09: the first native 2.0 for both houses. Every screen is native (Home, Today's cash, Orders, New order, Invoices, New sale, Scan a tag, Customers, Repairs, Stock, Workshop, Expenses, Hisaab, Analytics), with everything else as the ERP's own page inside the app. Face ID lock, the widget and push.
- 2026-10-09: again, with the signing fix (Apple refused a `limit` on a bundle ID's capabilities).
- 2026-10-09: again, now that the TestFlight job installs XcodeGen before it archives.
- 2026-10-09: the audit build. Every web flow's options checked against the app (palladium karats kept, rates to four places, sizes to the profile, expense batches and partner salaries, hisaab kept in step), a payment tapped twice is taken once, the house's filled buttons readable in dark mode, and a launch at ten times the books in 2 s (was 26 s).
- 2026-10-09: drafts across devices. An order or sale begun on the phone is in the ERP's Drafts too, in the web form's own shape, so it is finished at the counter at the figures the phone showed; one finished or discarded there is cleared from the phone, never saved twice.
- 2026-10-09: the iOS round. Typing a customer's name on New sale or New order offers the book there and then (a tap picks them, a number finds its owner, numbers kept as +92), Settings and Marketing native (Posts, the site's pieces, Ads), sending a queued post and changing an ad's budget or end date natively, each confirmed with exactly where it goes or what it costs, and a cleaner iOS look.
- 2026-10-09: Edit order and Edit invoice are native: New order's and New sale's own forms opened on what is on file, saved as changes (the order keeps its quoted rates and each piece's tick and photo; the invoice keeps its number, date and payments).
- 2026-10-09: Finalize & invoice, a stock piece added and edited, a customer's profile and a karigar edited, Drafts, the calendar, the activity log and the karigar's own work list are native; the invoice is made by the ERP's own finalize, priced as the screen shows.
