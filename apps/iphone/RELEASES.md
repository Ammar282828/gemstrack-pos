# Native builds asked for by hand

A line added here sends each house whose Firebase iOS app is registered (`houses.json`, `firebase.iosAppId`) to
TestFlight as version 2.0 (`.github/workflows/iphone-native.yml`), as "Run workflow" with *testflight* ticked does: a
cloud session cannot press that button, but it can push. One line per build, newest last.
- 2026-10-09: the first native 2.0 for both houses. Every screen is native (Home, Today's cash, Orders, New order, Invoices, New sale, Scan a tag, Customers, Repairs, Stock, Workshop, Expenses, Hisaab, Analytics), with everything else as the ERP's own page inside the app. Face ID lock, the widget and push.
- 2026-10-09: again, with the signing fix (Apple refused a `limit` on a bundle ID's capabilities).
- 2026-10-09: again, now that the TestFlight job installs XcodeGen before it archives.
