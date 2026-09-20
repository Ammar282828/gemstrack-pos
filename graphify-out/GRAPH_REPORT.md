# Graph Report - taheri-shop  (2026-09-20)

## Corpus Check
- 390 files · ~338,929 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 3076 nodes · 9068 edges · 193 communities (171 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 121 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a76a67cf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- karigar-glance.tsx
- fix-customer-cleanup.mjs
- v
- import-latest-shopify-order.mjs
- store.ts
- dependencies
- useAppStore
- orders/[id]/page.tsx
- ref_fs
- cart/page.tsx
- write/route.ts
- package.json
- rename-live-expense-descriptions.mjs
- test-shopify-sync.mjs
- test-shopify-customer-product-sync.mjs
- test-shopify-order-sync.mjs
- verifyRequestEmail
- backfill-shopify-invoice-adjustments.mjs
- order-scanner.tsx
- import-karigar-khata.mjs
- collapse-duplicate-payments.mjs
- audit-customers.mjs
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- firebase-admin.ts
- complete-items-on-completed-orders.mjs
- resolve.ts
- view-invoice/[id]/page.tsx
- types.ts
- quote/route.ts
- invoices/page.tsx
- useToast
- checkout.ts
- partner-statement.mjs
- revenue-reconciliation.mjs
- CartPage
- partnership.ts
- Orders workflow
- loadCustomers
- clean-admin-notes.mjs
- roles.ts
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- react
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- lib/store-config.ts
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- useAppReady
- answers.ts
- firebase
- _lib.ts
- overheads.ts
- clean-hisaab.mjs
- cleanup-shopify-customers.mjs
- check-counters.mjs
- import-expenses.mjs
- check-outstanding.mjs
- refund-fatima.mjs
- backfill-payment-credits.mjs
- pitr-restore-invoices.mjs
- list-invoices.mjs
- backfill-source-orders.mjs
- bill-scanner.tsx
- import-one-shopify-order.mjs
- workshop.ts
- form-drafts.ts
- voice-bubble.tsx
- karigar-auth.ts
- compilerOptions
- components.json
- checkout/route.ts
- revenue.ts
- ShareholderFinancesPage
- GoogleAuthGate
- taheri-book.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- order-slip-pdf.ts
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- phonetics.ts
- numerals.ts
- constructor
- shopifyRequest
- app/layout.tsx
- pdf-chrome.ts
- Quotation Generator
- Dynamic gold-rate price recalculation
- cn
- lib/utils.ts
- z
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- AnalyticsPage
- triage.ts
- workbox-f1770938.js
- a
- r
- photos/route.ts
- getShopifyCredentials
- OrdersPage
- partnership-settings.ts
- vcard.ts
- .S
- link-new-karigars.mjs
- devRole
- RankedName
- scripts
- whatsapp-local-service.js
- Sheet (shadcn/ui)
- receivables-breakdown.mjs
- lib/pricing.ts
- manifest.json
- cancel-tasneem-activity-log.mjs
- checkout.test.ts
- zebra-printer.ts
- sync/order/route.ts
- mark-shopify-unfulfilled.mjs
- cleanup-test-shopify-mirror-docs.mjs
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- import-shopify-orders.mjs
- notifications-scheduler.js
- callback/route.ts
- add-bank-account.mjs
- check-settings.mjs
- delete-bad-invoices.mjs
- diagnose-dbs.mjs
- fix-bareeka.mjs
- fix-dates.mjs
- fix-invoice-dates.mjs
- link-all-karigar-expenses.mjs
- link-invoice-hisaab.mjs
- link-uzair-expenses.mjs
- preview-karigar-links.mjs
- restore-orders.mjs
- restore-settings.mjs
- Karigar
- SidebarMenuButton
- financials.ts
- Selling from taheri.shop — how it works, and what must be true before it is switched on
- add-ali-customer.mjs
- add-bareeka-invoice.mjs
- add-order-1141.mjs
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- diagnose-orders.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- renumber-orders.mjs
- detectDuplicates
- dispatch
- middleware.ts
- add-mina-payment.mjs
- check-refunded-invoices.mjs
- clear-shopify.mjs
- inspect-zahra.mjs
- migrate-silver-hisaab.mjs
- renumber-zahra.mjs
- restore-inv-000001.mjs
- gold-rates/route.ts
- Firebase 404 fallback page
- Logo (white) SVG asset
- tcs/route.ts
- detectSpamCustomers
- QrScanner
- units.ts
- toast.tsx
- Chart (shadcn/ui)
- postcss.config.mjs
- Label (shadcn/ui)
- Switch (shadcn/ui)
- setup-cloud-scheduler.sh
- Settings: Backups
- AppLayout
- Menubar (shadcn/ui)
- loading.tsx
- Sidebar (shadcn/ui)
- next.config.ts
- vcard-parser.d.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 289 edges
2. `useAppStore` - 172 edges
3. `OrderForm` - 150 edges
4. `react` - 132 edges
5. `useToast()` - 125 edges
6. `next` - 100 edges
7. `lucide-react` - 89 edges
8. `ProductForm` - 83 edges
9. `Button` - 77 edges
10. `useToast` - 70 edges

## Surprising Connections (you probably didn't know these)
- `Selling from taheri.shop — how it works, and what must be true before it is switched on` --references--> `calculateProductPrice()`  [INFERRED]
  docs/website-checkout.md → src/lib/pricing.ts
- `The parts` --references--> `buildWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `The parts` --references--> `placeWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `The parts` --references--> `quotePiece()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/pricing.ts
- `GemsTrack POS overview` --semantically_similar_to--> `App blueprint (style + features)`  [INFERRED] [semantically similar]
  README.md → docs/blueprint.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Settings configuration sub-area** — settings_backups_page, settings_contact_import_page, settings_hisaab_import_page, settings_payment_methods_page, settings_printer_page, settings_weprint_api_page [1.0]
- **Domain entry forms (react-hook-form + zod)** — src_components_customer_customer_form, src_components_expense_expense_form, src_components_karigar_karigar_form, src_components_order_order_form, src_components_product_product_form [1.0]
- **Auth wrapping layer** — src_components_auth_google_auth_gate, src_components_auth_authorization_provider [1.0]
- **App layout chain** — src_components_layout_main_app, src_components_layout_app_layout, src_components_auth_google_auth_gate, src_components_auth_authorization_provider [0.9]
- **Public printable invoice view** — view_invoice_id_layout, view_invoice_id_page [1.0]
- **Data import pipeline** — settings_contact_import_page, settings_hisaab_import_page, settings_backups_page [0.9]
- **shadcn/ui primitives** — src_components_ui_tabs, src_components_ui_card, src_components_ui_slider, src_components_ui_popover, src_components_ui_progress, src_components_ui_toaster, src_components_ui_chart, src_components_ui_sheet, src_components_ui_scroll_area, src_components_ui_label_ui, src_components_ui_accordion, src_components_ui_drawer, src_components_ui_tooltip, src_components_ui_alert, src_components_ui_switch_ui, src_components_ui_calendar, src_components_ui_radio_group, src_components_ui_avatar, src_components_ui_menubar, src_components_ui_dialog, src_components_ui_badge, src_components_ui_sidebar [EXTRACTED 1.00]
- **shadcn/ui primitives (part 2)** — src_components_ui_table, src_components_ui_separator, src_components_ui_button, src_components_ui_toast, src_components_ui_checkbox, src_components_ui_dropdown_menu, src_components_ui_select, src_components_ui_textarea, src_components_ui_input, src_components_ui_skeleton, src_components_ui_form [1.0]
- **Custom (non-shadcn) UI** — src_components_ui_swipe_to_delete [1.0]
- **Custom hooks** — src_hooks_use_mobile, src_hooks_use_gold_rates_sync, src_hooks_use_toast, src_hooks_use_store, src_hooks_use_form_field [1.0]
- **lib/ utilities** — src_lib_gold_update, src_lib_firebase, src_lib_csv, src_lib_store_config, src_lib_utils [1.0]
- **Multi-tenant (silver/gold) configuration** — src_lib_firebase, src_lib_store_config [0.95]

## Communities (193 total, 22 thin omitted)

### Community 0 - "karigar-glance.tsx"
Cohesion: 0.06
Nodes (63): @google/generative-ai, GET(), checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings() (+55 more)

### Community 1 - "fix-customer-cleanup.mjs"
Cohesion: 0.10
Nodes (18): APPLY, ATTACH_CUSTOMER_INVOICES, attachPlan, auth, custById, extract(), fbConfig, fbGet() (+10 more)

### Community 2 - "v"
Cohesion: 0.36
Nodes (4): m(), st(), U(), v

### Community 3 - "import-latest-shopify-order.mjs"
Cohesion: 0.14
Nodes (18): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, fetch(), getDocById() (+10 more)

### Community 4 - "store.ts"
Cohesion: 0.04
Nodes (68): PlatingFields(), SizePicker(), Category, ActivityLog, AppState, AVAILABLE_TAG_FORMATS, AVAILABLE_THEMES, BRACELET_BANGLE_SIZES (+60 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (56): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+48 more)

### Community 6 - "useAppStore"
Cohesion: 0.07
Nodes (47): ActivityLogPage(), getEventTypeColor(), CategoriesAnalyticsPage(), GivenItemsPage(), EntityHisaabPage(), AddNewHisaabDialog(), FinalizeOrderDialog(), RecordAdvanceDialog() (+39 more)

### Community 7 - "orders/[id]/page.tsx"
Cohesion: 0.08
Nodes (68): qrcode.react, CustomerStats, jspdf, AddTransactionDialog(), HisaabEntryFormData, hisaabEntrySchema, jspdf, PhoneForm (+60 more)

### Community 8 - "ref_fs"
Cohesion: 0.05
Nodes (36): db, dump, privateKey, ts, ref_fs, ref_os, ref_sharp, existingInvoiceIds (+28 more)

### Community 9 - "cart/page.tsx"
Cohesion: 0.05
Nodes (87): Settings: Printer (Zebra), Settings: WePrint API, EstimatedInvoice, INVOICE_COLUMNS, jspdf, PhoneForm, RateInputs, NOTE: cartItemsFromStore.length is intentionally excluded from the deps below. (+79 more)

### Community 10 - "write/route.ts"
Cohesion: 0.07
Nodes (19): Body, dynamic, ORDER_STATUSES, POST(), stripUndefined(), adminPort, clientPort, BatchCtx (+11 more)

### Community 11 - "package.json"
Cohesion: 0.05
Nodes (39): name, private, version, buffer, clsx, dotenv-cli, immer, papaparse (+31 more)

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
Cohesion: 0.10
Nodes (32): ref_google_auth_library, BILL_SCHEMA, denyUnlessOwner(), dynamic, POST(), runtime, denyUnlessOwner(), DRAFT_SCHEMA (+24 more)

### Community 17 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.13
Nodes (29): money(), OrderForm(), promiseIn(), stripMeaninglessKarat(), downscale(), money(), OrderScanner(), Photo (+21 more)

### Community 19 - "import-karigar-khata.mjs"
Cohesion: 0.10
Nodes (17): APPLY, args, byName, createDoc(), ext(), fb, fetch(), H (+9 more)

### Community 20 - "collapse-duplicate-payments.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, backup, del(), ext(), fb, fetch(), getDoc() (+7 more)

### Community 21 - "audit-customers.mjs"
Cohesion: 0.10
Nodes (16): c(), f(), h(), n(), r(), u(), auth, byNorm (+8 more)

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
Cohesion: 0.14
Nodes (27): dynamic, fail(), gate(), GET(), POST(), base(), bookPacket(), call() (+19 more)

### Community 26 - "firebase-admin.ts"
Cohesion: 0.15
Nodes (19): db, firebase-admin, fetchAllPages(), mapCustomer(), mapInvoice(), mapInvoiceItem(), mapProduct(), validateWebhookHmac() (+11 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.10
Nodes (29): DocKind, DocResolution, documentHref(), documentsFor(), isRecent(), matchMethod(), matchStatus(), normaliseDocId() (+21 more)

### Community 29 - "view-invoice/[id]/page.tsx"
Cohesion: 0.11
Nodes (24): jspdf-autotable, INVOICE_COLUMNS, jspdf, EditCartItemDialog(), n(), toDraft(), toPatch(), getSafeDefaultValues() (+16 more)

### Community 30 - "types.ts"
Cohesion: 0.14
Nodes (21): ref_node_path, vitest, BuildContext, configReadiness(), collectionOfKey(), goldRateFor(), hasColouredStones(), isDiamond() (+13 more)

### Community 31 - "quote/route.ts"
Cohesion: 0.15
Nodes (22): Body, dynamic, POST(), dynamic, gate(), GET(), PUT, catalogUrl() (+14 more)

### Community 32 - "invoices/page.tsx"
Cohesion: 0.12
Nodes (25): DocumentCard(), DocumentRow(), DocumentsPage(), DocumentType, getDocStatus(), getStatusBadgeVariant(), importShopifyCSV(), INVOICE_COLUMNS (+17 more)

### Community 33 - "useToast"
Cohesion: 0.08
Nodes (17): defaultLayout, LabelField, LabelLayout, authHeader(), fmtDate(), PullItem, ShopifyPullPanel(), FormSkeleton() (+9 more)

### Community 34 - "checkout.ts"
Cohesion: 0.14
Nodes (24): ref_node_crypto, buildWebsiteOrder(), BuiltOrder, CheckoutBody, CheckoutInput, PlacedOrder, placeWebsiteOrder(), productFor() (+16 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "CartPage"
Cohesion: 0.25
Nodes (26): CartPage(), generateInvoicePDF(), getStatusBadgeVariant(), OrderDetailPage(), ViewInvoicePage(), categorySingular(), getInvoiceAdjustmentsAmount(), describeDelivery() (+18 more)

### Community 38 - "partnership.ts"
Cohesion: 0.11
Nodes (23): calculateDistribution(), categorise(), CategorisedLedger, DistributionResult, emptyCategorisedLedger(), LedgerCategory, LedgerEntry, LedgerType (+15 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "loadCustomers"
Cohesion: 0.12
Nodes (25): CustomersAnalyticsPage(), EditCustomerPage(), CustomerDetailPage(), getStatusBadgeVariant(), CustomerCard(), CustomerRow(), CustomersPage(), money() (+17 more)

### Community 41 - "clean-admin-notes.mjs"
Cohesion: 0.11
Nodes (18): ref_dns, APPLY, backup, byOrder, ext(), fb, getOrder(), H (+10 more)

### Community 42 - "roles.ts"
Cohesion: 0.15
Nodes (21): dynamic, GET(), previewAsStaff(), isOwner(), isStaff(), isStaffCollection(), normalise(), OWNER_EMAILS (+13 more)

### Community 43 - "audit-shopify-duplicates.mjs"
Cohesion: 0.09
Nodes (21): byPosInvoice, customerTotalDupes, dupePerExistingInvoice, duplicateSets, extractFields(), fbConfig, fbHeaders, getCollection() (+13 more)

### Community 44 - "cancel-customer-duplicate-payment.mjs"
Cohesion: 0.10
Nodes (22): amtNeedle, APPLY, args, dayOf(), debits, dupDay, extractFields(), fbConfig (+14 more)

### Community 45 - "GemsTrack POS overview"
Cohesion: 0.67
Nodes (4): Project graphify usage rules, App blueprint (style + features), GemsTrack user tutorial, GemsTrack POS overview

### Community 46 - "react"
Cohesion: 0.10
Nodes (64): class-variance-authority, date-fns, lucide-react, next, react, eventIcons, REVERTABLE_EVENTS, revertConsequences (+56 more)

### Community 47 - "sync-hisaab-balances.mjs"
Cohesion: 0.22
Nodes (6): app, batch, customerByName, db, firebaseConfig, linkedByInvoice

### Community 48 - "reset-and-reimport.mjs"
Cohesion: 0.20
Nodes (10): app, db, delBatch, impBatch, orderMap, parseCSV(), parseCSVRow(), rows (+2 more)

### Community 49 - "fix-invoice-skus.mjs"
Cohesion: 0.50
Nodes (4): app, db, fixSku(), main()

### Community 50 - "lib/store-config.ts"
Cohesion: 0.10
Nodes (15): Channel, didone, IconName, Utility, useGoldRatesSync, firebaseConfig, fetchLogo(), PdfLogo (+7 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "useAppReady"
Cohesion: 0.15
Nodes (21): ProductsAnalyticsPage(), NewSalePage(), HomePage(), BulkAddProductPage(), ProductsPage(), EditProductPage(), ProductDetailPage(), ScanPOSPage() (+13 more)

### Community 54 - "answers.ts"
Cohesion: 0.15
Nodes (20): DAYS_AHEAD, DAYS_BEHIND, daysUntilAnniversaryOf(), Occasion, occasionWhen(), upcomingOccasions(), Answer, answerQuestion() (+12 more)

### Community 55 - "firebase"
Cohesion: 0.10
Nodes (13): firebase, app, db, app, db, firebaseConfig, db, db (+5 more)

### Community 56 - "_lib.ts"
Cohesion: 0.15
Nodes (17): APP_URL, findShopifyCustomerId(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID, firestoreBase(), firestoreGet(), firestoreSet(), mapCustomerToShopify() (+9 more)

### Community 57 - "overheads.ts"
Cohesion: 0.17
Nodes (20): OverheadsPage(), PKR(), signed(), BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey() (+12 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 59 - "cleanup-shopify-customers.mjs"
Cohesion: 0.40
Nodes (3): db, privateKey, toDelete

### Community 60 - "check-counters.mjs"
Cohesion: 0.15
Nodes (11): fixes, h, homApp, homDb, maxHomInv, maxHomOrder, maxTaheriInv, maxTaheriOrder (+3 more)

### Community 61 - "import-expenses.mjs"
Cohesion: 0.33
Nodes (4): app, db, expenses, firebaseConfig

### Community 62 - "check-outstanding.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 64 - "backfill-payment-credits.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 65 - "pitr-restore-invoices.mjs"
Cohesion: 0.33
Nodes (4): backupApp, backupDb, liveApp, liveDb

### Community 66 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 67 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.18
Nodes (17): BillScanner(), downscale(), money(), ScannedBill, blankCartItem(), BillDraft, BillLine, billLineToProduct() (+9 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "workshop.ts"
Cohesion: 0.21
Nodes (17): daysSince(), GET(), urgency(), OrderFormProps, categoryTitle(), displayKarat(), describePlating(), Order (+9 more)

### Community 71 - "form-drafts.ts"
Cohesion: 0.18
Nodes (16): PageError(), DraftsRow(), UnfinishedWork(), DraftRestoreBanner(), useFormDraft(), clearDraft(), Draft, DraftKind (+8 more)

### Community 72 - "voice-bubble.tsx"
Cohesion: 0.17
Nodes (16): aliasMap(), Phase, untilLoaded(), VoiceBubble(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, loadInvoices, READ_ONLY_ACTIONS, grouped (+8 more)

### Community 73 - "karigar-auth.ts"
Cohesion: 0.19
Nodes (15): POST(), FulfillmentOrder, GET(), openFulfillmentOrders(), POST(), requireOwner(), OrderItem, POST() (+7 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "checkout/route.ts"
Cohesion: 0.24
Nodes (14): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), OPTIONS(), allowedOrigins() (+6 more)

### Community 77 - "revenue.ts"
Cohesion: 0.13
Nodes (15): CalendarPage(), dayMoney(), buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace() (+7 more)

### Community 78 - "ShareholderFinancesPage"
Cohesion: 0.15
Nodes (17): AdditionalRevenuePage(), RevenueForm(), ExpensesPage(), PKR(), ClosedBatchCard(), DirectPaymentsCard(), KarigarDetailPage(), ExportCard() (+9 more)

### Community 79 - "GoogleAuthGate"
Cohesion: 0.15
Nodes (15): AuthorizationProvider, GoogleAuthGate, AuthContext, AuthContextValue, GoogleAuthGate(), googleProvider, isAllowed(), KarigarPortal (+7 more)

### Community 80 - "taheri-book.ts"
Cohesion: 0.19
Nodes (16): buildIndex(), planImport(), classify(), extractContacts(), nameKey(), phoneKey(), BookPlan, classifyOne() (+8 more)

### Community 81 - "devDependencies"
Cohesion: 0.12
Nodes (16): devDependencies, dotenv-cli, firebase-admin, postcss, qrcode-terminal, tailwindcss, @types/heic-convert, @types/jspdf (+8 more)

### Community 82 - "cancel-tasneem-duplicate-payment.mjs"
Cohesion: 0.15
Nodes (14): APPLY, debits, extractFields(), fbConfig, fbHeaders, grandTotal, linked, listAll() (+6 more)

### Community 83 - "order-slip-pdf.ts"
Cohesion: 0.23
Nodes (11): jspdf, drawItemCell(), itemCellHeight(), line(), wrap(), Wrapped, jspdf, SLIP_COLUMNS (+3 more)

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "phonetics.ts"
Cohesion: 0.24
Nodes (13): DESTINATIONS, Item, NEW, levenshtein(), matchShape, nameScore(), phoneticKey(), rankNames() (+5 more)

### Community 87 - "numerals.ts"
Cohesion: 0.21
Nodes (13): QUERY_KINDS, ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy() (+5 more)

### Community 88 - "constructor"
Cohesion: 0.19
Nodes (6): b(), constructor(), deleteCacheAndMetadata(), F, j(), p()

### Community 89 - "shopifyRequest"
Cohesion: 0.41
Nodes (13): buildShopifyOrderPayload(), findShopifyOrderIdByTag(), shopifyRequest(), createNewOrder(), handleCancel(), handleRefund(), handleUpsert(), issueRefund() (+5 more)

### Community 90 - "app/layout.tsx"
Cohesion: 0.24
Nodes (11): src_app_globals, AppBody(), inter, MainApp, MainApp(), Toaster(), useIsStoreHydrated(), warmPdfLogo() (+3 more)

### Community 91 - "pdf-chrome.ts"
Cohesion: 0.14
Nodes (13): BAND, bandFor(), BRAND, fitTextRight(), FOOTER_HEIGHT, FooterOpts, HeaderOpts, INK (+5 more)

### Community 94 - "cn"
Cohesion: 0.05
Nodes (58): @radix-ui/react-accordion, @radix-ui/react-radio-group, vaul, CalendarEventType, EventDetails(), EventsByDate, fmt(), MyWorkPage() (+50 more)

### Community 95 - "lib/utils.ts"
Cohesion: 0.09
Nodes (55): @hookform/resolvers, react-day-picker, react-hook-form, react-phone-number-input, zod, RevenueFormData, revenueSchema, GivenFormData (+47 more)

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
Cohesion: 0.24
Nodes (12): AnalyticsPage(), CoinSplit, CoinSummary, GOLD_COIN_CATEGORY, isCoinItem(), itemsOf(), side(), splitAllCoinSales() (+4 more)

### Community 102 - "triage.ts"
Cohesion: 0.22
Nodes (11): ContactImportPage(), Conflict, ConflictChoice, ConflictReason, defaultChoice(), ExistingRow, ImportPlan, PendingContact (+3 more)

### Community 103 - "workbox-f1770938.js"
Cohesion: 0.33
Nodes (8): get(), h(), i, k(), O(), s, T(), X()

### Community 105 - "r"
Cohesion: 0.21
Nodes (3): et, q(), r

### Community 106 - "photos/route.ts"
Cohesion: 0.24
Nodes (11): heic-convert, dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE (+3 more)

### Community 107 - "getShopifyCredentials"
Cohesion: 0.27
Nodes (8): findShopifyProductIdsBySku(), getShopifyCredentials(), mapInvoiceToDraftOrder(), mapProductToShopify(), POST(), POST(), POST(), POST()

### Community 108 - "OrdersPage"
Cohesion: 0.21
Nodes (11): getPaymentBadgeClass(), getStatusBadgeVariant(), monthKeyOf(), monthLabel(), OrderRow(), OrdersPage(), OrderTableRow(), usePrintSlip() (+3 more)

### Community 109 - "partnership-settings.ts"
Cohesion: 0.23
Nodes (11): fmt(), fmtDate(), WorkingCapitalFloor(), DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry, isFloorStale(), isMonthStart() (+3 more)

### Community 110 - "vcard.ts"
Cohesion: 0.21
Nodes (11): ALL_TAGS, Classified, Contact, CUSTOMER_TAGS, decodeQuotedPrintable(), ExtractResult, parseVCards(), RawCard (+3 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 113 - "devRole"
Cohesion: 0.27
Nodes (10): AppLayout(), captureDevRole(), DEV_ROLE_HEADER, devRole, isDev(), attachStaffPoll(), createDataLoader(), effectiveRole() (+2 more)

### Community 114 - "RankedName"
Cohesion: 0.22
Nodes (11): NameGuess, NameGuess, AnswerContext, DocEntry, LearnedAlias, RankedName, RosterEntry, PromptContext (+3 more)

### Community 115 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:taheri, lint, notifications, start, test (+2 more)

### Community 116 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 117 - "Sheet (shadcn/ui)"
Cohesion: 0.22
Nodes (10): @radix-ui/react-dialog, Sheet (shadcn/ui), SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+2 more)

### Community 118 - "receivables-breakdown.mjs"
Cohesion: 0.22
Nodes (8): ext(), fb, H, listAll(), openOrders, orderRows, owing, receivables

### Community 119 - "lib/pricing.ts"
Cohesion: 0.29
Nodes (9): getMetalLabel(), ProductCard(), ProductRow(), _calculateProductCostsInternal(), calculateProductPrice(), _calculateSingleMetalCost(), DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, _getRateForKarat() (+1 more)

### Community 120 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 121 - "cancel-tasneem-activity-log.mjs"
Cohesion: 0.25
Nodes (7): APPLY, extractFields(), fbConfig, fbHeaders, listAll(), matches, toDelete

### Community 122 - "checkout.test.ts"
Cohesion: 0.22
Nodes (7): CheckoutRejected, bank, catalog, config, ctx, good, rates

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "sync/order/route.ts"
Cohesion: 0.50
Nodes (6): buildShopifyDraftOrderPayload(), findShopifyDraftOrderIdByTag(), cancelDraftIfPresent(), handleDraftCancel(), handleDraftUpsert(), POST()

### Community 125 - "mark-shopify-unfulfilled.mjs"
Cohesion: 0.25
Nodes (7): dotenv, APPLY, auth, fb, IDS, plan, stamp

### Community 126 - "cleanup-test-shopify-mirror-docs.mjs"
Cohesion: 0.29
Nodes (7): APPLY, extractFields(), fbConfig, listInvoices(), settings, shopifyMirrors, targets

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "import-shopify-orders.mjs"
Cohesion: 0.38
Nodes (6): app, db, firebaseConfig, main(), parseCSV(), parseCSVRow()

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "callback/route.ts"
Cohesion: 0.40
Nodes (3): ref_crypto, GET(), validateHmac()

### Community 132 - "add-bank-account.mjs"
Cohesion: 0.33
Nodes (4): app, BANK_ACCOUNT, db, firebaseConfig

### Community 133 - "check-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, env, envVars, s

### Community 134 - "delete-bad-invoices.mjs"
Cohesion: 0.33
Nodes (4): app, db, firebaseConfig, TO_DELETE

### Community 135 - "diagnose-dbs.mjs"
Cohesion: 0.33
Nodes (4): homApp, homDb, taheriApp, taheriDb

### Community 136 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

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

### Community 142 - "preview-karigar-links.mjs"
Cohesion: 0.33
Nodes (5): app, db, expenses, karigars, searchTerms

### Community 143 - "restore-orders.mjs"
Cohesion: 0.40
Nodes (5): app, db, findCustomerId(), firebaseConfig, main()

### Community 144 - "restore-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, firebaseConfig, SETTINGS, settingsRef

### Community 145 - "Karigar"
Cohesion: 0.33
Nodes (6): KarigarFormProps, RankedKarigars, HisaabEntry, Karigar, KarigarJob, BookData

### Community 146 - "SidebarMenuButton"
Cohesion: 0.33
Nodes (6): Sidebar, SidebarMenuButton, sidebarMenuButtonVariants, SidebarRail, SidebarTrigger, useSidebar()

### Community 147 - "financials.ts"
Cohesion: 0.40
Nodes (4): getInvoiceExchangeTotal(), getInvoiceExpectedGrandTotal(), InvoiceLike, OrderLike

### Community 148 - "Selling from taheri.shop — how it works, and what must be true before it is switched on"
Cohesion: 0.40
Nodes (4): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally, The parts

### Community 149 - "add-ali-customer.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "add-order-1141.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

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

### Community 157 - "renumber-orders.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, REMAP

### Community 158 - "detectDuplicates"
Cohesion: 0.40
Nodes (5): detectDuplicates(), MergeCustomersDialog(), nameSimilarity(), normalizeName(), normalizePhone()

### Community 159 - "dispatch"
Cohesion: 0.50
Nodes (5): addToRemoveQueue(), dispatch(), genId(), reducer(), Toast

### Community 160 - "middleware.ts"
Cohesion: 0.50
Nodes (4): bare(), config, LINKS_HOSTS, middleware()

### Community 161 - "add-mina-payment.mjs"
Cohesion: 0.50
Nodes (3): app, db, payment

### Community 162 - "check-refunded-invoices.mjs"
Cohesion: 0.50
Nodes (3): app, db, refunded

### Community 163 - "clear-shopify.mjs"
Cohesion: 0.50
Nodes (3): app, db, firebaseConfig

### Community 165 - "migrate-silver-hisaab.mjs"
Cohesion: 0.50
Nodes (3): db, privateKey, silverEntries

### Community 167 - "restore-inv-000001.mjs"
Cohesion: 0.50
Nodes (3): createdAt, db, homApp

### Community 168 - "gold-rates/route.ts"
Cohesion: 0.83
Nodes (3): GET(), parseRate(), scrapeGoldPk()

### Community 171 - "tcs/route.ts"
Cohesion: 1.00
Nodes (3): getBaseUrl(), getTcsTokens(), POST()

### Community 172 - "detectSpamCustomers"
Cohesion: 0.50
Nodes (4): detectSpamCustomers(), isGibberishName(), isRandomEmailLocal(), tokenGibberishScore()

### Community 173 - "QrScanner"
Cohesion: 0.24
Nodes (9): html5-qrcode, @radix-ui/react-slider, QrScanner, QrScanner, playBeep(), QrScanner(), QrScannerProps, Slider (shadcn/ui) (+1 more)

### Community 174 - "units.ts"
Cohesion: 0.67
Nodes (3): formatWeight(), GRAMS_PER_TOLA, toTola()

### Community 175 - "toast.tsx"
Cohesion: 0.23
Nodes (12): @radix-ui/react-toast, Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, src_components_ui_toast_toastprovider (+4 more)

### Community 176 - "Chart (shadcn/ui)"
Cohesion: 0.23
Nodes (11): recharts, Chart (shadcn/ui), ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent (+3 more)

### Community 181 - "Settings: Backups"
Cohesion: 0.67
Nodes (3): Settings: Backups, Settings: Contact Import, Settings: Hisaab Import

### Community 182 - "AppLayout"
Cohesion: 0.12
Nodes (20): @radix-ui/react-avatar, Settings: Payment Methods, AppLayout, NavGroup, navGroups, NavItem, Avatar (shadcn/ui), Avatar (+12 more)

### Community 183 - "Menubar (shadcn/ui)"
Cohesion: 0.11
Nodes (13): @radix-ui/react-menubar, Menubar (shadcn/ui), Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem (+5 more)

### Community 185 - "Sidebar (shadcn/ui)"
Cohesion: 0.10
Nodes (22): @radix-ui/react-slot, @radix-ui/react-tooltip, src_components_ui_sheet_sheet, Sidebar (shadcn/ui), SidebarContext, SidebarGroupAction, SidebarInput, SidebarMenuAction (+14 more)

## Knowledge Gaps
- **1040 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1035 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1291 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `import-shopify-orders.mjs`, `add-bank-account.mjs`, `store.ts`, `delete-bad-invoices.mjs`, `diagnose-dbs.mjs`, `fix-bareeka.mjs`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `link-all-karigar-expenses.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `preview-karigar-links.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `cart/page.tsx`, `write/route.ts`, `add-ali-customer.mjs`, `add-bareeka-invoice.mjs`, `add-order-1141.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `diagnose-orders.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `renumber-orders.mjs`, `view-invoice/[id]/page.tsx`, `invoices/page.tsx`, `add-mina-payment.mjs`, `check-refunded-invoices.mjs`, `clear-shopify.mjs`, `inspect-zahra.mjs`, `orders/[id]/page.tsx`, `renumber-zahra.mjs`, `restore-inv-000001.mjs`, `partnership.ts`, `react`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `lib/store-config.ts`, `clean-hisaab.mjs`, `check-counters.mjs`, `import-expenses.mjs`, `check-outstanding.mjs`, `refund-fatima.mjs`, `backfill-payment-credits.mjs`, `list-invoices.mjs`, `backfill-source-orders.mjs`, `GoogleAuthGate`, `partnership-settings.ts`, `link-new-karigars.mjs`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.368) - this node is a cross-community bridge._
- **Why does `next` connect `react` to `karigar-glance.tsx`, `callback/route.ts`, `orders/[id]/page.tsx`, `cart/page.tsx`, `write/route.ts`, `package.json`, `verifyRequestEmail`, `fulfilment.ts`, `firebase-admin.ts`, `view-invoice/[id]/page.tsx`, `quote/route.ts`, `invoices/page.tsx`, `useToast`, `middleware.ts`, `gold-rates/route.ts`, `roles.ts`, `tcs/route.ts`, `lib/store-config.ts`, `AppLayout`, `_lib.ts`, `next.config.ts`, `proxy-image/route.ts`, `workshop.ts`, `voice-bubble.tsx`, `karigar-auth.ts`, `checkout/route.ts`, `GoogleAuthGate`, `phonetics.ts`, `shopifyRequest`, `app/layout.tsx`, `cn`, `lib/utils.ts`, `photos/route.ts`, `getShopifyCredentials`, `sync/order/route.ts`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `firebase-admin` connect `firebase-admin.ts` to `pitr-restore-invoices.mjs`, `check-settings.mjs`, `migrate-silver-hisaab.mjs`, `ref_fs`, `write/route.ts`, `package.json`, `cleanup-shopify-customers.mjs`, `sync/order/route.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1040 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `karigar-glance.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06034801925212884 - nodes in this community are weakly interconnected._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._