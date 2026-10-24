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
| Dashboard: four figures, Needs you, Due to customers, Recent sales | ✓ | ✓ | ✓ | wip | 2026-09 | [Dashboard](decisions.md#dashboard); `Screens/Home`, `screens/home` |
| Today's cash | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Home/TodaysCashScreen.swift`, `screens/home/TodaysCashScreen.kt` |
| Team note (owners write, staff read) | ✓ | ✓ | ✓ | wip | 2026-09 | [Team note](decisions.md#team-note) |
| Search: one calm list (the map by group, then the account; no quick buttons, no recents) that finds customers, invoices, orders, stock, repairs, places | n/a (web search is the page's own) | ✓ | ✓ | wip | 2026-10-21 | `Nav/SearchHome.swift`, `nav/SearchScreen.kt` + `SearchLogic.kt`; Android has no long-press menu of a row's tabs |
| Analytics listed in Search (Home's group shown as Overview) | n/a | ✓ | ✓ | wip | 2026-10-24 | with the row above |
| Business switcher: Taheri, Mina and any business by address, a widget each | n/a | ✓ | ✓ | wip | 2026-10-16 | [iphone-app.md](features/iphone-app.md#one-app-many-businesses-2026-10-16), [android-app.md](features/android-app.md#one-app-many-businesses-2026-10-24); `screens/businesses`, `config/Businesses.kt`; Mina needs its Android app registered |
| Cold start asks which business | n/a | ✓ | ✓ | wip | 2026-10-20 | `Nav/BusinessPicker.swift`, `screens/businesses/BusinessPicker.kt` |

## Sales and invoices

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Invoices list, three-figure strip, Shopify chip | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Invoices`, `screens/invoices` |
| Invoice page, payments, discount, refund, delete, customer named | ✓ | ✓ | ✓ | wip | 2026-10 | [Invoice pages](decisions.md#invoice-pages) |
| New sale (scan a bill, scan a tag, line editor) | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Sale`, `screens/sale` |
| Edit invoice | ✓ | ✓ | ✓ | wip | 2026-10-09 | `Screens/Sale/SaleEdit.swift`; Android in `sale/` (check) |
| Whole rupees, round-off chips, Settle | ✓ | ✓ | ✓ | wip | 2026-10-17 | [Whole rupees](decisions.md#whole-rupees), [Round-off](decisions.md#round-off) |
| Invoice PDF and WhatsApp send | ✓ | ✓ | ✓ | wip | 2026-10 | [Invoice PDF](decisions.md#invoice-pdf) |
| Exchange as cash / exchange rows | ✓ | ✓ | ✓ | wip | 2026-10 | [Exchange as cash](decisions.md#exchange-as-cash) |
| Give back customer credit (overpaid refund) | ✓ | ✓ | owed | wip | 2026-10-24 | [Invoice credit](decisions.md#invoice-credit); `src/lib/writes/invoice-credit-payback.ts` (`payBackCredit`) |
| A money write keeps its request id across timeouts and relaunches | ✓ | ✓ | ✓ | wip | 2026-10-20 | `WriteIntents` (iPhone `Data/ERPAPI.swift`, Android `data/WriteIntents.kt`), `src/app/api/app/write/idempotency.ts` |

## Orders

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Orders hub by stage, next step per card | ✓ | ✓ | ✓ | wip | 2026-10 | [Orders hub](decisions.md#orders-hub) |
| Order page, pieces, status, courier / Leopards / tracking | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Orders`, `screens/orders` |
| New order (scan a slip, sizes to the profile, stock picker) | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/NewOrder`, `screens/neworder` |
| Edit order (keeps quoted rates, ticks, photos) | ✓ | ✓ | ✓ | wip | 2026-10-09 | `NewOrderEdit.swift`; Android (check) |
| Finalize and invoice | ✓ | ✓ | ✓ | wip | 2026-10 | [Order to invoice](decisions.md#order-to-invoice) |
| Online orders: a person confirms | ✓ | ✓ | ✓ | wip | 2026-10 | [Online orders](decisions.md#online-orders) |
| Order advance with exchanged gold | ✓ | ✓ | owed | wip | 2026-10-24 | Edit order rewrites the rows untagged, so deleting an older gold advance after an edit leaves its gold (removed by editing the order). [Order to invoice](decisions.md#order-to-invoice), [Exchange rows](decisions.md#exchange-rows) |
| Settle an advance (order stays as it was) | ✓ | ✓ | ✓ | wip | 2026-10-17 | `settleOrderAdvance` |
| Order slip printed from the phone | ✓ | ✓ | ✓ | wip | 2026-10-09 | |

## Repairs

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Repair tickets of many pieces: In the shop, Ready, Collected | ✓ | ✓ | ✓ | wip | 2026-10 | [Repairs](decisions.md#repairs); `Screens/Repairs`, `screens/repairs` |
| Repairs desk, PDFs for repairs | ✓ | ✓ | ✓ | wip | 2026-10-17 | |

## Customers and Hisaab

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Customers list, profile, add, edit | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Customers`, `screens/customers` |
| Duplicates and merge | ✓ | ✓ | ✓ | wip | 2026-10 | |
| Spam clean-up | ✓ | ✓ | ✓ | wip | 2026-10-17 | `CustomerSpamSheet.swift`; Android in `CustomersList.kt` |
| Hisaab ledger, entries, account picker, reminder | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Money`, `screens/money` |
| Walk-in row | ✓ | ✓ | ✓ | wip | 2026-10 | [Walk-ins](decisions.md#walk-ins) |

## Stock

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Stock list, piece page, add and edit, bulk add | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Stock`, `screens/stock` |
| Stock photos, tag printing from the piece | ✓ | ✓ | owed | wip | 2026-10-17 | `StockPiecePhoto.swift`, `StockPieceTag.swift`; Android has `StockImage.kt` only (check) |
| Label LIVE: print a piece's tag, several as one job, set-up (Integrate link, variables, printer), test print, print history | ✓ | wip | owed | wip | 2026-10-20 | [Label LIVE](features/label-live.md); ERPCore `LabelLive.swift`; Mac: localhost API then the link, iPhone: MQTT to the counter Mac; `LabelLivePrinter.swift` |
| Rates (gold, silver, rate chip) | ✓ | ✓ | ✓ | wip | 2026-10 | [Rate chip](decisions.md#rate-chip) |
| Scan a tag | ✓ | ✓ | ✓ | wip | 2026-10 | |

## Workshop

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Board, karigars, karigar page, pay batches, silver and khata, given items | ✓ | ✓ | ✓ | wip | 2026-10 | `Screens/Workshop`, `screens/workshop` |
| Piece details edit (order / invoice piece from the workshop) | ✓ | ✓ | owed | wip | 2026-10 | `WorkshopPieceDetailsSheet.swift`, `lib/writes/piece-details.ts` |
| My work (karigar's own list) | ✓ | ✓ | ✓ | wip | 2026-10 | |
| Drafts, Calendar, Activity log | ✓ | ✓ | ✓ | wip | 2026-10-09 | `Screens/Work`, `screens/work` |

## Money

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Expenses (batches, partner salaries), Extra revenue | ✓ | ✓ | ✓ | wip | 2026-10 | |
| Overheads, Shareholders, Recently removed (behind the delete code) | ✓ | ✓ | ✓ | wip | 2026-10-09 | `Screens/Owner`, `screens/owner` |
| Delete code on every delete | ✓ | ✓ | ✓ | wip | 2026-10 | [Delete code](decisions.md#delete-code) |

## Analytics

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Overview, Sales, Products, Customers (this month by default) | ✓ | ✓ | ✓ | wip | 2026-10 | [Analytics default](decisions.md#analytics-default-this-month) |
| Categories as ranked share bars | ✓ | ✓ | ✓ | wip | 2026-10-20 | `lineCategory`/`guessCategory`: `Categories.swift`, `core/logic/Categories.kt` (+ tests); `AnaShareChart` |
| One Analytics with sections (Sales · Website · Social · Ads) and a section picker; the marketing account sees only tabs marked `marketing` | ✓ | ✓ | ✓ | wip | 2026-10-23 | [The map](decisions.md#the-map) |
| Monthly PDF | ✓ | ✓ | ✓ | wip | 2026-10 | [Monthly PDF](features/notifications.md#monthly-pdf) |
| Sums spoken in rupees, charts summarised for screen readers | n/a | ✓ | n/a | wip | 2026-10-20 | Android uses TalkBack labels (`android-app.md`) |

## Website

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Website menu, Photos, Edit a piece, Photo weights | ✓ | ✓ | ✓ | wip | 2026-10-19 | `screens/marketing/Website*` |
| Investments and its schedule | ✓ | ✓ | ✓ | wip | 2026-10-19 | [Investments](features/investments.md) |
| Website → Interest: site report (sources, places, devices, funnel, pages, searches) and piece rankings | ✓ | ✓ | ✓ | wip | 2026-10-22 | [Website analytics](decisions.md#website-analytics), [Piece interest](decisions.md#piece-interest); `WebsiteInterest.swift`, `screens/marketing/WebsiteInterest.kt` |
| Website → Live (who is on the site now) | ✓ | ✓ | ✓ | wip | 2026-10-23 | `WebsiteLive.swift`, `WebsiteLive.kt` |
| Website selling settings | ✓ | ✓ | owed | wip | 2026-10 | `WebsiteSellingSettings.swift` (check) |

## Posts and Design

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Posts hub: Today, queue, pieces, Send all, Spread over the day | ✓ | ✓ | ✓ | wip | 2026-10-19 | [Hub](features/from-the-website.md#posts-hub) |
| Several photos of a piece, one caption, Instagram carousel of 10 | ✓ | ✓ | ✓ | wip | 2026-10-23 | [Queue and Mina](features/post-a-piece.md#queue-and-mina) |
| A post's card starts with the hero photo alone | ✓ | ✓ | ✓ | wip | 2026-10-23 | `PostTrayPhotos.swift` |
| Design: make, pages, resize, publish, AI tools, saved | ✓ | ✓ | ✓ | wip | 2026-10-19 | [Design](decisions.md#design) |
| Designer v2 (effects, rich text, gradients, QR, photo adjust) | ✓ | ✓ | ✓ | wip | 2026-10-19 | |
| Design Board (Studio canvas, Let it cook, agent) | ✓ | ✓ | pg | wip | 2026-10-15 | [Ad studio](features/ad-studio.md#board); Android opens `/design?v=board&web=1` |
| "Open in Design" from the Posts tray and Edit a piece | ✓ | ✓ | owed | wip | 2026-10-19 | `PostTray*.swift`; noted in `android-app.md` |

## Ads and Insights

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Ads: Overview, Campaigns, object page, New ad, ad sets, Audiences, Rules, Setup, Plan | ✓ | ✓ | ✓ | wip | 2026-10-17 | [Ads](features/ads.md) |
| Ads as of 10-16 (sales and ROAS, CSV, website audiences, video, creator post, catalogue, bidding, A/B tests) | ✓ | ✓ | owed | wip | 2026-10-17 | check `screens/ads` against `Screens/Marketing/Ads*` |
| Insights (Instagram + Facebook, organic beside paid) | ✓ | ✓ | ✓ | wip | 2026-10-17 | [Insights](features/insights.md) |

## Settings

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Settings in sections (Shop, Connections, Records) | ✓ | ✓ | ✓ | wip | 2026-10-23 | `SettingsRoot.swift` vs `SettingsRoot.kt` |
| Shop, alerts, bank accounts, integrations, Shopify, data, voice, labels, backups, contact and hisaab imports, This phone | ✓ | ✓ | ✓ | wip | 2026-10 | `screens/settings` |
| Taheri book import | ✓ | ✓ | owed | wip | 2026-10-17 | `TaheriBookImportSettings.swift` |
| Connect an AI (scoped keys; MCP + REST) | ✓ | pg | pg | wip | 2026-10-19 | [AI keys](features/ai-keys.md) |
| Appearance, Liquid Glass | ✓ | ✓ | n/a | wip | 2026-10 | Apple HIG glass; Android is Material 3 |
| Businesses (add by address, order, turn off the picker) | n/a | ✓ | ✓ | wip | 2026-10-16 | `BusinessesScreen.swift`, `screens/businesses/BusinessesPanel.kt` |

## Widgets and notifications

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Home-screen widget, three sizes, refreshed in the background | n/a | ✓ | ✓ | wip | 2026-10-13 | `Widget/`, `widget/` (Glance) |
| Widgets redone: 7-day sparkline, week's change, owed/due/bench, Needs you, recent sales; taps open the app on that screen | n/a | ✓ | ✓ | wip | 2026-10-23 | `shoperp://`; `widget/` (Glance, `WidgetLayout.plan`) |
| Both businesses on every widget size | n/a | ✓ | ✓ | wip | 2026-10-24 | "Show both businesses" in Settings → Widgets (Android has no per-widget configuration) |
| Lock Screen widget / gauge | n/a | ✓ | n/a | wip | 2026-10-23 | no lock-screen widgets on Android |
| Push notifications, per-kind switches, naming the store | n/a | ✓ | ✓ | wip | 2026-10-13 | `src/lib/push` |
| WhatsApp reports and the monthly PDF by WhatsApp | ✓ | n/a | n/a | n/a | 2026-10 | server-side, [notifications.md](features/notifications.md) |
| Voice (live words, any step) | ✓ | ✓ | ✓ | wip | 2026-10 | [Voice](features/ai.md#voice) |

## Platform and speed

| Feature | Web | iPhone | Android | Mac | Since | Where |
|---|---|---|---|---|---|---|
| Outbox: non-money saves leave at once and retry in the background, kept on disk | n/a | ✓ | ✓ | wip | 2026-10-20 | `Data/Outbox.swift`, Android `data/Outbox.kt` + `ui/OutboxHost.kt`; Android: settings, labels, voice, ads Run/Pause, posting and queueing, website photos and weights, edit-a-piece, Design save and publish go through it (saveWebsiteConfig has no Android screen yet); money ops stay awaited |
| Books paint from the phone's own copy before Firestore answers | n/a | ✓ | ✓ | wip | 2026-10-20 | Android: Firestore persistent cache |
| Launch clock: cold-start steps timed and sent (`app_launches`) | n/a | ✓ | ✓ | wip | 2026-10-20 | `LaunchClock` (Android `device/LaunchClock.kt`, `platform: "android"`) |
| Crash and hang reports | n/a | ✓ | ✓ | wip | 2026-10-20 | MetricKit / `last-crash.txt` |
| Biometric lock; delete code by biometric | n/a | ✓ | ✓ | wip | 2026-10 | Face ID / BiometricPrompt |
| Widget key revoked on sign-out, kept on the device | n/a | ✓ | ✓ | wip | 2026-10-20 | `/api/widget/key` |
| Update gate (out-of-date build writes nothing) | n/a | ✓ | owed | wip | 2026-10-20 | `Home/UpdateGate.swift` |
| Tablet / iPad: lists beside item, columns, shortcuts; the item side always open with "Choose an order" etc. until picked | n/a | ✓ | ✓ | wip | 2026-10-23 | `HubSplit.swift`, `nav/HubSplit.kt`; ⌘ shortcuts n/a on Android |
| Menus from `lib/nav.ts` via the exported JSON | ✓ | ✓ | ✓ | wip | 2026-10 | checked by `parity.yml` |
| Money contract (`contract/cases.json` equal on both phones) | ✓ | ✓ | ✓ | wip | 2026-10-12 | `src/app/api/app/write/contract.test.ts` |
| Store distribution | n/a | ✓ TestFlight | ✓ Play internal | wip | 2026-10 | `ios.yml`, `android.yml` |
| One number reader (Urdu and Arabic digits, lakh commas, never a silent 0) | n/a | ✓ | ✓ | owed | 2026-10-20 | `ShopNumber` (Android `core/logic/ShopNumber.kt`); marketing's weight and artwork boxes read through it on Android too |
| The lock covers every sheet and dialog | n/a | ✓ | ✓ | owed | 2026-10-20 | Android: the cover is a window of its own, `device/AppLock.kt`; not run on a phone |
| Page loads time out at 15 s; the server is warmed when the app comes forward | n/a | ✓ | ✓ | owed | 2026-10-23 | `/api/app/me`, `Outbox.warm()` |
