# Mac builds

A line added here on a `claude/` branch starts Xcode Cloud's "Mac release" workflow (docs/features/mac-app.md): the Mac
app archived for TestFlight's "Shop" group, and the iPhone app built beside it as a check. The "Mac build" GitHub workflow
(`.github/workflows/mac-status.yml`) prints the run's result and every compile error. One line per build, newest last.
- 2026-10-24: the first Mac build. Every iPhone screen in a Mac window (sidebar from the ERP's map, a window per place, the menu bar's shortcuts, Settings, today's figures in the menu bar), Label LIVE printing native.
- 2026-10-24: again, with every folder converted for the Mac (web views, PDFs, scanners as files and a USB scanner field, voice, keychain) and Print with Label LIVE on a piece's tag.
- 2026-10-24: round 2: windows by Codable route, the iPad pointer's highlight and iOS-only list and search details behind platform modifiers, launch diagnostics and the tab bar iPhone-only.
