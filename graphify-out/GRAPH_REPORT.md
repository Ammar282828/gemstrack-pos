# Graph Report - taheri-shop  (2026-09-25)

## Corpus Check
- 464 files · ~7,484,401 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 3694 nodes · 11013 edges · 197 communities (175 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 124 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5cbd51db`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- workshop.ts
- fix-customer-cleanup.mjs
- editor.ts
- import-latest-shopify-order.mjs
- store.ts
- dependencies
- google-auth-gate.tsx
- settings/page.tsx
- import-shopify-orders.mjs
- orders/[id]/page.tsx
- write/route.ts
- package.json
- rename-live-expense-descriptions.mjs
- test-shopify-sync.mjs
- test-shopify-customer-product-sync.mjs
- test-shopify-order-sync.mjs
- roleForEmail
- story-editor.tsx
- order-scanner.tsx
- import-karigar-khata.mjs
- collapse-duplicate-payments.mjs
- DocumentsPage
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- publish/route.ts
- complete-items-on-completed-orders.mjs
- resolve.ts
- answers.ts
- audit-customers.mjs
- pieces/route.ts
- loadCustomers
- story.ts
- invoices/page.tsx
- partner-statement.mjs
- revenue-reconciliation.mjs
- pdf-logo.ts
- run/route.ts
- Orders workflow
- ai/route.ts
- clean-admin-notes.mjs
- roles.ts
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- pdf-chrome.ts
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- store-config.ts
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- scripts
- verifyRequestEmail
- firebase
- useIsStoreHydrated
- overheads/page.tsx
- clean-hisaab.mjs
- editor-panels.tsx
- check-counters.mjs
- import-expenses.mjs
- check-outstanding.mjs
- design.ts
- backfill-payment-credits.mjs
- health.ts
- checkout.ts
- backfill-source-orders.mjs
- bill-scanner.tsx
- import-one-shopify-order.mjs
- newLayerId
- unfinished-work.tsx
- invoice-pdf.ts
- working-capital-floor.tsx
- compilerOptions
- components.json
- quote/route.ts
- useAppStore
- revenue.ts
- react
- triage.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- workbox-f1770938.js
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- _lib.ts
- instagram.ts
- backfill-shopify-invoice-adjustments.mjs
- fonts.ts
- devRole
- create-influencer-orders.mjs
- Quotation Generator
- Dynamic gold-rate price recalculation
- cn
- app-layout.tsx
- website/pricing.ts
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- AnalyticsPage
- lib/pricing.ts
- recents.ts
- CustomersPage
- DocumentCard
- z
- sheet.tsx
- gold-rates/route.ts
- tcs/route.ts
- firebase-admin
- a
- link-new-karigars.mjs
- shrink-order-sample-images.mjs
- mark-shopify-unfulfilled.mjs
- constructor
- whatsapp-local-service.js
- ref_fs
- receivables-breakdown.mjs
- app/layout.tsx
- manifest.json
- cancel-tasneem-activity-log.mjs
- dispatch
- zebra-printer.ts
- firebase-admin.ts
- [entityId]/page.tsx
- clear-shopify.mjs
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- voice-bubble.tsx
- notifications-scheduler.js
- workshop/page.tsx
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
- register-webhooks/route.ts
- restore-orders.mjs
- restore-settings.mjs
- numerals.ts
- AGENTS.md
- post/route.ts
- fix-bareeka.mjs
- restore-inv-000001.mjs
- add-bareeka-invoice.mjs
- whatsapp.ts
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- diagnose-orders.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- v
- materials.ts
- list-invoices.mjs
- add-mina-payment.mjs
- post/page.tsx
- inspect-zahra.mjs
- shopifyRequest
- renumber-orders.mjs
- website/featured/route.ts
- order-slip.ts
- Firebase 404 fallback page
- Logo (white) SVG asset
- placeWebsiteOrder
- preview-karigar-links.mjs
- add-ali-customer.mjs
- add-order-1141.mjs
- toast.tsx
- chart.tsx
- postcss.config.mjs
- Label (shadcn/ui)
- Switch (shadcn/ui)
- setup-cloud-scheduler.sh
- startup.sh
- next.config.ts
- check-refunded-invoices.mjs
- refund-fatima.mjs
- sidebar.tsx
- renumber-zahra.mjs
- fallback-ce627215c0e4a9af.js
- vcard-parser.d.ts
- loading.tsx
- r
- invoice-item-cell.ts
- order-slip-pdf.ts
- DayCard

## God Nodes (most connected - your core abstractions)
1. `cn()` - 329 edges
2. `useAppStore` - 178 edges
3. `react` - 140 edges
4. `useToast()` - 139 edges
5. `next` - 118 edges
6. `lucide-react` - 96 edges
7. `Button` - 84 edges
8. `firebase` - 63 edges
9. `Card` - 59 edges
10. `CardContent` - 59 edges

## Surprising Connections (you probably didn't know these)
- `Selling from taheri.shop — how it works, and what must be true before it is switched on` --references--> `calculateProductPrice()`  [INFERRED]
  docs/website-checkout.md → src/lib/pricing.ts
- `The parts` --references--> `buildWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `The parts` --references--> `quotePiece()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/pricing.ts
- `The parts` --references--> `placeWebsiteOrder()`  [INFERRED]
  docs/website-checkout.md → src/lib/website/checkout.ts
- `WAHA — the POS's WhatsApp gateway` --references--> `waha()`  [INFERRED]
  ops/waha/README.md → src/lib/whatsapp.ts

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

## Communities (197 total, 22 thin omitted)

### Community 0 - "workshop.ts"
Cohesion: 0.20
Nodes (18): daysSince(), GET(), urgency(), GlanceRow, categoryTitle(), displayKarat(), describePlating(), KarigarJobStatus (+10 more)

### Community 1 - "fix-customer-cleanup.mjs"
Cohesion: 0.10
Nodes (18): APPLY, ATTACH_CUSTOMER_INVOICES, attachPlan, auth, custById, extract(), fbConfig, fbGet() (+10 more)

### Community 2 - "editor.ts"
Cohesion: 0.10
Nodes (40): adjustedCache, adjustedSource(), applyPreset(), autoInk(), balancedTwo(), Ctx, curveLayout(), drawImageLayer() (+32 more)

### Community 3 - "import-latest-shopify-order.mjs"
Cohesion: 0.14
Nodes (18): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, fetch(), getDocById() (+10 more)

### Community 4 - "store.ts"
Cohesion: 0.04
Nodes (68): SizePicker(), Category, firebaseConfig, ActivityLog, AppState, AVAILABLE_TAG_FORMATS, AVAILABLE_THEMES, BRACELET_BANGLE_SIZES (+60 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (57): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+49 more)

### Community 6 - "google-auth-gate.tsx"
Cohesion: 0.15
Nodes (13): AuthContext, AuthContextValue, GoogleAuthGate(), googleProvider, isAllowed(), KarigarPortal, logSignIn(), parseUserAgent() (+5 more)

### Community 7 - "settings/page.tsx"
Cohesion: 0.11
Nodes (31): SilverTransactionFormData, silverTransactionSchema, ProductWithCalculatedCosts, FIELD_TAB, NOTIF_TOGGLES, SECTIONS, SettingsFormData, settingsSchema (+23 more)

### Community 8 - "import-shopify-orders.mjs"
Cohesion: 0.38
Nodes (6): app, db, firebaseConfig, main(), parseCSV(), parseCSVRow()

### Community 9 - "orders/[id]/page.tsx"
Cohesion: 0.05
Nodes (113): @hookform/resolvers, @radix-ui/react-label, react-hook-form, react-phone-number-input, zod, Settings: Printer (Zebra), Settings: WePrint API, EstimatedInvoice (+105 more)

### Community 10 - "write/route.ts"
Cohesion: 0.07
Nodes (18): Body, dynamic, ORDER_STATUSES, POST(), stripUndefined(), adminPort, clientPort, BatchCtx (+10 more)

### Community 11 - "package.json"
Cohesion: 0.05
Nodes (39): name, private, version, buffer, clsx, dotenv-cli, html5-qrcode, immer (+31 more)

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
Cohesion: 0.07
Nodes (42): ref_google_auth_library, BILL_SCHEMA, denyUnlessOwner(), dynamic, POST(), runtime, denyUnlessOwner(), DRAFT_SCHEMA (+34 more)

### Community 17 - "story-editor.tsx"
Cohesion: 0.07
Nodes (42): LayersPanel(), MobileToolbar(), PositionPanel(), SelectionSummary(), TransparencyPanel(), clipboard, CONTEXT_PANELS, CORNERS (+34 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.13
Nodes (29): money(), OrderForm(), promiseIn(), stripMeaninglessKarat(), downscale(), money(), OrderScanner(), Photo (+21 more)

### Community 19 - "import-karigar-khata.mjs"
Cohesion: 0.10
Nodes (17): APPLY, args, byName, createDoc(), ext(), fb, fetch(), H (+9 more)

### Community 20 - "collapse-duplicate-payments.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, backup, del(), ext(), fb, fetch(), getDoc() (+7 more)

### Community 21 - "DocumentsPage"
Cohesion: 0.40
Nodes (6): DocumentsPage(), importShopifyCSV(), monthKeyOf(), monthLabel(), parseCSV(), parseCSVRow()

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

### Community 26 - "publish/route.ts"
Cohesion: 0.11
Nodes (27): ref_crypto, dynamic, maxDuration, POST(), dynamic, GET(), hasIngestToken(), maxDuration (+19 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.09
Nodes (36): NameGuess, NameGuess, AnswerContext, DocEntry, DocKind, DocResolution, documentHref(), documentsFor() (+28 more)

### Community 29 - "answers.ts"
Cohesion: 0.13
Nodes (22): DAYS_AHEAD, DAYS_BEHIND, daysUntilAnniversaryOf(), Occasion, upcomingOccasions(), HisaabEntry, KarigarJob, Answer (+14 more)

### Community 30 - "audit-customers.mjs"
Cohesion: 0.14
Nodes (10): auth, byNorm, extract(), fbConfig, issues, listAll(), settings, shopifyCustById (+2 more)

### Community 31 - "pieces/route.ts"
Cohesion: 0.18
Nodes (16): dynamic, gate(), GET(), PUT, catalogUrl(), getCatalogAttributes(), normalisePieceKey(), PieceAttrs (+8 more)

### Community 32 - "loadCustomers"
Cohesion: 0.09
Nodes (33): CalendarPage(), dayMoney(), EditCustomerPage(), CustomerDetailPage(), getStatusBadgeVariant(), GivenItemForm(), EditKarigarPage(), KarigarDetailPage() (+25 more)

### Community 33 - "story.ts"
Cohesion: 0.13
Nodes (21): forAi(), Palette, PALETTES, canvasToJpeg(), drawBackdrop(), drawStory(), drawStoryPhoto(), fitSize() (+13 more)

### Community 34 - "invoices/page.tsx"
Cohesion: 0.07
Nodes (69): date-fns, react-day-picker, RevenueFormData, revenueSchema, CustomerPerformanceData, DailySummaryItem, ExpenseByCategoryData, SalesByCategoryData (+61 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "pdf-logo.ts"
Cohesion: 0.60
Nodes (4): fetchLogo(), loadPdfLogo(), PdfLogo, warmPdfLogo()

### Community 38 - "run/route.ts"
Cohesion: 0.06
Nodes (64): @google/generative-ai, checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings(), POST() (+56 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "ai/route.ts"
Cohesion: 0.09
Nodes (45): checkSame(), dynamic, maxDuration, POST(), shopName(), aiConfigured(), AiError, auth (+37 more)

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

### Community 46 - "pdf-chrome.ts"
Cohesion: 0.12
Nodes (33): daysLate(), RepairsPage(), BAND, bandFor(), BRAND, drawDocFooter(), drawDocHeader(), drawRowRule() (+25 more)

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
Cohesion: 0.10
Nodes (16): Channel, didone, IconName, Utility, STORE_COMMUNITIES, STORE_EST_MARGIN, STORE_LINKS, STORE_LOGO_LIGHT_URL (+8 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dev:mina, dev:taheri, env:mina, env:taheri, lint (+5 more)

### Community 54 - "verifyRequestEmail"
Cohesion: 0.14
Nodes (26): POST(), allowedWhileOpen(), POST(), tail(), FulfillmentOrder, GET(), openFulfillmentOrders(), POST() (+18 more)

### Community 55 - "firebase"
Cohesion: 0.10
Nodes (13): firebase, app, db, app, db, firebaseConfig, db, db (+5 more)

### Community 56 - "useIsStoreHydrated"
Cohesion: 0.16
Nodes (17): NewSalePage(), ProductsPage(), EditProductPage(), ProductDetailPage(), ScanPOSPage(), PrinterPageComponent(), WeprintApiPage(), MainApp() (+9 more)

### Community 57 - "overheads/page.tsx"
Cohesion: 0.23
Nodes (20): OverheadsPage(), PKR(), signed(), BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey() (+12 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 59 - "editor-panels.tsx"
Cohesion: 0.06
Nodes (49): @radix-ui/react-slider, BackgroundInspector(), BrandPanel(), ColourButton(), ColourPanel(), ColourRow(), ContextToolbar(), docColours() (+41 more)

### Community 60 - "check-counters.mjs"
Cohesion: 0.15
Nodes (11): fixes, h, homApp, homDb, maxHomInv, maxHomOrder, maxTaheriInv, maxTaheriOrder (+3 more)

### Community 61 - "import-expenses.mjs"
Cohesion: 0.33
Nodes (4): app, db, expenses, firebaseConfig

### Community 62 - "check-outstanding.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 63 - "design.ts"
Cohesion: 0.14
Nodes (23): AdjustControls(), PhotoEditPanel(), useFilterThumbs(), ContextMenu(), alignDeltas(), AlignHow, applyAdjust(), Box (+15 more)

### Community 64 - "backfill-payment-credits.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 65 - "health.ts"
Cohesion: 0.13
Nodes (31): dynamic, GET(), maxDuration, POST(), WHERES, aiPing(), imageModelServed(), diagnose() (+23 more)

### Community 66 - "checkout.ts"
Cohesion: 0.09
Nodes (36): ref_node_crypto, ref_node_path, vitest, BuildContext, buildWebsiteOrder(), BuiltOrder, CheckoutBody, CheckoutInput (+28 more)

### Community 67 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.18
Nodes (17): VoiceSettingsPage(), BillScanner(), downscale(), money(), blankCartItem(), BillDraft, BillLine, billLineToProduct() (+9 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "newLayerId"
Cohesion: 0.15
Nodes (25): ElementsPanel(), MarksSection(), PhotosPanel(), TextPanel(), StoryEditor(), applySquarePreset(), midY(), newBody() (+17 more)

### Community 71 - "unfinished-work.tsx"
Cohesion: 0.21
Nodes (15): PageError(), DraftsRow(), UnfinishedWork(), useFormDraft(), clearDraft(), Draft, DraftKind, DraftSummary (+7 more)

### Community 72 - "invoice-pdf.ts"
Cohesion: 0.13
Nodes (26): CartPage(), ViewInvoicePage(), cartItemToOrderItem(), categorySingular(), getInvoiceAdjustmentsAmount(), getInvoiceExchangeTotal(), getInvoiceExpectedGrandTotal(), InvoiceLike (+18 more)

### Community 73 - "working-capital-floor.tsx"
Cohesion: 0.27
Nodes (12): fmt(), fmtDate(), Props, WorkingCapitalFloor(), DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry, isFloorStale() (+4 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "quote/route.ts"
Cohesion: 0.13
Nodes (30): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), dynamic, GET() (+22 more)

### Community 77 - "useAppStore"
Cohesion: 0.06
Nodes (55): ActivityLogPage(), getEventTypeColor(), AdditionalRevenuePage(), RevenueForm(), GivenItemsPage(), AddNewHisaabDialog(), ClosedBatchCard(), DirectPaymentsCard() (+47 more)

### Community 78 - "revenue.ts"
Cohesion: 0.15
Nodes (13): buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace(), PeriodComparison, RevenueBucket (+5 more)

### Community 79 - "react"
Cohesion: 0.08
Nodes (51): class-variance-authority, lucide-react, next, react, eventIcons, REVERTABLE_EVENTS, revertConsequences, CategoryPerformanceData (+43 more)

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
Cohesion: 0.29
Nodes (8): get(), h(), i, k(), O(), s, T(), X()

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "_lib.ts"
Cohesion: 0.13
Nodes (24): findShopifyCustomerId(), findShopifyProductIdsBySku(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID, firestoreBase(), firestoreGet(), firestoreSet(), mapCustomer() (+16 more)

### Community 87 - "instagram.ts"
Cohesion: 0.16
Nodes (27): dynamic, POST(), dynamic, GET(), postGate(), APP_ID(), APP_SECRET(), authorizeUrl() (+19 more)

### Community 88 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 89 - "fonts.ts"
Cohesion: 0.18
Nodes (10): bodyFace, cinzel, cormorant, FONTS, headlineFace, montserrat, playfair, script (+2 more)

### Community 90 - "devRole"
Cohesion: 0.27
Nodes (10): AppLayout(), captureDevRole(), DEV_ROLE_HEADER, devRole, isDev(), attachStaffPoll(), createDataLoader(), effectiveRole() (+2 more)

### Community 91 - "create-influencer-orders.mjs"
Cohesion: 0.25
Nodes (7): ref_dns, APPLY, buildOrder(), created, H, INFLUENCERS, phone()

### Community 94 - "cn"
Cohesion: 0.05
Nodes (48): @radix-ui/react-accordion, @radix-ui/react-radio-group, vaul, CalendarEventType, EventDetails(), EventsByDate, PrintButton(), PickerOption (+40 more)

### Community 95 - "app-layout.tsx"
Cohesion: 0.10
Nodes (20): @radix-ui/react-avatar, Settings: Backups, Settings: Contact Import, Settings: Hisaab Import, Settings: Payment Methods, NavGroup, navGroups, NavItem (+12 more)

### Community 96 - "website/pricing.ts"
Cohesion: 0.17
Nodes (17): dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE, maxDuration (+9 more)

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
Cohesion: 0.14
Nodes (21): CategoriesAnalyticsPage(), CustomersAnalyticsPage(), AnalyticsPage(), ProductsAnalyticsPage(), CoinSplit, CoinSummary, GOLD_COIN_CATEGORY, isCoinItem() (+13 more)

### Community 102 - "lib/pricing.ts"
Cohesion: 0.29
Nodes (9): getMetalLabel(), ProductCard(), ProductRow(), _calculateProductCostsInternal(), calculateProductPrice(), _calculateSingleMetalCost(), DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, _getRateForKarat() (+1 more)

### Community 103 - "recents.ts"
Cohesion: 0.22
Nodes (12): cache, EMPTY, isRememberable(), listeners, load(), MAX_RECENTS, MIN_OPTIONS_FOR_RECENTS, readRecents() (+4 more)

### Community 104 - "CustomersPage"
Cohesion: 0.22
Nodes (9): CustomerCard(), CustomerRow(), CustomersPage(), detectSpamCustomers(), isGibberishName(), isRandomEmailLocal(), money(), pkr() (+1 more)

### Community 105 - "DocumentCard"
Cohesion: 0.53
Nodes (6): DocumentCard(), DocumentRow(), getDocStatus(), getStatusBadgeVariant(), isShopifyDoc(), pieceCount()

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
Cohesion: 0.07
Nodes (21): db, dump, privateKey, ts, db, firebase-admin, app, db (+13 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 113 - "shrink-order-sample-images.mjs"
Cohesion: 0.22
Nodes (7): sharp, APPLY, auth, fb, plan, shrinks, stamp

### Community 114 - "mark-shopify-unfulfilled.mjs"
Cohesion: 0.25
Nodes (7): dotenv, APPLY, auth, fb, IDS, plan, stamp

### Community 115 - "constructor"
Cohesion: 0.21
Nodes (6): b(), constructor(), deleteCacheAndMetadata(), F, j(), p()

### Community 116 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 117 - "ref_fs"
Cohesion: 0.06
Nodes (32): ref_fs, ref_os, existingInvoiceIds, fbConfig, invoices, orders, APPLY, extractFields() (+24 more)

### Community 118 - "receivables-breakdown.mjs"
Cohesion: 0.22
Nodes (8): ext(), fb, H, listAll(), openOrders, orderRows, owing, receivables

### Community 119 - "app/layout.tsx"
Cohesion: 0.19
Nodes (12): src_app_globals, AppBody(), inter, isLinksHost(), STORE_BRAND, STORE_THEME_COLOR, LIGHT_THEME, readCachedTheme() (+4 more)

### Community 120 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 121 - "cancel-tasneem-activity-log.mjs"
Cohesion: 0.25
Nodes (7): APPLY, extractFields(), fbConfig, fbHeaders, listAll(), matches, toDelete

### Community 122 - "dispatch"
Cohesion: 0.50
Nodes (5): addToRemoveQueue(), dispatch(), genId(), reducer(), Toast

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "firebase-admin.ts"
Cohesion: 0.11
Nodes (16): dynamic, GET(), validateHmac(), mapInvoiceToDraftOrder(), POST(), POST(), POST(), adminAuth (+8 more)

### Community 125 - "[entityId]/page.tsx"
Cohesion: 0.07
Nodes (42): jspdf-autotable, qrcode.react, CustomerStats, detectDuplicates(), DuplicatePair, MergeCustomersDialog(), nameSimilarity(), normalizeName() (+34 more)

### Community 126 - "clear-shopify.mjs"
Cohesion: 0.50
Nodes (3): app, db, firebaseConfig

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "voice-bubble.tsx"
Cohesion: 0.16
Nodes (18): aliasMap(), Phase, untilLoaded(), VoiceBubble(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, loadInvoices, PersonKind, RawIntent (+10 more)

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "workshop/page.tsx"
Cohesion: 0.07
Nodes (43): AddPhotosPage(), authHeaders(), Collection, Item, prettyBytes(), SITE, SITE_NAME, Status (+35 more)

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
Cohesion: 0.22
Nodes (8): ref_node_fs, yaml, blank, existing, lines, load(), merged, others

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

### Community 142 - "register-webhooks/route.ts"
Cohesion: 0.38
Nodes (6): APP_URL, SHOPIFY_API_VERSION, getExistingWebhooks(), POST(), registerWebhook(), WEBHOOK_TOPICS

### Community 143 - "restore-orders.mjs"
Cohesion: 0.40
Nodes (5): app, db, findCustomerId(), firebaseConfig, main()

### Community 144 - "restore-settings.mjs"
Cohesion: 0.33
Nodes (5): app, db, firebaseConfig, SETTINGS, settingsRef

### Community 145 - "numerals.ts"
Cohesion: 0.29
Nodes (10): ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy(), SCALES (+2 more)

### Community 147 - "post/route.ts"
Cohesion: 0.15
Nodes (22): heic-convert, dynamic, GET(), dynamic, maxDuration, POST(), dynamic, maxDuration (+14 more)

### Community 148 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

### Community 149 - "restore-inv-000001.mjs"
Cohesion: 0.50
Nodes (3): createdAt, db, homApp

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "whatsapp.ts"
Cohesion: 0.14
Nodes (27): Things you may need to do, WAHA — the POS's WhatsApp gateway, Worth knowing, GET(), PaymentMethodsPage(), FocusedKarigarView(), KarigarCard(), useShare() (+19 more)

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

### Community 157 - "v"
Cohesion: 0.33
Nodes (4): m(), st(), U(), v

### Community 159 - "materials.ts"
Cohesion: 0.19
Nodes (12): EditCartItemDialog(), n(), toDraft(), toPatch(), getSafeDefaultValues(), ProductForm(), describeMetal(), karatLabel() (+4 more)

### Community 160 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 161 - "add-mina-payment.mjs"
Cohesion: 0.50
Nodes (3): app, db, payment

### Community 162 - "post/page.tsx"
Cohesion: 0.05
Nodes (65): @radix-ui/react-dropdown-menu, ActionButton(), authHeaders(), Check, CheckStatus, HealthPanel(), HealthReport, ICON (+57 more)

### Community 165 - "shopifyRequest"
Cohesion: 0.24
Nodes (19): buildShopifyDraftOrderPayload(), buildShopifyOrderPayload(), findShopifyDraftOrderIdByTag(), findShopifyOrderIdByTag(), shopifyRequest(), createNewOrder(), handleCancel(), handleRefund() (+11 more)

### Community 166 - "renumber-orders.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, REMAP

### Community 167 - "website/featured/route.ts"
Cohesion: 0.29
Nodes (11): DELETE(), dynamic, gate(), GET(), PUT, shape(), site(), DOC (+3 more)

### Community 168 - "order-slip.ts"
Cohesion: 0.40
Nodes (5): staticCategories, drawOrderTotals(), money(), TotalRow, src_lib_store_categorysingular

### Community 171 - "placeWebsiteOrder"
Cohesion: 0.17
Nodes (13): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally, The parts, placeWebsiteOrder(), statusUrl(), customerPaidMessage(), customerPlacedMessage() (+5 more)

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
Cohesion: 0.21
Nodes (12): @radix-ui/react-toast, Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, src_components_ui_toast_toastprovider (+4 more)

### Community 176 - "chart.tsx"
Cohesion: 0.23
Nodes (10): recharts, ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, getPayloadConfigFromPayload() (+2 more)

### Community 181 - "startup.sh"
Cohesion: 0.83
Nodes (3): md(), secret(), startup.sh script

### Community 183 - "check-refunded-invoices.mjs"
Cohesion: 0.50
Nodes (3): app, db, refunded

### Community 185 - "sidebar.tsx"
Cohesion: 0.09
Nodes (26): @radix-ui/react-slot, @radix-ui/react-tooltip, src_components_ui_sheet_sheet, Sidebar, SidebarContext, SidebarGroup, SidebarGroupAction, SidebarInput (+18 more)

### Community 187 - "fallback-ce627215c0e4a9af.js"
Cohesion: 0.31
Nodes (6): c(), f(), h(), n(), r(), u()

### Community 194 - "r"
Cohesion: 0.19
Nodes (3): et, q(), r

### Community 196 - "invoice-item-cell.ts"
Cohesion: 0.36
Nodes (8): drawItemCell(), ItemBlock, itemCellHeight(), line(), wastageGrams(), wastageLine(), wrap(), Wrapped

### Community 198 - "order-slip-pdf.ts"
Cohesion: 0.16
Nodes (22): jspdf, ExpensesPage(), PKR(), EntityHisaabPage(), HisaabPage(), getStatusBadgeVariant(), OrderDetailPage(), buildOrderItemBlocks() (+14 more)

### Community 199 - "DayCard"
Cohesion: 0.40
Nodes (6): AddByHand(), authHeaders(), DayCard(), InvestmentsPage(), longDate(), time()

## Knowledge Gaps
- **1161 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1156 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1426 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `add-bank-account.mjs`, `store.ts`, `delete-bad-invoices.mjs`, `diagnose-dbs.mjs`, `import-shopify-orders.mjs`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `link-all-karigar-expenses.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `orders/[id]/page.tsx`, `write/route.ts`, `fix-bareeka.mjs`, `restore-inv-000001.mjs`, `add-bareeka-invoice.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `diagnose-orders.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `google-auth-gate.tsx`, `list-invoices.mjs`, `add-mina-payment.mjs`, `invoices/page.tsx`, `inspect-zahra.mjs`, `settings/page.tsx`, `renumber-orders.mjs`, `run/route.ts`, `preview-karigar-links.mjs`, `add-ali-customer.mjs`, `add-order-1141.mjs`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `check-refunded-invoices.mjs`, `refund-fatima.mjs`, `clean-hisaab.mjs`, `renumber-zahra.mjs`, `check-counters.mjs`, `import-expenses.mjs`, `check-outstanding.mjs`, `backfill-payment-credits.mjs`, `backfill-source-orders.mjs`, `working-capital-floor.tsx`, `react`, `link-new-karigars.mjs`, `clear-shopify.mjs`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.317) - this node is a cross-community bridge._
- **Why does `next` connect `react` to `workshop.ts`, `voice-bubble.tsx`, `workshop/page.tsx`, `google-auth-gate.tsx`, `settings/page.tsx`, `orders/[id]/page.tsx`, `write/route.ts`, `package.json`, `register-webhooks/route.ts`, `roleForEmail`, `post/route.ts`, `whatsapp.ts`, `fulfilment.ts`, `publish/route.ts`, `pieces/route.ts`, `loadCustomers`, `invoices/page.tsx`, `shopifyRequest`, `run/route.ts`, `website/featured/route.ts`, `ai/route.ts`, `roles.ts`, `store-config.ts`, `next.config.ts`, `verifyRequestEmail`, `overheads/page.tsx`, `proxy-image/route.ts`, `health.ts`, `unfinished-work.tsx`, `quote/route.ts`, `_lib.ts`, `instagram.ts`, `fonts.ts`, `cn`, `app-layout.tsx`, `website/pricing.ts`, `gold-rates/route.ts`, `tcs/route.ts`, `app/layout.tsx`, `firebase-admin.ts`, `[entityId]/page.tsx`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `voice-bubble.tsx`, `workshop/page.tsx`, `store.ts`, `settings/page.tsx`, `orders/[id]/page.tsx`, `story-editor.tsx`, `order-scanner.tsx`, `DocumentsPage`, `whatsapp.ts`, `materials.ts`, `loadCustomers`, `invoices/page.tsx`, `post/page.tsx`, `run/route.ts`, `pdf-chrome.ts`, `toast.tsx`, `chart.tsx`, `overheads/page.tsx`, `sidebar.tsx`, `editor-panels.tsx`, `design.ts`, `order-slip-pdf.ts`, `DayCard`, `invoice-pdf.ts`, `newLayerId`, `working-capital-floor.tsx`, `useAppStore`, `react`, `devRole`, `app-layout.tsx`, `AnalyticsPage`, `CustomersPage`, `DocumentCard`, `sheet.tsx`, `[entityId]/page.tsx`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1161 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `editor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10365853658536585 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._