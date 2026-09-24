# Graph Report - taheri-shop  (2026-09-25)

## Corpus Check
- 453 files · ~7,448,318 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 3486 nodes · 10334 edges · 192 communities (169 shown, 23 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 122 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6b306ce5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- workshop.ts
- fix-customer-cleanup.mjs
- getShopifyCredentials
- import-latest-shopify-order.mjs
- store.ts
- dependencies
- loadCustomers
- invoices/page.tsx
- import-shopify-orders.mjs
- order-form.tsx
- write/route.ts
- package.json
- rename-live-expense-descriptions.mjs
- test-shopify-sync.mjs
- test-shopify-customer-product-sync.mjs
- test-shopify-order-sync.mjs
- verifyRequestEmail
- story-editor.tsx
- order-scanner.tsx
- import-karigar-khata.mjs
- collapse-duplicate-payments.mjs
- DocumentsPage
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- photos/route.ts
- complete-items-on-completed-orders.mjs
- resolve.ts
- answers.ts
- audit-customers.mjs
- quote/route.ts
- orders/[id]/page.tsx
- story.ts
- given/page.tsx
- partner-statement.mjs
- revenue-reconciliation.mjs
- pdf-chrome.ts
- run/route.ts
- Orders workflow
- ai/route.ts
- clean-admin-notes.mjs
- repairs/page.tsx
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- order-slip-pdf.ts
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- store-config.ts
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- scripts
- ai.ts
- firebase
- calculateProductCosts
- overheads.ts
- clean-hisaab.mjs
- v
- check-counters.mjs
- import-expenses.mjs
- check-outstanding.mjs
- website/pricing.ts
- backfill-payment-credits.mjs
- health.ts
- checkout.ts
- backfill-source-orders.mjs
- bill-scanner.tsx
- import-one-shopify-order.mjs
- format
- form-drafts.ts
- invoice-pdf.ts
- partnership-settings.ts
- compilerOptions
- components.json
- public/me/route.ts
- useAppStore
- revenue.ts
- react
- triage.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- workbox-f1770938.js
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- next
- shrink-order-sample-images.mjs
- backfill-shopify-invoice-adjustments.mjs
- _lib.ts
- enable-whatsapp-notifications.mjs
- s
- Quotation Generator
- Dynamic gold-rate price recalculation
- cn
- settings/page.tsx
- tailwindcss
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- AnalyticsPage
- lib/pricing.ts
- recents.ts
- calendar/page.tsx
- DocumentCard
- r
- sheet.tsx
- gold-rates/route.ts
- tcs/route.ts
- firebase-admin
- a
- link-new-karigars.mjs
- fix-overwritten-invoices.mjs
- website/featured/route.ts
- CustomersPage
- whatsapp-local-service.js
- ref_fs
- receivables-breakdown.mjs
- google-auth-gate.tsx
- manifest.json
- cancel-tasneem-activity-log.mjs
- size-picker.tsx
- zebra-printer.ts
- health-panel.tsx
- workshop/page.tsx
- numerals.ts
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- voice-bubble.tsx
- notifications-scheduler.js
- fallback-ce627215c0e4a9af.js
- add-bank-account.mjs
- phonetics.ts
- delete-bad-invoices.mjs
- diagnose-dbs.mjs
- env-for-house.mjs
- fix-dates.mjs
- fix-invoice-dates.mjs
- link-all-karigar-expenses.mjs
- link-invoice-hisaab.mjs
- link-uzair-expenses.mjs
- invoice-item-cell.ts
- restore-orders.mjs
- restore-settings.mjs
- listen/route.ts
- AGENTS.md
- register-webhooks/route.ts
- fix-bareeka.mjs
- cleanup-test-shopify-mirror-docs.mjs
- add-bareeka-invoice.mjs
- openWhatsApp
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- diagnose-orders.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- check-settings.mjs
- OrderDetailPage
- list-invoices.mjs
- add-mina-payment.mjs
- post/page.tsx
- inspect-zahra.mjs
- fulfill/route.ts
- renumber-orders.mjs
- stockSku
- pdf-logo.ts
- Firebase 404 fallback page
- Logo (white) SVG asset
- Selling from taheri.shop — how it works, and what must be true before it is switched on
- preview-karigar-links.mjs
- add-ali-customer.mjs
- add-order-1141.mjs
- toast.tsx
- chart.tsx
- postcss.config.mjs
- Label (shadcn/ui)
- Switch (shadcn/ui)
- setup-cloud-scheduler.sh
- MyWorkPage
- KarigarForm
- check-refunded-invoices.mjs
- refund-fatima.mjs
- app-layout.tsx
- renumber-zahra.mjs
- use-toast.ts
- vcard-parser.d.ts
- loading.tsx

## God Nodes (most connected - your core abstractions)
1. `cn()` - 306 edges
2. `useAppStore` - 178 edges
3. `react` - 138 edges
4. `useToast()` - 135 edges
5. `next` - 115 edges
6. `lucide-react` - 94 edges
7. `Button` - 82 edges
8. `firebase` - 63 edges
9. `Card` - 59 edges
10. `CardContent` - 59 edges

## Surprising Connections (you probably didn't know these)
- `Selling from taheri.shop — how it works, and what must be true before it is switched on` --references--> `calculateProductPrice()`  [INFERRED]
  docs/website-checkout.md → src/lib/pricing.ts
- `The parts` --references--> `quotePiece()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/pricing.ts
- `The parts` --references--> `buildWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `The parts` --references--> `placeWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `GemsTrack POS overview` --semantically_similar_to--> `App blueprint (style + features)`  [INFERRED] [semantically similar]
  README.md → docs/blueprint.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **shadcn/ui primitives** — src_components_ui_tabs, src_components_ui_card, src_components_ui_slider, src_components_ui_popover, src_components_ui_progress, src_components_ui_toaster, src_components_ui_chart, src_components_ui_sheet, src_components_ui_scroll_area, src_components_ui_label_ui, src_components_ui_accordion, src_components_ui_drawer, src_components_ui_tooltip, src_components_ui_alert, src_components_ui_switch_ui, src_components_ui_calendar, src_components_ui_radio_group, src_components_ui_avatar, src_components_ui_menubar, src_components_ui_dialog, src_components_ui_badge, src_components_ui_sidebar [EXTRACTED 1.00]
- **Data import pipeline** — settings_contact_import_page, settings_hisaab_import_page, settings_backups_page [0.9]
- **App layout chain** — src_components_layout_main_app, src_components_layout_app_layout, src_components_auth_google_auth_gate, src_components_auth_authorization_provider [0.9]
- **Multi-tenant (silver/gold) configuration** — src_lib_firebase, src_lib_store_config [0.95]
- **Auth wrapping layer** — src_components_auth_google_auth_gate, src_components_auth_authorization_provider [1.0]
- **Custom (non-shadcn) UI** — src_components_ui_swipe_to_delete [1.0]
- **Domain entry forms (react-hook-form + zod)** — src_components_customer_customer_form, src_components_expense_expense_form, src_components_karigar_karigar_form, src_components_order_order_form, src_components_product_product_form [1.0]
- **lib/ utilities** — src_lib_gold_update, src_lib_firebase, src_lib_csv, src_lib_store_config, src_lib_utils [1.0]
- **Public printable invoice view** — view_invoice_id_layout, view_invoice_id_page [1.0]
- **Settings configuration sub-area** — settings_backups_page, settings_contact_import_page, settings_hisaab_import_page, settings_payment_methods_page, settings_printer_page, settings_weprint_api_page [1.0]
- **shadcn/ui primitives (part 2)** — src_components_ui_table, src_components_ui_separator, src_components_ui_button, src_components_ui_toast, src_components_ui_checkbox, src_components_ui_dropdown_menu, src_components_ui_select, src_components_ui_textarea, src_components_ui_input, src_components_ui_skeleton, src_components_ui_form [1.0]

## Communities (192 total, 23 thin omitted)

### Community 0 - "workshop.ts"
Cohesion: 0.17
Nodes (20): daysSince(), GET(), urgency(), GlanceRow, categoryTitle(), displayKarat(), describePlating(), KarigarJobStatus (+12 more)

### Community 1 - "fix-customer-cleanup.mjs"
Cohesion: 0.10
Nodes (18): APPLY, ATTACH_CUSTOMER_INVOICES, attachPlan, auth, custById, extract(), fbConfig, fbGet() (+10 more)

### Community 2 - "getShopifyCredentials"
Cohesion: 0.24
Nodes (15): fetchAllPages(), getShopifyCredentials(), mapCustomer(), mapInvoice(), mapInvoiceItem(), mapProduct(), existingSets(), GET() (+7 more)

### Community 3 - "import-latest-shopify-order.mjs"
Cohesion: 0.14
Nodes (18): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, fetch(), getDocById() (+10 more)

### Community 4 - "store.ts"
Cohesion: 0.04
Nodes (59): Category, devRole, firebaseConfig, ActivityLog, AppState, attachStaffPoll(), AVAILABLE_TAG_FORMATS, AVAILABLE_THEMES (+51 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (57): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+49 more)

### Community 6 - "loadCustomers"
Cohesion: 0.10
Nodes (30): CustomersAnalyticsPage(), EditCustomerPage(), CustomerDetailPage(), getStatusBadgeVariant(), GivenItemForm(), EditKarigarPage(), KarigarDetailPage(), KarigarsPage() (+22 more)

### Community 7 - "invoices/page.tsx"
Cohesion: 0.09
Nodes (53): date-fns, react-day-picker, RevenueFormData, revenueSchema, CategoryPerformanceData, COLORS, CustomerPerformanceData, DailySummaryItem (+45 more)

### Community 8 - "import-shopify-orders.mjs"
Cohesion: 0.38
Nodes (6): app, db, firebaseConfig, main(), parseCSV(), parseCSVRow()

### Community 9 - "order-form.tsx"
Cohesion: 0.05
Nodes (78): Settings: Printer (Zebra), Settings: WePrint API, EstimatedInvoice, INVOICE_COLUMNS, PhoneForm, RateInputs, NOTE: cartItemsFromStore.length is intentionally excluded from the deps below., NOTE: we do NOT delete the invoice before re-generating it. generateInvoice (+70 more)

### Community 10 - "write/route.ts"
Cohesion: 0.07
Nodes (19): Body, dynamic, ORDER_STATUSES, POST(), stripUndefined(), adminPort, clientPort, BatchCtx (+11 more)

### Community 11 - "package.json"
Cohesion: 0.05
Nodes (41): name, private, version, buffer, clsx, dotenv-cli, html5-qrcode, immer (+33 more)

### Community 12 - "rename-live-expense-descriptions.mjs"
Cohesion: 0.10
Nodes (17): ref, ref_path, EXACT_RENAMES, fallbackRename(), isAlreadyStructured(), normalizeExpenseDescription(), normalizeSpaces(), STRUCTURED_PREFIXES (+9 more)

### Community 13 - "test-shopify-sync.mjs"
Cohesion: 0.10
Nodes (21): assert(), assertEq(), createdInvoiceIds, createdShopifyIds, createInvoice(), extractFields(), fail(), fbConfig (+13 more)

### Community 14 - "test-shopify-customer-product-sync.mjs"
Cohesion: 0.10
Nodes (22): assert(), assertEq(), createdCustIds, createdProdIds, createdShopifyCustIds, createdShopifyProdIds, extractFields(), fail() (+14 more)

### Community 15 - "test-shopify-order-sync.mjs"
Cohesion: 0.12
Nodes (19): assert(), assertEq(), createdDraftIds, createdOrderIds, createOrder(), extractFields(), fail(), fbConfig (+11 more)

### Community 16 - "verifyRequestEmail"
Cohesion: 0.07
Nodes (51): ref_google_auth_library, dynamic, GET(), previewAsStaff(), BILL_SCHEMA, denyUnlessOwner(), dynamic, POST() (+43 more)

### Community 17 - "story-editor.tsx"
Cohesion: 0.07
Nodes (59): @radix-ui/react-slider, BackgroundInspector(), ColourRow(), Drag, LayerInspector(), Pills(), readTemplates(), StoryDocApi (+51 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.12
Nodes (30): money(), OrderForm(), promiseIn(), stripMeaninglessKarat(), downscale(), money(), OrderScanner(), Photo (+22 more)

### Community 19 - "import-karigar-khata.mjs"
Cohesion: 0.10
Nodes (17): APPLY, args, byName, createDoc(), ext(), fb, fetch(), H (+9 more)

### Community 20 - "collapse-duplicate-payments.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, backup, del(), ext(), fb, fetch(), getDoc() (+7 more)

### Community 21 - "DocumentsPage"
Cohesion: 0.22
Nodes (11): DocumentsPage(), importShopifyCSV(), monthKeyOf(), monthLabel(), parseCSV(), parseCSVRow(), monthKeyOf(), monthLabel() (+3 more)

### Community 22 - "sync-hisaab-rest.py"
Cohesion: 0.16
Nodes (11): json, create_hisaab(), doc_to_dict(), field_val(), Sync hisaab outstanding balances for all invoices (including Shopify-imported…, Extract Python value from Firestore field value dict., to_fs_value(), update_doc() (+3 more)

### Community 23 - "audit-duplicates.mjs"
Cohesion: 0.09
Nodes (21): args, dupExpenses, dupHisaab, dupLogs, dupRevenue, expSeen, ext(), fb (+13 more)

### Community 24 - "import-shopify-orders-by-number.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, ext(), fb, fetch(), found, getDocById(), H (+7 more)

### Community 25 - "fulfilment.ts"
Cohesion: 0.12
Nodes (32): dynamic, fail(), gate(), GET(), POST(), base(), bookPacket(), call() (+24 more)

### Community 26 - "photos/route.ts"
Cohesion: 0.24
Nodes (11): heic-convert, dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE (+3 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.10
Nodes (30): DocEntry, DocKind, DocResolution, documentHref(), documentsFor(), isRecent(), matchMethod(), matchStatus() (+22 more)

### Community 29 - "answers.ts"
Cohesion: 0.13
Nodes (23): DAYS_AHEAD, DAYS_BEHIND, daysUntilAnniversaryOf(), Occasion, occasionWhen(), upcomingOccasions(), HisaabEntry, KarigarJob (+15 more)

### Community 30 - "audit-customers.mjs"
Cohesion: 0.14
Nodes (10): auth, byNorm, extract(), fbConfig, issues, listAll(), settings, shopifyCustById (+2 more)

### Community 31 - "quote/route.ts"
Cohesion: 0.14
Nodes (26): The parts, Body, dynamic, POST(), dynamic, gate(), GET(), PUT (+18 more)

### Community 32 - "orders/[id]/page.tsx"
Cohesion: 0.10
Nodes (28): qrcode.react, FinalizeOrderFormData, finalizeOrderItemSchema, finalizeOrderSchema, NotificationType, PaymentStatus, PhoneForm, RecordAdvanceFormData (+20 more)

### Community 33 - "story.ts"
Cohesion: 0.16
Nodes (16): Palette, PALETTES, drawBackdrop(), drawStory(), drawStoryPhoto(), fitSize(), regionLuminance(), renderStoryJpeg() (+8 more)

### Community 34 - "given/page.tsx"
Cohesion: 0.10
Nodes (41): CustomerStats, detectDuplicates(), DuplicatePair, MergeCustomersDialog(), nameSimilarity(), normalizeName(), normalizePhone(), SpamCandidate (+33 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "pdf-chrome.ts"
Cohesion: 0.12
Nodes (35): daysLate(), RepairsPage(), customerLines(), drawInvoice(), alignHeadCell(), BAND, bandFor(), BRAND (+27 more)

### Community 38 - "run/route.ts"
Cohesion: 0.06
Nodes (68): @google/generative-ai, checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings(), POST() (+60 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "ai/route.ts"
Cohesion: 0.14
Nodes (30): checkSame(), dynamic, gate(), maxDuration, POST(), shopName(), prepareImage(), Aspect (+22 more)

### Community 41 - "clean-admin-notes.mjs"
Cohesion: 0.11
Nodes (18): ref_dns, APPLY, backup, byOrder, ext(), fb, getOrder(), H (+10 more)

### Community 42 - "repairs/page.tsx"
Cohesion: 0.17
Nodes (18): eventIcons, REVERTABLE_EVENTS, revertConsequences, READY_IN, STATUS_TONE, Tab, TABS, compressToDataUri() (+10 more)

### Community 43 - "audit-shopify-duplicates.mjs"
Cohesion: 0.09
Nodes (21): byPosInvoice, customerTotalDupes, dupePerExistingInvoice, duplicateSets, extractFields(), fbConfig, fbHeaders, getCollection() (+13 more)

### Community 44 - "cancel-customer-duplicate-payment.mjs"
Cohesion: 0.10
Nodes (22): amtNeedle, APPLY, args, dayOf(), debits, dupDay, extractFields(), fbConfig (+14 more)

### Community 45 - "GemsTrack POS overview"
Cohesion: 0.67
Nodes (4): Project graphify usage rules, App blueprint (style + features), GemsTrack user tutorial, GemsTrack POS overview

### Community 46 - "order-slip-pdf.ts"
Cohesion: 0.17
Nodes (17): jspdf, jspdf-autotable, ExpensesPage(), PKR(), EntityHisaabPage(), HisaabPage(), generateOrderSlipPDF(), jspdf (+9 more)

### Community 47 - "sync-hisaab-balances.mjs"
Cohesion: 0.22
Nodes (6): app, batch, customerByName, db, firebaseConfig, linkedByInvoice

### Community 48 - "reset-and-reimport.mjs"
Cohesion: 0.20
Nodes (10): app, db, delBatch, impBatch, orderMap, parseCSV(), parseCSVRow(), rows (+2 more)

### Community 49 - "fix-invoice-skus.mjs"
Cohesion: 0.50
Nodes (4): app, db, fixSku(), main()

### Community 50 - "store-config.ts"
Cohesion: 0.08
Nodes (26): src_app_globals, AppBody(), inter, Channel, didone, IconName, Utility, Toaster() (+18 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dev:mina, dev:taheri, env:mina, env:taheri, lint (+5 more)

### Community 54 - "ai.ts"
Cohesion: 0.18
Nodes (16): AiError, aiPing(), auth, call(), Candidate, CHECK_MODEL, generateImage(), generateJson() (+8 more)

### Community 55 - "firebase"
Cohesion: 0.08
Nodes (17): firebase, app, db, app, db, firebaseConfig, app, db (+9 more)

### Community 56 - "calculateProductCosts"
Cohesion: 0.18
Nodes (15): ProductsAnalyticsPage(), NewSalePage(), ProductsPage(), EditProductPage(), ProductDetailPage(), ScanPOSPage(), PrinterPageComponent(), downloadCsv() (+7 more)

### Community 57 - "overheads.ts"
Cohesion: 0.17
Nodes (20): OverheadsPage(), PKR(), signed(), BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey() (+12 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 60 - "check-counters.mjs"
Cohesion: 0.15
Nodes (11): fixes, h, homApp, homDb, maxHomInv, maxHomOrder, maxTaheriInv, maxTaheriOrder (+3 more)

### Community 61 - "import-expenses.mjs"
Cohesion: 0.33
Nodes (4): app, db, expenses, firebaseConfig

### Community 62 - "check-outstanding.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 63 - "website/pricing.ts"
Cohesion: 0.30
Nodes (9): collectionOfKey(), deliveryChargeFor(), goldRateFor(), hasColouredStones(), isDiamond(), pricingFor(), quotePiece(), config (+1 more)

### Community 64 - "backfill-payment-credits.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 65 - "health.ts"
Cohesion: 0.05
Nodes (81): dynamic, GET(), dynamic, POST(), dynamic, GET(), dynamic, maxDuration (+73 more)

### Community 66 - "checkout.ts"
Cohesion: 0.08
Nodes (36): ref_node_crypto, ref_node_path, vitest, BuildContext, BuiltOrder, CheckoutBody, CheckoutInput, CheckoutRejected (+28 more)

### Community 67 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.14
Nodes (22): BillScanner(), downscale(), money(), ScannedBill, blankCartItem(), BillDraft, BillLine, billLineToProduct() (+14 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "format"
Cohesion: 0.18
Nodes (12): AdditionalRevenuePage(), RevenueForm(), ClosedBatchCard(), DirectPaymentsCard(), day(), emptyPiece(), RepairForm(), ExportCard() (+4 more)

### Community 71 - "form-drafts.ts"
Cohesion: 0.24
Nodes (12): DraftRestoreBanner(), useFormDraft(), clearDraft(), Draft, DraftKind, DraftSummary, isWorthSaving(), keyFor() (+4 more)

### Community 72 - "invoice-pdf.ts"
Cohesion: 0.18
Nodes (16): ViewInvoicePage(), getInvoiceAdjustmentsAmount(), getInvoiceExchangeTotal(), getInvoiceExpectedGrandTotal(), InvoiceLike, OrderLike, allocate(), buildInvoicePdf() (+8 more)

### Community 73 - "partnership-settings.ts"
Cohesion: 0.23
Nodes (11): fmt(), fmtDate(), WorkingCapitalFloor(), DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry, isFloorStale(), isMonthStart() (+3 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "public/me/route.ts"
Cohesion: 0.14
Nodes (28): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), PUT, view() (+20 more)

### Community 77 - "useAppStore"
Cohesion: 0.07
Nodes (33): ActivityLogPage(), getEventTypeColor(), GivenItemsPage(), AddNewHisaabDialog(), FinalizeOrderDialog(), RecordAdvanceDialog(), ShopifyCourierOption(), HandBackDialog() (+25 more)

### Community 78 - "revenue.ts"
Cohesion: 0.15
Nodes (13): buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace(), PeriodComparison, RevenueBucket (+5 more)

### Community 79 - "react"
Cohesion: 0.09
Nodes (43): class-variance-authority, lucide-react, react, PageError(), AccountSummary, CombinedContact, InvoiceBalance, QrScanner (+35 more)

### Community 80 - "triage.ts"
Cohesion: 0.08
Nodes (38): ContactImportPage(), buildIndex(), Conflict, ConflictChoice, ConflictReason, defaultChoice(), ExistingRow, ImportPlan (+30 more)

### Community 81 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, dotenv-cli, firebase-admin, postcss, qrcode-terminal, tailwindcss, @types/heic-convert, @types/jspdf (+9 more)

### Community 82 - "cancel-tasneem-duplicate-payment.mjs"
Cohesion: 0.15
Nodes (14): APPLY, debits, extractFields(), fbConfig, fbHeaders, grandTotal, linked, listAll() (+6 more)

### Community 83 - "workbox-f1770938.js"
Cohesion: 0.19
Nodes (9): b(), constructor(), deleteCacheAndMetadata(), et, F, j(), p(), st() (+1 more)

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "next"
Cohesion: 0.09
Nodes (24): nextConfig, ref_crypto, next, POST(), allowedWhileOpen(), POST(), tail(), dynamic (+16 more)

### Community 87 - "shrink-order-sample-images.mjs"
Cohesion: 0.22
Nodes (7): sharp, APPLY, auth, fb, plan, shrinks, stamp

### Community 88 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 89 - "_lib.ts"
Cohesion: 0.12
Nodes (35): buildShopifyDraftOrderPayload(), buildShopifyOrderPayload(), findShopifyCustomerId(), findShopifyDraftOrderIdByTag(), findShopifyOrderIdByTag(), findShopifyProductIdsBySku(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID (+27 more)

### Community 90 - "enable-whatsapp-notifications.mjs"
Cohesion: 0.20
Nodes (8): APPLY, curFields, fbConfig, fields, H, params, PHONES, TOGGLES

### Community 91 - "s"
Cohesion: 0.14
Nodes (8): G, get(), k(), O(), s, T(), X(), z()

### Community 94 - "cn"
Cohesion: 0.05
Nodes (52): @radix-ui/react-accordion, @radix-ui/react-dropdown-menu, @radix-ui/react-menubar, @radix-ui/react-radio-group, AddTransactionDialog(), compactPKR(), Headline(), OngoingOrderRow() (+44 more)

### Community 95 - "settings/page.tsx"
Cohesion: 0.08
Nodes (54): @hookform/resolvers, react-hook-form, react-phone-number-input, zod, HisaabEntryFormData, hisaabEntrySchema, jspdf, PhoneForm (+46 more)

### Community 97 - "bulk-sync-pos-to-shopify.mjs"
Cohesion: 0.17
Nodes (9): APPLY, extractFields(), fbConfig, fbHeaders, INCLUDE_ORDERS, invoiceTargets, listAll(), results (+1 more)

### Community 98 - "mark-invoices-paid.mjs"
Cohesion: 0.19
Nodes (10): APPLY, ext(), fb, getDoc(), H, IDS, listAll(), now (+2 more)

### Community 99 - "regenerate-payment-link.mjs"
Cohesion: 0.18
Nodes (12): APPLY, args, extractFields(), fbConfig, H, listAll(), matched, patch() (+4 more)

### Community 100 - "who-owes-money.mjs"
Cohesion: 0.17
Nodes (9): byCust, custById, ext(), fb, grandTotal, groups, H, listAll() (+1 more)

### Community 101 - "AnalyticsPage"
Cohesion: 0.17
Nodes (18): CategoriesAnalyticsPage(), AnalyticsPage(), CoinSplit, CoinSummary, GOLD_COIN_CATEGORY, isCoinItem(), itemsOf(), side() (+10 more)

### Community 102 - "lib/pricing.ts"
Cohesion: 0.29
Nodes (9): getMetalLabel(), ProductCard(), ProductRow(), _calculateProductCostsInternal(), calculateProductPrice(), _calculateSingleMetalCost(), DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, _getRateForKarat() (+1 more)

### Community 103 - "recents.ts"
Cohesion: 0.24
Nodes (10): cache, EMPTY, listeners, load(), MAX_RECENTS, MIN_OPTIONS_FOR_RECENTS, readRecents(), SKIP (+2 more)

### Community 104 - "calendar/page.tsx"
Cohesion: 0.16
Nodes (15): vaul, CalendarEventType, CalendarPage(), dayMoney(), EventDetails(), EventsByDate, Drawer(), DrawerContent (+7 more)

### Community 105 - "DocumentCard"
Cohesion: 0.53
Nodes (6): DocumentCard(), DocumentRow(), getDocStatus(), getStatusBadgeVariant(), isShopifyDoc(), pieceCount()

### Community 106 - "r"
Cohesion: 0.24
Nodes (4): h(), i, q(), r

### Community 107 - "sheet.tsx"
Cohesion: 0.22
Nodes (9): @radix-ui/react-dialog, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle (+1 more)

### Community 108 - "gold-rates/route.ts"
Cohesion: 0.83
Nodes (3): GET(), parseRate(), scrapeGoldPk()

### Community 109 - "tcs/route.ts"
Cohesion: 1.00
Nodes (3): getBaseUrl(), getTcsTokens(), POST()

### Community 110 - "firebase-admin"
Cohesion: 0.12
Nodes (11): firebase-admin, db, privateKey, toDelete, db, privateKey, silverEntries, backupApp (+3 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 114 - "website/featured/route.ts"
Cohesion: 0.21
Nodes (14): dynamic, GET(), OPTIONS(), DELETE(), dynamic, gate(), GET(), PUT (+6 more)

### Community 115 - "CustomersPage"
Cohesion: 0.22
Nodes (9): CustomerCard(), CustomerRow(), CustomersPage(), detectSpamCustomers(), isGibberishName(), isRandomEmailLocal(), money(), pkr() (+1 more)

### Community 116 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 117 - "ref_fs"
Cohesion: 0.06
Nodes (28): db, dump, privateKey, ts, dotenv, ref_fs, ref_os, existingInvoiceIds (+20 more)

### Community 118 - "receivables-breakdown.mjs"
Cohesion: 0.22
Nodes (8): ext(), fb, H, listAll(), openOrders, orderRows, owing, receivables

### Community 119 - "google-auth-gate.tsx"
Cohesion: 0.13
Nodes (17): AuthContext, AuthContextValue, GoogleAuthGate(), googleProvider, isAllowed(), KarigarPortal, logSignIn(), parseUserAgent() (+9 more)

### Community 120 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 121 - "cancel-tasneem-activity-log.mjs"
Cohesion: 0.25
Nodes (7): APPLY, extractFields(), fbConfig, fbHeaders, listAll(), matches, toDelete

### Community 122 - "size-picker.tsx"
Cohesion: 0.42
Nodes (7): SizePicker(), categoryNeedsSize(), composeMultiSize(), isMultiPartScale(), legacyPartKeyFor(), parseMultiSize(), sizeScaleFor()

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "health-panel.tsx"
Cohesion: 0.21
Nodes (12): ActionButton(), authHeaders(), Check, CheckStatus, HealthPanel(), HealthReport, ICON, reportError() (+4 more)

### Community 125 - "workshop/page.tsx"
Cohesion: 0.15
Nodes (20): STATUS_LABEL, AgeBadge(), BoardJobCard(), KarigarAssign(), KarigarBulkAssign(), KarigarFormProps, KarigarPicker(), RankedKarigars (+12 more)

### Community 126 - "numerals.ts"
Cohesion: 0.29
Nodes (10): ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy(), SCALES (+2 more)

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "voice-bubble.tsx"
Cohesion: 0.10
Nodes (28): VoiceSettingsPage(), aliasMap(), Phase, untilLoaded(), VoiceBubble(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, HisaabEntityType, loadInvoices (+20 more)

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "fallback-ce627215c0e4a9af.js"
Cohesion: 0.24
Nodes (7): db, c(), f(), h(), n(), r(), u()

### Community 132 - "add-bank-account.mjs"
Cohesion: 0.33
Nodes (4): app, BANK_ACCOUNT, db, firebaseConfig

### Community 133 - "phonetics.ts"
Cohesion: 0.36
Nodes (10): levenshtein(), matchShape, nameScore(), phoneticKey(), rankNames(), ratio(), SCRIPTS, tokenKey() (+2 more)

### Community 134 - "delete-bad-invoices.mjs"
Cohesion: 0.33
Nodes (4): app, db, firebaseConfig, TO_DELETE

### Community 135 - "diagnose-dbs.mjs"
Cohesion: 0.33
Nodes (4): homApp, homDb, taheriApp, taheriDb

### Community 136 - "env-for-house.mjs"
Cohesion: 0.29
Nodes (5): ref_node_fs, yaml, existing, lines, merged

### Community 137 - "fix-dates.mjs"
Cohesion: 0.40
Nodes (5): app, db, firebaseConfig, main(), setDate()

### Community 138 - "fix-invoice-dates.mjs"
Cohesion: 0.40
Nodes (5): app, db, firebaseConfig, main(), setDate()

### Community 139 - "link-all-karigar-expenses.mjs"
Cohesion: 0.33
Nodes (5): app, db, expenses, karigarDefs, karigars

### Community 140 - "link-invoice-hisaab.mjs"
Cohesion: 0.33
Nodes (5): app, customersById, customersByName, db, linkedByInvoice

### Community 141 - "link-uzair-expenses.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, toLink, uzairKarigar

### Community 142 - "invoice-item-cell.ts"
Cohesion: 0.36
Nodes (8): drawItemCell(), ItemBlock, itemCellHeight(), line(), wastageGrams(), wastageLine(), wrap(), Wrapped

### Community 143 - "restore-orders.mjs"
Cohesion: 0.40
Nodes (5): app, db, findCustomerId(), firebaseConfig, main()

### Community 144 - "restore-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, firebaseConfig, SETTINGS, settingsRef

### Community 145 - "listen/route.ts"
Cohesion: 0.22
Nodes (12): denyUnlessOwner(), dynamic, POST(), READING_SCHEMA, runtime, QUERY_KINDS, documentLines(), numeralVocabulary() (+4 more)

### Community 147 - "register-webhooks/route.ts"
Cohesion: 0.38
Nodes (6): APP_URL, SHOPIFY_API_VERSION, getExistingWebhooks(), POST(), registerWebhook(), WEBHOOK_TOPICS

### Community 148 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

### Community 149 - "cleanup-test-shopify-mirror-docs.mjs"
Cohesion: 0.29
Nodes (7): APPLY, extractFields(), fbConfig, listInvoices(), settings, shopifyMirrors, targets

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "openWhatsApp"
Cohesion: 0.38
Nodes (7): FocusedKarigarView(), KarigarCard(), buildGlanceRows(), KarigarGlance(), useShare(), openWhatsApp(), formatJobListForShare()

### Community 152 - "add-uzair-skipped-entries.mjs"
Cohesion: 0.40
Nodes (4): app, db, toAdd, uzair

### Community 153 - "delete-sherbano-invoice.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 154 - "diagnose-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 155 - "do-refund-fatima.mjs"
Cohesion: 0.50
Nodes (4): cleanObject(), db, homApp, main()

### Community 156 - "link-uzair-stones.mjs"
Cohesion: 0.40
Nodes (4): app, db, toLink, uzair

### Community 157 - "check-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, env, envVars, s

### Community 159 - "OrderDetailPage"
Cohesion: 0.11
Nodes (26): CartPage(), getStatusBadgeVariant(), OrderDetailPage(), EditCartItemDialog(), n(), toDraft(), toPatch(), getSafeDefaultValues() (+18 more)

### Community 160 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 161 - "add-mina-payment.mjs"
Cohesion: 0.50
Nodes (3): app, db, payment

### Community 162 - "post/page.tsx"
Cohesion: 0.08
Nodes (44): AiImageResponse, authHeaders(), bodyFace, callAi(), checkOk(), Collection, collectionUrl(), errStatus() (+36 more)

### Community 165 - "fulfill/route.ts"
Cohesion: 0.60
Nodes (5): FulfillmentOrder, GET(), openFulfillmentOrders(), POST(), requireOwner()

### Community 166 - "renumber-orders.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, REMAP

### Community 167 - "stockSku"
Cohesion: 0.50
Nodes (4): cartItemToOrderItem(), isOneOffSku(), ONE_OFF_SKU_PREFIXES, stockSku()

### Community 168 - "pdf-logo.ts"
Cohesion: 0.60
Nodes (4): fetchLogo(), loadPdfLogo(), PdfLogo, warmPdfLogo()

### Community 171 - "Selling from taheri.shop — how it works, and what must be true before it is switched on"
Cohesion: 0.50
Nodes (3): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally

### Community 172 - "preview-karigar-links.mjs"
Cohesion: 0.33
Nodes (5): app, db, expenses, karigars, searchTerms

### Community 173 - "add-ali-customer.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 174 - "add-order-1141.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 175 - "toast.tsx"
Cohesion: 0.23
Nodes (11): @radix-ui/react-toast, Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, src_components_ui_toast_toastprovider (+3 more)

### Community 176 - "chart.tsx"
Cohesion: 0.23
Nodes (10): recharts, ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, getPayloadConfigFromPayload() (+2 more)

### Community 181 - "MyWorkPage"
Cohesion: 0.50
Nodes (4): fmt(), MyWorkPage(), OrderGroupedJobs(), groupJobsByOrder()

### Community 183 - "check-refunded-invoices.mjs"
Cohesion: 0.50
Nodes (3): app, db, refunded

### Community 185 - "app-layout.tsx"
Cohesion: 0.07
Nodes (41): Settings: Backups, Settings: Contact Import, Settings: Hisaab Import, Settings: Payment Methods, NavGroup, navGroups, NavItem, Avatar (+33 more)

### Community 188 - "use-toast.ts"
Cohesion: 0.20
Nodes (13): Action, ActionType, actionTypes, addToRemoveQueue(), dispatch(), genId(), listeners, memoryState (+5 more)

## Knowledge Gaps
- **1126 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1121 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1384 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `add-bank-account.mjs`, `store.ts`, `delete-bad-invoices.mjs`, `diagnose-dbs.mjs`, `import-shopify-orders.mjs`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `link-all-karigar-expenses.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `order-form.tsx`, `write/route.ts`, `fix-bareeka.mjs`, `add-bareeka-invoice.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `diagnose-orders.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `list-invoices.mjs`, `add-mina-payment.mjs`, `given/page.tsx`, `orders/[id]/page.tsx`, `inspect-zahra.mjs`, `invoices/page.tsx`, `renumber-orders.mjs`, `run/route.ts`, `preview-karigar-links.mjs`, `add-ali-customer.mjs`, `add-order-1141.mjs`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `check-refunded-invoices.mjs`, `refund-fatima.mjs`, `clean-hisaab.mjs`, `renumber-zahra.mjs`, `check-counters.mjs`, `import-expenses.mjs`, `check-outstanding.mjs`, `backfill-payment-credits.mjs`, `backfill-source-orders.mjs`, `partnership-settings.ts`, `react`, `settings/page.tsx`, `link-new-karigars.mjs`, `fix-overwritten-invoices.mjs`, `google-auth-gate.tsx`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.340) - this node is a cross-community bridge._
- **Why does `next` connect `next` to `workshop.ts`, `voice-bubble.tsx`, `getShopifyCredentials`, `loadCustomers`, `invoices/page.tsx`, `order-form.tsx`, `write/route.ts`, `package.json`, `verifyRequestEmail`, `listen/route.ts`, `register-webhooks/route.ts`, `fulfilment.ts`, `photos/route.ts`, `quote/route.ts`, `orders/[id]/page.tsx`, `given/page.tsx`, `post/page.tsx`, `fulfill/route.ts`, `run/route.ts`, `ai/route.ts`, `store-config.ts`, `app-layout.tsx`, `health.ts`, `public/me/route.ts`, `react`, `_lib.ts`, `settings/page.tsx`, `calendar/page.tsx`, `gold-rates/route.ts`, `tcs/route.ts`, `website/featured/route.ts`, `google-auth-gate.tsx`, `workshop/page.tsx`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1126 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._
- **Should `store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03715846994535519 - nodes in this community are weakly interconnected._