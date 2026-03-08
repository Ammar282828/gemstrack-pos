# GemsTrack POS — Full User Tutorial

## Table of Contents
1. [Logging In](#1-logging-in)
2. [Home Dashboard](#2-home-dashboard)
3. [Products](#3-products)
4. [Customers](#4-customers)
5. [Karigars](#5-karigars)
6. [Scan / POS](#6-scan--pos)
7. [Cart / Estimate](#7-cart--estimate)
8. [Orders](#8-orders)
9. [Quotation Generator](#9-quotation-generator)
10. [Hisaab / Ledger](#10-hisaab--ledger)
11. [Documents (Invoices)](#11-documents-invoices)
12. [Calendar](#12-calendar)
13. [Expenses](#13-expenses)
14. [Extra Revenue](#14-extra-revenue)
15. [Given Items](#15-given-items)
16. [Analytics](#16-analytics)
17. [Activity Log](#17-activity-log)
18. [Settings](#18-settings)

---

## 1. Logging In

GemsTrack uses **Google Sign-In**. Only pre-approved email addresses can access the system.

1. Open the app URL in any browser.
2. Click **Sign in with Google**.
3. Choose your authorised Google account.
4. You will be redirected to the Home dashboard on success.

If you see an "Unauthorized" screen, your email is not on the allowlist — contact the admin.

---

## 2. Home Dashboard

The home page gives a quick snapshot of the business:

| Card | What it shows |
|---|---|
| Today's Revenue | Total from invoices & orders created today |
| Pending Orders | Orders with status "Pending" or "In Progress" |
| Active Customers | Total customers in the system |
| Total Products | Total products in the catalogue |

The sidebar on the left lets you navigate to every section. On mobile, tap the menu icon (top-left) to open it.

---

## 3. Products

**Path:** Sidebar → Products (`/products`)

### Viewing Products
- Products display in a **grid** (cards) by default. Toggle to **list view** using the layout buttons (top-right of the product list).
- Each card shows: product image, name, SKU, metal type badge (gold/silver/platinum/palladium), category, and calculated price.
- Use the **search bar** to filter by name or SKU.
- Use the **category buttons** to filter by category. Each button shows how many products are in that category.

### Adding a Product
1. Click **+ Add Product**.
2. Fill in:
   - **Name** — product display name
   - **SKU** — unique stock-keeping unit code
   - **Category** — select from existing categories
   - **Metal Type** — Gold / Silver / Platinum / Palladium
   - **Weight (grams)** — net weight of the item
   - **Making Charges** — labour cost (flat PKR or per-gram)
   - **Image** — upload a photo (optional but recommended)
3. Click **Save**. Price is auto-calculated from live gold/silver rates in Settings.

### Bulk Add
Use **Bulk Add** (`/products/bulk-add`) to add multiple products at once via a CSV-style form.

### Editing / Deleting
- Click the **pencil icon** on any card (grid view) or row (list view) to edit.
- Click the **trash icon** to delete. Confirm in the popup.

---

## 4. Customers

**Path:** Sidebar → Customers (`/customers`)

### Viewing Customers
- Toggle between **card** and **table** view.
- Search by name, phone, or email.

### Adding a Customer
1. Click **+ Add Customer**.
2. Fill in: Name, Phone, Email (optional), Address (optional).
3. **Save**.

### Customer Detail Page
Click **View** on any customer to see:
- Their full contact info
- All invoices linked to them
- Outstanding balance

### Ledger (Hisaab)
Click **Ledger** on any customer card to open their personal Hisaab account — see [Section 10](#10-hisaab--ledger).

---

## 5. Karigars

**Path:** Sidebar → Karigars (`/karigars`)

Karigars are craftsmen/suppliers you work with.

### Adding a Karigar
1. Click **+ Add Karigar**.
2. Fill in: Name, Phone, Specialty (optional), Address (optional).
3. **Save**.

### Karigar Detail
Click **View** to see:
- Contact details
- All karigar batches (work assigned to them)
- Their Hisaab ledger

### Karigar Ledger
Click **Ledger** to open their Hisaab — track amounts owed to / by them.

---

## 6. Scan / POS

**Path:** Sidebar → Scan / POS (`/scan`)

Use this to quickly look up a product by scanning its **QR code** or **barcode**.

1. Allow camera access when prompted.
2. Point the camera at the product's QR/barcode label.
3. The product details will appear: name, price, weight, stock status.
4. Click **Add to Cart** to add it to the current cart session.

You can also type a SKU manually in the search box if scanning isn't available.

---

## 7. Cart / Estimate

**Path:** Sidebar → Cart / Estimate (`/cart`)

The cart is a quick price estimator and starting point for an order.

### Building an Estimate
1. Search for products by name or SKU using the search bar at the top.
2. Click **+ Add** next to any product to add it to the cart.
3. Adjust **quantity** using the +/− buttons on each cart item.
4. The cart shows per-item price and running **total**.

### Discounts
- Apply a percentage or flat discount to the total.

### Converting to an Order
- Click **Place Order** to convert the cart into a full order (goes to the Orders page).
- Click **Print Estimate** to print/save a non-binding quotation.

---

## 8. Orders

**Path:** Sidebar → Orders (`/orders`)

Orders are the core of the business — each order tracks items, customer, payment, and status.

### Order Statuses
| Status | Meaning |
|---|---|
| Pending | Received but not started |
| In Progress | Being worked on |
| Completed | Ready / delivered |
| Cancelled | Cancelled, no charge |
| Refunded | Money returned to customer |

### Adding an Order
1. Click **+ New Order**.
2. Fill in:
   - **Customer** — search and select (or type a name for walk-in)
   - **Order Items** — add products with quantity and price
   - **Advance Payment** — any upfront payment received
   - **Due Date** — when the order is expected
   - **Notes** — any special instructions
3. **Save Order**.

### Managing Orders
- **Filter** by status, payment status, or search by customer/order number.
- Click any order row to view full details.
- From the detail page:
  - **Update Status** — change from Pending → In Progress → Completed
  - **Add Payment** — record additional payments (cash, card, etc.)
  - **Generate Invoice** — convert completed order into a formal invoice
  - **Refund** — mark as refunded and reverse the transaction
  - **WhatsApp** — send order summary to customer via WhatsApp

### Payment Status
- **Unpaid** — no advance received
- **Partial** — advance received but balance remaining
- **Paid** — fully settled

---

## 9. Quotation Generator

**Path:** Sidebar → Quotation Gen (`/quotations`)

Generate a formal quotation PDF without creating an order.

1. Add customer name (or type any name).
2. Add line items with descriptions and prices.
3. Apply discount if needed.
4. Click **Download PDF** or **Print**.

Quotations do not affect inventory or financials.

---

## 10. Hisaab / Ledger

**Path:** Sidebar → Hisaab / Ledger (`/hisaab`)

Hisaab is the financial ledger — track credit/debit with each customer and karigar.

### Opening a Ledger
1. Click **+ Open Ledger** and search for a customer or karigar.
2. Or click **Ledger** directly from the Customer or Karigar page.

### Ledger Entries
Each entry records:
- **Date**
- **Description** — what the transaction was for
- **Debit / Credit** — direction of money
- **Cash or Gold** — specify which commodity

### Summary Cards
At the top of each ledger you see:
- **Cash Balance** — net cash owed/receivable
- **Gold Balance** — net gold weight owed/receivable

### Exporting
Click **Export PDF** to download the full ledger as a printable PDF.

---

## 11. Documents (Invoices)

**Path:** Sidebar → Documents (`/documents`)

All generated invoices are listed here.

### Viewing Invoices
- Search by invoice number, customer name, or date.
- Filter by payment status (Paid / Partial / Unpaid).
- Click any row to open the invoice detail.

### From the Invoice Detail
- **Record Payment** — add a payment against the outstanding balance. Specify amount and method (cash / card / bank transfer / cheque).
- **Print / Download PDF** — generate a formatted invoice PDF.
- **Share via WhatsApp** — send invoice link to the customer.
- **View Invoice** — open the customer-facing invoice view at `/view-invoice/[id]`.

### Outstanding Balance
The amber **Outstanding Balance** card at the top shows the total unpaid amount across all invoices.

---

## 12. Calendar

**Path:** Sidebar → Calendar (`/calendar`)

A monthly calendar view showing all orders with their due dates.

- Navigate months using the **← →** arrows.
- Each date with due orders shows a dot/count.
- Click a date to see all orders due that day.
- Click an order to go to its detail page.

Useful for planning workload and spotting overdue orders at a glance.

---

## 13. Expenses

**Path:** Sidebar → Expenses (`/expenses`)

Track all business outgoings.

### Adding an Expense
1. Click **+ Add Expense**.
2. Fill in:
   - **Date**
   - **Category** — e.g. Rent, Utilities, Materials, Salaries
   - **Description** — short note about what the expense was
   - **Amount** (PKR)
   - **Payment Method**
3. **Save**.

### Viewing Expenses
- Filter by date range or category.
- Table shows date, category, description, and amount.
- Click **Edit** or **Delete** on any row.

Expenses feed into the Analytics profit/loss calculations.

---

## 14. Extra Revenue

**Path:** Sidebar → Extra Revenue (`/additional-revenue`)

Record income that doesn't come from product orders — e.g. repair fees, consultation charges, rental income.

### Adding Revenue
1. Click **+ Add Revenue**.
2. Fill in: Date, Category, Description, Amount.
3. **Save**.

This revenue appears in Analytics alongside order revenue for a complete P&L picture.

---

## 15. Given Items

**Path:** Sidebar → Given Items (`/given`)

Track physical items you've **given out** that need to come back — samples sent to customers, jewellery left with a karigar for repair, etc.

### Adding a Given Item
1. Click **+ Record Given Item**.
2. Fill in:
   - **Date** — when you gave it out
   - **Description** — what the item is (e.g. "Gold bracelet sample", "Ring for resize")
   - **Given To** — select Karigar, Customer, or Other
   - **Name** — type the person's name (autocomplete from your contacts)
   - **Notes** — any extra details
3. **Save**. Status is set to **Out** automatically.

### Marking as Returned
When the item comes back:
- Click **Got Back** on the item row.
- Status changes to **Returned** and today's date is recorded.

### Summary Cards
- **Still Out** (amber) — items not yet returned
- **Returned** (green) — items back in hand
- **Total** — all recorded items

### Filtering
Use the search bar to find items by description or recipient name. Use the **All / Still Out / Returned** buttons to filter by status.

---

## 16. Analytics

**Path:** Sidebar → Analytics (`/analytics`)

A full business performance dashboard.

### Date Filters
- Quick select buttons: Today, Last 7 Days, Last 30 Days, This Month, This Year
- Or pick a custom **date range** using the date picker.

### Key Metric Cards
| Card | What it shows |
|---|---|
| Total Revenue | Sum of all invoices + orders in the period |
| Total Orders | Number of orders placed |
| Items Sold | Total units sold |
| Avg. Order Value | Revenue ÷ orders |
| Expenses | Total outgoings |
| Net Profit | Revenue minus expenses |
| Outstanding Balance | Unpaid invoice amounts (shown in amber if > 0) |

### Charts
- **Sales Over Time** — bar chart of daily revenue and order count. Click any bar to see a detailed daily breakdown.
- **Top Products** — which products sell most by quantity and revenue.
- **Sales by Category** — revenue split across jewellery categories.
- **Top Customers** — highest-spending customers in the period.
- **Expenses by Category** — breakdown of where money is being spent.

### Yearly Performance Table
Scroll down to see a year-by-year summary table: Revenue, Expenses, Net Profit, and Outstanding Unpaid amounts.

---

## 17. Activity Log

**Path:** Sidebar → Activity Log (`/activity-log`)

A full audit trail of every action taken in the system.

- Every create, update, delete, and payment is logged with a timestamp and description.
- Filter by **date range** or **event type** (product, order, invoice, expense, given items, etc.).
- Useful for tracking who changed what and when.
- Some events (e.g. invoice.create, order.create, expense.create) show a **Revert** button to undo the action.

---

## 18. Settings

**Path:** Sidebar → Settings (`/settings`)

### General Settings
- **Shop Name** — appears on invoices and PDFs
- **Shop Address / Phone** — contact info on documents
- **Gold Rate (PKR/gram)** — live rate used to auto-price gold products
- **Silver Rate (PKR/gram)** — live rate for silver products
- **Default Making Charges** — fallback labour rate

Update rates daily (or whenever market rates change) so product prices stay accurate.

### Payment Methods (`/settings/payment-methods`)
Configure which payment methods appear when recording payments:
- Add custom methods (e.g. "JazzCash", "Bank Transfer – HBL")
- Reorder or delete methods

### Backups (`/settings/backups`)
- **Export** all data to a JSON backup file.
- **Import** from a previous backup to restore data.
- Run backups regularly before making bulk changes.

### Printer (`/settings/printer`)
Configure Zebra label printer settings for printing product QR/barcode labels.

### Contact Import (`/settings/contact-import`)
Import customers in bulk from a CSV or vCard file (e.g. exported from your phone contacts).

### Hisaab Import (`/settings/hisaab-import`)
Bulk-import historical Hisaab entries from a CSV file.

---

## Quick Reference — Common Workflows

### Daily Opening
1. Check **Home** for today's pending orders.
2. Update **Gold/Silver rates** in Settings.
3. Review **Calendar** for items due today.

### Selling an Item (Walk-in)
1. **Scan** the product QR or add it via **Cart**.
2. Select the customer (or add new).
3. Place Order → mark Completed → Generate Invoice.
4. Record payment on the Invoice page.

### Custom Order (Manufacture)
1. **+ New Order** → fill items, customer, advance payment, due date.
2. Status: **Pending** → update to **In Progress** when work starts → **Completed** when ready.
3. Call customer, record remaining payment, **Generate Invoice**.

### End of Day
1. Check **Analytics → Today** to review day's revenue.
2. Look at **Outstanding Balance** card — follow up on partial/unpaid invoices.
3. Log any **Expenses** incurred during the day.
4. Check **Given Items → Still Out** — any overdue returns?

### Monthly Reporting
1. Open **Analytics** → set range to current month.
2. Review Revenue, Expenses, Net Profit cards.
3. Check **Top Products** and **Top Customers**.
4. **Export** a Backup from Settings for archiving.
