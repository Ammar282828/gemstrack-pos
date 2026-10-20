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
- 2026-10-09: an invoice's customer named or changed natively (the book offered as it is typed), House of Mina's WhatsApp message native and Taheri's PDF send confirmed natively; Overheads, Shareholders (contributions, withdrawals, salaries, the floor, the distribution calculator) and Recently removed native, deletes and Empty behind the delete code.
- 2026-10-09: the first Xcode Cloud build (2.1). Wave 3 (every operational page native, the order slip printed from the phone) and Home, Orders and Invoices redesigned.
- 2026-10-09: again, with the packages' Package.resolved committed (Xcode Cloud resolves nothing itself).
- 2026-10-12: the 10-12 review fixes (launch logo, iPad only on an iPad, sign-out, widget house, designer zoom/gradient/logo, ERPCore rules) and the UI pass: one kit (Tone, radii, Note, money rows, paid ring, hero sheen, zoom transitions, haptics), orders and invoices regrouped around who, what's owed and the next step, every screen on the kit.
- 2026-10-12: the same, numbered 2000 and up: Xcode Cloud's 2.1 (3) and (2) sat below the Mac's 1009, so no phone was offered them.
- 2026-10-12: as 2.2, since Xcode Cloud stamps its own build numbers (the 2000 offset did nothing) and 2.1 (1009) from the Mac outranked them.
- 2026-10-12: a phone that cannot register for notifications now says why to the ERP (push_devices_failed).
- 2026-10-12: Firebase no longer swizzles the app delegate (it swallowed the push token: 2.2 sat on "Registering this phone"); registration gives up with a reason after 20 s.
- 2026-10-15: Shopify chip back on Invoices; parity with the web since 10-09 (design engine v2, Design and Plan, board photos from Files/Drive/links, Analytics this month); push token fix carried.
- 2026-10-15: native Design (make, pages, resize, smart input, publish, AI tools, saved), designer v2 tools, marketing grouped as the ERP, Mina's Workshop starts on Anyone.
- 2026-10-15: no bubble when finishing an order, invoice or sheet (the zoom only from the row tapped).
- 2026-10-16: one app, many businesses (switch, add by ERP address, a widget per business); named ERP.
- 2026-10-16: House of Mina signs in inside the one app (her Firebase project's iOS app for shop.taheri.erp).
- 2026-10-16: the one app's own icon (ERP); Taheri and House of Mina as alternates.
- 2026-10-17: Ads as the web has them since 10-16: sales and ROAS, CSV to the share sheet, website audiences, a new video, a creator's post, the catalogue, bidding and set hours, A/B tests.
- 2026-10-17: Posts as the web has it since 10-16: the board's designer saves as you go and moves between designs in place, Tidy in sixties (boards over 60 designs), and the design engines rebuilt to Mina's new type rules.
- 2026-10-17: no ERP pages left behind native screens (stock photos, PDFs for repairs, expenses and hisaab, the hisaab reminder, spam clean-up, the five settings, re-make a site photo, Ads → Plan), the form-completion bubble gone, photos and big pages faster.
- 2026-10-17: no button opens the web any more (orders, invoices, stock, workshop, activity log, drafts, posts tray, Taheri book import; links on an ERP page open native screens), and every screen quieter: two-line rows, no Paid badges, each figure once.
- 2026-10-17: the large widget can show a second business under the first (Edit Widget → Second business), each in its own colours.
- 2026-10-17: the old cards and layouts back everywhere (invoices, orders, home, money, workshop, ads…), only less noisy: no Paid or Done badges, no number twice, no obvious footers.
- 2026-10-17: orders keep their status (stage words in colour, Paid) and every button; the card is cleaner: one line for what it is, its next step a small capsule.
- 2026-10-17: order and invoice cards open on the first tap again (the zoom's tap recogniser, added 10-15, took taps from the list's rows).
- 2026-10-17: Invoices: the three figures in one slim row (Owed to you · Today · This month), not a hero card and two tiles; payments in whole rupees.
- 2026-10-17: no decimals in money anywhere in the app: every amount box on the number pad in whole rupees, messages and slips in whole rupees, under a rupee counts as settled.
- 2026-10-17: Insights, as the web has it since today: Instagram and Facebook, organic beside paid (Overview, Posts, Audience), what the numbers say worked out on the server.
- 2026-10-17: bills in whole rupees as the ERP works them (each line rounded), round-off offers under the discount (New sale, New order, Finalize, Change discount), and Settle — give the remaining off — on payments and advances.
- 2026-10-17: Settle is one write on the ERP (settleInvoicePayment, settleOrderAdvance): the payment and its discount together, the order's status untouched.
- 2026-10-17: the UI scan. Every screen held to one rule set (CONVENTIONS rule 16): glass only on the controls, each page's one action pinned at the foot, refusals as alerts not red text, every delete asking first, one tap per event, figures and rows that move animate, sums readable at large text, the lock cover unreachable underneath.
- 2026-10-20: a fast start. A cold start asks which business to open (Settings › Businesses can turn it off) while the last one's books load underneath; every shelf paints from its own copy on the phone before Firestore answers, sorted off the main thread; each launch's steps are timed and sent to the ERP (app_launches).
- 2026-10-20: the blind-spot round. Face ID covers every sheet; a payment is recorded once across timeouts and relaunches; work and books never cross between businesses; one number reader (Urdu and Arabic digits); notifications name their store and open in it; privacy manifests, crash and hang reports, widget keys revoked on sign-out, TestFlight kept fresh; a richer icon.
