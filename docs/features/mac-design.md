# The Mac app, designed as a Mac app (2026-10-25)

Owner: "audit the ui and ux, design from scratch for mac" — after "i want it to operate as a classic native mac os
application" and "you see how the claude app is a native mac app, i want it to operate this fluidly". The audit (eight
inventories of every screen, 2026-10-25) found the Mac app was the iPhone app rearranged: places with their tabs hidden in
the title's dropdown, hub tables that could not act, a second "Overview" page per hub with the filters and figures, phone
cards on boards, hero figures, pushes where a Mac shows a record beside its list, sheets over sheets, chips as filters,
three different save models, ⌘N opening a chooser, Settings reachable three ways. This is the design that replaces it.
`apps/iphone/Mac/MAC-CONVENTIONS.md` holds the rules a screen follows; this file holds what each place is.

The iPhone is not touched by any of it: every Mac layout is `#if os(macOS)`, the logic (ERPCore, the writes, the shelves)
is the iPhone's.

## The ten rules

1. **Sidebar → list → inspector.** One window, three panes, as Mail, Finder and Xcode are: the sidebar picks a place or a
   saved list; the content is a sortable, multi-select table of its records; the inspector at the right shows the picked
   record and its quick actions. Picking never pushes a page. A record opens whole in **its own window** (double-click,
   Return, ⌘O). Back (⌘[) exists only where a page truly leads into another (a report's drill-down).
2. **Nothing hidden in the title.** Every tab of the ERP's map is a sidebar row (an entry's children, disclosed), and the
   Mac adds saved lists under the places people chase (Orders ▸ Late). The title is a title.
3. **An action is declared once** and appears in three places, always alike: the inspector's head (the two or three used
   most), the menu bar (every action, with its shortcut, in the record's own menu: Invoice, Order, Customer, Piece, Repair,
   Karigar), and the right-click menu. A place's toolbar holds its New and one Filter, never the picked record's actions
   (a record window's toolbar may hold four and a More menu). Never as a big button in the content. (`MacActions`, below.)
4. **Tables, not cards.** A collection is a `Table`: sortable columns, multi-select, a status dot and word, money
   right-aligned in monospaced digits. Boards (Orders by stage, Workshop by karigar) are compact rows in columns, selectable,
   and a row can be dragged where the move is a plain status change.
5. **Filters are the sidebar's saved lists and the toolbar.** No chips, no segmented "tab rows" in the content. A list's own
   filters are a toolbar pop-up; its search is the toolbar field, and ⌘F goes to it.
6. **Figures are a summary bar.** A list ends in a one-line bar ("214 invoices · PKR 32.4 lac billed · PKR 1.2 lac owed";
   with rows picked, the selection's sums). A report opens with a row of plain figures, not hero cards. No serif heroes.
7. **Forms are Mac forms.** Inspectors and Settings apply as you go. A document (a new sale, a new order, a new piece) has
   one Save, ⌘S, in a footer. A sheet is for a short modal task only (take a payment, change the discount, refund),
   about 440 pt wide, its first field focused, Return confirms, Esc cancels; never a sheet over a sheet (the delete code is
   a field of the confirming sheet, or Touch ID). A confirmation dialog is for what cannot be undone, never as a second
   ask after a sheet that already said the amount on its button ("Pay PKR 25,000").
8. **Keyboard first.** ⌘N new sale, ⇧⌘N new order, ⌥⌘N new repair, ⌃⌘N the place's own new (a customer, a piece, a karigar,
   an expense); ⌘K Quick Open; ⌘F the list's search; ⌘1–⌘9 the sidebar's places in its order; ⌥⌘I the inspector; Return
   opens; ⌘O opens in a window; ⌘E edit; ⌘↩ the record's next step; ⌘P print the selection; ⌘⌫ delete (asks); Space Quick
   Look (a piece's photo, an invoice's PDF); ⌘R refresh; ⌘[ ⌘] back and forward.
9. **The Mac's look.** System fonts and sizes, the window and list backgrounds, the sidebar's vibrancy, SF Symbols, the
   house's colour as the accent only, status in its tone (late red, owed orange, settled green, credit teal, working blue).
   Light and dark follow the Mac unless This Mac says otherwise.
10. **No gates.** It opens on the last business and the place it was left; Touch ID is the only thing between opening the
    app and the books; drafts wait in Drafts and never open themselves.

## The window

- **Sidebar** (250 pt): its first rows **New Sale ⌘N**, **New Order ⇧⌘N** and **Search ⌘K** (buttons, never
  selected), as the Claude app keeps New chat and Search at its sidebar's head; then the places; below the list, the
  day's **rate** ("21K 32,500", amber ⚠ "Rate not set today"; a click opens the rate sheet) and the business (its badge
  beside a pop-up: the businesses, then "Manage Businesses…"). Settings is the Settings window.
