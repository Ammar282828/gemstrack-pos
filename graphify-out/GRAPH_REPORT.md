# Graph Report - taheri-shop  (2026-09-22)

## Corpus Check
- 398 files · ~344,527 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 3127 nodes · 9201 edges · 184 communities (168 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 117 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c2186d91`
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
- ref_fs
- settings/page.tsx
- write/route.ts
- package.json
- rename-live-expense-descriptions.mjs
- test-shopify-sync.mjs
- test-shopify-customer-product-sync.mjs
- test-shopify-order-sync.mjs
- roleForEmail
- backfill-shopify-invoice-adjustments.mjs
- order-scanner.tsx
- import-karigar-khata.mjs
- collapse-duplicate-payments.mjs
- audit-customers.mjs
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- pull/route.ts
- complete-items-on-completed-orders.mjs
- resolve.ts
- z
- order-form.tsx
- quote/route.ts
- invoices/page.tsx
- workbox-f1770938.js
- checkout.ts
- partner-statement.mjs
- revenue-reconciliation.mjs
- view-invoice/[id]/page.tsx
- partnership.ts
- Orders workflow
- VoiceBubble
- clean-admin-notes.mjs
- roles.ts
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- next
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- store-config.ts
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- useAppReady
- answers.ts
- firebase
- app/layout.tsx
- overheads/page.tsx
- clean-hisaab.mjs
- google-auth-gate.tsx
- check-counters.mjs
- import-expenses.mjs
- check-outstanding.mjs
- menubar.tsx
- backfill-payment-credits.mjs
- firebase-admin
- gemini.ts
- backfill-source-orders.mjs
- bill-scanner.tsx
- import-one-shopify-order.mjs
- workshop.ts
- form-drafts.ts
- speak.ts
- firebase-admin.ts
- compilerOptions
- components.json
- public/me/route.ts
- shopifyRequest
- revenue.ts
- analytics/page.tsx
- taheri-book.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- r
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- phonetics.ts
- numerals.ts
- react
- _lib.ts
- listen/route.ts
- triage.ts
- Quotation Generator
- Dynamic gold-rate price recalculation
- cn
- utils.ts
- constructor
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- AnalyticsPage
- [entityId]/page.tsx
- inspect-tasneem-logs.mjs
- Selling from taheri.shop — how it works, and what must be true before it is switched on
- vcard.ts
- website/pricing.ts
- sheet.tsx
- shrink-order-sample-images.mjs
- working-capital-floor.tsx
- workshop/page.tsx
- a
- link-new-karigars.mjs
- fix-overwritten-invoices.mjs
- website/featured/route.ts
- MyWorkPage
- whatsapp-local-service.js
- ref_os
- receivables-breakdown.mjs
- lib/pricing.ts
- manifest.json
- cancel-tasneem-activity-log.mjs
- create-influencer-orders.mjs
- zebra-printer.ts
- CartPage
- karigar-assign.tsx
- sync/order/route.ts
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- voice-bubble.tsx
- notifications-scheduler.js
- callback/route.ts
- add-bank-account.mjs
- .S
- delete-bad-invoices.mjs
- diagnose-dbs.mjs
- env-for-house.mjs
- fix-dates.mjs
- fix-invoice-dates.mjs
- link-all-karigar-expenses.mjs
- link-invoice-hisaab.mjs
- link-uzair-expenses.mjs
- mark-shopify-unfulfilled.mjs
- restore-orders.mjs
- restore-settings.mjs
- orders/[id]/page.tsx
- AGENTS.md
- cart/page.tsx
- fix-bareeka.mjs
- cleanup-test-shopify-mirror-docs.mjs
- add-bareeka-invoice.mjs
- avatar.tsx
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- diagnose-orders.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- renumber-orders.mjs
- app/customers/page.tsx
- product-form.tsx
- list-invoices.mjs
- add-mina-payment.mjs
- openWhatsApp
- Karigar
- inspect-zahra.mjs
- check-orders.mjs
- clear-shopify.mjs
- restore-inv-000001.mjs
- gold-rates/route.ts
- Firebase 404 fallback page
- Logo (white) SVG asset
- tcs/route.ts
- WebsiteOrderPanel
- ShopifyPullPanel
- toast.tsx
- chart.tsx
- postcss.config.mjs
- Label (shadcn/ui)
- Switch (shadcn/ui)
- setup-cloud-scheduler.sh
- app-layout.tsx
- vcard-parser.d.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 289 edges
2. `useAppStore` - 172 edges
3. `react` - 132 edges
4. `useToast()` - 125 edges
5. `next` - 104 edges
6. `lucide-react` - 89 edges
7. `Button` - 77 edges
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

## Communities (184 total, 16 thin omitted)

### Community 0 - "run/route.ts"
Cohesion: 0.08
Nodes (48): @google/generative-ai, GET(), checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings() (+40 more)

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
Nodes (63): SizePicker(), Category, captureDevRole(), DEV_ROLE_HEADER, devRole, isDev(), firebaseConfig, ActivityLog (+55 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (56): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+48 more)

### Community 6 - "useAppStore"
Cohesion: 0.06
Nodes (50): ActivityLogPage(), getEventTypeColor(), RevenueForm(), CategoriesAnalyticsPage(), GivenItemsPage(), AddNewHisaabDialog(), ClosedBatchCard(), DirectPaymentsCard() (+42 more)

### Community 7 - "orders/page.tsx"
Cohesion: 0.12
Nodes (33): jspdf, PaymentStatus, METAL_COLORS, ViewMode, ProductWithCalculatedCosts, EXPORTABLE_COLLECTIONS, src_components_ui_alert_dialog_alertdialog, AlertDialogAction (+25 more)

### Community 8 - "ref_fs"
Cohesion: 0.12
Nodes (16): db, dump, privateKey, ts, ref_fs, app, db, env (+8 more)

### Community 9 - "settings/page.tsx"
Cohesion: 0.11
Nodes (33): FIELD_TAB, NOTIF_TOGGLES, SECTIONS, SettingsFormData, settingsSchema, themeKeys, AddPhotosPage(), authHeaders() (+25 more)

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

### Community 16 - "roleForEmail"
Cohesion: 0.15
Nodes (19): BILL_SCHEMA, denyUnlessOwner(), dynamic, POST(), runtime, denyUnlessOwner(), DRAFT_SCHEMA, dynamic (+11 more)

### Community 17 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.12
Nodes (32): cartItemToOrderItem(), money(), OrderForm(), promiseIn(), stripMeaninglessKarat(), downscale(), money(), OrderScanner() (+24 more)

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
Cohesion: 0.11
Nodes (33): dynamic, fail(), gate(), GET(), POST(), base(), bookPacket(), call() (+25 more)

### Community 26 - "pull/route.ts"
Cohesion: 0.19
Nodes (17): fetchAllPages(), mapCustomer(), mapCustomerToShopify(), mapInvoice(), mapInvoiceItem(), mapProduct(), validateWebhookHmac(), existingSets() (+9 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.11
Nodes (26): DocKind, DocResolution, documentHref(), documentsFor(), isRecent(), matchMethod(), matchStatus(), normaliseDocId() (+18 more)

### Community 29 - "z"
Cohesion: 0.19
Nodes (3): n(), G, z()

### Community 30 - "order-form.tsx"
Cohesion: 0.09
Nodes (26): CustomerAutocomplete(), EnrichedOrderFormData, jspdf, OrderFormData, OrderFormProps, orderFormSchema, OrderItemData, orderItemSchema (+18 more)

### Community 31 - "quote/route.ts"
Cohesion: 0.13
Nodes (28): The parts, Body, dynamic, POST(), dynamic, gate(), GET(), PUT (+20 more)

### Community 32 - "invoices/page.tsx"
Cohesion: 0.14
Nodes (22): DocumentCard(), DocumentRow(), DocumentsPage(), DocumentType, getDocStatus(), getStatusBadgeVariant(), importShopifyCSV(), INVOICE_COLUMNS (+14 more)

### Community 33 - "workbox-f1770938.js"
Cohesion: 0.33
Nodes (8): get(), h(), i, k(), O(), s, T(), X()

### Community 34 - "checkout.ts"
Cohesion: 0.10
Nodes (30): ref_node_crypto, ref_node_path, vitest, BuildContext, BuiltOrder, CheckoutBody, CheckoutInput, CheckoutRejected (+22 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "view-invoice/[id]/page.tsx"
Cohesion: 0.10
Nodes (46): jspdf-autotable, qrcode.react, EntityHisaabPage(), generateInvoicePDF(), INVOICE_COLUMNS, jspdf, ViewInvoicePage(), drawItemCell() (+38 more)

### Community 38 - "partnership.ts"
Cohesion: 0.12
Nodes (22): calculateDistribution(), categorise(), CategorisedLedger, DistributionResult, emptyCategorisedLedger(), LedgerCategory, LedgerEntry, LedgerType (+14 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "VoiceBubble"
Cohesion: 0.13
Nodes (26): CustomersAnalyticsPage(), EditCustomerPage(), CustomerDetailPage(), getStatusBadgeVariant(), CustomersPage(), GivenItemForm(), HisaabPage(), EditKarigarPage() (+18 more)

### Community 41 - "clean-admin-notes.mjs"
Cohesion: 0.21
Nodes (11): APPLY, backup, byOrder, ext(), fb, getOrder(), H, MOVE (+3 more)

### Community 42 - "roles.ts"
Cohesion: 0.16
Nodes (17): dynamic, GET(), previewAsStaff(), isStaffCollection(), OWNER_EMAILS, Role, STAFF_COLLECTIONS, STAFF_EMAILS (+9 more)

### Community 43 - "audit-shopify-duplicates.mjs"
Cohesion: 0.09
Nodes (21): byPosInvoice, customerTotalDupes, dupePerExistingInvoice, duplicateSets, extractFields(), fbConfig, fbHeaders, getCollection() (+13 more)

### Community 44 - "cancel-customer-duplicate-payment.mjs"
Cohesion: 0.10
Nodes (22): amtNeedle, APPLY, args, dayOf(), debits, dupDay, extractFields(), fbConfig (+14 more)

### Community 45 - "GemsTrack POS overview"
Cohesion: 0.67
Nodes (4): Project graphify usage rules, App blueprint (style + features), GemsTrack user tutorial, GemsTrack POS overview

### Community 46 - "next"
Cohesion: 0.10
Nodes (23): nextConfig, lucide-react, next, CalendarEventType, EventsByDate, AccountSummary, CombinedContact, InvoiceBalance (+15 more)

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
Cohesion: 0.11
Nodes (15): Channel, didone, IconName, Utility, fetchLogo(), loadPdfLogo(), PdfLogo, warmPdfLogo() (+7 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "useAppReady"
Cohesion: 0.10
Nodes (32): AdditionalRevenuePage(), ProductsAnalyticsPage(), CalendarPage(), dayMoney(), ExpensesPage(), PKR(), NewSalePage(), HomePage() (+24 more)

### Community 54 - "answers.ts"
Cohesion: 0.14
Nodes (21): DAYS_AHEAD, DAYS_BEHIND, daysUntilAnniversaryOf(), Occasion, occasionWhen(), upcomingOccasions(), Answer, AnswerContext (+13 more)

### Community 55 - "firebase"
Cohesion: 0.05
Nodes (26): firebase, app, db, firebaseConfig, app, db, firebaseConfig, app (+18 more)

### Community 56 - "app/layout.tsx"
Cohesion: 0.16
Nodes (15): src_app_globals, AppBody(), inter, MainApp(), Toaster(), useIsStoreHydrated(), isLinksHost(), STORE_BRAND (+7 more)

### Community 57 - "overheads/page.tsx"
Cohesion: 0.23
Nodes (20): OverheadsPage(), PKR(), signed(), BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey() (+12 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 59 - "google-auth-gate.tsx"
Cohesion: 0.17
Nodes (12): AuthContext, AuthContextValue, GoogleAuthGate(), googleProvider, isAllowed(), KarigarPortal, logSignIn(), parseUserAgent() (+4 more)

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

### Community 65 - "firebase-admin"
Cohesion: 0.12
Nodes (11): firebase-admin, db, privateKey, toDelete, db, privateKey, silverEntries, backupApp (+3 more)

### Community 66 - "gemini.ts"
Cohesion: 0.20
Nodes (11): ref_google_auth_library, dynamic, runtime, auth, endpoint(), GeminiError, generateJson(), GenerateOptions (+3 more)

### Community 67 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.21
Nodes (15): BillScanner(), downscale(), money(), blankCartItem(), BillDraft, BillLine, billLineToProduct(), CATEGORY_BY_WORD (+7 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "workshop.ts"
Cohesion: 0.24
Nodes (14): daysSince(), GET(), urgency(), categoryTitle(), displayKarat(), buildWorkshopJobs(), categoryTitle(), daysSince() (+6 more)

### Community 71 - "form-drafts.ts"
Cohesion: 0.18
Nodes (16): PageError(), DraftsRow(), UnfinishedWork(), DraftRestoreBanner(), useFormDraft(), clearDraft(), Draft, DraftKind (+8 more)

### Community 72 - "speak.ts"
Cohesion: 0.26
Nodes (9): grouped, listVoices(), pickVoice(), PREFERRED, setVoice(), speak(), speechOutputSupported(), stopSpeaking() (+1 more)

### Community 73 - "firebase-admin.ts"
Cohesion: 0.14
Nodes (21): POST(), FulfillmentOrder, GET(), openFulfillmentOrders(), POST(), requireOwner(), getShopifyCredentials(), mapInvoiceToDraftOrder() (+13 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "public/me/route.ts"
Cohesion: 0.12
Nodes (32): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), dynamic, GET() (+24 more)

### Community 77 - "shopifyRequest"
Cohesion: 0.41
Nodes (13): buildShopifyOrderPayload(), findShopifyOrderIdByTag(), shopifyRequest(), createNewOrder(), handleCancel(), handleRefund(), handleUpsert(), issueRefund() (+5 more)

### Community 78 - "revenue.ts"
Cohesion: 0.16
Nodes (11): buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace(), PeriodComparison, RevenueBucket (+3 more)

### Community 79 - "analytics/page.tsx"
Cohesion: 0.12
Nodes (37): date-fns, react-day-picker, recharts, CategoryPerformanceData, COLORS, CustomerPerformanceData, DailySummaryItem, ExpenseByCategoryData (+29 more)

### Community 80 - "taheri-book.ts"
Cohesion: 0.19
Nodes (16): buildIndex(), planImport(), classify(), extractContacts(), nameKey(), phoneKey(), BookPlan, classifyOne() (+8 more)

### Community 81 - "devDependencies"
Cohesion: 0.06
Nodes (30): devDependencies, dotenv-cli, firebase-admin, postcss, qrcode-terminal, tailwindcss, @types/heic-convert, @types/jspdf (+22 more)

### Community 82 - "cancel-tasneem-duplicate-payment.mjs"
Cohesion: 0.15
Nodes (14): APPLY, debits, extractFields(), fbConfig, fbHeaders, grandTotal, linked, listAll() (+6 more)

### Community 83 - "r"
Cohesion: 0.19
Nodes (3): et, q(), r

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "phonetics.ts"
Cohesion: 0.36
Nodes (10): levenshtein(), matchShape, nameScore(), phoneticKey(), rankNames(), ratio(), SCRIPTS, tokenKey() (+2 more)

### Community 87 - "numerals.ts"
Cohesion: 0.29
Nodes (10): ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy(), SCALES (+2 more)

### Community 88 - "react"
Cohesion: 0.20
Nodes (11): react, QrScanner, book, QrScannerProps, PageBack(), PageShell(), Alert, AlertDescription (+3 more)

### Community 89 - "_lib.ts"
Cohesion: 0.14
Nodes (19): APP_URL, findShopifyCustomerId(), findShopifyProductIdsBySku(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID, firestoreBase(), firestoreGet(), firestoreSet() (+11 more)

### Community 90 - "listen/route.ts"
Cohesion: 0.22
Nodes (11): denyUnlessOwner(), dynamic, POST(), READING_SCHEMA, runtime, QUERY_KINDS, documentLines(), numeralVocabulary() (+3 more)

### Community 91 - "triage.ts"
Cohesion: 0.22
Nodes (11): ContactImportPage(), Conflict, ConflictChoice, ConflictReason, defaultChoice(), ExistingRow, ImportPlan, PendingContact (+3 more)

### Community 94 - "cn"
Cohesion: 0.05
Nodes (49): @radix-ui/react-accordion, @radix-ui/react-dropdown-menu, @radix-ui/react-radio-group, vaul, EventDetails(), AddTransactionDialog(), compactPKR(), Headline() (+41 more)

### Community 95 - "utils.ts"
Cohesion: 0.08
Nodes (58): @hookform/resolvers, react-hook-form, react-phone-number-input, zod, Settings: Backups, Settings: Contact Import, Settings: Hisaab Import, RevenueFormData (+50 more)

### Community 96 - "constructor"
Cohesion: 0.21
Nodes (6): b(), constructor(), deleteCacheAndMetadata(), F, j(), p()

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

### Community 101 - "AnalyticsPage"
Cohesion: 0.24
Nodes (12): AnalyticsPage(), CoinSplit, CoinSummary, GOLD_COIN_CATEGORY, isCoinItem(), itemsOf(), side(), splitAllCoinSales() (+4 more)

### Community 102 - "[entityId]/page.tsx"
Cohesion: 0.12
Nodes (23): eventIcons, REVERTABLE_EVENTS, revertConsequences, HisaabEntryFormData, hisaabEntrySchema, jspdf, PhoneForm, TransactionMode (+15 more)

### Community 103 - "inspect-tasneem-logs.mjs"
Cohesion: 0.40
Nodes (5): extractFields(), fbConfig, fbHeaders, listAll(), matches

### Community 104 - "Selling from taheri.shop — how it works, and what must be true before it is switched on"
Cohesion: 0.50
Nodes (3): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally

### Community 105 - "vcard.ts"
Cohesion: 0.21
Nodes (11): ALL_TAGS, Classified, Contact, CUSTOMER_TAGS, decodeQuotedPrintable(), ExtractResult, parseVCards(), RawCard (+3 more)

### Community 106 - "website/pricing.ts"
Cohesion: 0.13
Nodes (21): heic-convert, dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE (+13 more)

### Community 107 - "sheet.tsx"
Cohesion: 0.22
Nodes (9): @radix-ui/react-dialog, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle (+1 more)

### Community 108 - "shrink-order-sample-images.mjs"
Cohesion: 0.22
Nodes (7): ref_sharp, APPLY, auth, fb, plan, shrinks, stamp

### Community 109 - "working-capital-floor.tsx"
Cohesion: 0.23
Nodes (13): fmt(), fmtDate(), Props, WorkingCapitalFloor(), src_lib_firebase_db, DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry (+5 more)

### Community 110 - "workshop/page.tsx"
Cohesion: 0.16
Nodes (19): class-variance-authority, STATUS_LABEL, AgeBadge(), BoardJobCard(), buildGlanceRows(), GlanceRow, KarigarGlance(), PullItem (+11 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 114 - "website/featured/route.ts"
Cohesion: 0.29
Nodes (11): DELETE(), dynamic, gate(), GET(), PUT, shape(), site(), DOC (+3 more)

### Community 115 - "MyWorkPage"
Cohesion: 0.50
Nodes (4): fmt(), MyWorkPage(), OrderGroupedJobs(), groupJobsByOrder()

### Community 116 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 117 - "ref_os"
Cohesion: 0.07
Nodes (19): ref_os, existingInvoiceIds, fbConfig, invoices, orders, APPLY, curFields, fbConfig (+11 more)

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

### Community 122 - "create-influencer-orders.mjs"
Cohesion: 0.25
Nodes (7): ref_dns, APPLY, buildOrder(), created, H, INFLUENCERS, phone()

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "CartPage"
Cohesion: 0.24
Nodes (16): CartPage(), OrderDetailPage(), categorySingular(), describeDelivery(), describeMetal(), describePlating(), describeSettings(), KARATS_BY_METAL (+8 more)

### Community 125 - "karigar-assign.tsx"
Cohesion: 0.56
Nodes (7): KarigarAssign(), KarigarBulkAssign(), KarigarPicker(), readRecent(), rememberRecent(), UNASSIGNED_VALUE, useKarigarsByRecency()

### Community 126 - "sync/order/route.ts"
Cohesion: 0.50
Nodes (6): buildShopifyDraftOrderPayload(), findShopifyDraftOrderIdByTag(), cancelDraftIfPresent(), handleDraftCancel(), handleDraftUpsert(), POST()

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "voice-bubble.tsx"
Cohesion: 0.12
Nodes (23): aliasMap(), Phase, untilLoaded(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, HisaabEntityType, PaymentType, NameGuess, NameGuess (+15 more)

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "callback/route.ts"
Cohesion: 0.40
Nodes (3): ref_crypto, GET(), validateHmac()

### Community 132 - "add-bank-account.mjs"
Cohesion: 0.33
Nodes (4): app, BANK_ACCOUNT, db, firebaseConfig

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

### Community 142 - "mark-shopify-unfulfilled.mjs"
Cohesion: 0.25
Nodes (7): dotenv, APPLY, auth, fb, IDS, plan, stamp

### Community 143 - "restore-orders.mjs"
Cohesion: 0.40
Nodes (5): app, db, findCustomerId(), firebaseConfig, main()

### Community 144 - "restore-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, firebaseConfig, SETTINGS, settingsRef

### Community 145 - "orders/[id]/page.tsx"
Cohesion: 0.09
Nodes (20): jspdf, FinalizeOrderFormData, finalizeOrderItemSchema, finalizeOrderSchema, getStatusBadgeVariant(), NotificationType, PaymentStatus, PhoneForm (+12 more)

### Community 147 - "cart/page.tsx"
Cohesion: 0.10
Nodes (27): EstimatedInvoice, INVOICE_COLUMNS, jspdf, PhoneForm, RateInputs, NOTE: cartItemsFromStore.length is intentionally excluded from the deps below., NOTE: we do NOT delete the invoice before re-generating it. generateInvoice, ProductCardProps (+19 more)

### Community 148 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

### Community 149 - "cleanup-test-shopify-mirror-docs.mjs"
Cohesion: 0.29
Nodes (7): APPLY, extractFields(), fbConfig, listInvoices(), settings, shopifyMirrors, targets

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "avatar.tsx"
Cohesion: 0.40
Nodes (4): @radix-ui/react-avatar, Avatar, AvatarFallback, AvatarImage

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

### Community 158 - "app/customers/page.tsx"
Cohesion: 0.14
Nodes (19): CustomerCard(), CustomerRow(), CustomerStats, detectDuplicates(), detectSpamCustomers(), DuplicatePair, isGibberishName(), isRandomEmailLocal() (+11 more)

### Community 159 - "product-form.tsx"
Cohesion: 0.11
Nodes (22): Settings: Printer (Zebra), Settings: WePrint API, EditCartItemDialog(), n(), toDraft(), toPatch(), getSafeDefaultValues(), ProductDataForAdd (+14 more)

### Community 160 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 161 - "add-mina-payment.mjs"
Cohesion: 0.50
Nodes (3): app, db, payment

### Community 162 - "openWhatsApp"
Cohesion: 0.60
Nodes (5): FocusedKarigarView(), KarigarCard(), useShare(), openWhatsApp(), formatJobListForShare()

### Community 163 - "Karigar"
Cohesion: 0.40
Nodes (5): KarigarFormProps, RankedKarigars, HisaabEntry, Karigar, BookData

### Community 165 - "check-orders.mjs"
Cohesion: 0.50
Nodes (3): app, db, firebaseConfig

### Community 166 - "clear-shopify.mjs"
Cohesion: 0.50
Nodes (3): app, db, firebaseConfig

### Community 167 - "restore-inv-000001.mjs"
Cohesion: 0.50
Nodes (3): createdAt, db, homApp

### Community 168 - "gold-rates/route.ts"
Cohesion: 0.83
Nodes (3): GET(), parseRate(), scrapeGoldPk()

### Community 171 - "tcs/route.ts"
Cohesion: 1.00
Nodes (3): getBaseUrl(), getTcsTokens(), POST()

### Community 172 - "WebsiteOrderPanel"
Cohesion: 0.67
Nodes (3): call(), fmt(), WebsiteOrderPanel()

### Community 173 - "ShopifyPullPanel"
Cohesion: 0.67
Nodes (3): authHeader(), fmtDate(), ShopifyPullPanel()

### Community 175 - "toast.tsx"
Cohesion: 0.23
Nodes (11): @radix-ui/react-toast, Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, src_components_ui_toast_toastprovider (+3 more)

### Community 176 - "chart.tsx"
Cohesion: 0.25
Nodes (9): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, getPayloadConfigFromPayload(), THEMES (+1 more)

### Community 185 - "app-layout.tsx"
Cohesion: 0.07
Nodes (41): @radix-ui/react-slot, @radix-ui/react-tooltip, Settings: Payment Methods, useAuth(), AppLayout(), NavGroup, navGroups, NavItem (+33 more)

## Knowledge Gaps
- **1055 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1050 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1309 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `add-bank-account.mjs`, `store.ts`, `delete-bad-invoices.mjs`, `diagnose-dbs.mjs`, `ref_fs`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `link-all-karigar-expenses.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `settings/page.tsx`, `write/route.ts`, `fix-bareeka.mjs`, `add-bareeka-invoice.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `diagnose-orders.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `renumber-orders.mjs`, `product-form.tsx`, `list-invoices.mjs`, `add-mina-payment.mjs`, `invoices/page.tsx`, `inspect-zahra.mjs`, `check-orders.mjs`, `clear-shopify.mjs`, `restore-inv-000001.mjs`, `orders/page.tsx`, `view-invoice/[id]/page.tsx`, `partnership.ts`, `next`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `clean-hisaab.mjs`, `google-auth-gate.tsx`, `check-counters.mjs`, `import-expenses.mjs`, `check-outstanding.mjs`, `backfill-payment-credits.mjs`, `backfill-source-orders.mjs`, `analytics/page.tsx`, `working-capital-floor.tsx`, `link-new-karigars.mjs`, `fix-overwritten-invoices.mjs`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.391) - this node is a cross-community bridge._
- **Why does `next` connect `next` to `run/route.ts`, `voice-bubble.tsx`, `callback/route.ts`, `orders/page.tsx`, `settings/page.tsx`, `write/route.ts`, `package.json`, `roleForEmail`, `orders/[id]/page.tsx`, `cart/page.tsx`, `fulfilment.ts`, `pull/route.ts`, `app/customers/page.tsx`, `quote/route.ts`, `invoices/page.tsx`, `order-form.tsx`, `product-form.tsx`, `view-invoice/[id]/page.tsx`, `gold-rates/route.ts`, `roles.ts`, `tcs/route.ts`, `store-config.ts`, `app/layout.tsx`, `overheads/page.tsx`, `app-layout.tsx`, `google-auth-gate.tsx`, `gemini.ts`, `workshop.ts`, `firebase-admin.ts`, `public/me/route.ts`, `shopifyRequest`, `analytics/page.tsx`, `react`, `_lib.ts`, `listen/route.ts`, `utils.ts`, `[entityId]/page.tsx`, `website/pricing.ts`, `workshop/page.tsx`, `website/featured/route.ts`, `sync/order/route.ts`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `firebase-admin` connect `firebase-admin` to `bulk-sync-pos-to-shopify.mjs`, `ref_fs`, `firebase-admin.ts`, `write/route.ts`, `package.json`, `pull/route.ts`, `sync/order/route.ts`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1055 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `run/route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0822746521476104 - nodes in this community are weakly interconnected._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._