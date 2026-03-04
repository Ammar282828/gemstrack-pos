// Diagnose order overlaps by reading activity log + orders from Firestore
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  console.log('Fetching activity log...');
  const logsSnap = await getDocs(query(collection(db, 'activity_log'), orderBy('timestamp', 'asc')));
  const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log('Fetching all orders...');
  const ordersSnap = await getDocs(collection(db, 'orders'));
  const orderIds = new Set(ordersSnap.docs.map(d => d.id));
  const orderMap = {};
  ordersSnap.docs.forEach(d => { orderMap[d.id] = d.data(); });

  console.log(`\nTotal activity log entries: ${logs.length}`);
  console.log(`Total orders in DB: ${ordersSnap.docs.length}`);

  // Find all order.create events
  const orderCreateLogs = logs.filter(l => l.eventType === 'order.create');
  console.log(`\norder.create events in log: ${orderCreateLogs.length}`);

  // Find duplicate order IDs in the log (same orderId created more than once)
  const idCounts = {};
  for (const log of orderCreateLogs) {
    idCounts[log.entityId] = (idCounts[log.entityId] || []);
    idCounts[log.entityId].push(log);
  }

  const duplicates = Object.entries(idCounts).filter(([, events]) => events.length > 1);
  if (duplicates.length > 0) {
    console.log(`\n⚠️  ORDER IDs CREATED MORE THAN ONCE (overwrite candidates):`);
    for (const [orderId, events] of duplicates) {
      console.log(`\n  Order ID: ${orderId}`);
      console.log(`  Created ${events.length} times:`);
      for (const e of events) {
        console.log(`    - ${e.timestamp} | ${e.description} | ${e.details}`);
      }
      const existsNow = orderIds.has(orderId);
      const current = orderMap[orderId];
      console.log(`  Currently in DB: ${existsNow ? 'YES' : 'NO'}`);
      if (existsNow && current) {
        console.log(`  Current data: Customer=${current.customerName}, Total=${current.grandTotal}, CreatedAt=${current.createdAt}`);
      }
    }
  } else {
    console.log('\n✅ No duplicate order IDs found in activity log.');
  }

  // Find order.create events whose order no longer exists in DB (deleted or overwritten+deleted)
  const missingOrders = orderCreateLogs.filter(l => !orderIds.has(l.entityId));
  if (missingOrders.length > 0) {
    console.log(`\n⚠️  ORDER.CREATE EVENTS WITH NO MATCHING ORDER IN DB (deleted/overwritten):`);
    for (const l of missingOrders) {
      console.log(`  ${l.timestamp} | ${l.entityId} | ${l.description} | ${l.details}`);
    }
  } else {
    console.log('\n✅ All order.create log entries have a matching order in DB.');
  }

  // Check lastOrderNumber vs actual highest order
  console.log('\nFetching settings...');
  const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
  if (settingsSnap.exists()) {
    const settings = settingsSnap.data();
    console.log(`\nlastOrderNumber in settings: ${settings.lastOrderNumber}`);
    const allOrderNums = ordersSnap.docs
      .map(d => parseInt(d.id.replace('ORD-', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => b - a);
    console.log(`Highest order number in DB: ${allOrderNums[0] ?? 'none'}`);
    if (settings.lastOrderNumber !== allOrderNums[0]) {
      console.log(`⚠️  MISMATCH: settings says ${settings.lastOrderNumber} but DB highest is ${allOrderNums[0]}`);
    } else {
      console.log('✅ lastOrderNumber matches highest order in DB.');
    }
    console.log(`All order numbers: ${allOrderNums.slice(0, 20).join(', ')}${allOrderNums.length > 20 ? '...' : ''}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
