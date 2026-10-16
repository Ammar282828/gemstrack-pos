/**
 * The house's own settings the native app follows, as /api/app/me (the signed-in `shop` block) and
 * /api/app/business (the public one) both send them: one function so the two routes agree.
 * Nothing here is secret; the web ships every one to every browser.
 */
import {
  STORE_PARTNERSHIP, STORE_WEBSITE_SELLING, STORE_INVOICE_BY_CUSTOMER, STORE_INVOICE_WHATSAPP_PDF,
  STORE_SIZE_TO_PROFILE, STORE_WORKSHOP_START,
} from '@/lib/store-config';

export const shopFlags = () => ({
  partnership: STORE_PARTNERSHIP,
  websiteSelling: STORE_WEBSITE_SELLING,
  invoiceByCustomer: STORE_INVOICE_BY_CUSTOMER,
  invoiceWhatsappPdf: STORE_INVOICE_WHATSAPP_PDF,
  sizeToProfile: STORE_SIZE_TO_PROFILE,
  workshopStart: STORE_WORKSHOP_START,
});
