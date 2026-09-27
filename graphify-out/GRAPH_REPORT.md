# Graph Report - taheri-pos  (2026-09-27)

## Corpus Check
- 554 files · ~541,108 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 3, .cache 2, .nix 1)

## Summary
- 4667 nodes · 16736 edges · 195 communities (173 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 153 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b7755073`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dispatch
- fix-customer-cleanup.mjs
- editor.ts
- import-latest-shopify-order.mjs
- store.ts
- dependencies
- meta.ts
- react
- plan.ts
- invoices/page.tsx
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
- ref_audience_editor
- sync-hisaab-rest.py
- audit-duplicates.mjs
- import-shopify-orders-by-number.mjs
- fulfilment.ts
- investments.ts
- complete-items-on-completed-orders.mjs
- resolve.ts
- answers.ts
- audit-customers.mjs
- exchange.ts
- assistant.ts
- _lib.ts
- next
- partner-statement.mjs
- revenue-reconciliation.mjs
- draft-list.tsx
- sidebar.tsx
- Orders workflow
- ai/route.ts
- clean-admin-notes.mjs
- MetaAdsError
- audit-shopify-duplicates.mjs
- cancel-customer-duplicate-payment.mjs
- GemsTrack POS overview
- invoice-pdf.ts
- sync-hisaab-balances.mjs
- reset-and-reimport.mjs
- fix-invoice-skus.mjs
- app-layout.tsx
- fix-phone-numbers.mjs
- collapse-tasneem-huzaifa-payments.mjs
- scripts
- useToast
- firebase
- cn
- z
- clean-hisaab.mjs
- editor-panels.tsx
- check-counters.mjs
- import-expenses.mjs
- vision/order/route.ts
- getInvoiceAdjustmentsAmount
- backfill-payment-credits.mjs
- health.ts
- checkout.ts
- firebase-admin.ts
- bill-scanner.tsx
- import-one-shopify-order.mjs
- Button
- story.ts
- vitest
- website/edit/page.tsx
- compilerOptions
- components.json
- public/me/route.ts
- audience-editor.tsx
- quote/route.ts
- radio-group.tsx
- triage.ts
- devDependencies
- cancel-tasneem-duplicate-payment.mjs
- import-shopify-orders.mjs
- cleanup-shopify-pos-orders.mjs
- dedupe-invoice-payments.mjs
- overheads.ts
- postGate
- workshop.ts
- campaigns/page.tsx
- listen/route.ts
- queue.ts
- Quotation Generator
- Dynamic gold-rate price recalculation
- menubar.tsx
- backfill-shopify-invoice-adjustments.mjs
- gold-rates/route.ts
- bulk-sync-pos-to-shopify.mjs
- mark-invoices-paid.mjs
- regenerate-payment-link.mjs
- who-owes-money.mjs
- analytics/page.tsx
- lib/pricing.ts
- settings.ts
- run/route.ts
- app/layout.tsx
- store-config.ts
- website/featured/route.ts
- printer/page.tsx
- photos/route.ts
- revenue.ts
- a
- link-new-karigars.mjs
- site-pieces.ts
- caption/route.ts
- constructor
- app/page.tsx
- ref_fs
- receivables-breakdown.mjs
- phonetics.ts
- manifest.json
- use-work-drafts.ts
- workbox-f1770938.js
- zebra-printer.ts
- sheet.tsx
- verifyRequestEmail
- edits/route.ts
- fix-zahra-invoice.mjs
- import-shopify-customers.mjs
- command-palette.tsx
- notifications-scheduler.js
- restore-inv-000001.mjs
- pdf-text.ts
- diagnose-dbs.mjs
- env-for-house.mjs
- fix-dates.mjs
- fix-invoice-dates.mjs
- delete-bad-invoices.mjs
- link-invoice-hisaab.mjs
- link-uzair-expenses.mjs
- restore-orders.mjs
- restore-settings.mjs
- numerals.ts
- AGENTS.md
- fix-bareeka.mjs
- google-auth-gate.tsx
- add-bareeka-invoice.mjs
- whatsapp.ts
- add-uzair-skipped-entries.mjs
- delete-sherbano-invoice.mjs
- link-all-karigar-expenses.mjs
- do-refund-fatima.mjs
- link-uzair-stones.mjs
- v
- diagnose-orders.mjs
- whatsapp-local-service.js
- check-outstanding.mjs
- post/page.tsx
- backfill-source-orders.mjs
- cancel-tasneem-activity-log.mjs
- list-invoices.mjs
- renumber-orders.mjs
- environment-setup.sh
- Firebase 404 fallback page
- Logo (white) SVG asset
- clear-shopify.mjs
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
- refund-fatima.mjs
- recents.ts
- session-start.sh
- voice-bubble.tsx
- fallback-ce627215c0e4a9af.js
- vcard-parser.d.ts
- sharp
- r
- firebase.ts
- cleanup-test-shopify-mirror-docs.mjs
- src_app_website_post_story_editor_storyeditor
- firebase-admin
- order-form.tsx
- shopifyRequest
- tcs/route.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 375 edges
2. `Button` - 261 edges
3. `useAppStore` - 187 edges
4. `react` - 160 edges
5. `useToast()` - 159 edges
6. `next` - 158 edges
7. `Card` - 140 edges
8. `CardContent` - 136 edges
9. `Input` - 122 edges
10. `lucide-react` - 113 edges

## Surprising Connections (you probably didn't know these)
- `Applying edits on each site` --references--> `s`  [INFERRED]
  docs/edit-website-pieces.md → public/workbox-f1770938.js
- `The POS page` --references--> `PairEditor()`  [INFERRED]
  docs/edit-website-pieces.md → src/app/website/post/story-editor.tsx
- `Source of truth: the POS` --references--> `base()`  [INFERRED]
  docs/edit-website-pieces.md → src/lib/leopards.ts
- `The POS page` --references--> `Placement`  [INFERRED]
  docs/edit-website-pieces.md → src/lib/social/story.ts
- `How a piece is named in each place` --references--> `getSitePieces()`  [INFERRED]
  docs/edit-website-pieces.md → src/lib/website/site-pieces.ts

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

## Communities (195 total, 22 thin omitted)

### Community 0 - "dispatch"
Cohesion: 0.50
Nodes (5): addToRemoveQueue(), dispatch(), genId(), reducer(), Toast

### Community 1 - "fix-customer-cleanup.mjs"
Cohesion: 0.10
Nodes (18): APPLY, ATTACH_CUSTOMER_INVOICES, attachPlan, auth, custById, extract(), fbConfig, fbGet() (+10 more)

### Community 2 - "editor.ts"
Cohesion: 0.05
Nodes (76): InlineText(), StoryEditorProps, Template, Adjust, MaskKey, ShapeKey, adjustedCache, adjustedSource() (+68 more)

### Community 3 - "import-latest-shopify-order.mjs"
Cohesion: 0.09
Nodes (25): ref_dns, APPLY, buildOrder(), created, H, INFLUENCERS, phone(), APPLY (+17 more)

### Community 4 - "store.ts"
Cohesion: 0.02
Nodes (88): ExpenseFormProps, Category, ExchangeEntry, ALWAYS, configured, EXPENSE_CATEGORIES, ExpenseCategory, TAHERI (+80 more)

### Community 5 - "dependencies"
Cohesion: 0.04
Nodes (57): dependencies, buffer, class-variance-authority, clsx, date-fns, dotenv, firebase, @google/generative-ai (+49 more)

### Community 6 - "meta.ts"
Cohesion: 0.10
Nodes (41): ref_crypto, dynamic, GET(), dynamic, POST(), dynamic, GET(), AdsConnection (+33 more)

### Community 7 - "react"
Cohesion: 0.09
Nodes (71): class-variance-authority, lucide-react, react, CustomerActions(), CustomerCard(), PageError(), Loading(), Choice() (+63 more)

### Community 8 - "plan.ts"
Cohesion: 0.12
Nodes (32): Photo, dynamic, isPlan(), maxDuration, POST(), AdTemplate, planContext(), createAd() (+24 more)

### Community 9 - "invoices/page.tsx"
Cohesion: 0.08
Nodes (100): date-fns, react-day-picker, AdditionalRevenuePage(), CategoriesAnalyticsPage(), CategoryPerformanceData, COLORS, CustomerPerformanceData, CustomersAnalyticsPage() (+92 more)

### Community 10 - "write/route.ts"
Cohesion: 0.07
Nodes (19): Body, dynamic, ORDER_STATUSES, POST(), stripUndefined(), adminPort, clientPort, BatchCtx (+11 more)

### Community 11 - "package.json"
Cohesion: 0.04
Nodes (44): name, private, version, buffer, clsx, dotenv-cli, html5-qrcode, immer (+36 more)

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
Cohesion: 0.10
Nodes (29): heic-convert, dynamic, maxDuration, POST(), dynamic, GET(), previewAsStaff(), dynamic (+21 more)

### Community 17 - "story-editor.tsx"
Cohesion: 0.07
Nodes (55): useFilterThumbs(), clipboard, CONTEXT_PANELS, ContextMenu(), CORNERS, Drag, Editor, fileToDataUrl() (+47 more)

### Community 18 - "order-scanner.tsx"
Cohesion: 0.15
Nodes (28): downscale(), money(), NamePick(), OrderScanner(), Photo, Row(), GRAMS_PER_TOLA, describeExchange() (+20 more)

### Community 19 - "import-karigar-khata.mjs"
Cohesion: 0.10
Nodes (17): APPLY, args, byName, createDoc(), ext(), fb, fetch(), H (+9 more)

### Community 20 - "collapse-duplicate-payments.mjs"
Cohesion: 0.16
Nodes (15): APPLY, args, backup, del(), ext(), fb, fetch(), getDoc() (+7 more)

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
Cohesion: 0.13
Nodes (28): Things to get right, dynamic, fail(), gate(), GET(), POST(), base(), bookPacket() (+20 more)

### Community 26 - "investments.ts"
Cohesion: 0.06
Nodes (70): dynamic, POST(), dynamic, maxDuration, POST(), dynamic, GET(), hasIngestToken() (+62 more)

### Community 27 - "complete-items-on-completed-orders.mjs"
Cohesion: 0.18
Nodes (14): APPLY, args, ext(), fb, fetch(), H, listAll(), log (+6 more)

### Community 28 - "resolve.ts"
Cohesion: 0.10
Nodes (32): DocEntry, DocKind, DocResolution, documentHref(), documentsFor(), isRecent(), matchMethod(), matchStatus() (+24 more)

### Community 29 - "answers.ts"
Cohesion: 0.10
Nodes (29): DuplicatePair, SpamCandidate, Props, CustomerFormProps, InvoicePdfOptions, DAYS_AHEAD, DAYS_BEHIND, daysUntilAnniversaryOf() (+21 more)

### Community 30 - "audit-customers.mjs"
Cohesion: 0.12
Nodes (12): db, c(), auth, byNorm, extract(), fbConfig, issues, listAll() (+4 more)

### Community 31 - "exchange.ts"
Cohesion: 0.10
Nodes (41): day(), OrderCarryOver(), pkr(), hasDetails(), KARATS, CashIn, cashInForPeriod(), CashInvoice (+33 more)

### Community 32 - "assistant.ts"
Cohesion: 0.08
Nodes (63): dynamic, GET(), maxDuration, cache, dynamic, GET(), maxDuration, adsSnapshot() (+55 more)

### Community 33 - "_lib.ts"
Cohesion: 0.15
Nodes (23): fetchAllPages(), findShopifyCustomerId(), FIRESTORE_API_KEY, FIRESTORE_PROJECT_ID, firestoreBase(), firestoreGet(), firestoreSet(), mapCustomer() (+15 more)

### Community 34 - "next"
Cohesion: 0.08
Nodes (50): nextConfig, next, dynamic, maxDuration, POST(), GET(), dynamic, POST() (+42 more)

### Community 35 - "partner-statement.mjs"
Cohesion: 0.08
Nodes (24): activeInvoices, auth, cashCollected, closedBatches, extract(), fbConfig, invoiceRevenue, listAll() (+16 more)

### Community 36 - "revenue-reconciliation.mjs"
Cohesion: 0.08
Nodes (23): auth, breakdown, extract(), fbConfig, isMoneyless(), listAll(), liveShopify, orphans (+15 more)

### Community 37 - "draft-list.tsx"
Cohesion: 0.32
Nodes (11): DraftsPage(), Section(), ago(), DraftCard(), DraftsShortcut(), pkr(), deleteWorkDraft(), useWorkDrafts() (+3 more)

### Community 38 - "sidebar.tsx"
Cohesion: 0.11
Nodes (22): src_components_ui_sheet_sheet, SidebarContext, SidebarGroupAction, SidebarInput, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, sidebarMenuButtonVariants (+14 more)

### Community 39 - "Orders workflow"
Cohesion: 0.50
Nodes (5): Given Items tracking, Hisaab/Ledger concept, Invoices/Documents, Orders workflow, Scan/POS QR-code lookup

### Community 40 - "ai/route.ts"
Cohesion: 0.08
Nodes (51): checkSame(), dynamic, gate(), maxDuration, POST(), shopName(), AiError, auth (+43 more)

### Community 41 - "clean-admin-notes.mjs"
Cohesion: 0.21
Nodes (11): APPLY, backup, byOrder, ext(), fb, getOrder(), H, MOVE (+3 more)

### Community 42 - "MetaAdsError"
Cohesion: 0.09
Nodes (43): Data, DELETE(), dynamic, maxDuration, nameOf(), POST(), segmentOf(), BUTTONS (+35 more)

### Community 43 - "audit-shopify-duplicates.mjs"
Cohesion: 0.09
Nodes (21): byPosInvoice, customerTotalDupes, dupePerExistingInvoice, duplicateSets, extractFields(), fbConfig, fbHeaders, getCollection() (+13 more)

### Community 44 - "cancel-customer-duplicate-payment.mjs"
Cohesion: 0.10
Nodes (22): amtNeedle, APPLY, args, dayOf(), debits, dupDay, extractFields(), fbConfig (+14 more)

### Community 45 - "GemsTrack POS overview"
Cohesion: 0.67
Nodes (4): Project graphify usage rules, App blueprint (style + features), GemsTrack user tutorial, GemsTrack POS overview

### Community 46 - "invoice-pdf.ts"
Cohesion: 0.07
Nodes (70): jspdf, jspdf-autotable, categorySingular(), staticCategories, drawItemCell(), ItemBlock, itemCellHeight(), line() (+62 more)

### Community 47 - "sync-hisaab-balances.mjs"
Cohesion: 0.22
Nodes (6): app, batch, customerByName, db, firebaseConfig, linkedByInvoice

### Community 48 - "reset-and-reimport.mjs"
Cohesion: 0.20
Nodes (10): app, db, delBatch, impBatch, orderMap, parseCSV(), parseCSVRow(), rows (+2 more)

### Community 49 - "fix-invoice-skus.mjs"
Cohesion: 0.50
Nodes (4): app, db, fixSku(), main()

### Community 50 - "app-layout.tsx"
Cohesion: 0.12
Nodes (28): Settings: Payment Methods, AppLayout(), forRole(), isActiveItem(), NavGroup, navGroups, NavItem, NavTab (+20 more)

### Community 51 - "fix-phone-numbers.mjs"
Cohesion: 0.09
Nodes (17): ref_libphonenumber_js, all(), auth, bad, fbConfig, report, sample, TARGETS (+9 more)

### Community 52 - "collapse-tasneem-huzaifa-payments.mjs"
Cohesion: 0.10
Nodes (20): APPLY, counts, debits, expected, extractFields(), fbConfig, getDoc(), grandTotal (+12 more)

### Community 53 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dev:mina, dev:taheri, env:mina, env:taheri, lint (+5 more)

### Community 54 - "useToast"
Cohesion: 0.05
Nodes (132): Audience, Audiences(), AudiencesRoute(), COUNTRIES, BUTTONS, Card(), GOAL_ICON, localInput() (+124 more)

### Community 55 - "firebase"
Cohesion: 0.05
Nodes (27): firebase, app, BANK_ACCOUNT, db, firebaseConfig, app, db, payment (+19 more)

### Community 56 - "cn"
Cohesion: 0.08
Nodes (57): @radix-ui/react-accordion, CalendarEventType, CalendarPage(), dayMoney(), EventDetails(), EventsByDate, getMetalLabel(), ProductCard() (+49 more)

### Community 58 - "clean-hisaab.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 59 - "editor-panels.tsx"
Cohesion: 0.10
Nodes (64): AdjustControls(), AlignButtons(), BackgroundInspector(), BrandPanel(), ColourButton(), ColourPanel(), ColourRow(), ContextToolbar() (+56 more)

### Community 60 - "check-counters.mjs"
Cohesion: 0.15
Nodes (11): fixes, h, homApp, homDb, maxHomInv, maxHomOrder, maxTaheriInv, maxTaheriOrder (+3 more)

### Community 61 - "import-expenses.mjs"
Cohesion: 0.33
Nodes (4): app, db, expenses, firebaseConfig

### Community 62 - "vision/order/route.ts"
Cohesion: 0.11
Nodes (25): BILL_SCHEMA, denyUnlessOwner(), dynamic, POST(), runtime, denyUnlessOwner(), DRAFT_SCHEMA, dynamic (+17 more)

### Community 63 - "getInvoiceAdjustmentsAmount"
Cohesion: 0.38
Nodes (5): getInvoiceAdjustmentsAmount(), getInvoiceExchangeTotal(), getInvoiceExpectedGrandTotal(), InvoiceLike, OrderLike

### Community 64 - "backfill-payment-credits.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 65 - "health.ts"
Cohesion: 0.10
Nodes (39): dynamic, GET(), dynamic, GET(), maxDuration, POST(), WHERES, aiConfigured() (+31 more)

### Community 66 - "checkout.ts"
Cohesion: 0.07
Nodes (51): The parts, ref_node_crypto, BuildContext, buildWebsiteOrder(), BuiltOrder, CheckoutBody, CheckoutInput, CheckoutRejected (+43 more)

### Community 67 - "firebase-admin.ts"
Cohesion: 0.14
Nodes (11): dynamic, GET(), validateHmac(), APP_URL, SHOPIFY_API_VERSION, getExistingWebhooks(), POST(), registerWebhook() (+3 more)

### Community 68 - "bill-scanner.tsx"
Cohesion: 0.16
Nodes (22): BillScanner(), CustomerPick(), downscale(), money(), ScannedBill, blankCartItem(), PhotoPick(), canDecode() (+14 more)

### Community 69 - "import-one-shopify-order.mjs"
Cohesion: 0.12
Nodes (17): APPLY, args, discount, extractFields(), fbConfig, fbHeaders, getDocById(), grandTotal (+9 more)

### Community 70 - "Button"
Cohesion: 0.09
Nodes (95): ActivityLogPage(), eventIcons, getEventTypeColor(), REVERTABLE_EVENTS, revertConsequences, RevenueForm(), AdDialog(), AudienceDialog() (+87 more)

### Community 71 - "story.ts"
Cohesion: 0.16
Nodes (16): Palette, PALETTES, drawBackdrop(), drawStory(), drawStoryPhoto(), fitSize(), regionLuminance(), renderStoryJpeg() (+8 more)

### Community 72 - "vitest"
Cohesion: 0.11
Nodes (32): ref_node_path, vitest, Breakdown, Overview, AttentionInput, AttentionItem, attentionItems(), AttentionKind (+24 more)

### Community 73 - "website/edit/page.tsx"
Cohesion: 0.06
Nodes (70): The POS page, authHeaders(), blankDoc(), Change, changed(), checkOk(), EditPiecePage(), EditPieceRoute() (+62 more)

### Community 74 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 75 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 76 - "public/me/route.ts"
Cohesion: 0.12
Nodes (33): dynamic, OPTIONS(), POST(), dynamic, GET(), OPTIONS(), dynamic, GET() (+25 more)

### Community 77 - "audience-editor.tsx"
Cohesion: 0.12
Nodes (28): AudienceEditor(), AudienceRow, Chip(), CITY_SHORTCUTS, INTEREST_SHORTCUTS, InterestHit, Section(), useDebounced() (+20 more)

### Community 78 - "quote/route.ts"
Cohesion: 0.08
Nodes (35): Applying edits on each site, Delivery: the POS pushes, the site serves it itself, Editing existing website pieces from the POS, How a piece is named in each place, Live channels that already exist, Photos: render in the POS, upload under a new name every time, Proposed design, Questions for the owner before building (+27 more)

### Community 79 - "radio-group.tsx"
Cohesion: 0.50
Nodes (3): @radix-ui/react-radio-group, RadioGroup, RadioGroupItem

### Community 80 - "triage.ts"
Cohesion: 0.09
Nodes (37): buildIndex(), Conflict, ConflictChoice, ConflictReason, defaultChoice(), ExistingRow, ImportPlan, PendingContact (+29 more)

### Community 81 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, dotenv-cli, firebase-admin, postcss, qrcode-terminal, tailwindcss, @types/heic-convert, @types/jspdf (+9 more)

### Community 82 - "cancel-tasneem-duplicate-payment.mjs"
Cohesion: 0.15
Nodes (14): APPLY, debits, extractFields(), fbConfig, fbHeaders, grandTotal, linked, listAll() (+6 more)

### Community 83 - "import-shopify-orders.mjs"
Cohesion: 0.38
Nodes (6): app, db, firebaseConfig, main(), parseCSV(), parseCSVRow()

### Community 84 - "cleanup-shopify-pos-orders.mjs"
Cohesion: 0.15
Nodes (10): APPLY, extractFields(), fbConfig, fbHeaders, getDocById(), invoiceIdsToStrip, invoicesById, listInvoicesWithShopifyId() (+2 more)

### Community 85 - "dedupe-invoice-payments.mjs"
Cohesion: 0.17
Nodes (13): APPLY, dayOf(), dedupePayments(), extractFields(), fbConfig, fbHeaders, fixes, hisaabByInvoice (+5 more)

### Community 86 - "overheads.ts"
Cohesion: 0.16
Nodes (17): BENCHMARK_START, benchmarkSummary(), DEFAULT_OVERHEADS, InvoiceLike, monthKey(), monthLabel(), monthlyRows(), MonthRow (+9 more)

### Community 87 - "postGate"
Cohesion: 0.15
Nodes (29): dynamic, POST(), dynamic, GET(), dynamic, maxDuration, POST(), postGate() (+21 more)

### Community 88 - "workshop.ts"
Cohesion: 0.13
Nodes (29): daysSince(), GET(), urgency(), Age(), buildGlanceRows(), GlanceRow, KarigarGlance(), KarigarPanel() (+21 more)

### Community 89 - "campaigns/page.tsx"
Cohesion: 0.06
Nodes (76): AccountAlerts(), AccountPill(), api(), ApiError, authHeaders(), ErrorLine(), NotReady(), RangePicker() (+68 more)

### Community 90 - "listen/route.ts"
Cohesion: 0.22
Nodes (12): denyUnlessOwner(), dynamic, POST(), READING_SCHEMA, runtime, QUERY_KINDS, documentLines(), numeralVocabulary() (+4 more)

### Community 91 - "queue.ts"
Cohesion: 0.07
Nodes (53): DELETE(), dynamic, fail(), idOk(), maxDuration, PATCH(), POST(), statusOf() (+45 more)

### Community 94 - "menubar.tsx"
Cohesion: 0.11
Nodes (12): @radix-ui/react-menubar, Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator (+4 more)

### Community 95 - "backfill-shopify-invoice-adjustments.mjs"
Cohesion: 0.27
Nodes (13): FIREBASE_TOOLS_CONFIG_PATH, firestoreFetchJson(), fromFirestoreDocument(), fromFirestoreValue(), getAccessToken(), getExchangeTotal(), getExpectedAdjustments(), getItemSubtotal() (+5 more)

### Community 96 - "gold-rates/route.ts"
Cohesion: 0.83
Nodes (3): GET(), parseRate(), scrapeGoldPk()

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

### Community 101 - "analytics/page.tsx"
Cohesion: 0.07
Nodes (37): DailySummaryItem, ExpenseByCategoryData, SalesByCategoryData, SalesOverTimeData, SOURCE_COLORS, SOURCE_KEYS, SOURCE_LABELS, SourceBreakdownData (+29 more)

### Community 102 - "lib/pricing.ts"
Cohesion: 0.24
Nodes (9): Before the switch goes on, Selling from taheri.shop — how it works, and what must be true before it is switched on, Testing locally, _calculateProductCostsInternal(), calculateProductPrice(), _calculateSingleMetalCost(), DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, _getRateForKarat() (+1 more)

### Community 103 - "settings.ts"
Cohesion: 0.20
Nodes (21): AdsStatus, Assets, dynamic, GET(), maxDuration, POST(), disconnect(), AccountChoice (+13 more)

### Community 104 - "run/route.ts"
Cohesion: 0.07
Nodes (55): @google/generative-ai, checkGivenItems(), checkKarigarPayments(), checkOverdueOrders(), daysSince(), fmt(), getSettings(), POST() (+47 more)

### Community 105 - "app/layout.tsx"
Cohesion: 0.23
Nodes (16): src_app_globals, AppBody(), inter, RootLayout(), warmPdfLogo(), applyThemeToDocument(), applyUiStyleToDocument(), DEFAULT_UI_STYLE (+8 more)

### Community 106 - "store-config.ts"
Cohesion: 0.09
Nodes (27): Block(), Channel, ChannelRow(), didone, host(), Icon(), IconName, LinksPage() (+19 more)

### Community 107 - "website/featured/route.ts"
Cohesion: 0.29
Nodes (11): DELETE(), dynamic, gate(), GET(), PUT, shape(), site(), DOC (+3 more)

### Community 108 - "printer/page.tsx"
Cohesion: 0.23
Nodes (13): defaultLayout, DumbbellTagOutline(), FieldPreview(), LabelField, LabelLayout, PrinterPage(), PrinterPageComponent(), ProductSearch() (+5 more)

### Community 109 - "photos/route.ts"
Cohesion: 0.21
Nodes (13): dynamic, EXTS, gate(), GET(), HEIC_EXTS, isHeic(), KNOWN_TREE, maxDuration (+5 more)

### Community 110 - "revenue.ts"
Cohesion: 0.16
Nodes (12): buildRevenueEvents(), comparePeriods(), DAY_NAMES, Grain, GRAIN_LABEL, monthPace(), PeriodComparison, RevenueBucket (+4 more)

### Community 112 - "link-new-karigars.mjs"
Cohesion: 0.18
Nodes (8): abdullah, app, db, expenses, karigarDefs, karigars, manif, PRE_LAUNCH_EXCLUSIONS

### Community 113 - "site-pieces.ts"
Cohesion: 0.12
Nodes (22): dynamic, GET(), STORE_SITE_POSTS, byNewest(), Dated, NEW_AT_LEAST, NEW_DAYS, newArrivalIds() (+14 more)

### Community 114 - "caption/route.ts"
Cohesion: 0.27
Nodes (10): dynamic, maxDuration, POST(), House, RULES, SITE_CAPTION_SCHEMA, siteCaptionSystem(), siteCaptionUser() (+2 more)

### Community 115 - "constructor"
Cohesion: 0.23
Nodes (5): b(), constructor(), deleteCacheAndMetadata(), F, p()

### Community 116 - "app/page.tsx"
Cohesion: 0.12
Nodes (30): compactPKR(), Due, dueOrder(), DueRow(), Headline(), HomePage(), Panel(), RecentInvoiceRow() (+22 more)

### Community 117 - "ref_fs"
Cohesion: 0.04
Nodes (41): db, dump, privateKey, ts, dotenv, ref_fs, ref_os, app (+33 more)

### Community 118 - "receivables-breakdown.mjs"
Cohesion: 0.22
Nodes (8): ext(), fb, H, listAll(), openOrders, orderRows, owing, receivables

### Community 119 - "phonetics.ts"
Cohesion: 0.36
Nodes (10): levenshtein(), matchShape, nameScore(), phoneticKey(), rankNames(), ratio(), SCRIPTS, tokenKey() (+2 more)

### Community 120 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 121 - "use-work-drafts.ts"
Cohesion: 0.15
Nodes (26): DraftStatus, moveLegacyDrafts(), thisDevice(), useWorkDraft(), clearAllDrafts(), Draft, DraftKind, listDrafts() (+18 more)

### Community 122 - "workbox-f1770938.js"
Cohesion: 0.27
Nodes (10): n(), get(), h(), i, j(), k(), O(), s (+2 more)

### Community 123 - "zebra-printer.ts"
Cohesion: 0.28
Nodes (8): checkZebraBrowserPrint(), generateDumbbellTagZpl(), generateZplFromLayout(), LabelField, LabelLayout, sendZplToPrinter(), ZebraBrowserPrint, ZebraDevice

### Community 124 - "sheet.tsx"
Cohesion: 0.22
Nodes (10): @radix-ui/react-dialog, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle (+2 more)

### Community 125 - "verifyRequestEmail"
Cohesion: 0.18
Nodes (19): POST(), FulfillmentOrder, GET(), openFulfillmentOrders(), POST(), requireOwner(), existingSets(), GET() (+11 more)

### Community 126 - "edits/route.ts"
Cohesion: 0.10
Nodes (36): cleanText(), dynamic, fieldsFor(), GET(), maxDuration, POST(), same(), dynamic (+28 more)

### Community 127 - "fix-zahra-invoice.mjs"
Cohesion: 0.25
Nodes (6): homApp, homConfig, homDb, taheriApp, taheriConfig, taheriDb

### Community 128 - "import-shopify-customers.mjs"
Cohesion: 0.29
Nodes (6): app, batch, db, existingNames, toAdd, uniqueMap

### Community 129 - "command-palette.tsx"
Cohesion: 0.19
Nodes (12): CommandPalette(), DESTINATIONS, GROUP_ORDER, Item, NEW, phoneForms(), pkr(), shortDate() (+4 more)

### Community 130 - "notifications-scheduler.js"
Cohesion: 0.40
Nodes (5): buildSchedule(), cron, run(), runArg, node-cron

### Community 131 - "restore-inv-000001.mjs"
Cohesion: 0.50
Nodes (3): createdAt, db, homApp

### Community 135 - "diagnose-dbs.mjs"
Cohesion: 0.33
Nodes (4): homApp, homDb, taheriApp, taheriDb

### Community 136 - "env-for-house.mjs"
Cohesion: 0.12
Nodes (14): ref_google_auth_library, ref_node_fs, yaml, auth, blank, existing, houseProject, lent (+6 more)

### Community 137 - "fix-dates.mjs"
Cohesion: 0.40
Nodes (5): app, db, firebaseConfig, main(), setDate()

### Community 138 - "fix-invoice-dates.mjs"
Cohesion: 0.40
Nodes (5): app, db, firebaseConfig, main(), setDate()

### Community 139 - "delete-bad-invoices.mjs"
Cohesion: 0.33
Nodes (4): app, db, firebaseConfig, TO_DELETE

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

### Community 145 - "numerals.ts"
Cohesion: 0.29
Nodes (10): ALL_WORDS(), clean(), editRatio(), findNumbers(), FoundNumber, FRACTIONS, isWordy(), SCALES (+2 more)

### Community 148 - "fix-bareeka.mjs"
Cohesion: 0.33
Nodes (5): app, batch, db, hisaabRef, inv

### Community 149 - "google-auth-gate.tsx"
Cohesion: 0.13
Nodes (19): AuthContext, AuthContextValue, GoogleAuthGate(), GoogleIcon(), googleProvider, isAllowed(), KarigarPortal, logSignIn() (+11 more)

### Community 150 - "add-bareeka-invoice.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, hisaabRef

### Community 151 - "whatsapp.ts"
Cohesion: 0.13
Nodes (33): Things you may need to do, WAHA — the POS's WhatsApp gateway, Worth knowing, GET(), channelId(), dynamic, gate(), GET() (+25 more)

### Community 152 - "add-uzair-skipped-entries.mjs"
Cohesion: 0.40
Nodes (4): app, db, toAdd, uzair

### Community 153 - "delete-sherbano-invoice.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 154 - "link-all-karigar-expenses.mjs"
Cohesion: 0.33
Nodes (5): app, db, expenses, karigarDefs, karigars

### Community 155 - "do-refund-fatima.mjs"
Cohesion: 0.50
Nodes (4): cleanObject(), db, homApp, main()

### Community 156 - "link-uzair-stones.mjs"
Cohesion: 0.40
Nodes (4): app, db, toLink, uzair

### Community 157 - "v"
Cohesion: 0.36
Nodes (4): m(), st(), U(), v

### Community 159 - "diagnose-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 160 - "whatsapp-local-service.js"
Cohesion: 0.22
Nodes (9): ref_http, qrcode-terminal, whatsapp-web.js, client, { Client, LocalAuth }, http, qrcode, readBody() (+1 more)

### Community 161 - "check-outstanding.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 162 - "post/page.tsx"
Cohesion: 0.04
Nodes (94): @radix-ui/react-dropdown-menu, ActionButton(), authHeaders(), Check, CheckStatus, HealthPanel(), HealthReport, ICON (+86 more)

### Community 163 - "backfill-source-orders.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 164 - "cancel-tasneem-activity-log.mjs"
Cohesion: 0.25
Nodes (7): APPLY, extractFields(), fbConfig, fbHeaders, listAll(), matches, toDelete

### Community 166 - "list-invoices.mjs"
Cohesion: 0.40
Nodes (3): app, db, firebaseConfig

### Community 167 - "renumber-orders.mjs"
Cohesion: 0.40
Nodes (4): app, batch, db, REMAP

### Community 171 - "clear-shopify.mjs"
Cohesion: 0.50
Nodes (3): app, db, firebaseConfig

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
Cohesion: 0.29
Nodes (11): @radix-ui/react-toast, Toast, ToastActionElement, ToastClose, ToastDescription, ToastProps, src_components_ui_toast_toastprovider, ToastTitle (+3 more)

### Community 176 - "chart.tsx"
Cohesion: 0.24
Nodes (11): recharts, ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartStyle(), ChartTooltipContent (+3 more)

### Community 181 - "startup.sh"
Cohesion: 0.83
Nodes (3): md(), secret(), startup.sh script

### Community 183 - "recents.ts"
Cohesion: 0.22
Nodes (12): cache, EMPTY, isRememberable(), listeners, load(), MAX_RECENTS, MIN_OPTIONS_FOR_RECENTS, readRecents() (+4 more)

### Community 186 - "voice-bubble.tsx"
Cohesion: 0.11
Nodes (26): SalePaymentRow, aliasMap(), Phase, untilLoaded(), VoiceBubble(), DEFAULT_KARAT_VALUE_FOR_CALCULATION, HisaabEntityType, OrderStatus (+18 more)

### Community 187 - "fallback-ce627215c0e4a9af.js"
Cohesion: 0.43
Nodes (4): f(), h(), r(), u()

### Community 193 - "sharp"
Cohesion: 0.22
Nodes (7): sharp, APPLY, auth, fb, plan, shrinks, stamp

### Community 194 - "r"
Cohesion: 0.19
Nodes (3): et, q(), r

### Community 196 - "firebase.ts"
Cohesion: 0.18
Nodes (10): src_lib_firebase_db, firebaseConfig, DEFAULT_WORKING_CAPITAL_FLOOR, DOC_PATH, FloorHistoryEntry, isFloorStale(), isMonthStart(), loadPartnershipSettings() (+2 more)

### Community 197 - "cleanup-test-shopify-mirror-docs.mjs"
Cohesion: 0.29
Nodes (7): APPLY, extractFields(), fbConfig, listInvoices(), settings, shopifyMirrors, targets

### Community 203 - "firebase-admin"
Cohesion: 0.12
Nodes (15): firebase-admin, db, toDelete, db, silverEntries, backupApp, backupDb, liveApp (+7 more)

### Community 204 - "order-form.tsx"
Cohesion: 0.04
Nodes (124): @hookform/resolvers, qrcode.react, react-hook-form, react-phone-number-input, zod, Settings: Backups, Settings: Contact Import, Settings: Hisaab Import (+116 more)

### Community 205 - "shopifyRequest"
Cohesion: 0.20
Nodes (21): buildShopifyOrderPayload(), findShopifyOrderIdByTag(), findShopifyProductIdsBySku(), getShopifyCredentials(), mapInvoiceToDraftOrder(), mapProductToShopify(), shopifyRequest(), POST() (+13 more)

### Community 208 - "tcs/route.ts"
Cohesion: 1.00
Nodes (3): getBaseUrl(), getTcsTokens(), POST()

## Knowledge Gaps
- **1369 isolated node(s):** `privateKey`, `db`, `dump`, `ts`, `$schema` (+1364 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1602 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase` connect `firebase` to `import-shopify-customers.mjs`, `restore-inv-000001.mjs`, `store.ts`, `diagnose-dbs.mjs`, `react`, `fix-dates.mjs`, `fix-invoice-dates.mjs`, `package.json`, `delete-bad-invoices.mjs`, `link-invoice-hisaab.mjs`, `link-uzair-expenses.mjs`, `restore-orders.mjs`, `restore-settings.mjs`, `invoices/page.tsx`, `write/route.ts`, `fix-bareeka.mjs`, `google-auth-gate.tsx`, `add-bareeka-invoice.mjs`, `add-uzair-skipped-entries.mjs`, `delete-sherbano-invoice.mjs`, `link-all-karigar-expenses.mjs`, `do-refund-fatima.mjs`, `link-uzair-stones.mjs`, `diagnose-orders.mjs`, `check-outstanding.mjs`, `backfill-source-orders.mjs`, `draft-list.tsx`, `list-invoices.mjs`, `renumber-orders.mjs`, `clear-shopify.mjs`, `preview-karigar-links.mjs`, `add-ali-customer.mjs`, `add-order-1141.mjs`, `sync-hisaab-balances.mjs`, `reset-and-reimport.mjs`, `fix-invoice-skus.mjs`, `refund-fatima.mjs`, `clean-hisaab.mjs`, `check-counters.mjs`, `import-expenses.mjs`, `backfill-payment-credits.mjs`, `firebase.ts`, `order-form.tsx`, `import-shopify-orders.mjs`, `run/route.ts`, `link-new-karigars.mjs`, `use-work-drafts.ts`, `fix-zahra-invoice.mjs`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **Why does `next` connect `next` to `command-palette.tsx`, `meta.ts`, `react`, `plan.ts`, `invoices/page.tsx`, `write/route.ts`, `package.json`, `roleForEmail`, `google-auth-gate.tsx`, `whatsapp.ts`, `fulfilment.ts`, `investments.ts`, `exchange.ts`, `assistant.ts`, `_lib.ts`, `draft-list.tsx`, `ai/route.ts`, `MetaAdsError`, `app-layout.tsx`, `useToast`, `cn`, `voice-bubble.tsx`, `vision/order/route.ts`, `health.ts`, `firebase-admin.ts`, `Button`, `website/edit/page.tsx`, `firebase-admin`, `public/me/route.ts`, `shopifyRequest`, `quote/route.ts`, `order-form.tsx`, `tcs/route.ts`, `postGate`, `workshop.ts`, `campaigns/page.tsx`, `listen/route.ts`, `queue.ts`, `gold-rates/route.ts`, `analytics/page.tsx`, `settings.ts`, `run/route.ts`, `app/layout.tsx`, `store-config.ts`, `website/featured/route.ts`, `printer/page.tsx`, `photos/route.ts`, `site-pieces.ts`, `caption/route.ts`, `app/page.tsx`, `verifyRequestEmail`, `edits/route.ts`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `react`, `invoices/page.tsx`, `story-editor.tsx`, `post/page.tsx`, `draft-list.tsx`, `sidebar.tsx`, `toast.tsx`, `chart.tsx`, `app-layout.tsx`, `useToast`, `voice-bubble.tsx`, `editor-panels.tsx`, `bill-scanner.tsx`, `Button`, `website/edit/page.tsx`, `order-form.tsx`, `audience-editor.tsx`, `radio-group.tsx`, `workshop.ts`, `campaigns/page.tsx`, `menubar.tsx`, `analytics/page.tsx`, `app/page.tsx`, `sheet.tsx`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `privateKey`, `db`, `dump` to the rest of the system?**
  _1369 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fix-customer-cleanup.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1038961038961039 - nodes in this community are weakly interconnected._
- **Should `editor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.050949367088607596 - nodes in this community are weakly interconnected._
- **Should `import-latest-shopify-order.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08866995073891626 - nodes in this community are weakly interconnected._