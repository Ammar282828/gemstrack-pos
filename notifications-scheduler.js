/**
 * GemsTrack POS — WhatsApp Notification Scheduler
 *
 * Run alongside `npm run dev`:
 *   node notifications-scheduler.js
 *
 * Trigger a task immediately (for testing):
 *   node notifications-scheduler.js --run weekly-report
 *
 * Available tasks:
 *   daily-checklist | end-of-day | weekly-report
 *   overdue-orders  | given-items | karigar-payments
 */

require('dotenv').config({ path: '.env.local' });
const cron = require('node-cron');

const BASE_URL = process.env.SCHEDULER_BASE_URL || 'http://localhost:3000';

async function run(task) {
  console.log(`[Scheduler] Running task: ${task}`);
  try {
    const res = await fetch(`${BASE_URL}/api/notifications/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[Scheduler] Task ${task} failed:`, data.error);
    } else {
      console.log(`[Scheduler] Task ${task} done:`, data);
    }
  } catch (err) {
    console.error(`[Scheduler] Task ${task} error:`, err.message);
  }
}

async function buildSchedule() {
  // Read times from env or use defaults
  const checklistTime = (process.env.NOTIF_CHECKLIST_TIME || '09:00').split(':');
  const endOfDayTime  = (process.env.NOTIF_EOD_TIME       || '19:00').split(':');

  // Daily checklist + overdue checks
  cron.schedule(`0 ${checklistTime[1]} ${checklistTime[0]} * * *`, () => {
    run('daily-checklist');
    run('overdue-orders');
    run('given-items');
  });

  // End of day
  cron.schedule(`0 ${endOfDayTime[1]} ${endOfDayTime[0]} * * *`, () => {
    run('end-of-day');
  });

  // Weekly report — every Monday at 9am
  cron.schedule('0 0 9 * * 1', () => {
    run('weekly-report');
    run('karigar-payments');
  });

  console.log('[Scheduler] GemsTrack notification scheduler started.');
  console.log(`  Daily checklist : ${checklistTime[0]}:${checklistTime[1]}`);
  console.log(`  End of day      : ${endOfDayTime[0]}:${endOfDayTime[1]}`);
  console.log(`  Weekly report   : Monday 09:00`);
  console.log(`  Next.js base    : ${BASE_URL}`);
}

// --run <task> flag: run once and exit
const runArg = process.argv.indexOf('--run');
if (runArg !== -1 && process.argv[runArg + 1]) {
  run(process.argv[runArg + 1]).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  buildSchedule().catch(console.error);
}
