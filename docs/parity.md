# Parity ledger

The one place that says what each surface has (web, iPhone, Android and, since 2026-10-24, the native **Mac** app: [Mac app](features/mac-app.md)). Owner, 2026-10-24: "I want a way to keep the web app / android app / ios app aligned at all times."
Decision: [Parity](decisions.md#parity).

**The rule.** Every user-facing change updates its row here **in the same commit**: ✓ on the surface where it was built, **owed** on the
others, and a new row if it is a new feature. A feature is not finished until the other two surfaces are ✓, `n/a` (with a reason) or
`owed` here. The web is the source of what a feature *is* (money rules in `src/lib`, writes in `src/lib/writes`); the phones follow it.
The menus are not a row: `src/lib/nav.ts` is the only map, `npm run nav:export` writes `apps/iphone/App/Resources/nav-<house>.json`,
the Android app reads that same file (Gradle source set, no copy), and `.github/workflows/parity.yml` fails if it is stale.

| Mark | Means |
|---|---|
| ✓ | built and in the app (native screen, or on the web the page itself) |
| pg | the app opens the ERP's own page for it (a WebView): works, not native; counts as covered, native is a later upgrade |
| wip | being built now |
| owed | the surface lacks it and should have it; the daily parity check works these |
| n/a | the surface cannot or should not have it (reason given) |

*Since* is the date the feature reached its first surface. *Where* is the file, doc section or decision. Seeded 2026-10-24 from
`git log --since=2026-10-01`, `apps/iphone/RELEASES.md`, `docs/features/android-app.md` and a grep of the Android code for each iPhone
screen: where the evidence was thin the row says "check" in *Where* and is marked owed (it is cheaper to disprove an owed than to miss one).

## Home

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Dashboard: four figures, Needs you, Due to customers, Recent sales | ✓ | ✓ | ✓ | ✓ | 2026-09 | [Dashboard](decisions.md#dashboard); `Screens/Home`, `screens/home` |
| Today's cash | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Home/TodaysCashScreen.swift`, `screens/home/TodaysCashScreen.kt` |
| Team note (owners write, staff read) | ✓ | ✓ | ✓ | ✓ | 2026-09 | [Team note](decisions.md#team-note) |
| Search: one calm list (the map by group, then the account; no quick buttons, no recents) that finds customers, invoices, orders, stock, repairs, places | n/a (web search is the page's own) | ✓ | ✓ | ✓ | 2026-10-21 | `Nav/SearchHome.swift`, `nav/SearchScreen.kt` + `SearchLogic.kt`; Android has no long-press menu of a row's tabs |
| Analytics listed in Search (Home's group shown as Overview) | n/a | ✓ | ✓ | ✓ | 2026-10-24 | with the row above |
| Quick Open (⌘K): a panel over the page that opens any place, customer, invoice, order, piece or repair as you type; ↑↓, Return, ⌘Return for a new window | ✓ | n/a (Search tab) | n/a (Search tab) | ✓ | 2026-10-25 | `Mac/MacQuickOpen.swift`; web `components/search/command-palette.tsx` (Ctrl/⌘K; repairs and ⌘Return added 2026-10-26; customers left out by the owner's 2026-09-25 rule, found through their orders and invoices); the Mac reopens on the place it was left (`@SceneStorage`) and reads every day-to-day list in the background at launch |
| The Mac as a Mac app (docs/features/mac-design.md): every place and tab in the sidebar with saved lists, tables with the inspector, a record menu per record, records and new work in windows of their own, Settings as a window | n/a | n/a | n/a | ✓ | 2026-10-25 | `Mac/Kit`, `Mac/Places`, `Mac/MacSidebar.swift`; the screens' Mac bodies |
| Back and Forward (⌘[ ⌘], the toolbar's ‹ ›): every place and page this window visited, as Finder's | n/a (the browser's own) | n/a (the navigation bar's back) | n/a (the system back) | ✓ | 2026-10-25 | `Mac/MacShell.swift` (`MacShellModel.history`); built on Xcode Cloud at 26a5ab2 (0 errors) |
| Send Page Snapshots (Help menu, owners): the window visits every sidebar place and sends a picture of each to the ERP (`/api/app/snapshots`, Firestore `app_snapshots`) for whoever builds the Mac app | n/a | n/a | n/a | ✓ | 2026-10-25 | `Mac/MacSnapshots.swift`, `src/app/api/app/snapshots`; built on Xcode Cloud at 26a5ab2 (0 errors) |
| Business switcher: Taheri, Mina and any business by address, a widget each | n/a | ✓ | ✓ | ✓ | 2026-10-16 | [iphone-app.md](features/iphone-app.md#one-app-many-businesses-2026-10-16), [android-app.md](features/android-app.md#one-app-many-businesses-2026-10-24); `screens/businesses`, `config/Businesses.kt`; Mina needs its Android app registered |
| Cold start asks which business | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `Nav/BusinessPicker.swift`, `screens/businesses/BusinessPicker.kt` |

## Sales and invoices

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Invoices list, three-figure strip, Shopify chip | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Invoices`, `screens/invoices` |
| Invoice page, payments, discount, refund, delete, customer named | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Invoice pages](decisions.md#invoice-pages) |
| New sale (scan a bill, scan a tag, line editor) | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Sale`, `screens/sale` |
| Edit invoice | ✓ | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Sale/SaleEdit.swift`; Android in `sale/` (check) |
| Whole rupees, round-off chips, Settle | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | [Whole rupees](decisions.md#whole-rupees), [Round-off](decisions.md#round-off) |
| Invoice PDF and WhatsApp send | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Invoice PDF](decisions.md#invoice-pdf) |
| Exchange as cash / exchange rows | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Exchange as cash](decisions.md#exchange-as-cash) |
| Give back customer credit (overpaid refund) | ✓ | ✓ | ✓ | ✓ | 2026-10-24 | [Invoice credit](decisions.md#invoice-credit); `src/lib/writes/invoice-credit-payback.ts` (`payBackCredit`); Android `InvoiceCreditSheet` (invoice page, customer page), Today's cash Paid out and Analytics Cash out show it |
| A money write keeps its request id across timeouts and relaunches | ✓ | ✓ | ✓ | ✓ | 2026-10-20 | `WriteIntents` (iPhone `Data/ERPAPI.swift`, Android `data/WriteIntents.kt`), `src/app/api/app/write/idempotency.ts` |

## Orders

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Orders hub by stage, next step per card | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Orders hub](decisions.md#orders-hub) |
| Order page, pieces, status, courier / Leopards / tracking | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Orders`, `screens/orders` |
| New order (scan a slip, sizes to the profile, stock picker) | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/NewOrder`, `screens/neworder` |
| Edit order (keeps quoted rates, ticks, photos) | ✓ | ✓ | ✓ | ✓ | 2026-10-09 | `NewOrderEdit.swift`; Android (check) |
| Finalize and invoice | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Order to invoice](decisions.md#order-to-invoice) |
| Online orders: a person confirms | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Online orders](decisions.md#online-orders) |
| Order advance with exchanged gold | ✓ | ✓ | ✓ | ✓ | 2026-10-24 | Edit order rewrites the rows untagged, so deleting an older gold advance after an edit leaves its gold (removed by editing the order). Android `ui/AdvanceExchange.kt` in the advance sheet. [Order to invoice](decisions.md#order-to-invoice), [Exchange rows](decisions.md#exchange-rows) |
| Settle an advance (order stays as it was) | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | `settleOrderAdvance` |
| Order slip printed from the phone | ✓ | ✓ | ✓ | ✓ | 2026-10-09 | |
| Change the rate: at finalize, from the order and invoice pages, silver per order | ✓ | ✓ | ✓ | ✓ | 2026-10-24 | [Order to invoice](decisions.md#order-to-invoice); `finalizeOrder` takes `ratesApplied`; web `order-dialogs.tsx`, Android `OrderFinalizeScreen.kt`, `?rates=1` on the edit pages; Mac: the one-window forms open with the rates on top |

## Repairs

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Repair tickets of many pieces: In the shop, Ready, Collected | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Repairs](decisions.md#repairs); `Screens/Repairs`, `screens/repairs` |
| Repairs desk, PDFs for repairs | ✓ | ✓ | ✓ | ✓ | 2026-10-17 |  |

## Customers and Hisaab

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Customers list, profile, add, edit | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Customers`, `screens/customers` |
| Duplicates and merge | ✓ | ✓ | ✓ | ✓ | 2026-10 |  |
| Spam clean-up | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | `CustomerSpamSheet.swift`; Android in `CustomersList.kt` |
| Hisaab ledger, entries, account picker, reminder | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Money`, `screens/money` |
| Walk-in row | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Walk-ins](decisions.md#walk-ins) |

## Stock

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Stock list, piece page, add and edit, bulk add | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Stock`, `screens/stock` |
| Stock photos, tag printing from the piece | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | `StockPiecePhoto.swift`, `StockPieceTag.swift`; Android `StockPiecePhoto.kt` (take or choose, replace, `/api/app/product-photo`), `StockPieceTag.kt` (piece tag sheet; Stock list Select, then Print N tags as one job) |
| Tag designer: interactive canvas (zoom, grid, rulers, resize, rotate, align, undo), all field types, placeholders, pictures, .lsc import, copy ZPL, test print | owed | ✓ | ✓ | ✓ | 2026-10-24 | Built on Xcode Cloud (Mac release a82280c). `Screens/Settings/LabelDesigner`; ERPCore `LabelGeometry`, `LabelEditing`, `LabelPlaceholders`; web has the older field list at `settings/printer`. Android: `screens/settings/label/` (Compose canvas) over `core/logic/LabelDesignerModel.kt`, `LabelGeometry`, `LabelEditing`, `LabelPlaceholders`; its ZPL, placeholders and .lsc import are proved equal to the web's by `LabelGoldenTests` |
| Zebra straight from the app: the shop's tag as ZPL (every Label LIVE mode and number: thermal, tear/peel/cut, media, darkness, speed, offsets, orientation, mirror), job sheet (copies, skip, counter), printer status | owed | ✓ | ✓ | ✓ | 2026-10-24 | `TagPrinter.swift`, `ZebraTransport.swift` (Mac: Zebra Browser Print or a Mac printer raw via CUPS; both: network 9100), `TagPrinterSettingsScreen.swift`, `TagPrintJobSheet.swift`; ERPCore `Zpl.swift` = `src/lib/zebra-zpl.ts`. Android: raw TCP 9100 only (`device/TagPrinter.kt`, `core/logic/Zpl.kt`, `TagPrint.kt`); Browser Print and CUPS are n/a on Android |
| Label LIVE design import (.lsc) into the shop's tag | ✓ | ✓ | ✓ | ✓ | 2026-10-24 | `src/lib/label-lsc.ts` = ERPCore `LabelLSC.swift`; web: Settings → Labels, "Import Label LIVE design (.lsc)" (2026-10-25); Android `LabelLSC.kt`, picked with the document picker in the designer's File menu |
| Label LIVE: print a piece's tag, several as one job, set-up (Integrate link, variables, printer), test print, print history | ✓ | ✓ | ✓ | ✓ | 2026-10-20 | [Label LIVE](features/label-live.md); ERPCore `LabelLive.swift`; Mac: localhost API then the link, iPhone: MQTT to the counter Mac; `LabelLivePrinter.swift`. Android: the same MQTT (Label LIVE has no Android app), `LabelLivePrinter` in `device/TagPrinter.kt`, `TagPrint.Mqtt` in core; the counter Mac is typed by its address |
| Rates (gold, silver, rate chip) | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Rate chip](decisions.md#rate-chip) |
| Scan a tag | ✓ | ✓ | ✓ | ✓ | 2026-10 |  |

## Workshop

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Board, karigars, karigar page, pay batches, silver and khata, given items | ✓ | ✓ | ✓ | ✓ | 2026-10 | `Screens/Workshop`, `screens/workshop` |
| Piece details edit (order / invoice piece from the workshop) | ✓ | ✓ | ✓ | ✓ | 2026-10 | `WorkshopPieceDetailsSheet.swift`, `lib/writes/piece-details.ts`; Android `WorkshopPieceDetailsSheet.kt`, through the Outbox |
| My work (karigar's own list) | ✓ | ✓ | ✓ | ✓ | 2026-10 |  |
| Drafts, Calendar, Activity log | ✓ | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Work`, `screens/work` |
| Drafts: saved at every keystroke, never auto-opened (a New sale / New order is blank; the unfinished one waits in Drafts; a quiet "N drafts" line on the blank form) | ✓ | ✓ | owed | ✓ | 2026-10-25 | [Drafts](decisions.md#drafts); web `use-work-drafts.ts` + `lib/draft-writer.ts`, `?continue=1`; iPhone/Mac one code: `Data/WorkDraftSync.swift`, `NewSale.swift`, `NewOrder.swift`, `Work/DraftsNote.swift`, `?resume=1`; Android: own copy on the phone still auto-opens, send within 300 ms, write the previous draft to Drafts and start blank, `?resume` for Scan/Stock/Drafts |

## Money

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Expenses (batches, partner salaries), Extra revenue | ✓ | ✓ | ✓ | ✓ | 2026-10 |  |
| Overheads, Shareholders, Recently removed (behind the delete code) | ✓ | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Owner`, `screens/owner` |
| Delete code on every delete | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Delete code](decisions.md#delete-code) |

## Analytics

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Overview, Sales, Products, Customers (this month by default) | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Analytics default](decisions.md#analytics-default-this-month) |
| Categories as ranked share bars | ✓ | ✓ | ✓ | ✓ | 2026-10-20 | `lineCategory`/`guessCategory`: `Categories.swift`, `core/logic/Categories.kt` (+ tests); `AnaShareChart` |
| One Analytics with sections (Sales · Website · Social · Ads) and a section picker; the marketing account sees only tabs marked `marketing` | ✓ | ✓ | ✓ | ✓ | 2026-10-23 | [The map](decisions.md#the-map) |
| Net profit = estimated profit less expenses (not revenue less expenses) | ✓ | ✓ | owed | ✓ | 2026-10-25 | [Net profit](decisions.md#net-profit); `src/lib/analytics/net-profit.ts`, `AnaNet`; Android `AnaYear.netProfit` and the Overview tile still use revenue − expenses |
| Monthly PDF | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Monthly PDF](features/notifications.md#monthly-pdf) |
| Sums spoken in rupees, charts summarised for screen readers | n/a | ✓ | n/a | ✓ | 2026-10-20 | Android uses TalkBack labels (`android-app.md`) |

## Website

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Website menu, Photos, Edit a piece, Photo weights | ✓ | ✓ | ✓ | ✓ | 2026-10-19 | `screens/marketing/Website*` |
| Investments and its schedule | ✓ | ✓ | ✓ | ✓ | 2026-10-19 | [Investments](features/investments.md) |
| Website → Interest: site report (sources, places, devices, funnel, pages, searches) and piece rankings | ✓ | ✓ | ✓ | ✓ | 2026-10-22 | [Website analytics](decisions.md#website-analytics), [Piece interest](decisions.md#piece-interest); `WebsiteInterest.swift`, `screens/marketing/WebsiteInterest.kt` |
| Website → Live (who is on the site now) | ✓ | ✓ | ✓ | ✓ | 2026-10-23 | `WebsiteLive.swift`, `WebsiteLive.kt` |
| Website selling settings | ✓ | ✓ | ✓ | ✓ | 2026-10 | `WebsiteSellingSettings.swift`; Android `WebsiteSellingSettings.kt` at `/app/settings/website`, `saveWebsiteConfig` through the Outbox |

## Posts and Design

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Posts hub: Today, queue, pieces, Send all, Spread over the day | ✓ | ✓ | ✓ | ✓ | 2026-10-19 | [Hub](features/from-the-website.md#posts-hub) |
| Several photos of a piece, one caption, Instagram carousel of 10 | ✓ | ✓ | ✓ | ✓ | 2026-10-23 | [Queue and Mina](features/post-a-piece.md#queue-and-mina) |
| A post's card starts with the hero photo alone | ✓ | ✓ | ✓ | ✓ | 2026-10-23 | `PostTrayPhotos.swift` |
| Design: make, pages, resize, publish, AI tools, saved | ✓ | ✓ | ✓ | ✓ | 2026-10-19 | [Design](decisions.md#design) |
| Designer v2 (effects, rich text, gradients, QR, photo adjust) | ✓ | ✓ | ✓ | ✓ | 2026-10-19 |  |
| Design Board (Studio canvas, Let it cook, agent) | ✓ | ✓ | pg | ✓ | 2026-10-15 | [Ad studio](features/ad-studio.md#board); Android opens `/design?v=board&web=1` |
| "Open in Design" from the Posts tray and Edit a piece | ✓ | ✓ | ✓ | ✓ | 2026-10-19 | `PostTray*.swift`; Android `PostTrayScreen.kt` and `WebsiteEditPiece.kt` open `/design?v=make&site=<id>`, which native `design/DesignRoutes.kt` starts a Piece from (this row was stale) |

## Ads and Insights

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Ads: Overview, Campaigns, object page, New ad, ad sets, Audiences, Rules, Setup, Plan | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | [Ads](features/ads.md) |
| Ads as of 10-16 (sales and ROAS, CSV, website audiences, video, creator post, catalogue, bidding, A/B tests) | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | `screens/ads` (AdsNewAdSources, AdsTests) matches `Screens/Marketing/Ads*`; Android done 2026-10-25 |
| Insights (Instagram + Facebook, organic beside paid) | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | [Insights](features/insights.md) |

## Settings

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Settings in sections (Shop, Connections, Records) | ✓ | ✓ | ✓ | ✓ | 2026-10-23 | `SettingsRoot.swift` vs `SettingsRoot.kt` |
| Shop, alerts, bank accounts, integrations, Shopify, data, voice, labels, backups, contact and hisaab imports, This phone | ✓ | ✓ | ✓ | ✓ | 2026-10 | `screens/settings` |
| Taheri book import | ✓ | ✓ | ✓ | ✓ | 2026-10-17 | `TaheriBookImportSettings.swift`; Android `TaheriBookImportSettings.kt` (`importTaheriBook` preview, then Import; the iPhone does not use `/api/app/taheri-book` either, that route is the web page's) |
| Connect an AI (scoped keys; MCP + REST) | ✓ | ✓ | pg | ✓ | 2026-10-19 | [AI keys](features/ai-keys.md) |
| Appearance, Liquid Glass | ✓ | ✓ | n/a | ✓ | 2026-10 | Apple HIG glass; Android is Material 3 |
| Light/dark: separated grounds, lifted cards | ✓ | ✓ | ✓ | ✓ | 2026-10-25 | Warm deeper light ground + white cards with a soft shadow; near-black dark ground + lifted cards with a 0.5 hairline, richer dark accents ([Light and dark](decisions.md#light-and-dark)). Web `globals.css` `--card-shadow` / `--card-edge`; iPhone and Mac `Theme.houseCard` + `Elevated-*` colour sets (the Mac compiles the same `App/`); Android `Modifier.houseCardSurface` + `house_elevated`. Not built on a phone or a Mac here |
| Businesses (add by address, order, turn off the picker) | n/a | ✓ | ✓ | ✓ | 2026-10-16 | `BusinessesScreen.swift`, `screens/businesses/BusinessesPanel.kt` |

## Widgets and notifications

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Home-screen widget, three sizes, refreshed in the background | n/a | ✓ | ✓ | ✓ | 2026-10-13 | `Widget/`, `widget/` (Glance) |
| Widgets redone: 7-day sparkline, week's change, owed/due/bench, Needs you, recent sales; taps open the app on that screen | n/a | ✓ | ✓ | ✓ | 2026-10-23 | `shoperp://`; `widget/` (Glance, `WidgetLayout.plan`) |
| Both businesses on every widget size | n/a | ✓ | ✓ | ✓ | 2026-10-24 | "Show both businesses" in Settings → Widgets (Android has no per-widget configuration) |
| Lock Screen widget / gauge | n/a | ✓ | n/a | ✓ | 2026-10-23 | no lock-screen widgets on Android |
| Push notifications, per-kind switches, naming the store | n/a | ✓ | ✓ | ✓ | 2026-10-13 | `src/lib/push` |
| WhatsApp reports and the monthly PDF by WhatsApp | ✓ | n/a | n/a | n/a | 2026-10 | server-side, [notifications.md](features/notifications.md) |
| Voice (live words, any step) | ✓ | ✓ | ✓ | ✓ | 2026-10 | [Voice](features/ai.md#voice) |
| Voice, Siri-grade: instant start, on-device words, end of speech by itself, keeps listening for changes and "yes", "Do it" | owed | ✓ | owed | ✓ | 2026-10-25 | [Voice, Siri-grade](features/ai.md#voice-siri-grade-iphone-and-mac-2026-10-25); `Device/NativeVoice.swift`, `Device/VoiceEngine.swift`; the Mac compiles the same sources (not yet run on a Mac). Web has live words only (`lib/voice/live.ts`); Android's recogniser and sheet are owed |
| "Talk to ERP": Siri phrases, Action button, Spotlight, Control Center and Lock Screen control | n/a | ✓ | owed | n/a | 2026-10-25 | `Shared/VoiceLaunch.swift`, `Device/VoiceIntents.swift`, `Widget/ERPVoiceControl.swift`; web and Mac have no such entry points (Android: an assistant shortcut / quick-settings tile) |

## Platform and speed

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Outbox: non-money saves leave at once and retry in the background, kept on disk | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `Data/Outbox.swift`, Android `data/Outbox.kt` + `ui/OutboxHost.kt`; Android: settings, labels, voice, ads Run/Pause, posting and queueing, website photos and weights, edit-a-piece, Design save and publish go through it (saveWebsiteConfig has no Android screen yet); money ops stay awaited |
| Books paint from the phone's own copy before Firestore answers | n/a | ✓ | ✓ | ✓ | 2026-10-20 | Android: Firestore persistent cache |
| Launch clock: cold-start steps timed and sent (`app_launches`) | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `LaunchClock` (Android `device/LaunchClock.kt`, `platform: "android"`) |
| Crash and hang reports | n/a | ✓ | ✓ | ✓ | 2026-10-20 | MetricKit / `last-crash.txt` |
| Biometric lock; delete code by biometric | n/a | ✓ | ✓ | ✓ | 2026-10 | Face ID / BiometricPrompt |
| Widget key revoked on sign-out, kept on the device | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `/api/widget/key` |
| Update gate (out-of-date build writes nothing) | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `Home/UpdateGate.swift`; Android `config/UpdateGate.kt` against `minAndroidBuild` (`APP_MIN_ANDROID_BUILD`): its own number, the iPhone's `minBuild` is a CFBundleVersion |
| Tablet / iPad: lists beside item, columns, shortcuts; the item side always open with "Choose an order" etc. until picked | n/a | ✓ | ✓ | ✓ | 2026-10-23 | `HubSplit.swift`, `nav/HubSplit.kt`; ⌘ shortcuts n/a on Android |
| Menus from `lib/nav.ts` via the exported JSON | ✓ | ✓ | ✓ | ✓ | 2026-10 | checked by `parity.yml` |
| Money contract (`contract/cases.json` equal on both phones) | ✓ | ✓ | ✓ | ✓ | 2026-10-12 | `src/app/api/app/write/contract.test.ts` |
| Store distribution | n/a | ✓ TestFlight | ✓ Play internal | ✓ TestFlight (Mac) | 2026-10 | `ios.yml`, `android.yml` |
| One number reader (Urdu and Arabic digits, lakh commas, never a silent 0) | n/a | ✓ | ✓ | ✓ | 2026-10-20 | `ShopNumber` (Android `core/logic/ShopNumber.kt`); marketing's weight and artwork boxes read through it on Android too |
| The lock covers every sheet and dialog | n/a | ✓ | ✓ | ✓ | 2026-10-20 | Android: the cover is a window of its own, `device/AppLock.kt`; not run on a phone. Mac: every sheet and panel gets the cover inside it (`MacLockSheets`) |
| Page loads time out at 15 s; the server is warmed when the app comes forward | n/a | ✓ | ✓ | ✓ | 2026-10-23 | `/api/app/me`, `Outbox.warm()` |
