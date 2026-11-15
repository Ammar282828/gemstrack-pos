# Design audit, 2026-11-15

Owner, 2026-11-15: "use this design skill and perform a comprehensive audit" — the apple-design skill
(github.com/dickwu/apple-design-skill: Apple's Human Interface Guidelines as Markdown, five lenses: accessibility,
platform conventions, visual craft, interaction, writing). A code audit: four reviewers read the iPhone/iPad app, the
Mac app, the web ERP and the Android app; every contrast figure was computed (WCAG) from the real token values
(asset catalogues, `globals.css`, the Android theme), not estimated. Nothing was run on a device.

Ratings: **iPhone/iPad** Critical issues · **Mac** Needs work · **Web** Needs work · **Android** Good.
Thesis everywhere: a warm paper ledger where money is the subject (date leaf, stage track, perforated bill, one hero
figure). Not a template; keep it.

## Critical (fixed 2026-11-15)

| Where | Finding | Fix |
|---|---|---|
| iPhone, Mac | Status colours drawn as text fail in light mode: orange 2.31:1, green 2.22, teal 2.16 on white; ~2.0 in a pill. The "Due" figure, the hisaab balance (216 call sites) | `Tone.ink` colorsets with light, dark and high-contrast values (owed #9A4D00, settled #1B6E30, credit #00646E, late #B0151C, working #0062CC: 5.8–7.1:1); fills keep the system colours |
| iPhone, Mac | Nothing answers Increase Contrast; Taheri's gold #8A6B42 is 4.03:1 on its ground | high-contrast appearances on Accent, Ground, Card, OnAccent |
| Web | Light-mode tone pills 3.3–4.2:1 | darker `-ink` tokens (4.5+ on the pill wash over card and ground); a contrast test that parses `globals.css` |
| Web | White text on swipe squares 2.2–3.6:1 | black text on coloured fills (≈9:1), as Android's `onFill` |
| Web | Dark `--destructive` 3.60 (Taheri), 3.34 (Mina) on a card | `4 80% 60%` / `6 78% 62%` |
| Web | Checkboxes 16 px on touch | a 44 px hit area on coarse pointers, same look |
| Android | Calendar: 9 sp text, dots that differ only by colour | 11 sp, a glyph per count |

## High and Medium: fixed

- Web: focus ring 1.72:1 → full-strength ring; glass-card fill raised to what its comment promised (0.62/0.58);
  Mina's dark mode showed Taheri's gold as the house tone (tokens resolved on `<html>`); 9–10 px text on everyday
  screens → 11; nine icon buttons named; calendar dots carry a glyph; charts get an accessible description and one
  y-axis; error toasts say what failed; sentence case; money fields use `AmountInput`.
- iPhone: Bold Text reaches Inter; the contact row and hisaab rows survive the largest text sizes; 44 pt controls on
  the money path; `Ink2` for secondary money figures (was 3.18:1); Undo stays while VoiceOver runs; glass capsules no
  longer slide; form fields keep their label (were "Optional" only); iPad tab bar of five with the rest in sections the
  owner can customise; unsaved sheets don't swipe away; "Void order" instead of a second "Cancel"; a search button on
  Orders, Invoices, Customers; the open row highlighted in the iPad split; quiet (provisional) notifications at sign-in;
  Siri phrases do what they say; plain-word errors and permission sentences; the last tab restored.
- Mac: no standard shortcut repurposed (⇧⌘W, ⇧⌘A, ⌘E, ⌥⌘P reserved; Control-key shortcuts dropped); toolbar commands in
  the menu bar; "Today's Rates…" in the menus, not only the sidebar foot; context menus without shortcuts or dimmed
  items, three groups and More; no app-level appearance switch; state-aware Show/Hide Inspector; the menu bar extra
  can be removed; "this Mac" and "Click" instead of phone words.

## Open (deliberately not done without a compiler and a device)

- Layout by device idiom instead of size class (`App/UI/Kit.swift:310`, 32 call sites): blocks iPhone Duo's inner
  display and wide iPhone windows. Do it with a build and Xcode's Device Hub.
- New sale / New order as a sheet with its own stack and child sheets (`RootView.swift:271-285`): move to full-screen
  covers and pushed questions.
- Settings window reworked to ~5 panes for this Mac; Save out of the bottom bar into the toolbar. (Undo in the Edit
  menu on the Mac was done the same day: `MacUndo`, docs/features/mac-app.md, "Edit menu".) The Mac's own deeper pass
  (glass, lists, cards, interaction): [Mac design review](features/mac-design-audit.md).
- Check on a device: Bold Text with Inter, the contact row at AX5, text on glass cards, round-off chip height.
