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
