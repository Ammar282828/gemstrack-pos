# core: the iPhone app's rules, in Kotlin

`apps/android/core` is a plain Kotlin JVM library (no Android imports) that ports
`apps/iphone/Packages/ERPCore` — the ERP's models and money rules — so the two apps cannot disagree on
a rupee. All 368 XCTest cases are ported, with the same names (`src/test/kotlin/erp/core`, one file per
Swift test file). Rules 1-3 and 7 of `apps/iphone/CONVENTIONS.md` hold here as they do there:
one brain, lenient models, no real data, comments say why.

Run: `./gradlew :core:test` from `apps/android`.

## Where things went

| Swift (`ERPCore/Sources/ERPCore`) | Kotlin (`erp.core…`) |
|---|---|
| `Support/Lenient.swift` | `erp.core.Container` (`string double int bool list strings obj word stringMap`), `Word`, `Decodable` |
| `Support/DocJSON.swift`, `ERPDecode` | `erp.core.DocJSON`, `erp.core.ERPDecode`, `erp.core.Json` |
| `Support/ERPDate.swift` | `erp.core.ERPDate` (dates are `java.time.Instant`) |
| `Models/*.swift` | `erp.core.models` (`Enums.swift` is `Words.kt`; one `data class` per model) |
| `Logic/JSCompat.swift` | `erp.core.logic.JS` (internal) and `jsSorted` |
| `Logic/Money.swift` | `Money.kt` |
| `SaleValue`, `InvoiceCredit`, `RecentlyRemoved`, `Financials` | `logic/Sales.kt` |
| `OrderStage`, `OrderPayment`, `OrderTiming` | `logic/Orders.kt` |
| `CashIn`, `TodaysCash` | `logic/Cash.kt` |
| `Partnership`, `ShareholderFigures` | `logic/Partnership.kt` |
| `KarigarPay`, `KarigarPortal` | `logic/Karigar.kt` |
| `ActivityLogRules`, `WorkDrafts` | `logic/Drafts.kt` |
| every other `Logic/X.swift` | `logic/X.kt` (`RatesLogic`, `Pricing`, `Margin`, `Exchange`, `WalkIn`, `Owed`, `Materials`, `OrderFinalize`, `InvoiceActions`, `Overheads`, `ShopCalendar`, `CustomerSearch`) |

Swift names stay, in Kotlin style: functions and properties as they were (`invoiceSaleValue`, `owedToYou`,
`PricedPiece`). Swift enums with an `.unknown(raw)` case (`OrderStatus` …) are classes in `Words.kt`
with constants of the same names (`OrderStatus.inProgress`), `OrderStatus.of("raw")`, `OrderStatus.unknown("x")`
and `.rawValue`; two words are equal when they are the same list's and say the same text. Swift tuples
became small data classes (`KarachiDayPeriod`, `OrderWithTiming`, `ShopCalendar.YearMonth` …). A Swift
`Date` is an `Instant`; `Date()` is `Instant.now()`.

## Decoding a model

A document is a `Map<String, Any?>` of JSON-ish values (`String`, `Number`, `Boolean`, `List`, `Map`, `null`).
Nothing throws: a number stored as text, a list stored as a map keyed "0", "1", an unknown status kept,
a missing field is its default.

```kotlin
val order = DocJSON.decode<Order>(id, data)             // a Firestore document; its id wins
val orders = DocJSON.decodeList<Order>(serverDocs)      // /api/… lists: each carries its own id
val inv = Json.decode<Invoice>(jsonText)                // JSON text, same path (null unless an object)
val invs = Json.decodeList<Invoice>(jsonText)           // one odd element never empties the list
val c = ERPDecode.model<Customer>(map)                  // a map already JSON-safe; null if it is not
val s = Order.from(id, data)                            // the same as DocJSON.decode, without reified generics
val raw = Json.parse(text)                              // String/Long/Double/Boolean/List/Map/null
```

