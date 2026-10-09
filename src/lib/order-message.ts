/**
 * The order page's "Send to customer" message (src/app/orders/[id]/page.tsx handleSendWhatsApp): the words
 * written into WhatsApp on the device, for a person to press send. Nothing goes from the shop's line and
 * nothing is recorded; it is the device's own WhatsApp, opened at the customer's chat (lib/whatsapp.ts
 * `whatsAppLink`).
 *
 * One copy of the words, so the iPhone app's sheet (apps/iphone OrderActionsLogic `customerMessage`, ported
 * line for line with these tests) says what the web says. The page reaches only the summary since the
 * status updates stopped opening the dialog by themselves; the two updates are kept for when they do.
 */

export type OrderMessageKind = 'inProgress' | 'completed' | 'summary';

export interface OrderMessageInput {
  id: string;
  customerName?: string;
  grandTotal: number;
  items: { description: string; isManualPrice?: boolean; estimatedWeightG?: number; karat?: string }[];
}

/** "12,345.00": the page's `toLocaleString(undefined, { minimumFractionDigits: 2 })`, in the ERP's en-US grouping. */
const amount = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

export function orderCustomerMessage(order: OrderMessageInput, kind: OrderMessageKind, shopName: string): string {
  let message = `Dear ${order.customerName || 'Customer'},\n\n`;
  if (kind === 'summary') {
    message += `Here is a summary of your custom order *#${order.id}* from ${shopName}.\n\n`;
    order.items.forEach((item, index) => {
      message += `*Item ${index + 1}:* ${item.description}\n`;
      if (!item.isManualPrice) {
        message += `  - Est. Weight: ${item.estimatedWeightG}g ${item.karat ? `(${item.karat})` : ''}\n`;
      }
    });
    message += `\n*Total Balance Due:* PKR ${amount(order.grandTotal)}\n\n`;
    message += `We are working on your order and will notify you of any updates.\n\n`;
  } else {
    message += `This is an update regarding your order *#${order.id}* from ${shopName}.\n\n`;
    if (kind === 'inProgress') {
      message += `We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n`;
    } else {
      message += `Your custom order is now *Completed* and ready for collection.\n\n`;
      message += `*Amount Due:* PKR ${amount(order.grandTotal)}\n\n`;
    }
  }
  message += `Thank you for your business.`;
  return message;
}
