// Draws the monthly report from invented data, to look at: npx tsx scripts/monthly-sample.ts 2026-09 out.pdf
// House by environment: NEXT_PUBLIC_STORE_BRAND=mina NEXT_PUBLIC_STORE_PALETTE=... as apphosting.mina.yaml sets them.
import { writeFileSync } from 'node:fs';
import { buildMonthlyReport, parseMonth } from '../src/lib/reports/monthly';
import { sampleShop } from '../src/lib/reports/monthly-fixture';
import { buildMonthlyPdf } from '../src/lib/reports/monthly-pdf';

const month = parseMonth(process.argv[2] || '2026-09')!;
const out = process.argv[3] || 'monthly-sample.pdf';
const now = new Date(process.argv[4] || '2026-10-30T10:00:00Z');
const t0 = performance.now();
const report = buildMonthlyReport(sampleShop(), month, now);
const doc = buildMonthlyPdf(report, null);
const bytes = new Uint8Array(doc.output('arraybuffer'));
writeFileSync(out, bytes);
console.log(`${out}: ${bytes.length} bytes, ${doc.getNumberOfPages()} pages, ${Math.round(performance.now() - t0)} ms, ${report.sales.length} sales`);