`DocJSON.plain(value, custom)` is the step that makes SDK values JSON-safe (a `custom` hook turns the
rest into text, null drops it). It knows `Instant`, `java.util.Date` (both become ISO text), `ByteArray`
(base64), non-finite numbers (dropped), and the Admin SDK's `{_seconds, _nanoseconds}` /
`{seconds, nanoseconds}` Timestamp map (ISO text).

## What the Android app must hand core

Dates stay ISO `String` in models. core never sees a Firestore `Timestamp`: the app turns SDK values into
plain ones first, exactly as `apps/iphone/App/Data/FirestoreSource.swift` `plainSDK` does:

- `Timestamp` → `ERPDate.iso(instant)`, i.e. `"2026-10-08T06:00:00.000Z"` (UTC, milliseconds, `Z`).
  (`DocJSON.plain` also does this for an `Instant` or `Date` it finds in the data.)
- `DocumentReference` → its `path` string; `GeoPoint` → `{"latitude": …, "longitude": …}`.

`ERPDate.parse` reads `yyyy-MM-ddTHH:mm:ss[.f…]` with `Z` or `±hh:mm` (seconds and a zone are required) and
a bare `yyyy-MM-dd` (its UTC midnight, as `new Date("yyyy-mm-dd")`). Karachi is UTC+5 all year and is the
"local" zone of every rule (`ERPDate.karachi`).

## Money must not diverge: where the port is exact on purpose

- `JS.round` (JS `Math.round`, halves up), `JS.number` (`String(n)`), `JS.toFixed` (exact binary value, tie up),
  `JS.parseFloat/parseInt/toNumber`, `JS.localeCompare` (ICU root order for ASCII), `JS.trim`, `jsSorted` (stable).
- Swift `.rounded()` (half away from zero) is `swiftRounded`; Kotlin's `Math.round` and `kotlin.math.round` are
  not used for it. `Money.fixed` is C's `%.nf` (exact value, tie to even): Java's `String.format` rounds the
  shortest digits half up (1.005 → "1.01"), which is wrong here.
- Doubles are added in the order the Swift adds them (`fold` left to right); no `fma`, no reordering.
- `Int` model fields (`lastInvoiceNumber`, `shopifyOrderNumber`, `bytes` …) are Kotlin 32-bit `Int` where Swift's
  is 64-bit; they saturate. No money is held in one.

## Places the Swift is hard to reproduce exactly

- `Support/ERPDate.swift:8-27`: Foundation's `ISO8601DateFormatter` strictness is the OS's; `ERPDate.parse` is a
  hand-written reader of the shapes the ERP writes.
- `Logic/CustomerSearch.swift:40,82,89`: `folding(.caseInsensitive, .diacriticInsensitive)`, `range(of:)` and
  `localizedCaseInsensitiveCompare` are approximated with NFD + dropping marks + lower case, and a
  `java.text.Collator` (secondary strength) for the tie break. ASCII and plain accents agree; ß-like case folds do not.
- `Logic/Money.swift:19`: `NumberFormatter` (ICU) prints a double's shortest digits and "-0" for negative zero;
  `Money.grouped` does the same.
- `Support/Lenient.swift:11,69`: `String(d)` for a non-integer number (`1e-05` below 1e-4) is `swiftDescription`.
  `Support/Lenient.swift:22`: Swift's `Double(String)` also reads "inf", "nan" and hex; `swiftDouble` does.
- `Logic/CashIn.swift:60`: the legacy-advance regex uses ICU's Unicode `\d`/`\S`; here `(?iU)`.
- `Logic/Partnership.swift:59,62`: Swift `max(0, nan)` is 0 and `min(…)` of a NaN differs from `maxOf/minOf`; the
  rules are only ever fed finite numbers.
- `Support/DocJSON.swift:53`: a server Timestamp's sub-millisecond digits are rounded to the microsecond and the ISO
  text cuts to milliseconds.
