/**
 * The house's own settings the native app follows, as /api/app/me (the signed-in `shop` block) and
 * /api/app/business (the public one) both send them: one function so the two routes agree.
 * Nothing here is secret; the web ships every one to every browser.
 */
import {
  STORE_PARTNERSHIP, STORE_WEBSITE_SELLING, STORE_INVOICE_BY_CUSTOMER,
  STORE_SIZE_TO_PROFILE, STORE_WORKSHOP_START,
} from '@/lib/store-config';
import { whatsAppProvider } from '@/lib/whatsapp';

export const shopFlags = () => ({
  partnership: STORE_PARTNERSHIP,
  websiteSelling: STORE_WEBSITE_SELLING,
  invoiceByCustomer: STORE_INVOICE_BY_CUSTOMER,
  // Invoices and orders go to the customer as a PDF from this house's own WhatsApp line wherever one is
  // connected (both houses since 2026-11-02, lib/customer-doc.ts); without one the apps send a link from the phone.
  invoiceWhatsappPdf: whatsAppProvider() !== null,
  sizeToProfile: STORE_SIZE_TO_PROFILE,
  workshopStart: STORE_WORKSHOP_START,
});
