# WhatsApp reports and the monthly PDF

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### WhatsApp reports

- **The WhatsApp reports send themselves** (2026-09-30, owner: "fix this" on Settings → Notifications' "Send failed — While
  sign-in is off, messages can only go to the numbers saved in Settings"). Cause: `/api/notifications/send` and `/run` read *the
  first document* of `app_settings`, which since 29 Sep is `ad_studio_assess` (the Ad studio's lease sorts before `global`), so
  every live alert was refused and every scheduled report skipped — with a 200, so no job showed red. **Read
  `app_settings/global` by name** (`readNotifSettings` in `lib/notifications/dispatch.ts`), never `limit(1)`. The reports had
  also needed `node notifications-scheduler.js` on a computer, so only Mina's 9 pm report and the ads summary ever went; now
  `lib/notifications/schedule.ts` (tested) sets the times — checklist + overdue orders + given items at the checklist time,
  end of day, the daily report at `notifDailyReportTime` (21:00), Mondays the weekly report and karigar balances, ads 09:30,
  all Karachi time — and the `social-queue-tick` sends what is due in both projects (before its Post a Piece gate). Each goes
  once a day: a transaction claim `notif_runs/<date>_<task>` shared with `/run`, so the `ads-daily-summary` and
  `mina-daily-report` jobs can't double-send; one that reached nobody is retried at the next ticks (3 tries), up to 60 min
  late. Settings shows each report's time and last send, and **Send now** (open like the test button: only to saved numbers).
  The builders (`lib/notifications/reports.ts`, no longer `@ts-nocheck`) had never run, and were broken: the checklist threw
  (`fresh` undefined), given items and karigar batches were read by fields that don't exist, and every revenue figure summed
  completed orders instead of invoices. Now sales are invoices at `invoiceSaleValue`, a completion is dated by its invoice,
  lateness is by promised date, and karigars come from Hisaab (Taheri's is gold only, last entry July; Mina has none — it
  pays karigars through expenses).

### Monthly PDF

- **The monthly report PDF** (2026-09-30, owner: "add proper monthly report pdfs with all listed sales"): `lib/reports/monthly.ts`
  (pure, tested) builds a Karachi month on **Analytics' own rules** so the totals always match it — jewellery invoices at
  `invoiceSaleValue` on their order's date, open orders at their subtotal, other income; coins apart; cash in by
  `cashInForPeriod`; business expenses (drawings shown, not counted) — and lists **every** invoice (refunds greyed and not
  counted, coin sales marked), every open order taken, every payment by method, other income and every expense, with the
  month before for comparison. `monthly-pdf.ts` draws it A4 with the invoices' furniture (`pdf-chrome.ts`; `plain()` keeps text
  to what Helvetica can print); `monthly-server.ts` reads Firestore and the wordmark from `public/`. Two ways out: **Analytics →
  Monthly PDF** (any of the last 24 months; `/api/reports/monthly?month=2026-09`, open under open access), and the WhatsApp
  report **`monthly-report`** (`notifMonthlyReport`, off until the owner switches it on in Settings → Notifications): on the **1st at the checklist time**, the month before,
  as a PDF document (`sendWhatsAppFile` → WAHA `/api/sendFile`) with a short caption. jsPDF and its table plugin are
  `serverExternalPackages`, so the server takes jsPDF's Node build rather than bundling the browser one.
- **Trends and analytics in it** (2026-10-30, owner: "the report should show trends etc, analytics etc."):
  `monthly-insights.ts` (pure, tested; `report.insights`) on the same rules, and `monthly-charts.ts` draws them with jsPDF's own
  lines and rectangles (no image, no chart library). Page 1: six figures (Revenue, **Net profit = estimated profit less expenses**,
  Cash in, Expenses, Estimated profit, Sales), each **against last month and the same month last year**; a month still running is
  set against the *same days* of those months, never a whole one (the caption's old "no comparison" for a running month stays).
  Then revenue by day (bars), twelve months of revenue and net profit (lines, the running month's point hollow), sales by category,
  top pieces, top customers (walk-ins one row), how it was paid, expenses by category, the orders (taken, where they stand now,
  invoiced from an order, open orders with advances held and the balance to collect), **gold coins on their own card** (never in
  revenue, profit or the rankings) and, when `site_days` has the month, the website (visitors, visits, WhatsApp enquiries, top
  channels; read by `websiteInsights`, left out if it cannot be read). The sale tables follow as before. Colours: the document's
  maroon, then the house's `NEXT_PUBLIC_STORE_PALETTE` accent (Mina's is the maroon itself, so a tint of it). "Revenue less expenses"
  is still in the numbers beside Expenses, labelled as that, never as profit. Look at it without the shop's data:
  `npx tsx scripts/monthly-sample.ts 2026-09 out.pdf` (invented data, `lib/reports/monthly-fixture.ts`; set the house's variables for Mina).
  About 120 KB for a year of sales, far under WhatsApp's document limit; the live route answered 200 in 1.2 to 2.5 s with 380 KB.
- **Export on the phone** (2026-10-30, owner: "I can't export the report"): the server was fine (Cloud Run: 200s, a second or two). The iPhone
  opened the PDF in a plain sheet, and a sheet is no navigation stack, so the toolbar's **Share** button (Save to Files, Print, WhatsApp)
  never appeared: the report could be read, not taken away. It now sits in its own `NavigationStack` with Done. `PDFDocumentScreen`
  also takes a longer wait (150 s), says what it is doing while it draws, explains a 401/403 ("for the owners"), and on the Mac has **Save
  as PDF** (save panel) beside Print and Share. Android asks for the same 150 s. The route is owners' only (`NEXT_PUBLIC_STORE_OWNER_EMAILS`).

### PDFs only

- **Every WhatsApp alert and report to the shop's own numbers is a PDF** (2026-10-01, owner: "send all whatsapp
  messages/alerts/reports as proper structured pdfs only"). A builder returns an `AlertDoc` (`lib/notifications/doc.ts`:
  title, heading, figures, sections of tables, label/value pairs and text); `doc-pdf.ts` draws it on a **phone-shaped
  100 × 178 mm page** with the invoices' furniture (WhatsApp's viewer fits the page's width to the screen: A4 came out a third
  the size); `send-doc.ts` sends it with **no caption**: the file's name is the headline ("Taheri ERP · New sale · INV-000083 ·
  Rashida Modi · PKR 321,700.pdf"), the only thing the notification, the chat list and WhatsApp's search show.
- **Live alerts** (new sale, payment, new order, order completed / cancelled / refunded): the app posts only the record's id to
  `/api/notifications/alert` (`send-alert.ts`, owners and staff), which reads the record from Firestore, checks the same Settings
  switches, builds the document (`alerts.ts`) and sends it to every saved number; claimed for ten minutes in `notif_alerts` so a
  double tap sends once. The browser no longer writes the words, and **staff payments, orders and status changes now alert
  too** (they never did: the server write path had no `notify`). `/api/notifications/send` (any text to a saved number) is gone;
  Settings' **Send test** is a test PDF.
- **Scheduled reports** (`report-docs.ts`, pure, tested; `reports.ts` reads): the same figures as the texts, as tables. The
  daily report lists every payment with its method and time. The weekly report has a day-by-day table. Found with it: "today"
  was the server's UTC midnight, so a sale between midnight and 5 am Karachi counted on the day before; it is Karachi's day now
  (`karachiDayPeriod`). The ads digest is `adsDigestDoc`; the monthly report keeps its A4 file, without its caption; the
  scheduler-only gold updates go through `textDoc`.
- **Not PDFs:** what goes to customers and the community: the website checkout's messages to the customer, Post a piece,
  Investments, and the wa.me links the app opens on a phone (sent by a person from their own WhatsApp; a link cannot carry a
  file). The website order's shop copy is a PDF to the alert numbers (it went to the shop's own line, which is the sender).

### Not your own action

- (2026-10-26, owner: "why is it sending notifications to the device that is using the app or causing the notification"): an event push (a sale, a payment, an order, an order finished or cancelled) leaves out
  every phone registered to the person who caused it, whichever surface they used (web, iPhone, Android, Mac, the voice assistant): the same
  person already knows. The actor is the signed-in email on the request to `/api/notifications/alert` (`by` in `sendLiveAlert`); `push_devices`
  already keep each phone's `email`, so no new header or registration field is needed, and an old device with no email keeps receiving.
  Events nobody here caused (a customer's website order or slip, Shopify, the clock) and the person's own reports, reminders and **Send test**
  go to everyone as before. `recipientsFor` in `lib/push/send.ts`, tested in `lib/push/recipients.test.ts`.
