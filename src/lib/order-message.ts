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
  /** The balance after the advance (the stored `grandTotal`). */
  grandTotal: number;
  /** With these the message leads with the full amount and names the advance on its own line. */
  subtotal?: number;
  discountAmount?: number;
  advancePayment?: number;
  advanceInExchangeValue?: number;
  items: { description: string; isManualPrice?: boolean; estimatedWeightG?: number; karat?: string }[];
}

/** "12,345": the page's `toLocaleString(undefined, { maximumFractionDigits: 0 })`, in the ERP's en-US grouping. */
const amount = (n: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** The full amount first, the advance on its own line, then what is left (owner, 2026-11-03: never the balance as the headline). */
function moneyLines(order: OrderMessageInput): string {
  const advance = (Number(order.advancePayment) || 0) + (Number(order.advanceInExchangeValue) || 0);
  const known = typeof order.subtotal === 'number' && order.subtotal > 0;
  const total = known ? Math.max(0, order.subtotal! - (Number(order.discountAmount) || 0)) : (Number(order.grandTotal) || 0) + advance;
  const lines = [`*Total:* PKR ${amount(total)}`];
  if (advance > 0) {
    lines.push(`*Advance paid:* PKR ${amount(advance)}`);
    lines.push(`*Balance due:* PKR ${amount(order.grandTotal)}`);
  }
  return lines.join('\n');
}

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
    message += `\n${moneyLines(order)}\n\n`;
    message += `We are working on your order and will notify you of any updates.\n\n`;
  } else {
    message += `This is an update regarding your order *#${order.id}* from ${shopName}.\n\n`;
    if (kind === 'inProgress') {
      message += `We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n`;
    } else {
      message += `Your custom order is now *Completed* and ready for collection.\n\n`;
      message += `${moneyLines(order)}\n\n`;
    }
  }
  message += `Thank you for your business.`;
  return message;
}
