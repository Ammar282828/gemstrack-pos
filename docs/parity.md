# Parity ledger

The one place that says what each surface has. Owner, 2026-10-24: "I want a way to keep the web app / android app / ios app aligned at all times."
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

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Dashboard: four figures, Needs you, Due to customers, Recent sales | ✓ | ✓ | ✓ | 2026-09 | [Dashboard](decisions.md#dashboard); `Screens/Home`, `screens/home` |
| Today's cash | ✓ | ✓ | ✓ | 2026-10 | `Screens/Home/TodaysCashScreen.swift`, `screens/home/TodaysCashScreen.kt` |
| Team note (owners write, staff read) | ✓ | ✓ | ✓ | 2026-09 | [Team note](decisions.md#team-note) |
| Search that finds customers, invoices, orders, stock, repairs, places; launcher of recents and tiled groups | n/a (web search is the page's own) | ✓ | owed | 2026-10-21 | `Nav/SearchHome.swift`; Android's Search is the menu only |
| Analytics listed in Search | n/a | ✓ | owed | 2026-10-24 | with the row above |
| Business switcher: Taheri, Mina and any business by address, a widget each | n/a | ✓ | owed | 2026-10-16 | [iphone-app.md](features/iphone-app.md#one-app-many-businesses-2026-10-16); Android ships one app per house (two flavors) |
| Cold start asks which business | n/a | ✓ | owed | 2026-10-20 | `Nav/BusinessPicker.swift` |

## Sales and invoices

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Invoices list, three-figure strip, Shopify chip | ✓ | ✓ | ✓ | 2026-10 | `Screens/Invoices`, `screens/invoices` |
| Invoice page, payments, discount, refund, delete, customer named | ✓ | ✓ | ✓ | 2026-10 | [Invoice pages](decisions.md#invoice-pages) |
| New sale (scan a bill, scan a tag, line editor) | ✓ | ✓ | ✓ | 2026-10 | `Screens/Sale`, `screens/sale` |
| Edit invoice | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Sale/SaleEdit.swift`; Android in `sale/` (check) |
| Whole rupees, round-off chips, Settle | ✓ | ✓ | ✓ | 2026-10-17 | [Whole rupees](decisions.md#whole-rupees), [Round-off](decisions.md#round-off) |
| Invoice PDF and WhatsApp send | ✓ | ✓ | ✓ | 2026-10 | [Invoice PDF](decisions.md#invoice-pdf) |
| Exchange as cash / exchange rows | ✓ | ✓ | ✓ | 2026-10 | [Exchange as cash](decisions.md#exchange-as-cash) |
| Give back customer credit (overpaid refund) | wip | wip | owed | 2026-10-24 | [Invoice credit](decisions.md#invoice-credit); `src/lib/writes` |
| A money write keeps its request id across timeouts and relaunches | ✓ | ✓ | owed | 2026-10-20 | Android de-duplicates 30 s only; `Data/Outbox.swift`, `src/app/api/app/write/idempotency.ts` |

## Orders

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Orders hub by stage, next step per card | ✓ | ✓ | ✓ | 2026-10 | [Orders hub](decisions.md#orders-hub) |
| Order page, pieces, status, courier / Leopards / tracking | ✓ | ✓ | ✓ | 2026-10 | `Screens/Orders`, `screens/orders` |
| New order (scan a slip, sizes to the profile, stock picker) | ✓ | ✓ | ✓ | 2026-10 | `Screens/NewOrder`, `screens/neworder` |
| Edit order (keeps quoted rates, ticks, photos) | ✓ | ✓ | ✓ | 2026-10-09 | `NewOrderEdit.swift`; Android (check) |
| Finalize and invoice | ✓ | ✓ | ✓ | 2026-10 | [Order to invoice](decisions.md#order-to-invoice) |
| Online orders: a person confirms | ✓ | ✓ | ✓ | 2026-10 | [Online orders](decisions.md#online-orders) |
| Order advance with exchanged gold | wip | wip | owed | 2026-10-24 | [Order to invoice](decisions.md#order-to-invoice), [Exchange rows](decisions.md#exchange-rows) |
| Settle an advance (order stays as it was) | ✓ | ✓ | ✓ | 2026-10-17 | `settleOrderAdvance` |
| Order slip printed from the phone | ✓ | ✓ | ✓ | 2026-10-09 | |

## Repairs

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Repair tickets of many pieces: In the shop, Ready, Collected | ✓ | ✓ | ✓ | 2026-10 | [Repairs](decisions.md#repairs); `Screens/Repairs`, `screens/repairs` |
| Repairs desk, PDFs for repairs | ✓ | ✓ | ✓ | 2026-10-17 | |

## Customers and Hisaab

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Customers list, profile, add, edit | ✓ | ✓ | ✓ | 2026-10 | `Screens/Customers`, `screens/customers` |
| Duplicates and merge | ✓ | ✓ | ✓ | 2026-10 | |
| Spam clean-up | ✓ | ✓ | ✓ | 2026-10-17 | `CustomerSpamSheet.swift`; Android in `CustomersList.kt` |
| Hisaab ledger, entries, account picker, reminder | ✓ | ✓ | ✓ | 2026-10 | `Screens/Money`, `screens/money` |
| Walk-in row | ✓ | ✓ | ✓ | 2026-10 | [Walk-ins](decisions.md#walk-ins) |

## Stock

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Stock list, piece page, add and edit, bulk add | ✓ | ✓ | ✓ | 2026-10 | `Screens/Stock`, `screens/stock` |
| Stock photos, tag printing from the piece | ✓ | ✓ | owed | 2026-10-17 | `StockPiecePhoto.swift`, `StockPieceTag.swift`; Android has `StockImage.kt` only (check) |
| Rates (gold, silver, rate chip) | ✓ | ✓ | ✓ | 2026-10 | [Rate chip](decisions.md#rate-chip) |
| Scan a tag | ✓ | ✓ | ✓ | 2026-10 | |

## Workshop

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Board, karigars, karigar page, pay batches, silver and khata, given items | ✓ | ✓ | ✓ | 2026-10 | `Screens/Workshop`, `screens/workshop` |
| Piece details edit (order / invoice piece from the workshop) | ✓ | ✓ | owed | 2026-10 | `WorkshopPieceDetailsSheet.swift`, `lib/writes/piece-details.ts` |
| My work (karigar's own list) | ✓ | ✓ | ✓ | 2026-10 | |
| Drafts, Calendar, Activity log | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Work`, `screens/work` |

## Money

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Expenses (batches, partner salaries), Extra revenue | ✓ | ✓ | ✓ | 2026-10 | |
| Overheads, Shareholders, Recently removed (behind the delete code) | ✓ | ✓ | ✓ | 2026-10-09 | `Screens/Owner`, `screens/owner` |
| Delete code on every delete | ✓ | ✓ | ✓ | 2026-10 | [Delete code](decisions.md#delete-code) |

## Analytics

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Overview, Sales, Products, Customers (this month by default) | ✓ | ✓ | ✓ | 2026-10 | [Analytics default](decisions.md#analytics-default-this-month) |
| Categories as ranked share bars | ✓ | ✓ | owed | 2026-10-20 | `lineCategory`, `AnalyticsCategories.swift`; Android's is the pie (check) |
| One Analytics with sections (Sales · Website · Social · Ads) and a section picker | ✓ | ✓ | owed | 2026-10-23 | [The map](decisions.md#the-map) |
| Monthly PDF | ✓ | ✓ | ✓ | 2026-10 | [Monthly PDF](features/notifications.md#monthly-pdf) |
| Sums spoken in rupees, charts summarised for screen readers | n/a | ✓ | n/a | 2026-10-20 | Android uses TalkBack labels (`android-app.md`) |

## Website

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Website menu, Photos, Edit a piece, Photo weights | ✓ | ✓ | ✓ | 2026-10-19 | `screens/marketing/Website*` |
| Investments and its schedule | ✓ | ✓ | ✓ | 2026-10-19 | [Investments](features/investments.md) |
| Website → Interest: site report (sources, places, devices, funnel, pages, searches) and piece rankings | ✓ | ✓ | ✓ | 2026-10-22 | [Website analytics](decisions.md#website-analytics), [Piece interest](decisions.md#piece-interest); `WebsiteInterest.swift`, `screens/marketing/WebsiteInterest.kt` |
| Website → Live (who is on the site now) | ✓ | ✓ | ✓ | 2026-10-23 | `WebsiteLive.swift`, `WebsiteLive.kt` |
| Website selling settings | ✓ | ✓ | owed | 2026-10 | `WebsiteSellingSettings.swift` (check) |

## Posts and Design

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Posts hub: Today, queue, pieces, Send all, Spread over the day | ✓ | ✓ | ✓ | 2026-10-19 | [Hub](features/from-the-website.md#posts-hub) |
| Several photos of a piece, one caption, Instagram carousel of 10 | ✓ | ✓ | ✓ | 2026-10-23 | [Queue and Mina](features/post-a-piece.md#queue-and-mina) |
| A post's card starts with the hero photo alone | ✓ | ✓ | ✓ | 2026-10-23 | `PostTrayPhotos.swift` |
| Design: make, pages, resize, publish, AI tools, saved | ✓ | ✓ | ✓ | 2026-10-19 | [Design](decisions.md#design) |
| Designer v2 (effects, rich text, gradients, QR, photo adjust) | ✓ | ✓ | ✓ | 2026-10-19 | |
| Design Board (Studio canvas, Let it cook, agent) | ✓ | ✓ | pg | 2026-10-15 | [Ad studio](features/ad-studio.md#board); Android opens `/design?v=board&web=1` |
| "Open in Design" from the Posts tray and Edit a piece | ✓ | ✓ | owed | 2026-10-19 | `PostTray*.swift`; noted in `android-app.md` |

## Ads and Insights

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Ads: Overview, Campaigns, object page, New ad, ad sets, Audiences, Rules, Setup, Plan | ✓ | ✓ | ✓ | 2026-10-17 | [Ads](features/ads.md) |
| Ads as of 10-16 (sales and ROAS, CSV, website audiences, video, creator post, catalogue, bidding, A/B tests) | ✓ | ✓ | owed | 2026-10-17 | check `screens/ads` against `Screens/Marketing/Ads*` |
| Insights (Instagram + Facebook, organic beside paid) | ✓ | ✓ | ✓ | 2026-10-17 | [Insights](features/insights.md) |

## Settings

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Settings in sections (Shop, Connections, Records) | ✓ | ✓ | owed | 2026-10-23 | `SettingsRoot.swift` vs `SettingsRoot.kt` |
| Shop, alerts, bank accounts, integrations, Shopify, data, voice, labels, backups, contact and hisaab imports, This phone | ✓ | ✓ | ✓ | 2026-10 | `screens/settings` |
| Taheri book import | ✓ | ✓ | owed | 2026-10-17 | `TaheriBookImportSettings.swift` |
| Connect an AI (scoped keys; MCP + REST) | ✓ | pg | pg | 2026-10-19 | [AI keys](features/ai-keys.md) |
| Appearance, Liquid Glass | ✓ | ✓ | n/a | 2026-10 | Apple HIG glass; Android is Material 3 |
| Businesses (add by address, order, turn off the picker) | n/a | ✓ | owed | 2026-10-16 | `BusinessesScreen.swift` |

## Widgets and notifications

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Home-screen widget, three sizes, refreshed in the background | n/a | ✓ | ✓ | 2026-10-13 | `Widget/`, `widget/` (Glance) |
| Widgets redone: 7-day sparkline, week's change, owed/due/bench, Needs you, recent sales; taps open the app on that screen | n/a | ✓ | owed | 2026-10-23 | `shoperp://`; Android draws the old faces |
| Both businesses on every widget size | n/a | ✓ | owed | 2026-10-24 | |
| Lock Screen widget / gauge | n/a | ✓ | n/a | 2026-10-23 | no lock-screen widgets on Android |
| Push notifications, per-kind switches, naming the store | n/a | ✓ | ✓ | 2026-10-13 | `src/lib/push` |
| WhatsApp reports and the monthly PDF by WhatsApp | ✓ | n/a | n/a | 2026-10 | server-side, [notifications.md](features/notifications.md) |
| Voice (live words, any step) | ✓ | ✓ | ✓ | 2026-10 | [Voice](features/ai.md#voice) |

## Platform and speed

| Feature | Web | iPhone | Android | Since | Where |
|---|---|---|---|---|---|
| Outbox: non-money saves leave at once and retry in the background, kept on disk | n/a | ✓ | owed | 2026-10-20 | `Data/Outbox.swift` |
| Books paint from the phone's own copy before Firestore answers | n/a | ✓ | ✓ | 2026-10-20 | Android: Firestore persistent cache |
| Launch clock: cold-start steps timed and sent (`app_launches`) | n/a | ✓ | owed | 2026-10-20 | `LaunchClock` |
| Crash and hang reports | n/a | ✓ | ✓ | 2026-10-20 | MetricKit / `last-crash.txt` |
| Biometric lock; delete code by biometric | n/a | ✓ | ✓ | 2026-10 | Face ID / BiometricPrompt |
| Widget key revoked on sign-out, kept on the device | n/a | ✓ | ✓ | 2026-10-20 | `/api/widget/key` |
| Update gate (out-of-date build writes nothing) | n/a | ✓ | owed | 2026-10-20 | `Home/UpdateGate.swift` |
| Tablet / iPad: lists beside item, columns, shortcuts | n/a | ✓ | ✓ | 2026-10-23 | window size classes; ⌘ shortcuts n/a on Android |
| Menus from `lib/nav.ts` via the exported JSON | ✓ | ✓ | ✓ | 2026-10 | checked by `parity.yml` |
| Money contract (`contract/cases.json` equal on both phones) | ✓ | ✓ | ✓ | 2026-10-12 | `src/app/api/app/write/contract.test.ts` |
| Store distribution | n/a | ✓ TestFlight | ✓ Play internal | 2026-10 | `ios.yml`, `android.yml` |
