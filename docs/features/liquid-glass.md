# Liquid Glass

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Liquid Glass

- **Liquid Glass is a choice** (2026-09-27, owner: "add liquid glass from apple to the pos, use apples exact design guides …
  this will be a dropdown option from the normal ui"): Settings → Appearance → **Interface style**, Standard (default) or Liquid
  Glass, the shop's (`settings.uiStyle`, cached per device as `gemstrack:ui-style` for the first paint, like the theme). It is one
  class, `ui-glass` on `<html>` (`applyUiStyleToDocument`, and the boot script in the head), and every rule lives under it at the end
  of `globals.css` — Standard is untouched. Built from Apple's HIG (Materials; Adopting Liquid Glass; Color; Layout), each rule
  quoted in the CSS: glass only on the navigation and control layer (sidebar, the top bar's controls and page tabs, mobile bottom
  bars, sheets, dialogs, menus, popovers, tooltips, toasts, the two floating buttons), never on content (cards, tables, forms stay
  opaque); the regular variant only (the clear one is for controls over photos — not used); sidebars more opaque; one tinted
  control, New Sale; the top bar is transparent with a **scroll edge effect** instead of a strip; windows inset from the edge with a
  1.75rem radius; section headers in title style; Reduce Transparency / Increase Contrast / no backdrop-filter get a solid
  version. Components carry inert hook classes (`glass`, `glass-window`, `glass-popover`, `glass-bar`, `glass-fab`, `glass-ctl`,
  `glass-toolbar`, `app-header`, `app-tabs`, `app-inset`; and on the content layer `btn`, `ui-field`, `card`, `alert`, `tabs-list`,
  `tabs-trigger`, `sidebar-search`); the material itself is the house's popover colour at low opacity over a fixed ambient glow of
  the house's primary, so both houses get their own glass.
  **The sweep of 2026-09-27** (owner: "assess and refine liquid glass in every page, every feature"): every route shot in headless
  Chromium at 1280 px dark and 390 px light with glass on, plus the sidebar sheet, command palette, select, dialog, alert, popovers,
  drawer, tooltip, the Ads helper and the designer. What it changed: **the content layer takes Apple's shapes without becoming
  glass** — buttons are capsules (44 px and taller, and buttons drawn as fields such as a picker's trigger, are 0.875rem rounded
  rectangles, as the system's large buttons are; a split button keeps its shared edge), fields 0.625rem, cards and alerts 1rem,
  in-page tabs a pill like the top bar's — so a 0.5rem card no longer sits beside a 1.75rem pane; light glass carries an outer
  hairline so it reads over a white page; the dark ambient glow is stronger so the pane has something behind it; windows (sheets,
  dialogs, alerts, the helper's panel) and popovers are more opaque than a control, and on a phone a dialog or alert is a rounded
  window inset from the edges instead of an edge-to-edge box (`glass-full` marks the two that fill the width: the command palette
  and the helper's panel); the sidebar's search is a field cut into the glass, its rows
  0.625rem, New Sale a capsule; the floating discs draw their symbol in the foreground colour (the Ads helper's was white on white
  glass). Every page with chrome of its own is on the hooks: Hisaab's sticky search and the contact import's bar are floating
  toolbars, the karigar's My work header a scroll edge, Edit a piece's save foot glass, the customer and SKU autocomplete lists
  popovers, the designer's long-press menu a sheet over a dimmed page. The designer's own bars stay standard: they sit beside the
  canvas, not over it, so there is nothing for glass to show. Not on a real phone.
  **The pane floats** (2026-09-28, owner: "there shouldn't be a cut at all … the sidebar should be floating", then "cut comes back
  … when scrolling down"): on a computer the pane sits above the top bar (z 45, between the bar's 40 and the windows' 50), and
  the bar's scroll edge runs under it across the whole window (`inset … -100vw`) and appears only once the page scrolls
  (`data-scrolled` from `useScrolled`) — starting at the pane's edge, or drawn always, its tint made a vertical step at the
  pane. The pane has no drawn outline: a soft shadow and a specular edge (`::after`, a masked gradient ring bright at the top
  left, fading down the side). Bottom bars (`.glass-bar`) start after the pane on a computer, open or folded.
