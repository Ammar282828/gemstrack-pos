// End-to-end check of online orders (docs/website-checkout.md, "Testing") against the Firestore
// EMULATOR — never the live book: confirming takes the next ORD- number. Refuses without FIRESTORE_EMULATOR_HOST.
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('emulator only'); process.exit(1); }

const { adminDb } = await import('@/lib/firebase-admin');
const { primeCatalogAttributes } = await import('@/lib/website/catalog-source');
const online = await import('@/lib/website/online');
const { publicOrderView } = await import('@/lib/website/checkout');
const { markTransferReceived, lapseOrder } = await import('@/lib/website/fulfilment');
const { recordSlip } = await import('@/lib/website/slips');

const ok = (c: unknown, m: string) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

await adminDb.collection('app_settings').doc('global').set({
  goldRatePerGram24k: 30000, goldRatePerGram22k: 27500, goldRatePerGram21k: 26250, goldRatePerGram18k: 22500,
  palladiumRatePerGram: 9000, platinumRatePerGram: 10000, silverRatePerGram: 300, lastOrderNumber: 41, ratesUpdatedAt: new Date().toISOString(),
});
await adminDb.collection('app_settings').doc('website').set({
  enabled: true, currency: 'PKR', posCategoryId: 'cat001', deliveryCharge: 500, freeDeliveryOver: 300000,
  defaultPricing: { karat: '21k', wastagePercentage: 10, makingChargesPerGram: 1500, stoneChargesDefault: 4000 }, categories: {},
});
primeCatalogAttributes({
  'Rings & Bands/Rings/Ring 1.webp': { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional', weightGrams: 4, name: 'Plain Band' },
  'Earrings/Jhumki/Jhumki 2.webp': { metal: 'Yellow Gold', stone: 'Ruby', cut: 'Oval', style: 'Traditional', weightGrams: 2 },
} as never);

const body = {
  customer: { name: 'Test Customer', phone: '0300 1234567', email: '' },
  delivery: { address: 'House 12, Street 4, Phase 6', city: 'Lahore', notes: 'Call first' },
  pieces: [{ key: 'Rings & Bands/Rings/Ring 1.webp', size: '12' }, 'Earrings/Jhumki/Jhumki 2.webp'],
  expectedTotal: 0, bagId: 'bag_e2e_000001', acceptedTerms: true,
};
let expected = 0;
try { await online.placeOnlineOrder(body, {}); } catch (e) { expected = (e as { detail: { grandTotal: number } }).detail.grandTotal; }
ok(expected > 0, `a wrong total is refused with the right one (${expected})`);

const placed = await online.placeOnlineOrder({ ...body, expectedTotal: expected }, { customerUid: 'uid-1' });
ok(online.isOnlineId(placed.id) && placed.confirmation === 'to_confirm', `placed ${placed.id}, to confirm`);
const again = await online.placeOnlineOrder({ ...body, expectedTotal: expected }, { customerUid: 'uid-1' });
ok(again.id === placed.id, 'the same bag twice is one order');
ok((await adminDb.collection('orders').get()).empty && (await adminDb.collection('customers').get()).empty && (await adminDb.collection('products').get()).empty, 'nothing in orders, customers or products before confirming');

const v1 = await online.publicOnlineView(placed.id, placed.token);
ok(v1?.confirmation === 'to_confirm' && v1.bank === null && v1.items[0].size === '12', 'the customer sees it waiting, no bank details, the size');
ok((await online.publicOnlineView(placed.id, 'wrong')) === null, 'a wrong token sees nothing');
ok((await online.countWaiting()) === 1, 'one waiting');
const rows = await online.listOnlineOrders();
ok(rows.length === 1 && rows[0].todayTotal === expected && !('draft' in rows[0]), `the inbox lists it with today's total ${rows[0]?.todayTotal}, no draft`);

let slipEarly = '';
try { await recordSlip(placed.id, placed.token, { file: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300)]).toString('base64') }); } catch (e) { slipEarly = (e as Error).message; }
ok(/not confirmed/.test(slipEarly), 'a slip before confirming is refused');

// Two people press Confirm at once.
const [a, b] = await Promise.allSettled([online.confirmOnlineOrder(placed.id, 'one@x'), online.confirmOnlineOrder(placed.id, 'two@x')]);
const won = [a, b].filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<{ orderId: string }>).value.orderId).filter(Boolean);
ok(won.length >= 1 && new Set(won).size === 1, `two confirms make one order (${won.join(',')}; ${[a, b].map(r => r.status === 'rejected' ? (r.reason as Error).message : 'ok').join(' / ')})`);
const orders = await adminDb.collection('orders').get();
ok(orders.size === 1 && orders.docs[0].id === 'ORD-000042', `one order, the next number (${orders.docs.map(d => d.id)})`);
const o = orders.docs[0].data();
ok(o.source === 'website' && o.website.onlineId === placed.id && o.website.holdUntil && o.website.total === expected, 'labelled online, with its ONL-, hold and total');
ok(o.grandTotal === o.subtotal && o.subtotal === expected - 500, `balance is the pieces (${o.grandTotal}), delivery separate`);
ok(o.items[0].isManualPrice === true && o.items[0].size === '12' && o.items[0].description === 'Plain Band', 'pieces fixed at the quote, size and site name kept');
ok(o.ratesApplied.goldRatePerGram21k === 26250, 'stamped with the quoted rates');
ok((await adminDb.collection('customers').get()).size === 1 && (await adminDb.collection('products').get()).size === 2, 'one customer, two products');
ok((await online.countWaiting()) === 0, 'none waiting');

