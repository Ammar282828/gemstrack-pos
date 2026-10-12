# Web ERP matches the iPhone/iPad app

_Design spec, 2026-10-12. Owner: "re-skin the web ERP to match the native app as much as possible." Nothing here is built yet.
Read-only research of `apps/iphone/App/{Config,UI,Nav,Screens}` against `src/app/globals.css`, `tailwind.config.ts`,
`src/components/{ui,layout}`, `src/lib/nav.ts` and the Home / Orders / Invoices pages. Where a value is read from the app's code it
is exact; where it is Apple's system value (SF text styles, system colours) it is marked **(system)**; where the web must differ
from the app on purpose it is marked **deviation**._

## 0. What the research found (read this first)

1. **Dark mode is already the app's palette.** The app was built from the web's palette (`Theme.swift` says so). Taheri dark
   ground `#0A1111`, gold `#BE9F76`; Mina dark ground `#1C1114`, rose `#E8A5AE` match `globals.css` to within 1% HSL. **The gap is
   light mode**: the app's light is a grey `#F2F3F6` ground (Mina: cream `#F4EFE8`) with white (Mina `#FFFDF9`) cards and a **deep gold
   `#8A6B42` accent** (Mina maroon `#380000`). The web's light is near-white `#FCFCFD`, white cards on a hairline, and Taheri's
   accent is **near-black navy** (`--primary: 220.9 39.3% 11%`). That one change (Taheri light accent navy -> gold) is the most
   visible thing in this spec; 61 page files use `text-primary` for headings.
