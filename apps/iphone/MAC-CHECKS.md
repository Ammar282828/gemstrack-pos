# Mac checks

A line added here runs the Mac app's tests in Xcode Cloud (the "Mac check" workflow: scheme "ERP Mac", Test, macOS):
`MacTests/` (the Mac's own rules, in the demo) and `MacUITests/` (every place, Back and Forward, ⌘K, the counter's windows,
records in windows, the inspector, views, filters, Settings, the rate, the menus, light and dark; a screenshot per place).
Results show on the commit in GitHub ("Xcode Cloud" check: test failures and their messages) and in App Store Connect →
Xcode Cloud (the screenshots). One line per check, newest last.
- 2026-10-27: the first Mac check: the iPhone's look on the Mac, the tests' first run.
- 2026-10-27: with the review's fixes and their tests (two ⌘N windows, keys from a sale window and Settings, a list in a window, Forward after ⌘K, Print on the inbox, snapshots in the demo).
- 2026-10-27: the Mac check workflow's first run (set up by the owner): every unit and UI test.
- 2026-10-27: again, the test target given the CCUPS module path (the first run stopped at "Unable to resolve module dependency: 'CCUPS'"); the shared figure card and even grid, the opaque summary bar, inspectors on the ground.
- 2026-10-27: the unit tests import ERPCore (Money) and ask ScreenRegistry, not ScreenRoute, for a native page: the app and its new kit compiled, only the tests did not.
- 2026-10-27: the app could not launch on the test machine ("Launchd job spawn failed"): the Debug build now signs without push and keychain groups (ERPMac-Debug.entitlements); with the money and reports pages in one look.
- 2026-10-27: the first run that launched (25 failures): ⌘K's field takes the keys at once, Live's and Plan's icons, the last place reopened at launch, the tests read titles without their subtitles, pick a real row before Return, one metric per test; with every page's one-look fixes.
- 2026-10-27: 3 left, all the tests' own: the record test picks the place's list (not the sidebar's), the saved list's title read without its subtitle, switching places by ⌘2–⌘6 (a low sidebar row was scrolled out of a short window).
- 2026-10-27: Return and double-click open a picked row in Orders, Invoices, Customers, Repairs (their grouped lists' primary action fired for neither) and Return in Stock.
- 2026-10-27: Return opens the picked rows through AppKit (a List hands Return to neither its primary action nor onKeyPress); the record test finds the empty inspector by its value (a Mac's static text), so it picks a row, not a section heading.