let declineLate = '';
try { await online.declineOnlineOrder(placed.id, 'x@x', 'Changed our mind'); } catch (e) { declineLate = (e as Error).message; }
ok(/confirmed already/.test(declineLate), 'a confirmed order cannot be declined');

const v2 = await online.publicOnlineView(placed.id, placed.token);
// With a whole account in the environment the page shows it; without (Taheri: the shop sends it on WhatsApp) it shows none.
const bankInEnv = !!process.env.NEXT_PUBLIC_STORE_IBAN;
ok(v2?.confirmation === 'confirmed' && v2.ref === 'ORD-000042' && v2.id === placed.id && (bankInEnv ? !!v2.bank?.iban : v2.bank === null) && v2.grandTotal === expected, `the customer sees the shop ref, and ${bankInEnv ? 'the bank details' : 'no bank details (they come on WhatsApp)'}`);
ok((await publicOrderView('ORD-000042', placed.token))?.id === placed.id, 'the ORD- link shows the same order under the ONL- number');

const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]).toString('base64');
const s = await recordSlip(placed.id, placed.token, { file: jpeg, amount: expected, reference: 'TRX123', fromBank: 'HBL' });
ok(s.slip.id && (await adminDb.collection('website_slips').doc(s.slip.id).get()).exists, 'the slip is stored');
const o2 = (await adminDb.collection('orders').doc('ORD-000042').get()).data()!;
ok(o2.website.paymentStatus === 'slip_sent' && o2.website.slips.length === 1, 'slip sent; the order waits for the shop');

const paid = await markTransferReceived('ORD-000042', 'one@x');
ok(paid.ok, 'transfer received');
const o3 = (await adminDb.collection('orders').doc('ORD-000042').get()).data()!;
ok(o3.grandTotal === 0 && o3.advancePayment === expected - 500 && o3.advances[0].method === 'Bank Transfer', `paid: balance 0, advance ${o3.advancePayment} by bank transfer`);
ok(o3.status === 'Pending', 'still Not started: the pieces move it');
const rev = await adminDb.collection('additional_revenue').get();
ok(rev.size === 1 && rev.docs[0].data().amount === 500 && rev.docs[0].id === o3.website.deliveryRevenueId, 'delivery booked once as extra revenue');
await markTransferReceived('ORD-000042', 'two@x');
ok((await adminDb.collection('additional_revenue').get()).size === 1 && (await adminDb.collection('orders').doc('ORD-000042').get()).data()!.advances.length === 1, 'pressing it twice books nothing twice');
let lapsePaid = '';
try { await lapseOrder('ORD-000042', 'x'); } catch (e) { lapsePaid = (e as Error).message; }
ok(/paid/.test(lapsePaid), 'a paid order cannot lapse');

// A second order, declined.
const p2 = await online.placeOnlineOrder({ ...body, bagId: 'bag_e2e_000002', expectedTotal: expected }, {});
const d = await online.declineOnlineOrder(p2.id, 'one@x', 'We cannot deliver to this city');
ok(d.notified === 'notifications off', 'declined (notifications off in the test)');
const v3 = await online.publicOnlineView(p2.id, p2.token);
ok(v3?.confirmation === 'declined' && v3.declineReason === 'We cannot deliver to this city' && v3.bank === null, 'the customer sees why');
ok((await adminDb.collection('orders').get()).size === 1, 'a declined order wrote nothing to the book');

// A third, confirmed and left unpaid: the tick reminds, then tells the shop, and cancels nothing.
const p3 = await online.placeOnlineOrder({ ...body, bagId: 'bag_e2e_000003', expectedTotal: expected }, {});
const c3 = await online.confirmOnlineOrder(p3.id, 'one@x', new Date('2026-10-05T06:00:00Z'));   // Mon 11:00 Karachi
const r1 = await online.sweepOnline(new Date('2026-10-06T04:00:00Z'));                          // Tue 09:00, 2h left
ok(r1.reminded === 1 && r1.holdEnded === 0, `reminded 2h before the end (${JSON.stringify(r1)})`);
const r2 = await online.sweepOnline(new Date('2026-10-06T04:05:00Z'));
ok(r2.reminded === 0, 'reminded once');
const r3 = await online.sweepOnline(new Date('2026-10-06T07:00:00Z'));                          // Tue 12:00, ended
ok(r3.holdEnded === 1, 'the shop is told the hold ended');
const o4 = (await adminDb.collection('orders').doc(c3.orderId).get()).data()!;
ok(o4.status === 'Pending' && o4.website.paymentStatus === 'awaiting_transfer', 'and nothing is cancelled on its own');
await lapseOrder(c3.orderId, 'one@x');
const o5 = (await adminDb.collection('orders').doc(c3.orderId).get()).data()!;
ok(o5.status === 'Cancelled' && o5.website.paymentStatus === 'expired', 'let it lapse: cancelled');

const mine = await online.onlineOrdersFor('uid-1');
ok(mine.length === 1 && mine[0].id === placed.id && mine[0].confirmation === 'confirmed' && mine[0].paymentStatus === 'transfer_received', 'the account page lists the signed-in customer’s order with its state');
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
process.exit();