- **Toolbar** (unified): the sidebar toggle; **‹ ›** Back and Forward (⌘[ ⌘], every place and page the window visited);
  the place's title with a subtitle (its count); a view switch where a place has two views; one group of the place's
  New and one Filter menu at the trailing end; the search field; the inspector toggle above the inspector.
- **Content**: the list, board or report.
- **Inspector** (300 pt, ⌥⌘I, on by default for lists): the picked record — a plain header (name, number, status dot and
  word, the one figure that matters), a row of its main actions as bordered buttons, then its sections as a grouped form,
  edited in place where the field is simple.
- **Record windows**: an invoice, order, repair, customer, piece or karigar in a window of its own, the same view as the
  inspector at full size: a document header, its tables full width, its details at the right, its actions in the window's
  toolbar and the menu bar.
- **Document windows**: New sale, New order, New repair, a new piece, Add in bulk, the Label designer, a Design.

## The sidebar

```
Taheri ▾
Today
Sales
  Invoices                 n unpaid
    Unpaid · Today · This month
  Orders                   n online waiting (else n late)
    Online · Late · Due this week · Not started · With karigars · Ready to hand over · Awaiting payment
  Repairs                  n in the shop
    In the shop · Ready · Collected
  Customers
    Owe us · Recent
  Drafts                   n
Workshop & stock
  Workshop                 n late
    Board · Karigars · Given items
  Stock
    Pieces · Labels
  Calendar
Money                      (owners)
  Today's cash
  Expenses · Extra revenue · Hisaab · Overheads · Shareholders (Mina)
  Analytics
    Overview · Sales · Products · Customers · Categories
Marketing
  Posts      ▸ Queue · Design · Investments
  Website    ▸ Photos · Edit a piece · Photo weights · Visitors · Live · Interest
  Ads        ▸ Campaigns · Plan · New ad · Ad results · Setup
  Social     ▸ Insights · Posts · Audience
```

The sidebar is drawn from the ERP's map (nav.ts, `NavMap`), so a role sees what the web shows it; the Mac adds only the
saved lists (`MacLists`, keyed by entry id) and the badges. ⌘1–⌘9 follow this order. Children are disclosed, their state
kept per window.

## The menu bar

- **ERP**: About, Settings… ⌘,, Lock Now ⌃⌘L, Sign Out…, Services, Hide, Quit.
- **File**: New Sale ⌘N, New Order ⇧⌘N, New Repair ⌥⌘N, New ▸ (Customer, Piece, Karigar, Expense, Hisaab Entry, Repair,
  Order, Sale — the place's own carries ⌃⌘N), New Window ⌥⇧⌘N; Open ⌘O; Open Recent ▸ (the last ten records); Close ⌘W;
  Scan a Tag… ⇧⌘T; Import ▸ (Contacts…, Hisaab…, Taheri Software Book…, Shopify Orders…), Export ▸ (this list as CSV…,
  Backup…), Restore from Backup…; Print… ⌘P.
- **Edit**: the system's, plus Quick Open… ⌘K and Find ⌘F (the list's field).
- **View**: as Table / as Board (where both) ⌃⌘1 ⌃⌘2; Show Inspector ⌥⌘I; Show Sidebar ⌃⌘S; Sort By ▸; Refresh ⌘R; Full
  Screen.
- **Go**: Today ⇧⌘H; the places ⌘1–⌘9; Back ⌘[; Forward ⌘].
- **The record's menu** (titled for what is picked: Invoice, Order, Repair, Customer, Piece, Karigar, Expense): every
  action of that record with its shortcut, from `MacActions`.
