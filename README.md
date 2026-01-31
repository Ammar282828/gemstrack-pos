# MINA / GemsTrack POS

A comprehensive Point of Sale (POS) and Inventory Management System designed for jewelry businesses. This application handles products, customers, orders, expenses, and invoicing with specialized features for gold/metal calculations.

## Live Application

**URL:** https://studio--hom-pos-52710474-ceeea.us-central1.hosted.app

## Features

- **Inventory Management:** Track products with detailed attributes (metal type, karat, weight, stones, diamonds).
- **Point of Sale:** Create invoices, manage carts, and calculate prices based on daily gold rates.
- **Order Management:** Track custom orders, generate estimates, and manage workflows with Karigars.
- **Customer CRM:** Manage customer profiles and history.
- **Hisaab (Ledger):** Track payments, credits, and debits.
- **Analytics:** View sales trends and business performance.
- **Printing:** Integrated support for Zebra label printers.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + Shadcn UI
- **Backend/Database:** Firebase (Firestore, Auth, Storage)
- **Deployment:** Firebase App Hosting

## Getting Started

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Run the development server:**
    ```bash
    npm run dev
    ```

3.  **Build for production:**
    ```bash
    npm run build
    ```

## Deployment

This project is configured for **Firebase App Hosting**.

To deploy the latest version:

```bash
firebase deploy
```
