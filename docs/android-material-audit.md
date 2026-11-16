# Android Material 3 Expressive audit (2026-11-16)

Method: the `material-expressive` skill's review checklist, applied to the kit (`apps/android/app/src/main/kotlin/erp/app/ui/`, `ui/theme/`, `nav/`)
and the daily screens (Home, Orders hub + page, Invoices list + page, Customers + page, New order, New sale, To collect, Repairs), read from the
Roborazzi baselines (Taheri, phone and tablet, light and dark; Mina's Home and Orders) and from the code. Library: `androidx.compose.material3`
1.5.0-beta01 (Expressive APIs public; every use is `@OptIn(ExperimentalMaterial3ExpressiveApi::class)`). Nothing was run on a device.

**Outcome: Ready with follow-up.** The kit was already a faithful M3 Expressive implementation (scheme grown from the business seed with Material
Color Utilities, tonal surfaces, segmented groups, `MotionScheme.expressive()` through `ErpMotion` with Reduce Motion honoured, Material Symbols,
filled text fields, the expressive loading indicator, `Tone` containers, contrast held by `ContrastTests`). The remaining problems were
layout defects where a custom piece imitated a Material one, not a missing design system. Four were fixed here; the rest are listed.

## Fixed in this pass

| # | Sev | Where | Evidence (before) | Outcome |
|---|---|---|---|---|
| 1 | High | `ui/States.kt` `BusyLabel` (used by Order page `OrderScreen.kt` `ActionBar`, 32 call sites) | `order-page_phone-*`: the check icon drew over the "M" of "Mark ready" (overlapping text) | The label row is now aligned inside the box instead of being the box's centred child; icon and words sit side by side. After: `order-page_phone-dark/light` |
| 2 | High | `ui/Contact.kt` `QuickAction` (Order page hero, Invoice page, Customer page) | "WhatsApp" cut to "WhatsAp" in the Order page's narrower hero cells (auto-size jumped a whole sp past fit, ellipsis ate the glyph) | quarter-sp auto-size steps, no ellipsis, 1 dp slack; all five words whole on `order-page` and `invoice-page` |
| 3 | Med | `ui/Chips.kt` `ChipRow`, `CustomersList.kt` | `audit-customers_phone-*`: the Everyone/Owing/Recent chips started 32 dp in, off the cards' edge (the row's own 16 dp gutter stacked on the page's) | `ChipRow(inset = ...)`; Customers passes 0. Chips now flush with the cards |
| 4 | Med | `NewOrderSections.kt` `PromisedSection` | `audit-new-order_phone-*`: 7d / 10d / 14d / No date chips touched (2 dp gaps), against M3's 8 dp | `ChipFlow` (8 dp gaps, wraps at large text) |
| 5 | Med | `CollectScreen.kt` row | `audit-collect_phone-dark`: the bill line ended in "…" so "Taken by" and the days were lost | up to three lines; whole line shown |
| 6 | Low | `CustomerScreen.kt` `Header` | `audit-customer-page_phone-*`: the customer's name twice, as the large bar title and again under the avatar (two emphasised elements for one fact) | in-body name removed; avatar, number and Contact row remain |

## Findings left open (with where to look)

| Sev | Finding | Evidence | Why not done here |
|---|---|---|---|
| Med | Other `ChipRow` callers also stack two gutters or none | `ChipRow(Modifier.padding(horizontal = 0.dp))` in `WorkshopKarigarScreen.kt:268`, `WorkshopBoard.kt:605`, `Insights.kt:473` does nothing (the 16 dp is inside the row); `DesignRoutes.kt:211`, `WorkshopGivenScreen.kt:230,410`, `WorkshopKarigarsList.kt:203`, `WorkshopPaySheets.kt:201` unverified | those screens have no baseline in this audit's set; each needs `inset = 0.dp` checked against a picture |
| Low | Home tiles and the date use ALL-CAPS eyebrows (`DashboardParts.kt:99`, `Dashboard.kt:264`, `MyWorkScreen.kt:340`), while sections are sentence case (`LedgerHeading`) | `root-home_phone-*` | M3 labels are sentence case; changing the case shifts every Home tile's rhythm and the owner has not asked |
| Low | `QuickAction` is a custom tile (clip + clickable + 12 % accent fill) imitating a tonal icon button with a caption | `Contact.kt` | The fill is a fade of a fill (allowed) and the icon/words pass contrast; a swap to `FilledTonalIconButton` would change the row's shape on three pages |
| Low | The FAB floats over a Needs-you row's trailing amount until the list is scrolled to its end | `root-home_phone-*` ("PKR 1.31 l…") | Standard FAB behaviour; `LocalFabClearance` pads the end. Could hide the FAB on scroll down (a motion decision) |
| Low | Repairs and Customers create with a "+" in the top bar, Home with a FAB | `repairs-list_phone-dark`, `audit-customers_phone-dark` | navigation/action structure; owner decision |
| Info | Step tabs of New order/New sale are a custom pill row, not `SecondaryScrollableTabRow` or a connected button group | `new-sale-1-customer_phone-dark` | works, selected state clear; Expressive has no better stock fit for a wizard |

## Checklist result

- **Product and hierarchy:** pass; one primary action per screen (filled bottom button or FAB), outlined secondary (Advance). Loading skeleton, empty (`NotAvailableState`), error (`FailureAlert`/Retry) exist in the kit.
- **Foundations:** pass. Semantic roles throughout; alpha only on fills; contrast test covers every role, both houses, both themes. Shape scale and type scale are M3's with Inter. Section headings follow one pattern.
- **Expressive quality:** pass with restraint; the hero card (`primaryContainer`) is the one emphasised region per screen, as the first-glance order on Home and the pages shows.
- **Components and states:** pass after fixes 1-2 (a label and its icon must never overlap, a caption must never be clipped). Disabled buttons stay readable (`readableWhenOff`).
- **Adaptive:** pass in the tablet baselines (readable column, list-detail where the iPad has it).
- **Accessibility:** icon-only controls have descriptions; targets 48 dp (`MinTouchTarget`); text wraps at 1.3x in the large-text set; Reduce Motion read from the system. Not tested: RTL, TalkBack on a device.
- **Engineering:** only stable-or-opted-in APIs of material3 1.5.0-beta01 (`TextAutoSize.StepBased` with `stepSize` is foundation's, not Material's); no new dependency.

## What could not be verified

Device behaviour (TalkBack, font scale 2x, RTL, predictive back), the Mina baselines after the changes (only Taheri was re-recorded; the changed code is house-independent), and the run-to-run noise in some existing baselines (Home's bars, Calendar, Drafts and Search differ between recording runs of the same code in one JVM, so those baselines were left as committed).