- **Window**: the system's, plus Activity Log (owners), Today's Figures (the menu-bar extra as a window).
- **Help**: Keyboard Shortcuts, the ERP on the web.

## The places

### Today
One page, no cards. A team-note strip at the top when there is one (yellow, the pencil for owners). A row of five plain
figures, each a link to its list: Taken today (with a 7-day sparkline), Owed to you, On the bench, This month (± against
last month), Orders due. Then three columns of plain lists with section headers: **Needs you**, **Due to customers**,
**Recent sales** — selectable rows (the inspector shows the record), no chevrons, all rows shown (the columns scroll).
The rate is the sidebar's foot.

### Invoices
Table: Number, Customer, Date, Total, Paid, Owed, Status (dot: Paid · Owed · In credit · Refunded); Pieces, Taken by and
Source are the inspector's. Saved lists Unpaid, Today, This month; one Filter menu (Taken by and Source inline); summary
bar. Inspector: header
(customer, number, date, status, the due amount), actions (Take Payment, WhatsApp, PDF), Pieces (compact rows), Payments
(compact rows, give back credit), Details. Record window: the invoice document (header, pieces table, totals block,
payments table, details column). Menu **Invoice**: Take Payment… ⌥⌘P, Change Discount… ⇧⌘D, Send on WhatsApp ⇧⌘W, PDF
(Space Quick Looks it), Print ⌘P, Copy Payment Link, Edit ⌘E (opens the sale document on it), Change Rate…, Name the
Customer…, Give Back Credit…, Refund…, Delete… ⌘⌫.

### New sale (document window, ⌘N, straight to the sale — the chooser is the iPhone's)
Three regions. **Left, Stock** (collapsible like a sidebar): the scanner field (focused; Return adds the match, a scanner
types and presses Return), its table (Piece, Metal, Weight, Price, sortable), Scan a Tag…, New Item. **Centre, the Bill**:
the lines as a table with inline-editable price cells; double-click a line opens a popover editor (not a page sheet);
⌫ removes; under it the totals block (Subtotal, Discount, Exchange, Total, Paid, Balance). **Right, the sale's panel**
(320): Customer (a combo field with suggestions in a pop-up list, not rows in the form), Payment (amount, method pop-up,
Paid in Full; more rows with + and −), Discount (field and a Round ▾ menu), Exchange (rows with + −), then disclosed:
Rates, Delivery, For the shop. The footer: the balance or what blocks saving, and **Save Sale · PKR x** (⌘S; Return when
the scanner field is empty). Toolbar: Read a Written Bill…, Create Order from These Pieces, Start Over. Each window keeps
its own draft (two sales at once never share one).

