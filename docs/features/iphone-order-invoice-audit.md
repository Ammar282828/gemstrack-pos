# Order and invoice form audit — 10 October 2026

Compared the native NewOrder and SaleForm screens, their piece editors and wire payloads with `order-form.tsx`, `sale-page.tsx`, `edit-cart-item-dialog.tsx` and the shared server writes. This audit covers create/edit forms; it does not certify every ERP screen as native.

| Area | Native coverage checked |
| --- | --- |
| Customer | Existing/recent customer, typed name/phone, walk-in, source, profile sizes |
| Pieces | Stock selection, custom piece, multiple pieces, quantity, description, category, metal/karat, weight, stones/diamonds, wastage, making charges, fixed price |
| Figures | Shop rates, rate overrides, hide rates, discount, exchanges, advance/payment method and reference, totals and margin |
| Fulfilment | Taken by, notes, promised date, delivery address/history, city, contact, charge and notes |
| Work in progress | Draft restoration, scan entry, create and edit save paths |
| Order workshop | Karigar, sample given, completion, sample photo preservation/replacement/removal |

Restored missing controls and handoffs:

- Order editing now exposes the ERP's “Piece is finished” toggle and initializes it from the saved piece.
- Existing order sample photos remain visible and can be explicitly removed or replaced. Removing a photo sends explicit nulls; unrelated workshop handover facts remain on file.
- A stock product created from the invoice form is added to that invoice, including when editing an invoice. The saved-product page retains the existing ERP photo editor and the ability to add another piece.
- Saving an edited order also offers changed sizes to the existing customer's profile, using the same optional size sheet and server operation as new orders.

The stock photo uploader remains the ERP page inside the app. It is reachable from the saved product page; this flow has not been converted to a native uploader. Writes continue through existing ERP operations. No pricing, discount, exchange or payment rules were changed.

Floating mic and create controls are limited to root tab pages, shrink from 52 to 44 points after scrolling and expand at the top. Both retain at least 44-point targets. There is no bottom bar. Transaction forms and pushed screens do not inherit these controls. Root pages retain bottom clearance for the final content.

Validation: 1,477 ERP tests, 368 ERPCore tests, TypeScript checking, native ContractCases edit assertions, generated contract payload equality with the previous fixtures, and an iPhone 18 Pro Max simulator build. Simulator screenshots confirmed the floating controls shrink on scroll and are absent on the order entry stack. Signed builds and uploads are recorded in the release logs outside the repository.

## Build 1004 follow-up

- Order cards group customer and owed amount at the top, followed by the piece summary, a separated status/due-date row, then the existing action. Order number, ownership/online badges, progress counts and all menu/swipe actions remain available. Typography uses the existing system text sizes and house colors.
- Firestore listeners now include metadata changes. A cached first snapshot can therefore transition to a server-confirmed snapshot even when no document fields change. The former behavior could leave every shelf marked as cached indefinitely.
- The offline banner now additionally requires an unsatisfied network path from `NWPathMonitor`. Cache provenance alone never declares the phone offline. Permission and read errors remain visible when connected. Airplane-mode/network-loss behavior is not claimed as physically tested; simulator compilation and source-path review cover this follow-up.
