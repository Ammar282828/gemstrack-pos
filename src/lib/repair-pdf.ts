"use client";

/**
 * The repair receipt: the customer's proof that their piece is with us.
 *
 * Printed when a piece comes in, and again when it goes back (the second one
 * shows what was paid and the weight it left at). Same letterhead as the
 * invoice. The weight is printed large on purpose: for gold, "it came back
 * lighter" is the one dispute a repair counter has, and the answer is on this
 * paper, signed for at both ends.
 */

import jsPDF from 'jspdf';
import { format, parseISO } from 'date-fns';
import { STORE_LOGO_ASPECT } from '@/lib/store-config';
import { metalLabel } from '@/lib/materials';
import { type Repair, repairBalance, repairPaid, REPAIR_STATUS_LABELS } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { loadPdfLogo } from '@/lib/pdf-logo';
import { drawDocHeader, drawDocFooter, drawTotals, hairline, label, type TotalRow } from '@/lib/pdf-chrome';

const pkr = (n: number) => `PKR ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (iso?: string) => {
  if (!iso) return '';
  try { return format(parseISO(iso), 'd MMM yyyy'); } catch { return iso; }
};

export async function buildRepairPdf(r: Repair): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const logo = await loadPdfLogo();
  const drawHeader = (pageNum: number) => drawDocHeader(doc, {
    pageWidth, pageHeight, margin, title: 'Repair receipt',
    logoDataUrl: logo?.dataUrl ?? null, logoFormat: logo?.format ?? 'PNG', logoAspect: STORE_LOGO_ASPECT, pageNum,
  });
  drawHeader(1);

  // Who and when.
  let y = 28;
  label(doc, 'Received from', margin, y);
  label(doc, 'Repair', pageWidth / 2, y);
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);
  const who = [r.customerName || 'Walk-in customer', r.customerContact ? `Phone: ${r.customerContact}` : ''].filter(Boolean);
  doc.text(who.join('\n'), margin, y, { lineHeightFactor: 1.4 });
  const when = [
    `Repair #: ${r.id}`,
    `Received: ${day(r.receivedAt)}`,
    r.promisedDate ? `Ready by: ${day(r.promisedDate)}` : '',
    r.status === 'collected' && r.collectedAt ? `Collected: ${day(r.collectedAt)}` : '',
  ].filter(Boolean);
  doc.text(when.join('\n'), pageWidth / 2, y, { lineHeightFactor: 1.4 });
  y += Math.max(who.length, when.length) * 4 + 6;

  hairline(doc, margin, y, pageWidth - margin, 'rule');
  y += 7;

  // The piece.
  label(doc, 'The piece', margin, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0);
  const itemLines = doc.splitTextToSize(r.item, pageWidth - margin * 2);
  doc.text(itemLines, margin, y);
  y += itemLines.length * 5;
  const metal = [r.metalType ? metalLabel(r.metalType) : '', r.metalType === 'gold' && r.karat ? r.karat.toUpperCase() : ''].filter(Boolean).join(' ');
  if (metal) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
    doc.text(metal, margin, y);
    y += 5;
  }

  // Weights, large: in, and out once it has gone back.
  if (r.weightInG) {
    y += 2;
    const col = (pageWidth - margin * 2) / 2;
    label(doc, 'Weight received', margin, y);
    if (r.weightOutG) label(doc, 'Weight returned', margin + col, y);
    y += 6;
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(0);
    doc.text(`${r.weightInG.toFixed(3)} g`, margin, y);
    if (r.weightOutG) doc.text(`${r.weightOutG.toFixed(3)} g`, margin + col, y);
    y += 6;
  }

  // The work.
  y += 3;
  label(doc, 'Work to be done', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0);
  const work = [r.work?.length ? r.work.join(' · ') : '', r.details || ''].filter(Boolean).join('\n');
  const workLines = doc.splitTextToSize(work || '—', pageWidth - margin * 2);
  doc.text(workLines, margin, y, { lineHeightFactor: 1.4 });
  y += workLines.length * 4.4 + 4;

  // Money.
  const paid = repairPaid(r);
  const due = r.charge ?? r.estimate ?? 0;
  const rows: TotalRow[] = [];
  if (r.charge == null && r.estimate) rows.push({ label: 'Estimate', value: pkr(r.estimate) });
  const payments: TotalRow[] = (r.payments || []).map((p) => ({
    label: `${p.note || 'Paid'} · ${day(p.date)}${p.method ? ` · ${p.method}` : ''}`,
    value: `- ${pkr(p.amount)}`,
  }));
  if (due > 0 || paid > 0) {
    drawTotals(doc, {
      pageWidth, pageHeight, margin, startY: y + 4, onNewPage: drawHeader,
      rows,
      total: { label: r.charge != null ? 'Repair charge' : 'Estimated charge', value: pkr(due) },
      after: payments,
      closing: r.status === 'cancelled' ? undefined : { label: 'Balance due', value: pkr(repairBalance(r)) },
    });
  }

  // What the customer signs for, at both ends.
  const signY = pageHeight - 34 - 16;
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110);
  doc.text(
    r.status === 'cancelled'
      ? `This repair was cancelled (${REPAIR_STATUS_LABELS.cancelled.toLowerCase()}).`
      : 'Please bring this receipt when you collect your piece.',
    margin, signY - 4,
  );
  hairline(doc, margin, signY + 8, margin + 50, 'rule');
  hairline(doc, pageWidth - margin - 50, signY + 8, pageWidth - margin, 'rule');
  label(doc, 'Received by the shop', margin, signY + 12, { size: 5.5 });
  label(doc, r.status === 'collected' ? 'Collected by the customer' : 'Customer', pageWidth - margin - 50, signY + 12, { size: 5.5 });

  drawDocFooter(doc, {
    pageWidth, pageHeight, margin,
    linksQr: document.getElementById('links-qr-code') as HTMLCanvasElement | null,
    whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
    instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
  });
  return doc;
}

export async function saveRepairPdf(r: Repair): Promise<void> {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  try {
    await savePDF(await buildRepairPdf(r), `Repair-${r.id}.pdf`, iOSWin);
  } catch (e) {
    iOSWin?.close();
    throw e;
  }
}