### Orders
Two views, ⌃⌘1 / ⌃⌘2: **Table** — Number, Customer, Stage (dot and the stage's words), Promised (red when late),
Karigars, Total (the order's worth, not `grandTotal`, which is the balance), Owed (pieces and advances are the inspector's); **Board** — a column per stage
(Online, Not started, With karigars, Ready to hand over, Awaiting payment; Done and Cancelled folded), compact two-line
rows, selectable, a row dragged from With karigars to Ready marks it ready, and back. Saved lists as in the sidebar.
Inspector: header (customer, number, stage, promised leaf, owed), the next step as the default button, pieces (karigar
pop-up and a done tick per piece, inline), advances, details. Record window: the order document. Menu **Order**: Next Step
⌘↩, Take Advance… ⇧⌘A, Give Out…, Mark Ready, Make Invoice…, Print Slip ⌘P, Message the Customer…, Book Courier…, Track,
Edit ⌘E, Change Rate…, Status ▸, Cancel Order…, Refund…, Delete… ⌘⌫.

### New order (document window, ⇧⌘N)
Left column: the order (Customer combo, Phone, How they found us, Taken by, Promised: a date field with a menu of 7 / 10 /
14 days and No date, Urgent). Centre: the **Pieces** table (#, Piece, Metal, Weight, Size, Karigar, Price; + Add a Piece,
+ From Stock…, − Remove); picking a piece shows its editor in the right panel — no sheet. Right panel (320), switched by a
segmented control in its header: **Piece** (the piece editor) / **Order** (Rates, Payment: discount with Round ▾, advance,
method; Exchange; Delivery; Notes; our margin). Footer: Balance due and **Save Order** (⌘S). Toolbar: Read a Slip…, Start
Over. Edit order is the same window; closing with changes asks (Save, Don't Save, Cancel).

### Make invoice (from an order)
A document window, not a sheet: the rates, one row per piece with its final weight, wastage, making, stones (a table, the
figures inline-editable), discount with Round ▾, the invoice's totals; **Make Invoice · PKR x** in the footer, ⌘S — Return
never makes it. Making it turns the window into the invoice.

### Repairs
Table: Number, Piece, Customer, Status, Ready by, Owed, Karigar (the day it came in is the inspector's); saved lists In the shop, Ready, Collected; summary
bar with what is due. Inspector: the ticket (header, pieces, money, details) with Mark Ready / Collected as its default
button and Take Payment beside it. New repair: a document window (Customer, Pieces table, Ready by with a menu of 3 days /
1 week / 2 weeks, Advance, For the shop), Save. Menu **Repair**: Mark Ready, Collected…, Tell Them It's Ready, Take
Payment…, Print Receipt ⌘P, Edit ⌘E, Cancel…, Delete…. Collected with money owed asks once: "Take PKR x and hand back" /
"Hand back without it" / Cancel.

### Customers
Table: Name, Phone, City, Last sale, Spent, Owed, Came from (sizes are the inspector's); saved lists Owe us, Recent; summary bar (customers,
owed). Inspector: header (name, phone, owed), actions (Call, WhatsApp, Message, Hisaab), Contact (edited in place), Sizes
(in place), Recent invoices and orders (compact). Record window: header, a toolbar segmented control Invoices / Orders /
Repairs / Hisaab over one sortable table, the details column at the right edited in place. Merge Duplicates… and Clean Up
Spam… are menu items (Customer menu, and the toolbar's one Tidy Up menu). New customer: ⌃⌘N in Customers, a sheet (Name, Phone, Email,
Address, Came from) — small, so a sheet.

### Drafts
Table (Kind, For, What is in it, Pieces, Total, Last typed); Return or double-click continues it **in its own document
window**; ⌫ discards (asks). Sidebar badge: the count.

### Workshop
**Board** — a column per karigar (and Needs a karigar, Free), compact rows; drag a row onto a karigar's column to give it to
them, onto Done to mark it done. **Table** — Piece, Order, Customer, Karigar, Stage, Age, Weight, with the karigar a pop-up
cell and Done a checkbox cell. A filter pop-up (All work, Needs attention, Unassigned, To give) and Taken by. Inspector:
the job (making details edited in place, photo, instructions, Give / Mark done). Summary bar: active, late, metal out.
**Karigars**: table (Name, Pieces out, Late, Metal out, Holds of ours / We owe) + inspector (now, details, Pay…); record
window with Work / Payments as a toolbar segmented control. **Pay**: one sheet whose button says the amount; no second ask.
**Given items**: table + inspector, Record Item Given ⌃⌘N.

### Stock
Two views: **Table** (SKU, Name, Category, Metal, Weight, Price today, In since) and **Gallery** (photos, Finder's icon
view). A Category filter pop-up; summary bar (pieces, worth today). Inspector: the photo (drop a file to replace; Space
Quick Looks it), details (in place), the price at today's rates with its breakdown, actions Sell, Print Tag. New piece
(⌃⌘N): a document window, the photo droppable before saving. Add in bulk: a document window (the shared fields at the
left, the weights as an editable table). Print tags: ⌘P on the selection opens the print job sheet (Copies, Blank labels
first, Counter), Return prints. Menu **Piece**: Sell, Print Tag… ⌘P, Print Now ⌥⌘P, Edit ⌘E, Copy SKU, Show QR, Export
Tag CSV…, Delete… ⌘⌫. **Labels**: the designer, already a Mac three-pane editor; its Field / Label / Preview become the
inspector's header switch, not a content tab row.

### Calendar
Already Mac-shaped (a month grid and the day's list); stays, with ⌘← ⌘→ months and Today.

### Money
**Today's cash**: a report with a date picker (any day, not only today), a figures row (In the drawer, Money in, Paid out,
Exchange), then three tables (Came in, By how it was paid, Paid out), Print. **Expenses**: table (Date, What, Category,
Paid to, Amount), period and category pop-ups, summary bar, Add Expense ⌃⌘N as a sheet, edit in the inspector. **Extra
revenue**: the same shape. **Hisaab**: accounts table (Name, Who, Invoices owing, Metal, Balance) + inspector showing the
ledger; You Gave… ⇧⌘G / You Got… ⇧⌘R as sheets from the toolbar and the Hisaab menu; the ledger in its own window.
**Overheads** and **Shareholders** are already Mac-shaped (inline lines; partner panes with an inspector) and keep it.

### Analytics
A report: the period pop-up in the toolbar (This month, **Last month**, Last 30 days, This quarter, This year, Last year,
All time, Custom…) and **Compare with ▸** (the previous period, the same period last year, none). The figures row shows
each figure with its change against the comparison. Charts read out on hover. Every list is a sortable table (no "Show
top 10", no sort chips), every number visible (no disclosures hiding them). Export ▸ CSV, the monthly PDF.

### Marketing
The sidebar takes the analytics tabs to the places they are about: Website ▸ Visitors, Live, Interest; Ads ▸ Results;
a **Social** entry ▸ Insights, Posts, Audience. The legacy Studio shell and "Post a piece" composer are gone on the Mac
(their addresses open Design); the Board is a Design child.

**Design** — sidebar children **Saved** (the default: a gallery of designs, Finder's icon view, folders as the place's
own children, Return opens), **Photos** (a gallery with a source pop-up and a collection pop-up), **Board**. **New
Design…** (⌃⌘N in Design, and from any piece) asks in one sheet what it is (Story and post, Post, Story, WhatsApp, Website
photo, Ad, a size) and which photograph (the website, the library, a file — or dropped), then opens the **design
document window**, Keynote's shape:
- left, the pages (one per size; + adds a size; right-click Make the Master, Re-do from the Master, Remove);
- centre, the canvas, live: click selects a layer, ⇧-click and a marquee select several, handles resize, the knob rotates,
  double-click edits text in place, drag moves with guides, arrows nudge (⇧ by 10), ⌘-scroll and pinch zoom, ⌘0 fits;
- right, the inspector with icon tabs in its head: **Layer** (font, colour, size, position, effects of what is picked),
  **Words** (kicker, headline, specs, button, price, the ad's words), **Photo** (the photograph, more of the piece, crop),
  **AI** (each tool a row with a short line of what it does, run from its button), **Page** (layout, colours, background,
  safe zones);
- toolbar: Layout ▾, Add ▾ (text, shape, badge, logo, picture, link pill, QR), Sizes…, Safe Zones, Share ▾, **Publish…**;
- **Edit** menu: Undo/Redo, Cut/Copy/Paste, Duplicate ⌘D, Delete ⌫, Select All ⌘A; **Arrange** menu: Bring to Front ⇧⌘F,
  Bring Forward ⌥⇧⌘F, Send Backward ⌥⇧⌘B, Send to Back ⇧⌘B, Align ▸, Distribute ▸, Group ⌥⌘G, Ungroup ⌥⇧⌘G, Lock ⌘L;
- photos dropped from Finder land as the photograph (on the photo) or a picture layer (elsewhere); a page drags out to
  Finder as a PNG; File ▸ Export… saves every size.
The layer editor sheet is gone: editing is the window. **Publish…** is one sheet: the places as a checkbox list (Website
with its collection, each WhatsApp group, the channel, Instagram story, Instagram post, Meta ad), each with the page it
uses; Captions; **When** (Now / Hold in the Queue / Schedule at…); the button says what happens ("Publish to 4 Places")
and does it — no second ask.

**Posts** — sidebar children **Today** and **Queue**: a table (When, What, Where, Status) with the inspector (caption,
places, Send Now, Hold, Remove, Send at…); Spread Over the Day… and Send All Now are toolbar/menu items. **New Post…**
(the tray) is a document window: the photos as a strip (drop from Finder, drag to reorder), the places as checkboxes, the
caption (Write with AI), the weight on the photo; Send or Later in the footer. **Investments** (Taheri): the fortnight
as a table with the inspector for a day.

**Website** — **Pieces** (Edit a piece): a table/gallery (Name, Collection, Weight, Status: Hidden · Changed here · New
photo, On the site since), collection and status pop-ups, the inspector editing the name, description, details, weight
and Hide in place with **Save to the Website** (⌘S) in its foot; photo tools (Re-make, AI ▸, Crop and Design… opening a
design window) in the inspector's Photo tab; a photo dropped on the inspector replaces it. **Add Photos**: drop or choose,
a table of the photographs (thumbnail, house, official name, status), the collection pop-up in the toolbar, Send N to the
Website. **Photo Weights**: the focused tool it is, Previous/Next on ⌥⌘← ⌥⌘→. **Visitors / Interest**: a report like
Analytics — the period pop-up, the figures row, the chart, and the pieces as one sortable table (Saved, Asked on WhatsApp,
Looked longest, Opened) whose row selects the ERP's piece; Open on the Website is the right-click. **Live** stays.

**Ads** — **Campaigns**: an outline table (campaign ▸ ad set ▸ ad: Name, Running switch, Status, Budget, Spent, Results,
Each, ROAS, Reach), the range pop-up, Show pop-up (All, Running, Paused, Problems), the inspector for what is picked
(results figures with change, the preview, budget and end date edited in place with a "Change to PKR x a day" button,
Pause/Run, Duplicate, Archive, Delete; Meta's raw details behind a disclosure); multi-select Pause and Run. **Results**:
the report (figures row with change, the daily chart, Needs a Look as rows with Pause, the top ads and who/where/region as
tables). **New Ad…**: a document window — the source at the left (post, photos dropped, a piece, video, a design), the
form in the centre without step numbers (goal as a pop-up, words, who sees it inline with the estimate pinned at its
head, budget and dates), the live preview at the right; Create Ad ▾ (Paused / Live) in the footer, one confirm. Plan,
Audiences, Rules, A/B Tests: tables with the inspector, their New… as sheets from the toolbar. **Setup**: a checklist page.

**Social** — Insights (a report: figures row with change, charts with hover, Ads or Own Posts as a table), Posts (the
sortable table with every number the phone shows, a column chooser), Audience (charts and tables, Who as a pop-up).

### Settings (⌘,)
A Settings window with a toolbar of panes, as Mail's. Each pane is one grouped form at the window's width, applied as you
go (no Save buttons; text fields commit on Return or leaving the field):
- **General** (this Mac): Appearance (Follow the Mac / Light / Dark), Lock with Touch ID (and after how long), Notifications
  (Sales, Payments, Orders, Karigars; per business), Ask Which Business on Opening.
- **Shop** (owners): name, contact, address; the numbering; **Bank accounts** (the table, + −).
- **Alerts** (owners): the WhatsApp connection first (status, Check Again, Send a Test), recipients, what is sent, when,
  Send a Report Now ▸.
- **Labels & Printing**: Print with (Label LIVE / the Zebra), the Zebra (Browser Print / a printer / an address), media,
  quality, position and direction as number fields; Label LIVE's link and variables; Open the Label Designer….
- **Selling Online** (owners): the website's selling and pricing, Shopify's connection and order notices.
- **Connections** (owners): Meta (Ads › Setup), Connect an AI (the keys table), Voice.
- **Businesses**: the table, + −, Open.
- **Account**: signed in as, Sign Out….
Tools leave Settings for the File menu (Import ▸, Export ▸, Restore from Backup…, Recently Removed as a window from the
Window menu); the Activity log is a window (Window ▸ Activity Log).

## The kit (apps/iphone/Mac/Kit/)

- `MacActions` — an action declared once (title, symbol, shortcut, role, enabled, perform). A screen publishes its record's
  actions with `.macRecordActions(_:)`; the menu bar's record menu, the toolbar and the right-click menu read them.
- `MacSummaryBar` — the list's one-line bar.
- `MacStatus` — a dot and a word in a tone.
- `MacFigures` — a report's row of plain figures with optional change.
- `MacInspectorHeader`, `MacInspectorActions` — the inspector's head and its buttons.
- `MacDocumentHeader` — a record window's head.
- `MacLists` — the saved lists per sidebar entry, their filters and counts.
- `MacComboField` — a text field with a suggestion pop-up (customers, karigars).
- `MacRoundMenu` — the discount's Round ▾ menu (RoundOff's offers).