2. **The system font is already in use on the web** (`decisions.md#fonts`: "the ERP's screens are in the system font"), i.e. SF
   Pro on Apple devices. So text styles can be matched exactly with sizes and weights; no font file is needed. The app's one
   typographic signature, **numbers and section headings in the system serif (New York)**, is `font-family: ui-serif` on the
   web (Tailwind's `font-serif`): New York on Apple devices, Georgia elsewhere.
3. **The app's look is flat.** Cards are `Theme.card` on `Theme.ground`, radius 22, **no border, no shadow**; tone, not outline,
   separates them. Colour means something (`Tone`): red late, amber owed, green settled, teal credit, blue working, accent = chosen.
   One badge at most per card. A person (monogram + name) leads every row; the record id is the quiet caption.
4. **Shell**: phone = 4 tabs + a Search tab that is also the whole map; a floating mic + "+" create menu above the tab bar;
   iPad = adaptable sidebar. The web today = hamburger sheet + top bar + a Home-only "New" bubble.
5. The web already has most hooks (glass classes, `--app-header-h`, `phone-tabs` segmented row, `cv-list`, swipe-to-delete,
   motion curves identical to the app's `Motion`). The work is mostly values and a few new components, not a rewrite.

---

## (a) Design tokens

### a.1 Colour: the app's four values per house (Assets.xcassets), as HSL for `globals.css`

| Role (app name) | Taheri light | Taheri dark | Mina light | Mina dark |
|---|---|---|---|---|
| Ground (`Ground-*`) -> `--background` | `#F2F3F6` = `225 18% 95.7%` | `#0A1111` = `180 26% 5.3%` | `#F4EFE8` = `35 35% 93.3%` | `#1C1114` = `344 24% 8.8%` |
| Card (`Card-*`) -> `--card`, `--popover` | `#FFFFFF` = `0 0% 100%` | `#141A1A` = `180 13% 9%` | `#FFFDF9` = `40 100% 98.8%` | `#27191D` = `343 22% 12.5%` |
| Accent (`Accent-*`) -> `--primary`, `--ring` | `#8A6B42` = `34 35% 40%` | `#BE9F76` = `34 36% 60.4%` | `#380000` = `0 100% 11%` | `#E8A5AE` = `352 59% 77.8%` |
| On accent (`OnAccent-*`) -> `--primary-foreground` | `#FFFFFF` = `0 0% 100%` | `#0B1414` = `180 29% 6.1%` | `#FBF9F9` = `0 20% 98%` | `#251318` = `343 32% 11%` |

Current web values for comparison: Taheri light `--background 220 30% 99.4%`, `--primary 220.9 39.3% 11%`; Taheri dark
`--background 180 24% 5%`, `--card 185 15% 9%`; Mina light = Taheri's neutrals with only `--primary 0 100% 11%`; Mina dark
`--primary 352 52% 76%`. So: Taheri dark and Mina dark change only in the 3rd digit (adopt the exact values anyway, one source of truth
with the app); **Taheri light and Mina light change fully** (Mina light needs its own neutrals block: today it inherits Taheri's).

Derived tokens (not in the app's asset catalogue; the app uses iOS system fills, so these are the web's equivalents):

| Token | Taheri light | Mina light | Dark (both houses) |
|---|---|---|---|
| `--foreground`, `--card-foreground` (system label) | `0 0% 0%` | `0 0% 0%` | `0 0% 100%` (was warm `40 14% 96%`/`20 22% 94%`; app is system white) |
| `--secondary`, `--muted`, `--accent` (iOS tertiary fill, used for chips, tracks, hover) | `240 6% 93%` | `35 20% 89%` | unchanged (`185 12% 15%` / Mina `345 16% 18%`; accent `185 14% 21%` / `345 20% 22%`) |
| `--muted-foreground` | unchanged `220 8.9% 46.1%` | `30 8% 42%` | unchanged. **deviation**: iOS secondary label at 60% alpha is ~3.5:1 on white; the web keeps its AA grey. |
| `--border`, `--input` (field outline only; cards get none) | unchanged `220 13% 91%` | `35 20% 86%` | unchanged |
| **new** `--separator` (list dividers; iOS opaque separator) | `240 2% 78%` (#C6C6C8) | `35 15% 80%` | `240 2% 22%` (#38383A); Mina `343 12% 24%` |
| `--secondary-foreground`, `--accent-foreground` | `0 0% 0%` | same | unchanged |
| `--chart-1` | = `--primary` | = `--primary` | unchanged |

**Contrast note (carry into the CSS comment):** `#8A6B42` is 4.9:1 on white but ~4.4:1 on the `#F2F3F6` ground. So accent
**text under 17px/semibold goes on cards, not on the ground**, or uses `--foreground`. Page titles use `text-foreground` (the app's
titles are label colour; only controls and chosen states are accent).

### a.2 Tone colours (the app's `Tone`; nothing else picks a colour)

New tokens, light/dark, each as a fill (tints, bars, icons) and an `-ink` (text and 12px icons). Values are Apple's system
colours and their accessible variants **(system)**:

| Tone (app `Tone`) | Means | Fill light / dark | Ink light / dark |
|---|---|---|---|
| `--tone-late` | late, missed promise, sitting too long | `3 100% 59%` (#FF3B30) / `4 100% 61%` (#FF453A) | `354 100% 42%` (#D70015) / = fill |
| `--tone-owed` | due soon, money still to come (never red) | `35 100% 50%` (#FF9500) / `37 100% 52%` (#FF9F0A) | `19 100% 39%` (#C93400) / = fill |
| `--tone-settled` | paid, done, ready | `135 59% 49%` (#34C759) / `135 64% 51%` (#30D158) | `136 58% 34%` (#248A3D) / = fill |
| `--tone-credit` | in credit (the shop owes) | `189 63% 48%` (#30B0C7) / `189 72% 56%` (#40C8E0) | `190 100% 30%` (#008299) / = fill |
| `--tone-working` | with the karigars | `211 100% 50%` (#007AFF) / `211 100% 52%` (#0A84FF) | `224 100% 43%` (#0040DD) / = fill |
| `--tone-quiet` | nothing to say | `--muted-foreground` | same |
| `--tone-house` | the shop's own, chosen | `--primary` | `--primary` |

Wire-up: Tailwind `colors.tone.{late,owed,settled,credit,working}.{DEFAULT,ink}`. Existing `--destructive`/`--success`/`--warning`
keep their names (230 usages of `bg|text-success|warning`): set **light** `--destructive: 354 100% 42%`, `--success: 136 58% 34%`,
`--warning: 19 100% 39%` (the inks, so white-on-fill passes) and leave dark values as they are. WP-A greps those 230 and eyeballs.
A **pill** is `text-tone-X-ink bg-tone-X/[.13]`, as `Pill` does (`tone.color.opacity(0.13)`).

### a.3 Type: SF Pro text styles -> web

Font families: **no new font files.** `font-sans` stays the system stack (SF Pro on Apple; Inter is not loaded in the ERP, only
`/links`). Add `font-serif` use = `ui-serif` (New York on Apple; Georgia fallback elsewhere, i.e. Windows desktops differ from the
app. Optional later: load `newsreader-normal-latin.woff2`, already in `src/fonts/`, in `layout.tsx` as the non-Apple serif; that
is a `next/font/local` addition per `decisions.md#fonts`, not a new file). Do not set `letter-spacing` on system-ui text: Safari
applies SF's dynamic tracking itself. Remove the base rule `h1..h6 { font-bold tracking-tight }` (the app's headings are semibold
and untracked). `tabular-nums` everywhere a figure appears (= `monospacedDigit()`).

| App style (SwiftUI) | px / line | Weight | Tailwind (new `fontSize` keys in `tailwind.config.ts`) | Used for |
|---|---|---|---|---|
| `.largeTitle` | 34 / 41 | bold (nav large title); semibold serif for `HeroAmount` | `text-ios-large` | page title (phone), hero sum |
| `.title2` | 22 / 28 | semibold, serif for figures | `text-ios-title2` | `FigureTile` value, big sheet figures |
| `.title3` | 20 / 25 | semibold, serif | `text-ios-title3` | `LedgerHeading`, invoice-row total, `PKR` beside hero (medium) |
| `.headline` | 17 / 22 | semibold | `text-ios-headline` | row name (customer), nav bar title |
| `.body` | 17 / 22 | regular | `text-base` (16) -> use `text-[17px]` only in list rows | form values |
| `.subheadline` | 15 / 20 | regular; semibold for amounts, medium for "show more"/chips | `text-ios-sub` | secondary lines, `RowAmount`, chips |
| `.footnote` | 13 / 18 | regular, medium for state words | `text-ios-foot` | stage word, hints, footers |
| `.caption` | 12 / 16 | regular; semibold in `Pill`, `DateLeaf` | `text-ios-cap` | record id line, pills, "You" |
| `.caption2` | 11 / 13 | semibold, uppercase, `tracking-[0.6px]` for labels (`MoneySplit`), medium for tab labels | `text-2xs` (already 11px) | `MoneySplit` labels, tab-bar labels |
| `DateLeaf` | weekday `size*.2` bold, day `size*.42` semibold serif, month `size*.16` | | inline | 44px leaf |
| `Monogram` | initials `size*.38` semibold serif | | inline | 40px circle |
| Date line (Home) | 12 semibold, uppercase, tracking `.8px`, secondary | | | "FRIDAY 9 OCTOBER" |

On a phone `<input>` text must stay >= 16px (iOS zoom); fields keep `text-base`, desktop `md:text-sm` as today.
The 44px target the app guarantees everywhere is already the web's `pointer: coarse` rule (`min-height: 2.75rem`).

### a.4 Radii, spacing, shadow

| Token | Value | App source |
|---|---|---|
| `--r-card` / Tailwind `rounded-card` | **1.375rem (22px)** | `ledgerCard`, `FigureTile`, skeleton card, dashboard cards |
| `--r-card-sm` | 1.25rem (20px) | standalone `OrderCardRows` (iPad grid) |
| `--r-tile` | 0.875rem (14px) | `QuickAction` button |
| `--r-leaf` | 0.625rem (10px) | `DateLeaf`; need-row icon tile = `side*0.3` |
| `--r-control` | 0.75rem (12px) | form fields (`Input`, `Textarea`, `Select` trigger); inline controls |
| capsule `rounded-full` | | buttons, chips, pills, segmented control, tab bar (iOS 26), search field, `MineTag` |
| `--r-window` | 1.75rem (existing) | sheets, dialogs |
| existing `--radius` 0.75rem | unchanged (drives `rounded-lg/md/sm` of untouched components) | |

`html.ui-glass` currently sets `--r-card: 1rem` and `--r-control: 0.625rem`; **raise both to the values above** (glass is the app's
look; a 1rem card beside the 22px app card would be the one visible difference).

Spacing (px): screen gutter **16** on a phone, **24** on iPad/desktop (`padding(24)` in the wide hub); gap between page sections **22**
(`VStack(spacing: 22)`, Orders wide 24); card padding **16**; list row min-height **56** with 16 insets (`defaultMinListRowHeight`)
and card-row insets top 16 / bottom 12-16; chip row gap 8; heading-to-card gap 8; monogram-to-text gap 12; list section gap 24.
Dividers are inset to the text edge (16, or 16+monogram+12 = 68 with a 40px monogram).

Shadow: **none** on content (`Card` drops `shadow-sm`; `border` goes transparent: the standalone order card alone has a 1px
`primary/8%` ring, `primary/22%` when it is yours). Floating controls keep the existing glass shadow. Segmented-control selected
segment keeps `shadow-sm` (the system's).

### a.5 Motion (already identical)

`Motion.enter` (0.22,1,0.36,1) 220ms, `exit` (0.4,0,1,1) 150ms, `travel` (0.32,0.72,0,1) 300ms are the web's `ease-enter/exit/sheet`.
Nothing to change. `contentTransition(.numericText)` has no CSS equivalent: cross-fade 150ms on figure change. Chips: fill eases on
`exit` curve. Reduce Motion rule stays.

### a.6 Where it lives (so it can be switched back)

Put the new values in `:root` / `.dark` / `.brand-mina` blocks (the palette is the palette), and every **structural** rule (card
radius, tab bar, large title, flat card) under a constant body class `app-look` added in `layout.tsx` `bodyClass` (same on server and
client, so no hydration risk: `decisions.md#light-and-dark`). Removing the class reverts structure; the tokens revert by git. No
new Settings option: this becomes the Standard look; **Liquid Glass stays the option** layered on top (the app is always glass; the
web's Standard = the same shapes without the material).

---

## (b) Component-by-component mapping

New components are in **bold**, all under `src/components/ledger/` (one file each) unless noted. `Tone`
= `'late'|'owed'|'settled'|'credit'|'working'|'quiet'|'house'` in `src/lib/tones.ts`.

| Native (file) | Web today | Change |
|---|---|---|
| `Theme.card` + `ledgerCard()` (padding 16, radius 22) | `ui/card.tsx` (`rounded-lg border shadow-sm`, header/content `p-6`) | `rounded-card border-transparent shadow-none`; `CardHeader`/`CardContent`/`CardFooter` `p-4` (callers passing `p-6` keep it); CardTitle default `text-ios-headline font-semibold` |
| `Pill` / `StatusBadge` | `ui/badge.tsx` + ad-hoc `getPaymentBadgeClass`, `getStatusBadgeVariant` (orders, invoices pages: solid saturated fills) | **`Pill({tone, icon?, children})`**: `inline-flex gap-1 rounded-full px-2 py-[3px] text-ios-cap font-semibold tabular-nums text-tone-X-ink bg-tone-X/[.13]`; `Badge` gains `tone` variants and drops its border; pages replace their solid class maps (status: Pending owed, In Progress working, Completed settled, Cancelled/Refunded quiet) |
| `Monogram` | `ui/avatar.tsx` (photo/initial) | **`Monogram({name,size=40})`**: circle `bg-primary/[.13]`, initials serif semibold `size*.38` in `text-primary`; walk-in name (use `lib/walk-in.ts isWalkInName`) -> person glyph at 80% |
| `HeroAmount`, `RowAmount`, `FigureTile`, `MoneyText` | ad-hoc `Headline`/`Panel` in `app/page.tsx`; `PKR {n.toLocaleString()}` | **`HeroAmount({amount, lac?, tone?})`** (small `PKR` ios-title3 medium secondary + `text-ios-large font-serif font-semibold tabular-nums`, `truncate`); **`RowAmount`** (ios-sub semibold tabular); **`FigureTile({label,value,detail?,tint?})`** (label ios-sub secondary, value ios-title2 serif semibold) using `lib/money.ts` (lac/crore) |
| `PaidBar`, `MoneySplit` | `ui/progress.tsx`; two-column money in cards | `Progress` height 4px (`h-1`), track `bg-muted`, fill `bg-primary`, `bg-tone-settled` when paid; **`MoneySplit({total,paid,due,totalLabel?,paidLabel?})`**: three cells (Total / Paid / Due or In credit or "Nil"), labels `text-2xs uppercase tracking-[.6px] font-semibold text-muted-foreground`, values ios-sub semibold tabular, Due `tone-owed`, credit `tone-credit`, nil `tone-settled`, bar below |
| `DateLeaf`, `PromiseWords` | `components/shared/promise-line.tsx` | **`DateLeaf({date,tone,size=44})`** (weekday/day/month stack on `tone/10%` tile, radius 10); `promise-line.tsx` keeps the words ("Late 2 days", "Due today", "Due Thu 12 Oct") and its owner file stays WP-D's |
| `StageTrack` | none on cards; order page has steps | **`StageTrack({stage, labels?})`**: 4 capsule bars (Booked, Making, Ready, Invoiced) height 4-5px, filled `bg-primary` up to the step, rest `bg-muted-foreground/[.18]`; labels `text-2xs` (chosen semibold). Order **detail** page only (app: cards show the stage word, detail shows the track) |
| `LedgerHeading` / `LedgerSection` | `CardTitle`, ad-hoc `<h2>` | **`LedgerHeading({title,count?,trailing?,tone?})`**: serif `text-ios-title3 font-semibold` (red if `late`), count ios-sub secondary tabular, trailing ios-sub medium secondary tabular, right-aligned, baseline aligned; **`LedgerSection`** = heading + inset-rows card (`rounded-card bg-card divide-y divide-separator` with 16 insets) + optional footer `text-ios-foot text-muted-foreground`, collapsible via `<details>` styled like `DisclosureGroup` |
| `FilterChip`, `ChipRow`, `.chipRowInList` | `Select` rows; `ui/tabs.tsx` | **`ChipRow`** (horizontal scroll, `gap-2`, gutter 16, no scrollbar) + **`FilterChip({title,count?,chosen,onClick})`**: `h-11 rounded-full px-[13px] text-ios-sub`; chosen `bg-primary text-primary-foreground font-semibold` (count 80%); else `bg-card border border-muted-foreground/[.18] font-medium`; `aria-pressed` |
| `Picker .segmented` ("Show by") | `phone-tabs` row in `app-layout.tsx`, `inline-flex rounded-md border` group in orders | **`Segmented({value,options,onChange})`** shared by both: capsule track `bg-muted p-[3px] h-9`, selected `bg-card shadow-sm font-medium` (today `bg-background`: use `bg-card`); `app-layout`'s `phone-tabs` adopts the same classes |
| `QuickAction` / `ContactActions` | buttons in customer page | **`QuickAction({icon,label,prominent?,href})`**: 44px-high `rounded-tile` (14) tile `bg-primary/[.12] text-primary` (prominent: `bg-primary text-primary-foreground`), label `text-2xs font-medium` under; **`ContactActions({phone})`** = Call / WhatsApp / Message (`tel:`, `wa.me/<digits>` with the existing `whatsAppNumber`, `sms:`), nothing without a number |
| `MineTag` | `mineRowClass` tint + bar in `lib/utils.ts` | **`MineTag`**: `text-2xs font-bold text-primary border border-primary/50 rounded-full px-1.5 py-0.5` reading "You" (`aria-label="Taken by you"`); `mineRowClass` is retired from phone cards (kept on desktop table rows). `decisions.md#signed-in-defaults` ("yours lit in place") still holds |
| `ContentUnavailableView` | ad-hoc centred `<p>` (e.g. "No sales yet.") | **`EmptyState({icon,title,description?,action?})`**: centred, icon 40px `text-muted-foreground/70`, title ios-headline, description ios-sub secondary, lucide icons from section c.2 |
| `ShelfState` / `SkeletonLoading` | `shared/skeletons.tsx` | skeleton lines `bg-muted-foreground/[.12]` capsule-ish (`rounded-[calc(h/2.5)]`), cards `rounded-card bg-card` |
| `Form`/`List` insetGrouped rows | `Input`, `FormField`, table | `Input`/`Textarea`: `rounded-control border-transparent bg-muted/70 h-11` (focus: `ring-2 ring-primary/40`, no offset) **only inside `LedgerSection` rows**; bare fields keep the border; native search -> **`SearchField`** (capsule, magnifier, `h-11 bg-muted`, clear button) replaces the pages' search `<Input>` |
| `.buttonStyle(.houseProminent / .glass / .borderless)` | `ui/button.tsx` | `default` = capsule accent fill (`rounded-full`, `h-11`, `px-5`); `lg` `h-12`; `sm` `h-9` (44 when coarse, existing rule); `secondary` = `bg-primary/[.12] text-primary`; `outline` = `bg-card` + 1px `muted-foreground/18`; `ghost` = accent text (the "borderless" button); `destructive` unchanged shape. `rounded-md` -> `rounded-full` only for `default|secondary|outline|destructive`; `icon` stays circle |
| `Toggle` (tinted) | `ui/switch.tsx` | track 51x31, thumb 27, checked `bg-primary` (the app tints toggles with the accent, not green) |
| `.sheet` / `confirmationDialog` / alert | `ui/dialog.tsx`, `sheet.tsx`, `alert-dialog.tsx`, `drawer.tsx` | phone (`<md`): `Dialog` content anchors to the bottom, `rounded-t-[1.75rem]`, grabber 36x5 `bg-muted-foreground/30`, enters on `ease-sheet` 300ms (existing `slide-in-from-bottom`), `max-h-[92dvh]`, safe-area padding; `AlertDialog` stays a centred 14px-radius alert (iOS alert) with stacked full-width actions; desktop unchanged. Header = inline title + trailing "Close" (`xmark`) like the app's create sheet |
| `.contextMenu`, `Menu` | `ui/dropdown-menu.tsx`, `popover.tsx` | radius 14-16, `bg-popover`, rows 44px with trailing-less leading icons (lucide 18px); long-press on a touch row opens the same menu (see c.5) |
| `swipeActions` | `ui/swipe-to-delete.tsx` (trailing delete only) | **`SwipeRow`** generalises it: `leading?: Action[]`, `trailing?: Action[]` (each `{label, icon, tone, onSelect}`), the same 8px intent test and no-React drag, actions are 76px coloured squares with icon over word `text-2xs`, `allowsFullSwipe: false` (never auto-fires). Touch only (`pointer: coarse`); desktop shows the same actions in the row's `...` menu |
| `NavigationLink` chevron rows | `<Link>` cards | rows end with a `ChevronRight` 14px `text-muted-foreground/60` where the app shows the system disclosure |
| `RateChip` (leading of each tab root) | `rates/rate-chip.tsx` | unchanged (already a glass capsule); phone: leading in the top bar |
| Sidebar header logo | `Sidebar` header | unchanged (both have the full logo) |

---

## (c) App shell

### c.1 Breakpoint rule

`<md` (under 768px, the web's phone) = the app's **iPhone shell**; `>=md` = the app's **iPad shell** (sidebar). 768 is iPad
portrait, where the app's size class turns `.regular`. Nothing about `nav.ts` changes: **all of this reads `sidebarFor()`/`forRole()`/
`locate()`**, so houses, flags and roles come through unchanged, and `nav.test.ts` still guards the registry.

### c.2 Phone: bottom tab bar (new `components/layout/tab-bar.tsx`, `lib/tab-bar.ts`)

Tabs, in order, exactly the app's `RootView.primary`: **Home, Orders, Invoices, Customers** then **Search** (role `search`, set
apart on the right). Ids are `nav.ts` entry ids, so `lib/tab-bar.ts` exports
`PRIMARY_TAB_IDS = ['home','orders','invoices','customers']` and `tabEntries(navRole, groups)`:
owner/staff -> those four found in `forRole`'d entries (a staff account sees all four, they are `staff: true`); **marketing -> the first
four entries of the Marketing group** (`prefix(4)`: Posts, Website, Ads), no create menu, no Home. A test in `nav.test.ts` asserts
every id in `PRIMARY_TAB_IDS` exists in `NAV`.

| Tab | lucide (from `NAV[].icon`) | SF Symbol in `NavIcon.swift` |
|---|---|---|
| Home | `Home` | `house` |
| Orders | `ClipboardList` | `list.clipboard` |
| Invoices | `Receipt` | `receipt` |
| Customers | `Users` | `person.2` |
| Search | `Search` | `magnifyingglass` |

(The lucide set is already what `nav.ts` uses; the app maps those names to SF Symbols in `NavIcon.symbols`, so one name per icon
both ways. Stroke 1.75 to sit closer to SF's weight.)

Geometry: `<nav class="fixed inset-x-0 bottom-0 z-40 md:hidden">`, 5 equal columns, item = icon 24px over label `text-2xs font-medium`,
`min-h-[49px] pt-1.5`, bottom `padding-bottom: env(safe-area-inset-bottom)`. Lit tab = `text-primary` (icon and label); others
`text-muted-foreground`. **Standard**: `bg-card/90 backdrop-blur-xl` with a top `border-separator` hairline (the iOS 18 bar). **Glass**
(`html.ui-glass`): the existing `.glass-bar` recipe, inset `0.75rem`, capsule, lit tab gets a `bg-foreground/[.09]` capsule behind it, Search
as its own round button (iOS 26). Badge: Orders shows `useOnlineWaiting()` count (nav `count: 'online'`, owners, only when the house
sells online) as a red `tone-late` capsule at the icon's top-right, same rule as `app-layout` today. Lit tab = the tab whose entry
`locate(pathname)` returns; a page in any other entry (Workshop, Money, Settings...) **lights Search**, because in the app those open
from the Search tab.

The bar hides on: the keyboard being open (`visualViewport.height` < 75% of `innerHeight`), and the create/edit routes the app
shows as modal sheets: `/new`, `/orders/add`, `/invoices/new`, `/repairs?new=1`, `/customers/add`, `/products/add`, `/karigars/add`,
any `*/edit`, `/scan`, `/website/post*`, `/ads/new`, `/ads/studio*` (their own bottom bars - `glass-bar` totals - would collide).
Those pages show a leading `Close` (X) / back control (reuse `shared/page-back.tsx`). List in `lib/tab-bar.ts` `HIDES_TAB_BAR`.

Page bottom padding on a phone: `<main>` `pb-28` -> `pb-[calc(49px+env(safe-area-inset-bottom)+76px)]` (the app's
`safeAreaPadding(.bottom, 76)` for the floating buttons) on tab-root pages; `pb-[calc(49px+env(safe-area-inset-bottom)+16px)]`
elsewhere. Define as `--tabbar-h` and `--fab-clear` in globals.

### c.3 Search tab = the whole map (new `components/layout/map-sheet.tsx`)

The app's Search tab lists every ERP place in nav groups, then Settings, "This phone", signed-in email, Sign out; typing filters by
name and keywords. On the web it is a **full-height sheet** (not a route, so `nav.test.ts` has nothing to register) opened by the
Search tab: top = `SearchField` ("Places in the ERP"), idle body = `sidebarFor(navRole)` groups rendered as `LedgerSection`s
(group label = `LedgerHeading` size, rows = icon + label + chevron, count chips for Drafts/online), then Settings, then the account
block (avatar, name, email, **Light/Dark toggle** [the web's `ThemeToggle`, which `decisions.md#the-map` moved into the menu footer],
Sign out). Typed body = `paletteFor(navRole)` filtered the way `CommandPalette` already filters (reuse its matcher; extract it to
`lib/palette-match.ts` if it is inline). The Ctrl+K `CommandPalette` stays for desktop. The hamburger/`SidebarTrigger` is hidden under md.

### c.4 Phone top bar and titles

Bar (sticky, `bg-background/80 backdrop-blur`, no bottom border; scroll-edge hairline once scrolled, `useScrolled`):
leading **RateChip** on tab roots, **back chevron + parent label** on deeper pages (`‹ Orders`; parent = the `locate()` entry's
label; `router.back()` when history exists, else the entry href); trailing on Home for owners **the account monogram -> /settings**
(32px circle, `Initials` in accent: the app's top-right Settings). Centre = the page title in `text-ios-headline`, **shown only
once the large title has scrolled out** (IntersectionObserver on the `<h1>`; `data-title-hidden` on the header). The sibling-page
`phone-tabs` row stays under the bar (it is the closest web match to the app's title menu `toolbarTitleMenu`; restyled as
`Segmented`). `PageShell`: h1 on phone = `text-ios-large font-bold text-foreground` (no icon, no `text-primary`), `md:` 30px
semibold; subtitle `text-ios-foot text-muted-foreground`; `action` slot moves to the bar's trailing on phone only when it is a single
icon-able button, else stays under the title.

### c.5 Create menu and voice (replace `new-bubble.tsx`)

App: on every tab root and the Search tab, bottom-trailing glass cluster: mic circle (owners) + prominent "+" circle (52px, 44 once
the page has scrolled: `compact`), `GlassEffectContainer`; "+" is a menu: **New sale** (the `/new` chooser), **New order**
(`/orders/add`), **Scan** (`/scan`), divider, **Voice assistant** (owners). New `components/layout/create-menu.tsx`: same
cluster on phone, shown on `/`, `/orders`, `/invoices`, `/customers` and the map sheet (tab roots), hidden for marketing and when the
tab bar is hidden. Menu rows (use `NEW_SALE`, `ACTIONS` from `nav.ts` for the hrefs/labels): **New invoice** (`/invoices/new`), **New
order** (`/orders/add`), **New sale ...** (`/new`: repair, scan a tag, read a bill) - this keeps `decisions.md#the-map`'s Home New
choices (invoice, order) and adds the app's third row. Icons `Receipt`, `ClipboardList`, `ScanLine`, `Mic`. `VoiceBubble`'s button
moves into the cluster (it keeps its own live-transcript panel; reposition it above the cluster). On `>=md` there is **no floating
cluster**: the sidebar's New sale button and Ctrl+K cover it (the app's iPad puts New in the toolbar).

### c.6 iPad/desktop: sidebar like the iPad app

`app-layout.tsx` keeps `Sidebar collapsible="icon"` and `sidebarFor()` groups. Restyle only: group labels sentence case
`text-ios-foot font-semibold text-muted-foreground` (drop `uppercase tracking-widest 11px`; the glass pass already title-cases them);
rows `h-11 rounded-xl gap-3`, icon 20px; **lit row = `bg-primary/[.12] text-primary font-semibold`** (approximates the system
sidebar selection; no solid fill); logo header unchanged; Search field at the top (capsule, `bg-muted`), New sale capsule below it;
footer = Settings row + account row (monogram, name, email, sign out). Width stays `var(--sidebar-width)`. Top bar on `>=md`:
`SidebarTrigger` · page tabs (restyled as `Segmented`, glass pills exist) · RateChip · theme toggle, as today; the large title lives
in the page. The page column: lists/forms use a readable column (`max-w-[720px] mx-auto`, the app's `ReadableColumn`) on
Settings, Customers, Karigars and detail pages; hubs (Orders, Invoices) use a card grid `repeat(auto-fill, minmax(340px, 1fr))`
at 768-1023 and keep their **tables at `lg+`** (**deviation**: the app shows card grids on a 1366px iPad; a desk user who sorts 400
invoices wants the table. Owner may ask to drop the tables later).

### c.7 Coexistence checklist with what exists

- `nav.ts` untouched (and therefore `npm run nav:export` / the app's `nav-*.json` unchanged). New files only read it.
- Phone `SidebarTrigger` sheet is no longer reachable under `md` (the map sheet replaces it); `useSidebar().isMobile` consumers
  (`SidebarSearch`) are not rendered on phone.
- `inNativeApp()` branch of `app-layout` (the app's own web view) stays bare: no tab bar, no create menu inside the app. Skin tokens
  still apply (that page is *in* the app and now matches it).
- `pathname === '/' && newSaleEntry && <NewBubble />` is removed; `VoiceBubble` is mounted by the cluster.
- `main` `data-scrolled`, `--app-header-h`, `.phone-tabs` `scrollIntoView` effect, `cv-list` are kept.
- Offline banner: `Pill`-style full-width strip `bg-tone-owed/[.13] text-tone-owed-ink` (it currently uses `bg-warning text-warning`, same colour twice).

---

## (d) Screen by screen, ordered by impact

Impact = visits per day x how much of the screen changes. All screens inherit section (a)/(b) automatically; below is what each
page does **beyond** the inherited values.

### d.1 Orders - `src/app/orders/page.tsx` (+ `components/order/next-step.tsx`, `promise-line.tsx`)

App: large title; search in the nav bar; **"Show by" segmented** (Day default, Stage, Due, Week, Month) as the list's first row;
status **chips** (counts) and a toolbar **filter menu** (month, taken by, payment); sections with `LedgerHeading` + hint; each order a
card. Web today: PageShell + a row of four `Select`s + a `group-by` button group; mobile `Card` with two solid Badges.

1. Controls block (phone): `SearchField`; `Segmented` over the web's existing groupings (Day, Stage, Week, Month; web's legacy
   "status" grouping stays only in the desktop group; **"Due" is app-only**: porting it needs `orderTiming` per order, already in
   `lib/` for the dashboard - optional); `ChipRow` of status chips with counts (All, Pending, In progress, Completed, Cancelled);
   a "Filters" capsule button (`SlidersHorizontal` + count) opening a bottom sheet with Month / Taken by / Payment (the `Select`s move
   in). Desktop (`md+`) keeps the inline selects, restyled capsule triggers.
2. Section header: `LedgerHeading` (Stage view: stage name, count, hint = the stage's one-line meaning; Day view: "Today",
   "Yesterday", weekday, with the day's total as `trailing`). Done/Cancelled stay folded in the Stage view (existing `folds`).
3. Order card (phone `<OrderCard>` replaces lines ~109-210): `Card` + `p-4`:
   row 1 `[Monogram 36] [name headline / id caption / MineTag / OnlineBadge] ... [money right: RowAmount owed or Paid pill]`;
   row 2 piece summary `text-ios-sub text-muted-foreground` (`What . extra`); `Separator`; row 3 left stage word (icon + footnote
   medium in stage tone: karigar working, ready/done settled, transfer/payment owed, else quiet) with "x of y done"/"n unassigned"
   caption, right the promise (`DateLeaf` 36 or words: late red, today amber, "Due Thu 12 Oct" quiet); **one badge at most**
   (the payment `Pill`; the status badge goes: the stage word says it); row 4 = `next-step.tsx` as a full-width capsule
   `bg-primary/[.12] text-primary h-11` (Mark ready / Give out / Finalize & invoice / Take PKR ...), invoiced orders show the quiet
   *Invoiced . INV-...* link. Invoiced/done cards: name `text-muted-foreground` (replaces `settledRowClass` opacity). Cards are a
   `space-y-3` stack; on 768-1023 a 2-column grid.
4. `SwipeRow`: leading Call / WhatsApp (settled, credit tones) when a phone exists; trailing Advance (working), Ready (settled, only
   when with the karigars). Long-press/`...` menu: Record an advance, Mark ready, Set status >, Call, WhatsApp, Open page. Advance
   still honours `decisions.md#order-actions-gate` (owner-only, delete-code rules unchanged).
5. Empty states (`EmptyState`): no orders, nothing open (Due view), search no match.
6. Order **detail** (`orders/[id]`): `StageTrack labels`, `MoneySplit`, `ContactActions`, `LedgerSection`s for pieces/payments.

### d.2 Invoices - `src/app/invoices/page.tsx` (+ `components/invoice/*`)

App: chips (All, Unpaid, Paid, In credit, Shopify; counts), filter menu (group by, taken by, month, date range), rows grouped by day.
Row: `Monogram 38`, name headline, `INV-... . 3:45 pm` caption (+ `. Shopify`), MineTag, what-was-sold subheadline, bottom:
balance pill left (owed "PKR x due" / Paid / In credit) and the total in serif title3 right. Swipe: leading Send on WhatsApp
(working), trailing Take payment (settled, owners, owing only). Context menu: Take payment, Send/Send again on WhatsApp, Print/PDF.
Web today: Card with docType Badge + paid Badge + status Badge, `PKR n` in the table.

1. Phone controls = `SearchField` + `ChipRow` + Filters sheet (as d.1). The date-range popover (`date-range-picker.tsx`) opens inside it.
2. Row card (replaces the card at lines ~94-160): the app row verbatim (grouped list inside a `LedgerSection`: rows
   `rounded-card` card per day with `divide-y divide-separator`, insets 16). Drop the `docType` badge (invoices only here; orders
   have their own page) and the status badge; the **balance pill is the one badge**. The `CardFooter` action strip
   (`bg-muted/30`) goes: its actions become the swipes/menu above.
3. Totals: `font-serif text-ios-title3 font-semibold tabular-nums`; `trailing` of each day heading = the day's takings.
4. Invoice **detail**: `HeroAmount` (grand total) + `MoneySplit` + `ContactActions` + sections; keep `decisions.md#invoice-pages`
   (viewer never touches the cart; `/view-invoice/<id>` is the customer's page and **is not re-skinned** - customer-facing, own dress).

### d.3 Home - `src/app/page.tsx`

App order: date line; **hero "Taken today"** (serif, invoices count, last sale time, week bars); a collapsed "Shop overview" with
**This month** (vs last), **Owed to you** (amber, "n unpaid", "x in hisaab"), **On the bench**; **Needs you** (3 rows + "Show n more");
**Due to customers** (DateLeaf rows); **Recent sales** (monogram rows); collapsed "Last 30 days". Wide (>=900): hero + 3 cards across,
then two columns (needs + due | sales + month), max-width 1240.

Web changes: heading = shop name `text-ios-large font-bold text-foreground` (phone) with the date line above it
(`text-ios-cap font-semibold uppercase tracking-[.8px]`); replace the four `Headline`s by `HeroAmount` card (Taken today) +
three `FigureTile`s; the three `Panel`s become `LedgerHeading` + inset-rows cards (rows exactly: need row = icon tile
`rounded-[30%]` in tone, title semibold, caption; due row = `DateLeaf 44` + name + piece + amount; sale row = `Monogram 40` + name
+ pill); show 3 rows then "Show n more" (`text-ios-sub font-medium`, 44px); the 30-day strip -> collapsible card. Desktop `lg`:
two columns as the wide app layout; **drop** `lg:h-[calc(100dvh-6.5rem)] lg:overflow-hidden` (the app's page scrolls). **Deviations:** the
three stat cards stay **visible** (the app hides them behind "Shop overview"; `decisions.md#dashboard` says four figures on the
glance); numbers keep `compactPKR`. Staff see what the web already shows them (no hisaab/expenses), unchanged.

### d.4 Customers - `src/app/customers/page.tsx`

App: large title, search ("name, phone, or email"), chips **Everyone / Owing / Recent**, sections with title+count+hint, rows =
`Monogram 40` + name + (phone, "n sales . last Oct 2026") + right amount: owing -> `PKR n` amber with caption "Owed", else lac of
lifetime spend with caption "Lifetime sales". Swipe trailing WhatsApp (green), Call (blue); context menu Call / WhatsApp / Message.
Empty states: no customers, nobody owes you, no recent buyers. Detail: `HeroAmount` + `ContactActions` row.
Web: phone card (`CustomerCard`, line ~108) + desktop table; replace the card with the row, add the chips (the web has filters in
other forms), keep the table at `lg+` with `Monogram` in the name cell and the amount cell in the same tones. Merge/spam/duplicate
tools stay where they are, restyled by inheritance.

### d.5 Workshop - `src/app/workshop/page.tsx` (+ `karigars`, `given`)

App: chips **All work / Unassigned / Requires attention / Not yet given** with counts; a "Group by" menu + "Reset filters"; a filter
menu (taken by, work, karigar, status); job rows in sections; karigars list with a Show picker. Web: `Select`s per job card (`h-7
w-[130px]`) and Cards (lines ~568-700). Changes: `ChipRow` focus filter, `Segmented` for Jobs / Karigars / Given items stays the
page-tab row; the job card -> row (title headline, karigar + customer caption, status `Pill`, due `DateLeaf`/words, the status
`Select` moves into the swipe/menu: leading Mark done..., trailing Assign / Given); critical (sitting 7+ days) = red word, not a red card
border (`border-destructive/60 bg-destructive/5` goes). Empty states with the app's words ("All work is assigned", "No work requires
attention", "Nothing is on the bench").

### d.6 Settings - `src/app/settings/page.tsx` (+ `settings/*`)

App: Form: account card (56px accent circle with initial, name headline, email, "Owner . <shop>"), then grouped rows each with a
coloured rounded-square icon (Shop blue, Alerts red, Bank accounts green, Integrations purple, Data grey, Activity indigo, Voice pink,
This phone teal), Sign out, footer with version. Web: phase 1 (in scope): the existing tabbed pages restyled by inheritance -
`Card`s become `LedgerSection`s (heading outside, inset rows, `Switch` 51x31, fields in rows), Appearance's *Interface style*
select unchanged. **Phase 2 (optional, needs an owner decision):** on a phone, `/settings` becomes the index list above; the Shop
form moves to a new `/settings/shop` registered under `SETTINGS.pages` in `nav.ts` and the app's `nav-*.json` regenerated
(`npm run nav:export`, else its staleness test fails); the existing segmented row is then unnecessary on phone for Settings only.

---

## (e) Implementation plan: six work packages

Order: **A first** (alone, 1 agent, small and fast; it fixes the token names everyone else uses). Then **B and C in parallel** (B is new
files only; C owns the shell). **D, E, F in parallel after B** (B's component props are fixed in section b, so D-F can code against
the signatures while B finishes, but merge after it). No two packages edit the same file; shared files are marked.

### WP-A - Tokens and primitives (blocking; shared files)

Files: `src/app/globals.css` (palette blocks per a.1/a.2, new `--separator`, `--tone-*`, `--r-*`, `app-look` structural rules, boot
colours per house, raise glass `--r-card`/`--r-control`, remove base `h1-h6` bold/tight rule), `tailwind.config.ts` (`tone`,
`separator`, `rounded-card/tile/leaf/control`, `fontSize` ios-*, `fontFamily.serif`), `src/app/layout.tsx` (add `app-look` to
`bodyClass`; light status-bar colour `#FCFCFD` -> `#F2F3F6` / Mina `#F4EFE8`; `STORE_THEME_COLOR` is dark-only and stays),
`src/components/ui/{card,button,badge,input,textarea,select,tabs,switch,progress,skeleton,separator,dialog,sheet,alert-dialog,dropdown-menu,popover}.tsx`,
`src/components/shared/page-shell.tsx` (large title), `src/lib/tones.ts` (new). Also greps the 230 `bg|text-success|warning` uses and the 61
`text-primary` headings (headings -> `text-foreground` where the element is a page/section title). Verify: `npx tsc --noEmit -p .`,
build, shots of `/`, `/orders`, `/invoices` in 4 states (Taheri/Mina x light/dark; `npm run env:mina`).

### WP-B - Ledger kit (new files only)

Files: `src/components/ledger/{pill,monogram,money,stage-track,date-leaf,heading,section,chip,segmented,quick-actions,mine-tag,empty-state,search-field,swipe-row}.tsx`,
`src/components/ledger/index.ts`, `src/components/ui/swipe-to-delete.tsx` (becomes a thin wrapper over `swipe-row` so Hisaab/Expenses
keep working), `src/lib/utils.ts` (`settledRowClass`/`mineRowClass` notes; add `toneClass()`), tests `src/components/ledger/*.test.tsx`
(Pill tone, Monogram letters incl. walk-in, MoneySplit due/credit/nil, StageTrack steps).

### WP-C - App shell

Files: `src/components/layout/app-layout.tsx`, `src/components/layout/tab-bar.tsx` (new), `create-menu.tsx` (new; deletes
`new-bubble.tsx`), `map-sheet.tsx` (new), `src/lib/tab-bar.ts` (new), `src/lib/nav.test.ts` (add the `PRIMARY_TAB_IDS` assertion;
**no change to `nav.ts`**), `src/components/ui/sidebar.tsx` (row/label styling only), `src/components/voice/voice-bubble.tsx`
(position/cluster), `src/components/search/command-palette.tsx` (extract matcher), `src/components/rates/rate-chip.tsx` (no
logic), `src/lib/use-scrolled.ts` (title-visible helper), `src/components/shared/page-back.tsx`.

### WP-D - Orders and Home

Files: `src/app/orders/page.tsx`, `src/app/orders/[id]/page.tsx`, `src/components/order/next-step.tsx`,
`src/components/order/online-inbox.tsx` (badge), `src/components/shared/promise-line.tsx`, `src/app/page.tsx`
(`src/lib/dashboard*` untouched).

### WP-E - Invoices and Customers (and Repairs, same pattern)

Files: `src/app/invoices/page.tsx`, `src/app/invoices/[id]/page.tsx` (not `view-invoice`), `src/components/invoice/*` (list/row only),
`src/app/customers/page.tsx`, `src/app/customers/[id]/page.tsx`, `src/components/customer/*`, `src/app/repairs/page.tsx`.

### WP-F - Workshop and Settings (plus the rest by inheritance)

Files: `src/app/workshop/page.tsx`, `src/app/karigars/page.tsx`, `src/app/given/page.tsx`, `src/components/karigar/*`,
`src/app/settings/**/page.tsx`, `src/components/settings/*`; optionally (phase 2) `src/lib/nav.ts` + `apps/iphone/App/Resources/nav-*.json`
(**the only package allowed to touch `nav.ts`**, and only if the owner takes the phone Settings index). Money, Analytics, Ads,
Posts/Website (marketing pages) get a smoke pass here: check they read well with the new tokens, fix only what breaks.

Docs at the end (WP-A owner, last): update `docs/features/liquid-glass.md` (radii, tab bar), `docs/decisions.md#the-map`
(phone shell), `docs/decisions.md#dashboard` (layout), add a one-line index entry to `CLAUDE.md`; run `graphify update .`.

Ship per `CLAUDE.md`: all packages go to both houses together; there is no review gate on cloud-deploy, so land WP-A + B + C
before D-F, and check both houses' rollout (`gcloud builds list`).

---

## (f) Risks, decisions touched, things with no web equivalent

### Decisions in `docs/decisions.md` this changes

| Decision | Change |
|---|---|
| **The map** (2026-10-01/10-10) | On a phone the hamburger sheet + "menu . rate chip . search" bar is replaced by the tab bar + Search sheet + back chevron. The segmented tab row under the bar stays. Light/dark stays in the account block. Reopened by the owner's own request. |
| **Home's New** (2026-10-10) | A Home-only bubble becomes the create cluster on all four tab roots (New invoice, New order, New sale/other ways); gone on desktop (sidebar has it). |
| **Dashboard** | Content/figures unchanged; layout loses `lg:h-[100dvh]` no-scroll. Stat cards stay visible (not the app's collapsed "Shop overview"). |
| **Light and dark** | Mechanism untouched; **Taheri light accent changes navy -> gold** and light grounds go grey/cream: every light-mode screen and the `text-primary` headings change colour. |
| **Fonts** | No new file. Optional Newsreader load would follow the "download woff2 into `src/fonts/`" rule. |
| **Motion** | Unchanged (identical curves). Digit-roll animation not reproducible. |
| **Liquid Glass** (`features/liquid-glass.md`) | Still an option; its `--r-card` 1rem / `--r-control` 0.625rem raised to 22px / 12px; the bottom bar now exists in Standard too. |
| **Signed-in defaults** | "Lit in place": phone cards use the "You" tag instead of the tinted row + bar (the app already did this). Desktop rows keep the tint. |
| **Orders hub** | Default grouping is already Day on both; "Due" grouping exists only in the app (optional port). Invoiced = greyed stays (as secondary-colour name). |
| **Invoice pages** | `/view-invoice/<id>` (customer-facing) is deliberately **not** re-skinned. |
| **Customer copy / name ERP** | Unaffected; use the app's words ("Owed to you", "In the drawer", "hisaab"). |

### Risks

- **Gold headings in light.** `text-primary` on 61 pages becomes `#8A6B42`; titles move to `text-foreground`, but body-size accent text
  on the grey ground is 4.4:1. Rule in a.1; WP-A reviews each `text-primary` use.
- **Pale tones in light.** System orange/green/teal as 12px text fail 4.5:1 on white; the plan uses the `-ink` variants for text and the
  base for fills (a.2). The app itself uses the base colour on a 13% tint, so the web will be slightly darker/more legible than the app.
- **230 `success`/`warning` usages** change hue in light (navy-ish greens to system inks) - eyeball charts (`--chart-*`, `ui/chart.tsx`
  keep their own tokens, only `--chart-1` follows the new accent).
- **Mina light is a new neutral set**, not an override: test `brand-mina.theme-default` against every shared component.
- **Print/PDF and the label designer** read CSS tokens: check `print:` styles and `jspdf` canvases (they draw their own colours; the
  invoice PDF is server-drawn and untouched).
- **Phone sheets** for `Dialog` change ~17 dialogs' layout at once (`decisions.md#motion` "nothing vanishes"; the lingering hook must
  still work with bottom anchoring). Ship WP-A's dialog change behind `app-look` and test the payment, delete-code and piece-editor dialogs.
- **Tab bar vs bottom bars** (`glass-bar` totals on New sale/order, Hisaab's sticky search, designer bars): the hide-list in c.2 must be
  complete; a missed page shows two bars. Fixed bottom elements use `--tabbar-h`.
- **Keyboard/`visualViewport`** on iOS Safari for hiding the bar; test on a real phone (headless Chromium will not show it).
- **Swipe + horizontal scroll** conflicts (chip rows inside lists; `overflow-x-clip` on `<main>`): keep the existing 8px intent test.
- **Context menu:** Radix `@radix-ui/react-context-menu` is not installed. Use a long-press (500ms) that opens the existing
  `DropdownMenu` at the row; a real context menu would add a dependency (say so before adding).
- **Perf:** more cards and shadows removed is neutral; keep `.cv-list` on the new lists (`--cv-size` ~ 150px for an order card).
- **Two copies of the look** (SwiftUI and CSS) can drift: add a line to `apps/iphone/CONVENTIONS.md` rule 12 pointing at this file, and
  a vitest that parses `Assets.xcassets/{Accent,Ground,Card,OnAccent}-*.colorset` and asserts the CSS blocks hold the same hex
  (WP-A; the repo already tests the nav export the same way).

### In the app, no web equivalent (do not try)

Face ID / app lock and the delete-code Face ID vault; Apple's document scanner; the home-screen widget; haptics (`sensoryFeedback`);
push notification settings ("This phone"); `numericText` digit rolling; real Liquid Glass refraction and the tab bar's morphing
(CSS backdrop-filter only approximates it); SF Symbols (lucide stands in); `toolbarTitleMenu` (the segmented row replaces it);
pull-to-refresh (the web is live via Firestore listeners; do not intercept the browser gesture); Dynamic Type (the web follows the
browser's text size via `rem`; no per-app setting); `sidebarAdaptable`'s animated tab-bar-to-sidebar morph (static breakpoint
instead); the offline 512 MB copy (the web has its own cache); native speech (the web has `SpeechRecognition`).

### Web-only things the app does not show (kept)

Wide tables at `lg+`; Ctrl+K palette and `⌘B`; the sidebar's collapse-to-icons; designers (Post a piece, Ad studio, Edit a piece)
which the app itself opens as web pages; `/view-invoice` and `/links` (public, own dress).

### Open questions for the owner

1. Keep desktop tables at `lg+` (recommended) or card grids everywhere like the iPad app?
2. Phone Settings as an index list (phase 2) - yes/no?
3. Port "Due" grouping to the web Orders (app-only today)?
4. Adopt system white `0 0% 100%` for dark-mode text (matches the app), or keep each house's warm off-white?

### Answered (2026-10-12, decided in the owner's stead per their standing "do everything yourself")

1. **Tables stay at `lg+`** (desktop is where the counter does bulk work); below `lg` every list is the app's cards.
2. **Phone Settings is an index list** like the app (phase 2 of WP-F, which alone may touch `src/lib/nav.ts` and the app's `nav-*.json`).
3. **Port "Due" grouping** to web Orders (WP-D), same buckets and order as the app.
4. **Dark-mode text is system white `0 0% 100%`**, as the app.
