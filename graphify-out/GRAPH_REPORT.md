# Graph Report - taheri-shop  (2026-09-22)

## Corpus Check
- 401 files · ~344,315 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 3157 nodes · 9218 edges · 191 communities (169 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 119 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5df32e2b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- run/route.ts
- fix-customer-cleanup.mjs
- v
- import-latest-shopify-order.mjs
- store.ts
- dependencies
- useAppStore
- orders/page.tsx
- import-shopify-orders.mjs
- cart/page.tsx
- write/route.ts
- package.json
- rename-live-expense-descriptions.mjs
- test-shopify-sync.mjs
- test-shopify-customer-product-sync.mjs
- test-shopify-order-sync.mjs
- vision/order/route.ts
- backfill-shopify-invoice-adjustments.mjs
- order-scanner.tsx
- import-karigar-khata.mjs
- collapse-duplicate-payments.mjs
- audit-customers.mjs
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- next
- complete-items-on-completed-orders.mjs
- resolve.ts
- order-form.tsx
- useIsStoreHydrated
- quote/route.ts
- DocumentsPage
- numerals.ts
- types.ts
- partner-statement.mjs
- revenue-reconciliation.mjs
- pdf-chrome.ts
- ShareholderFinancesPage
- Orders workflow
- loadOrders
- clean-admin-notes.mjs
- roles.ts
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- react
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- store-config.ts
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- Product
- answers.ts
- firebase
- app/layout.tsx
- overheads.ts
- clean-hisaab.mjs
- google-auth-gate.tsx
- check-counters.mjs
- import-expenses.mjs
- check-outstanding.mjs
- menubar.tsx
- backfill-payment-credits.mjs
- pitr-restore-invoices.mjs
- checkout.ts
- backfill-source-orders.mjs
- bill-scanner.tsx
- import-one-shopify-order.mjs
- workshop.ts
- form-drafts.ts
- app/page.tsx
- verifyRequestEmail
- compilerOptions
- components.json
- public/me/route.ts
- use-toast.ts
- revenue.ts
- invoices/page.tsx
- triage.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- workbox-f1770938.js
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- _lib.ts
- scripts
- shopifyRequest
- listen/route.ts
- format
- Quotation Generator
- Dynamic gold-rate price recalculation
- cn
- orders/[id]/page.tsx
- cleanup-shopify-customers.mjs
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- coins.ts
- invoice-item-cell.ts
- recents.ts
- Selling from taheri.shop — how it works, and what must be true before it is switched on
- migrate-silver-hisaab.mjs
- photos/route.ts
- sheet.tsx
- shrink-order-sample-images.mjs
- partnership-settings.ts
- loadCustomers
- OrderDetailPage
- link-new-karigars.mjs
- fix-overwritten-invoices.mjs
- website/featured/route.ts
- z
- whatsapp-local-service.js
- ref_fs
- receivables-breakdown.mjs
- KaratValue
- manifest.json
- cancel-tasneem-activity-log.mjs
- create-influencer-orders.mjs
- zebra-printer.ts
- order-slip-pdf.ts
- a
- OrderRow
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- voice-bubble.tsx
- notifications-scheduler.js
- constructor
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
- .S
- restore-orders.mjs
- restore-settings.mjs
- size-picker.tsx
- AGENTS.md
- invoice-pdf.ts
- fix-bareeka.mjs
- cleanup-test-shopify-mirror-docs.mjs
- add-bareeka-invoice.mjs
- app-layout.tsx
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- diagnose-orders.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- renumber-orders.mjs
- Customer
- edit-cart-item-dialog.tsx
- list-invoices.mjs
- add-mina-payment.mjs
- karigar-picker.tsx
- r
- inspect-zahra.mjs
- AnalyticsPage
- pdf-logo.ts
- stockSku
- gold-rates/route.ts
- Firebase 404 fallback page
- Logo (white) SVG asset
- tcs/route.ts
- preview-karigar-links.mjs
- add-ali-customer.mjs
- add-order-1141.mjs
- toast.tsx
- chart.tsx
- postcss.config.mjs
- Label (shadcn/ui)
- Switch (shadcn/ui)
- setup-cloud-scheduler.sh
- dispatch
- check-refunded-invoices.mjs
- refund-fatima.mjs
- sidebar.tsx
- renumber-zahra.mjs
- vcard-parser.d.ts
- loading.tsx

## God Nodes (most connected - your core abstractions)
1. `cn()` - 291 edges
2. `useAppStore` - 172 edges
3. `react` - 134 edges
4. `useToast()` - 125 edges
5. `next` - 104 edges
6. `lucide-react` - 90 edges
7. `Button` - 78 edges
8. `firebase` - 63 edges
9. `Card` - 58 edges
10. `CardContent` - 58 edges

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

## Communities (191 total, 22 thin omitted)

### Community 0 - "run/route.ts"
Cohesion: 0.09
Nodes (44): @google/generative-ai, GET(), checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings() (+36 more)

### Community 1 - "fix-customer-cleanup.mjs"
Cohesion: 0.10
Nodes (18): APPLY, ATTACH_CUSTOMER_INVOICES, attachPlan, auth, custById, extract(), fbConfig, fbGet() (+10 more)

### Community 2 - "v"
Cohesion: 0.26
Nodes (4): m(), st(), U(), v

### Community 3 - "import-latest-shopify-order.mjs"
Cohesion: 0.14
Nodes (18): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, fetch(), getDocById() (+10 more)

### Community 4 - "store.ts"
Cohesion: 0.04
Nodes (50): Category, firebaseConfig, ActivityLog, AppState, attachStaffPoll(), AVAILABLE_TAG_FORMATS, AVAILABLE_THEMES, BRACELET_BANGLE_SIZES (+42 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (56): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+48 more)

### Community 6 - "useAppStore"
Cohesion: 0.06
Nodes (47): ActivityLogPage(), getEventTypeColor(), CategoriesAnalyticsPage(), ProductsAnalyticsPage(), GivenItemsPage(), AddNewHisaabDialog(), FinalizeOrderDialog(), RecordAdvanceDialog() (+39 more)

### Community 7 - "orders/page.tsx"
Cohesion: 0.12
Nodes (40): date-fns, qrcode.react, CustomerStats, detectDuplicates(), MergeCustomersDialog(), nameSimilarity(), normalizeName(), normalizePhone() (+32 more)

### Community 8 - "import-shopify-orders.mjs"
Cohesion: 0.38
Nodes (6): app, db, firebaseConfig, main(), parseCSV(), parseCSVRow()

### Community 9 - "cart/page.tsx"
Cohesion: 0.10
Nodes (41): eventIcons, REVERTABLE_EVENTS, revertConsequences, EstimatedInvoice, INVOICE_COLUMNS, PhoneForm, RateInputs, NOTE: cartItemsFromStore.length is intentionally excluded from the deps below. (+33 more)

### Community 10 - "write/route.ts"
Cohesion: 0.07
Nodes (19): Body, dynamic, ORDER_STATUSES, POST(), stripUndefined(), adminPort, clientPort, BatchCtx (+11 more)

### Community 11 - "package.json"
Cohesion: 0.05
Nodes (38): name, private, version, buffer, clsx, dotenv-cli, immer, papaparse (+30 more)

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

### Community 16 - "vision/order/route.ts"
Cohesion: 0.11
Nodes (26): ref_google_auth_library, BILL_SCHEMA, denyUnlessOwner(), dynamic, POST(), runtime, denyUnlessOwner(), DRAFT_SCHEMA (+18 more)

### Community 17 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.14
Nodes (26): VoiceSettingsPage(), downscale(), money(), OrderScanner(), Photo, describeExchange(), DraftExchange, DraftItem (+18 more)

### Community 19 - "import-karigar-khata.mjs"
Cohesion: 0.10
Nodes (17): APPLY, args, byName, createDoc(), ext(), fb, fetch(), H (+9 more)

### Community 20 - "collapse-duplicate-payments.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, backup, del(), ext(), fb, fetch(), getDoc() (+7 more)

### Community 21 - "audit-customers.mjs"
Cohesion: 0.14
Nodes (10): auth, byNorm, extract(), fbConfig, issues, listAll(), settings, shopifyCustById (+2 more)

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
Nodes (28): dynamic, fail(), gate(), GET(), POST(), base(), bookPacket(), call() (+20 more)

### Community 26 - "next"
Cohesion: 0.11
Nodes (23): nextConfig, ref_crypto, firebase-admin, next, GET(), validateHmac(), fetchAllPages(), mapCustomer() (+15 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.09
Nodes (32): DocEntry, DocKind, DocResolution, documentHref(), documentsFor(), isRecent(), matchMethod(), matchStatus() (+24 more)

### Community 29 - "order-form.tsx"
Cohesion: 0.10
Nodes (19): cartItemToOrderItem(), EnrichedOrderFormData, jspdf, money(), OrderForm(), OrderFormData, orderFormSchema, OrderItemData (+11 more)

### Community 30 - "useIsStoreHydrated"
Cohesion: 0.32
Nodes (7): AppLayout(), MainApp(), useIsStoreHydrated(), devRole, effectiveRole(), staffWrite(), staffWriteJson()

### Community 31 - "quote/route.ts"
Cohesion: 0.14
Nodes (23): Body, dynamic, POST(), dynamic, gate(), GET(), PUT, catalogUrl() (+15 more)

### Community 32 - "DocumentsPage"
Cohesion: 0.23
Nodes (12): DocumentCard(), DocumentRow(), DocumentsPage(), getDocStatus(), getStatusBadgeVariant(), importShopifyCSV(), isShopifyDoc(), monthKeyOf() (+4 more)

### Community 33 - "numerals.ts"
Cohesion: 0.29
Nodes (10): ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy(), SCALES (+2 more)

### Community 34 - "types.ts"
Cohesion: 0.11
Nodes (26): ref_node_path, vitest, BuildContext, bank, catalog, config, ctx, good (+18 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "pdf-chrome.ts"
Cohesion: 0.15
Nodes (25): customerLines(), drawInvoice(), generateOrderSlipPDF(), alignHeadCell(), BAND, bandFor(), BRAND, drawDocFooter() (+17 more)

### Community 38 - "ShareholderFinancesPage"
Cohesion: 0.11
Nodes (26): fmt(), ShareholderFinancesPage(), today(), calculateDistribution(), categorise(), CategorisedLedger, DistributionResult, emptyCategorisedLedger() (+18 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "loadOrders"
Cohesion: 0.10
Nodes (22): CalendarPage(), dayMoney(), CustomerDetailPage(), getStatusBadgeVariant(), CustomerCard(), CustomerRow(), CustomersPage(), detectSpamCustomers() (+14 more)

### Community 41 - "clean-admin-notes.mjs"
Cohesion: 0.21
Nodes (11): APPLY, backup, byOrder, ext(), fb, getOrder(), H, MOVE (+3 more)

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
Nodes (41): class-variance-authority, html5-qrcode, lucide-react, react, AccountSummary, CombinedContact, InvoiceBalance, QrScanner (+33 more)

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
Cohesion: 0.13
Nodes (11): Channel, didone, IconName, Utility, STORE_BRAND, STORE_COMMUNITIES, STORE_EST_MARGIN, STORE_LINKS (+3 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "Product"
Cohesion: 0.16
Nodes (15): ProductCardProps, ProductsPage(), ProductDetailPage(), ProductFormProps, downloadCsv(), generateProductCsv(), OverheadItem, OverheadPlan (+7 more)

### Community 54 - "answers.ts"
Cohesion: 0.16
Nodes (19): OrderFormProps, HisaabEntry, KarigarJob, Order, Answer, answerQuestion(), Balance, balances() (+11 more)

### Community 55 - "firebase"
Cohesion: 0.08
Nodes (17): firebase, app, db, app, db, firebaseConfig, app, db (+9 more)

### Community 56 - "app/layout.tsx"
Cohesion: 0.17
Nodes (13): src_app_globals, AppBody(), inter, Toaster(), isLinksHost(), STORE_CONFIG, STORE_THEME_COLOR, LIGHT_THEME (+5 more)

### Community 57 - "overheads.ts"
Cohesion: 0.20
Nodes (18): OverheadsPage(), PKR(), signed(), BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey() (+10 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 59 - "google-auth-gate.tsx"
Cohesion: 0.13
Nodes (16): AuthContext, AuthContextValue, GoogleAuthGate(), googleProvider, isAllowed(), KarigarPortal, logSignIn(), parseUserAgent() (+8 more)

### Community 60 - "check-counters.mjs"
Cohesion: 0.15
Nodes (11): fixes, h, homApp, homDb, maxHomInv, maxHomOrder, maxTaheriInv, maxTaheriOrder (+3 more)

### Community 61 - "import-expenses.mjs"
Cohesion: 0.33
Nodes (4): app, db, expenses, firebaseConfig

### Community 62 - "check-outstanding.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 63 - "menubar.tsx"
Cohesion: 0.11
Nodes (12): @radix-ui/react-menubar, Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator (+4 more)

### Community 64 - "backfill-payment-credits.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 65 - "pitr-restore-invoices.mjs"
Cohesion: 0.33
Nodes (4): backupApp, backupDb, liveApp, liveDb

### Community 66 - "checkout.ts"
Cohesion: 0.13
Nodes (25): The parts, ref_node_crypto, normalizePhoneNumber(), buildWebsiteOrder(), BuiltOrder, CheckoutBody, CheckoutInput, CheckoutRejected (+17 more)

### Community 67 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.15
Nodes (21): BillScanner(), downscale(), money(), ScannedBill, blankCartItem(), BillDraft, BillLine, billLineToProduct() (+13 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "workshop.ts"
Cohesion: 0.10
Nodes (33): daysSince(), GET(), urgency(), FocusedKarigarView(), KarigarCard(), KarigarFormProps, Age(), buildGlanceRows() (+25 more)

### Community 71 - "form-drafts.ts"
Cohesion: 0.18
Nodes (16): PageError(), DraftsRow(), UnfinishedWork(), DraftRestoreBanner(), useFormDraft(), clearDraft(), Draft, DraftKind (+8 more)

### Community 72 - "app/page.tsx"
Cohesion: 0.16
Nodes (17): NewSalePage(), compactPKR(), Headline(), HomePage(), OngoingOrderRow(), RecentInvoiceRow(), TaskRow(), ScanPOSPage() (+9 more)

### Community 73 - "verifyRequestEmail"
Cohesion: 0.21
Nodes (15): POST(), allowedWhileOpen(), POST(), tail(), OrderItem, POST(), requireOwner(), shippingAddress() (+7 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "public/me/route.ts"
Cohesion: 0.13
Nodes (31): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), dynamic, GET() (+23 more)

### Community 77 - "use-toast.ts"
Cohesion: 0.12
Nodes (16): AddPhotosPage(), authHeaders(), Collection, Item, prettyBytes(), Status, src_components_ui_select_selectgroup, SelectLabel (+8 more)

### Community 78 - "revenue.ts"
Cohesion: 0.15
Nodes (13): buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace(), PeriodComparison, RevenueBucket (+5 more)

### Community 79 - "invoices/page.tsx"
Cohesion: 0.10
Nodes (43): react-day-picker, RevenueFormData, revenueSchema, CategoryPerformanceData, COLORS, CustomerPerformanceData, DailySummaryItem, ExpenseByCategoryData (+35 more)

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
Cohesion: 0.24
Nodes (9): get(), h(), i, k(), O(), q(), s, T() (+1 more)

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "_lib.ts"
Cohesion: 0.12
Nodes (23): APP_URL, buildShopifyDraftOrderPayload(), findShopifyDraftOrderIdByTag(), findShopifyProductIdsBySku(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID, firestoreBase(), firestoreGet() (+15 more)

### Community 87 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dev:mina, dev:taheri, env:mina, env:taheri, lint (+5 more)

### Community 89 - "shopifyRequest"
Cohesion: 0.17
Nodes (26): FulfillmentOrder, GET(), openFulfillmentOrders(), POST(), requireOwner(), buildShopifyOrderPayload(), findShopifyCustomerId(), findShopifyOrderIdByTag() (+18 more)

### Community 90 - "listen/route.ts"
Cohesion: 0.22
Nodes (12): denyUnlessOwner(), dynamic, POST(), READING_SCHEMA, runtime, QUERY_KINDS, documentLines(), numeralVocabulary() (+4 more)

### Community 91 - "format"
Cohesion: 0.15
Nodes (15): RevenueForm(), ExpensesPage(), PKR(), ClosedBatchCard(), DirectPaymentsCard(), KarigarDetailPage(), ExportCard(), JobCardMobile() (+7 more)

### Community 94 - "cn"
Cohesion: 0.05
Nodes (62): @radix-ui/react-accordion, @radix-ui/react-dropdown-menu, @radix-ui/react-radio-group, @radix-ui/react-slider, vaul, CalendarEventType, EventDetails(), EventsByDate (+54 more)

### Community 95 - "orders/[id]/page.tsx"
Cohesion: 0.06
Nodes (77): @hookform/resolvers, react-hook-form, react-phone-number-input, zod, Settings: Printer (Zebra), Settings: WePrint API, HisaabEntryFormData, hisaabEntrySchema (+69 more)

### Community 96 - "cleanup-shopify-customers.mjs"
Cohesion: 0.40
Nodes (3): db, privateKey, toDelete

### Community 97 - "bulk-sync-pos-to-shopify.mjs"
Cohesion: 0.10
Nodes (15): db, c(), f(), h(), r(), u(), APPLY, extractFields() (+7 more)

### Community 98 - "mark-invoices-paid.mjs"
Cohesion: 0.19
Nodes (10): APPLY, ext(), fb, getDoc(), H, IDS, listAll(), now (+2 more)

### Community 99 - "regenerate-payment-link.mjs"
Cohesion: 0.18
Nodes (12): APPLY, args, extractFields(), fbConfig, H, listAll(), matched, patch() (+4 more)

### Community 100 - "who-owes-money.mjs"
Cohesion: 0.17
Nodes (9): byCust, custById, ext(), fb, grandTotal, groups, H, listAll() (+1 more)

### Community 101 - "coins.ts"
Cohesion: 0.26
Nodes (11): CoinSplit, CoinSummary, GOLD_COIN_CATEGORY, isCoinItem(), itemsOf(), side(), splitAllCoinSales(), splitCoinSales() (+3 more)

### Community 102 - "invoice-item-cell.ts"
Cohesion: 0.36
Nodes (8): drawItemCell(), ItemBlock, itemCellHeight(), line(), wastageGrams(), wastageLine(), wrap(), Wrapped

### Community 103 - "recents.ts"
Cohesion: 0.24
Nodes (10): cache, EMPTY, listeners, load(), MAX_RECENTS, MIN_OPTIONS_FOR_RECENTS, readRecents(), SKIP (+2 more)

### Community 104 - "Selling from taheri.shop — how it works, and what must be true before it is switched on"
Cohesion: 0.50
Nodes (3): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally

### Community 105 - "migrate-silver-hisaab.mjs"
Cohesion: 0.50
Nodes (3): db, privateKey, silverEntries

### Community 106 - "photos/route.ts"
Cohesion: 0.24
Nodes (11): heic-convert, dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE (+3 more)

### Community 107 - "sheet.tsx"
Cohesion: 0.22
Nodes (9): @radix-ui/react-dialog, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle (+1 more)

### Community 108 - "shrink-order-sample-images.mjs"
Cohesion: 0.12
Nodes (12): ref_sharp, app, db, env, envVars, s, APPLY, auth (+4 more)

### Community 109 - "partnership-settings.ts"
Cohesion: 0.23
Nodes (11): fmt(), fmtDate(), WorkingCapitalFloor(), DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry, isFloorStale(), isMonthStart() (+3 more)

### Community 110 - "loadCustomers"
Cohesion: 0.18
Nodes (14): CustomersAnalyticsPage(), EditCustomerPage(), GivenItemForm(), EditKarigarPage(), ImportTaheriPage(), RecentlyRemovedPage(), CommandPalette(), DESTINATIONS (+6 more)

### Community 111 - "OrderDetailPage"
Cohesion: 0.24
Nodes (14): CartPage(), getStatusBadgeVariant(), OrderDetailPage(), categorySingular(), describeDelivery(), describePlating(), describeSettings(), buildOrderItemBlocks() (+6 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 114 - "website/featured/route.ts"
Cohesion: 0.29
Nodes (11): DELETE(), dynamic, gate(), GET(), PUT, shape(), site(), DOC (+3 more)

### Community 115 - "z"
Cohesion: 0.19
Nodes (3): n(), G, z()

### Community 116 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 117 - "ref_fs"
Cohesion: 0.05
Nodes (36): db, dump, privateKey, ts, dotenv, ref_fs, ref_os, existingInvoiceIds (+28 more)

### Community 118 - "receivables-breakdown.mjs"
Cohesion: 0.22
Nodes (8): ext(), fb, H, listAll(), openOrders, orderRows, owing, receivables

### Community 119 - "KaratValue"
Cohesion: 0.24
Nodes (11): Draft, KaratValue, MetalType, _calculateProductCostsInternal(), _calculateSingleMetalCost(), DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, _getRateForKarat(), GOLD_COIN_CATEGORY_ID_INTERNAL (+3 more)

### Community 120 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 121 - "cancel-tasneem-activity-log.mjs"
Cohesion: 0.25
Nodes (7): APPLY, extractFields(), fbConfig, fbHeaders, listAll(), matches, toDelete

### Community 122 - "create-influencer-orders.mjs"
Cohesion: 0.25
Nodes (7): ref_dns, APPLY, buildOrder(), created, H, INFLUENCERS, phone()

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "order-slip-pdf.ts"
Cohesion: 0.18
Nodes (14): jspdf, jspdf-autotable, EntityHisaabPage(), HisaabPage(), jspdf, SLIP_COLUMNS, fitText(), GUTTER (+6 more)

### Community 126 - "OrderRow"
Cohesion: 0.36
Nodes (7): getPaymentBadgeClass(), getStatusBadgeVariant(), OrderRow(), OrderTableRow(), usePrintSlip(), getOrderPaymentStatus(), PaymentStatus

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "voice-bubble.tsx"
Cohesion: 0.12
Nodes (24): aliasMap(), Phase, untilLoaded(), VoiceBubble(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, HisaabEntityType, loadInvoices, OrderStatus (+16 more)

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "constructor"
Cohesion: 0.23
Nodes (6): b(), constructor(), deleteCacheAndMetadata(), F, j(), p()

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

### Community 143 - "restore-orders.mjs"
Cohesion: 0.40
Nodes (5): app, db, findCustomerId(), firebaseConfig, main()

### Community 144 - "restore-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, firebaseConfig, SETTINGS, settingsRef

### Community 145 - "size-picker.tsx"
Cohesion: 0.42
Nodes (7): SizePicker(), categoryNeedsSize(), composeMultiSize(), isMultiPartScale(), legacyPartKeyFor(), parseMultiSize(), sizeScaleFor()

### Community 147 - "invoice-pdf.ts"
Cohesion: 0.18
Nodes (16): ViewInvoicePage(), getInvoiceAdjustmentsAmount(), getInvoiceExchangeTotal(), getInvoiceExpectedGrandTotal(), InvoiceLike, OrderLike, allocate(), buildInvoicePdf() (+8 more)

### Community 148 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

### Community 149 - "cleanup-test-shopify-mirror-docs.mjs"
Cohesion: 0.29
Nodes (7): APPLY, extractFields(), fbConfig, listInvoices(), settings, shopifyMirrors, targets

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "app-layout.tsx"
Cohesion: 0.10
Nodes (20): @radix-ui/react-avatar, Settings: Backups, Settings: Contact Import, Settings: Hisaab Import, Settings: Payment Methods, NavGroup, navGroups, NavItem (+12 more)

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

### Community 158 - "Customer"
Cohesion: 0.29
Nodes (7): DuplicatePair, SpamCandidate, CustomerAutocomplete(), Props, CustomerFormProps, InvoicePdfOptions, Customer

### Community 159 - "edit-cart-item-dialog.tsx"
Cohesion: 0.14
Nodes (18): EditCartItemDialog(), n(), toDraft(), toPatch(), getSafeDefaultValues(), ProductForm(), PlatingFields(), staticCategories (+10 more)

### Community 160 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 161 - "add-mina-payment.mjs"
Cohesion: 0.50
Nodes (3): app, db, payment

### Community 162 - "karigar-picker.tsx"
Cohesion: 0.46
Nodes (7): KarigarAssign(), KarigarBulkAssign(), KarigarPicker(), readRecent(), rememberRecent(), UNASSIGNED_VALUE, useKarigarsByRecency()

### Community 165 - "AnalyticsPage"
Cohesion: 0.38
Nodes (6): AdditionalRevenuePage(), AnalyticsPage(), loadAdditionalRevenues, formatWeight(), GRAMS_PER_TOLA, toTola()

### Community 166 - "pdf-logo.ts"
Cohesion: 0.60
Nodes (4): fetchLogo(), loadPdfLogo(), PdfLogo, warmPdfLogo()

### Community 167 - "stockSku"
Cohesion: 0.67
Nodes (3): isOneOffSku(), ONE_OFF_SKU_PREFIXES, stockSku()

### Community 168 - "gold-rates/route.ts"
Cohesion: 0.83
Nodes (3): GET(), parseRate(), scrapeGoldPk()

### Community 171 - "tcs/route.ts"
Cohesion: 1.00
Nodes (3): getBaseUrl(), getTcsTokens(), POST()

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

### Community 182 - "dispatch"
Cohesion: 0.50
Nodes (5): addToRemoveQueue(), dispatch(), genId(), reducer(), Toast

### Community 183 - "check-refunded-invoices.mjs"
Cohesion: 0.50
Nodes (3): app, db, refunded

### Community 185 - "sidebar.tsx"
Cohesion: 0.09
Nodes (26): @radix-ui/react-slot, @radix-ui/react-tooltip, src_components_ui_sheet_sheet, Sidebar, SidebarContext, SidebarGroupAction, SidebarInput, SidebarMenuAction (+18 more)

## Knowledge Gaps
- **1061 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1056 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1313 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `add-bank-account.mjs`, `store.ts`, `delete-bad-invoices.mjs`, `diagnose-dbs.mjs`, `import-shopify-orders.mjs`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `link-all-karigar-expenses.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `write/route.ts`, `fix-bareeka.mjs`, `add-bareeka-invoice.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `diagnose-orders.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `renumber-orders.mjs`, `list-invoices.mjs`, `add-mina-payment.mjs`, `inspect-zahra.mjs`, `orders/page.tsx`, `ShareholderFinancesPage`, `preview-karigar-links.mjs`, `add-ali-customer.mjs`, `add-order-1141.mjs`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `react`, `check-refunded-invoices.mjs`, `refund-fatima.mjs`, `clean-hisaab.mjs`, `renumber-zahra.mjs`, `check-counters.mjs`, `import-expenses.mjs`, `check-outstanding.mjs`, `google-auth-gate.tsx`, `backfill-payment-credits.mjs`, `backfill-source-orders.mjs`, `use-toast.ts`, `invoices/page.tsx`, `orders/[id]/page.tsx`, `partnership-settings.ts`, `link-new-karigars.mjs`, `fix-overwritten-invoices.mjs`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.401) - this node is a cross-community bridge._
- **Why does `next` connect `next` to `run/route.ts`, `voice-bubble.tsx`, `orders/page.tsx`, `cart/page.tsx`, `write/route.ts`, `package.json`, `vision/order/route.ts`, `app-layout.tsx`, `fulfilment.ts`, `order-form.tsx`, `quote/route.ts`, `gold-rates/route.ts`, `roles.ts`, `tcs/route.ts`, `react`, `store-config.ts`, `app/layout.tsx`, `google-auth-gate.tsx`, `workshop.ts`, `app/page.tsx`, `verifyRequestEmail`, `public/me/route.ts`, `use-toast.ts`, `invoices/page.tsx`, `_lib.ts`, `shopifyRequest`, `listen/route.ts`, `cn`, `orders/[id]/page.tsx`, `photos/route.ts`, `loadCustomers`, `website/featured/route.ts`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1061 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `run/route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09049773755656108 - nodes in this community are weakly interconnected._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._