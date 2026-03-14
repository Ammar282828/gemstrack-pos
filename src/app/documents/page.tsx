
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAppStore, Order, Invoice, Settings, Customer, InvoiceItem, staticCategories } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, FileText, ClipboardList, AlertTriangle, User, Calendar, DollarSign, Eye, Upload, CheckCircle2, ShoppingBag, Printer } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { cn, openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, writeBatch, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { STORE_CONFIG } from '@/lib/store-config';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}


type DocumentType = (Order | Invoice) & { docType: 'order' | 'invoice' };

async function generateInvoicePDF(
  invoice: Invoice,
  settings: Settings,
  customers: Customer[],
) {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  const pdfDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageHeight = pdfDoc.internal.pageSize.getHeight();
  const pageWidth = pdfDoc.internal.pageSize.getWidth();
  const margin = 10;

  let logoDataUrl: string | null = null;
  let logoFormat = 'PNG';
  const logoUrl = settings.shopLogoUrlBlack || settings.shopLogoUrl;
  if (logoUrl) {
    try {
      const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(logoUrl)}`);
      const blob = await res.blob();
      logoFormat = blob.type.toLowerCase().includes('jpeg') || blob.type.toLowerCase().includes('jpg') ? 'JPEG' : 'PNG';
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) { console.error('Logo load error:', e); }
  }

  function drawHeader(pageNum: number) {
    if (logoDataUrl) {
      try { pdfDoc.addImage(logoDataUrl, logoFormat, margin, 8, 35, 11, undefined, 'FAST'); } catch (e) {}
    }
    pdfDoc.setFont('helvetica', 'bold').setFontSize(14);
    pdfDoc.text('ESTIMATE', pageWidth - margin, 14, { align: 'right' });
    pdfDoc.setLineWidth(0.4).line(margin, 22, pageWidth - margin, 22);
    if (pageNum > 1) {
      pdfDoc.setFontSize(8).setTextColor(150);
      pdfDoc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
      pdfDoc.setTextColor(0);
    }
  }
  drawHeader(1);

  let infoY = 28;
  pdfDoc.setFontSize(7).setTextColor(100).setFont('helvetica', 'bold');
  pdfDoc.text('BILL TO:', margin, infoY);
  pdfDoc.text('INVOICE DETAILS:', pageWidth / 2, infoY);
  pdfDoc.setLineWidth(0.2).line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);
  infoY += 6;
  pdfDoc.setFont('helvetica', 'normal').setTextColor(0).setFontSize(8);

  let customerInfo = 'Walk-in Customer';
  if (invoice.customerId) {
    const customer = customers.find(c => c.id === invoice.customerId);
    if (customer) {
      customerInfo = customer.name;
      if (customer.phone) customerInfo += `\nPhone: ${customer.phone}`;
      if (customer.email) customerInfo += `\nEmail: ${customer.email}`;
    } else if (invoice.customerName) {
      customerInfo = invoice.customerName;
    }
  } else if (invoice.customerName) {
    customerInfo = invoice.customerName;
  }
  pdfDoc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });
  pdfDoc.text(`Estimate #: ${invoice.id}\nDate: ${new Date(invoice.createdAt).toLocaleDateString()}`, pageWidth / 2, infoY, { lineHeightFactor: 1.4 });

  const rates = (invoice.ratesApplied || {}) as Record<string, number>;
  const itemsToPrint = Array.isArray(invoice.items) ? invoice.items : Object.values(invoice.items as Record<string, InvoiceItem>);
  const usedKarats = new Set(itemsToPrint.filter((i: InvoiceItem) => i.metalType === 'gold').map((i: InvoiceItem) => i.karat).filter(Boolean));
  const ratesApplied: string[] = [];
  if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
  if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
  if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
  if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
  if (ratesApplied.length > 0) {
    pdfDoc.setFontSize(6.5).setTextColor(150);
    pdfDoc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, infoY + 10, { lineHeightFactor: 1.4 });
  }

  const tableStartY = infoY + (ratesApplied.length > 0 ? 18 : 13);
  const tableRows: any[][] = [];
  itemsToPrint.forEach((item: InvoiceItem, index: number) => {
    const breakdownLines: string[] = [];
    if (item.metalCost > 0) breakdownLines.push(`  Metal: PKR ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    if (item.wastageCost > 0) breakdownLines.push(`  + Wastage (${item.wastagePercentage}%): PKR ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    if (item.makingCharges > 0) breakdownLines.push(`  + Making: PKR ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    if (item.diamondChargesIfAny > 0) breakdownLines.push(`  + Diamonds: PKR ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    if (item.stoneChargesIfAny > 0) breakdownLines.push(`  + Stones: PKR ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    if (item.miscChargesIfAny > 0) breakdownLines.push(`  + Misc: PKR ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    const metalTypeName = item.metalType === 'silver' ? '925 Sterling Silver' : item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1);
    const karat = item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : '';
    const weightPart = item.metalWeightG > 0 ? `, Wt: ${(item.metalWeightG || 0).toFixed(2)}g` : '';
    const categoryTitle = staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '';
    const fullDescription = `${categoryTitle ? categoryTitle.toUpperCase() + '\n' : ''}${item.name}\nSKU: ${item.sku} | ${metalTypeName}${karat}${weightPart}${breakdownLines.length > 0 ? '\n' + breakdownLines.join('\n') : ''}`;
    tableRows.push([index + 1, fullDescription, item.quantity, item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }), item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })]);
  });

  pdfDoc.autoTable({
    head: [['#', 'Product & Breakdown', 'Qty', 'Unit', 'Total']],
    body: tableRows,
    startY: tableStartY,
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 40, fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
    styles: { fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, valign: 'top', lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles: { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 9, halign: 'right' }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 22, halign: 'right' } },
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > 1) { pdfDoc.setPage(data.pageNumber); data.settings.startY = 28; }
      drawHeader(data.pageNumber);
    },
  });

  let finalY = pdfDoc.lastAutoTable.finalY || 0;

  if (invoice.paymentHistory && invoice.paymentHistory.length > 0) {
    finalY += 8;
    pdfDoc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
    pdfDoc.text('Payment History', margin, finalY);
    finalY += 4;
    pdfDoc.autoTable({
      head: [['Date', 'Amount', 'Notes']],
      body: invoice.paymentHistory.map(p => [format(new Date(p.date), 'PP'), `PKR ${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, p.notes || 'Payment received']),
      startY: finalY, theme: 'striped',
      headStyles: { fillColor: [240, 240, 240], textColor: 50, fontSize: 8 },
      styles: { fontSize: 7 },
    });
    finalY = pdfDoc.lastAutoTable.finalY || finalY;
  }

  if (finalY + 70 > pageHeight - margin) {
    pdfDoc.addPage(); drawHeader(pdfDoc.getNumberOfPages()); finalY = 28;
  }

  let currentY = finalY + 8;
  const totalsX = pageWidth - margin;
  pdfDoc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(0);
  pdfDoc.text('Subtotal:', totalsX - 50, currentY, { align: 'right' });
  pdfDoc.text(`PKR ${invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
  currentY += 6;
  if (invoice.discountAmount > 0) {
    pdfDoc.setFont('helvetica', 'bold').setTextColor(220, 53, 69);
    pdfDoc.text('Discount:', totalsX - 50, currentY, { align: 'right' });
    pdfDoc.text(`- PKR ${invoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 6;
  }
  if (invoice.exchangeAmount1 || invoice.exchangeAmount2) {
    pdfDoc.setFont('helvetica', 'bold').setTextColor(30, 100, 180);
    pdfDoc.text(invoice.exchangeDescription ? `Exchange (${invoice.exchangeDescription}):` : 'Exchange:', totalsX - 50, currentY, { align: 'right' });
    currentY += 5;
    if (invoice.exchangeAmount1) { pdfDoc.setFont('helvetica', 'normal'); pdfDoc.text(`- PKR ${invoice.exchangeAmount1.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' }); currentY += 5; }
    if (invoice.exchangeAmount2) { pdfDoc.setFont('helvetica', 'normal'); pdfDoc.text(`- PKR ${invoice.exchangeAmount2.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' }); currentY += 5; }
  }
  pdfDoc.setFont('helvetica', 'normal').setTextColor(0).setLineWidth(0.2).line(totalsX - 50, currentY, totalsX, currentY);
  currentY += 6;
  pdfDoc.setFontSize(10).setFont('helvetica', 'bold');
  pdfDoc.text('Grand Total:', totalsX - 50, currentY, { align: 'right' });
  pdfDoc.text(`PKR ${invoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
  currentY += 7;
  if (invoice.amountPaid > 0) {
    pdfDoc.setFontSize(9).setFont('helvetica', 'normal');
    pdfDoc.text('Amount Paid:', totalsX - 50, currentY, { align: 'right' });
    pdfDoc.text(`- PKR ${invoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    pdfDoc.setFontSize(12).setFont('helvetica', 'bold');
    pdfDoc.text('Balance Due:', totalsX - 50, currentY, { align: 'right' });
    pdfDoc.text(`PKR ${invoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
  }

  const footerStartY = pageHeight - 36;
  const contacts = [
    { name: STORE_CONFIG.contact1Name, number: STORE_CONFIG.contact1Number },
    { name: STORE_CONFIG.contact2Name, number: STORE_CONFIG.contact2Number },
    { name: STORE_CONFIG.contact3Name, number: STORE_CONFIG.contact3Number },
    { name: STORE_CONFIG.contact4Name, number: STORE_CONFIG.contact4Number },
  ].filter(c => c.name && c.number);
  const qrCodeSize = 16, qrGap = 3;
  const qrSectionWidth = qrCodeSize * 2 + qrGap;
  const textBlockWidth = pageWidth - margin * 2 - qrSectionWidth - 6;
  const qrStartX = pageWidth - margin - qrSectionWidth;
  pdfDoc.setLineWidth(0.2).line(margin, footerStartY - 2, pageWidth - margin, footerStartY - 2);
  pdfDoc.setFontSize(6).setFont('helvetica', 'bold').setTextColor(70);
  pdfDoc.text('For Orders & Inquiries:', margin, footerStartY + 2, { maxWidth: textBlockWidth });
  pdfDoc.setFontSize(7.5).setFont('helvetica', 'normal').setTextColor(30);
  contacts.forEach((c, i) => pdfDoc.text(`${c.name}: ${c.number}`, margin, footerStartY + 6 + i * 4, { maxWidth: textBlockWidth }));
  const afterContacts = footerStartY + 6 + contacts.length * 4;
  pdfDoc.setFontSize(6).setFont('helvetica', 'bold').setTextColor(80);
  pdfDoc.text(STORE_CONFIG.bankLine, margin, afterContacts + 2, { maxWidth: textBlockWidth });
  if (STORE_CONFIG.iban) { pdfDoc.setFontSize(6).setFont('helvetica', 'normal').setTextColor(100); pdfDoc.text(`IBAN: ${STORE_CONFIG.iban}`, margin, afterContacts + 6, { maxWidth: textBlockWidth }); }
  const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
  const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
  if (waQrCanvas) { pdfDoc.setFontSize(5).setFont('helvetica', 'bold').setTextColor(60); pdfDoc.text('Join us on Whatsapp', qrStartX + qrCodeSize / 2, footerStartY + 2, { align: 'center' }); pdfDoc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY + 4, qrCodeSize, qrCodeSize); }
  if (instaQrCanvas) { const secondQrX = qrStartX + qrCodeSize + qrGap; pdfDoc.setFontSize(5).setFont('helvetica', 'bold').setTextColor(60); pdfDoc.text('Follow us on Instagram', secondQrX + qrCodeSize / 2, footerStartY + 2, { align: 'center' }); pdfDoc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY + 4, qrCodeSize, qrCodeSize); }
  savePDF(pdfDoc, `Invoice-${invoice.id}.pdf`, iOSWin);
}

async function generateOrderSlipPDF(order: Order, settings: Settings) {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  const pdfDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageHeight = pdfDoc.internal.pageSize.getHeight();
  const pageWidth = pdfDoc.internal.pageSize.getWidth();
  const margin = 10;

  let logoDataUrl: string | null = null;
  let logoFormat = 'PNG';
  const logoUrl = settings.shopLogoUrlBlack || settings.shopLogoUrl;
  if (logoUrl) {
    try {
      const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(logoUrl)}`);
      const blob = await res.blob();
      logoFormat = blob.type.toLowerCase().includes('jpeg') || blob.type.toLowerCase().includes('jpg') ? 'JPEG' : 'PNG';
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) { console.error('Logo load error:', e); }
  }

  function drawHeader(pageNum: number) {
    if (logoDataUrl) { try { pdfDoc.addImage(logoDataUrl, logoFormat, margin, 7, 32, 10, undefined, 'FAST'); } catch (e) {} }
    pdfDoc.setFont('helvetica', 'bold').setFontSize(14);
    pdfDoc.text('WORKSHOP ORDER SLIP', pageWidth - margin, 14, { align: 'right' });
    pdfDoc.setLineWidth(0.4).line(margin, 22, pageWidth - margin, 22);
    if (pageNum > 1) { pdfDoc.setFontSize(7).setTextColor(150); pdfDoc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, { align: 'right' }); pdfDoc.setTextColor(0); }
  }
  drawHeader(1);

  let infoY = 28;
  pdfDoc.setFontSize(7).setTextColor(100).setFont('helvetica', 'bold');
  pdfDoc.text('ORDER DETAILS:', margin, infoY);
  pdfDoc.setLineWidth(0.2).line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);
  infoY += 6;
  pdfDoc.setFont('helvetica', 'normal').setTextColor(0).setFontSize(8.5);
  pdfDoc.text(`Order ID: ${order.id}`, margin, infoY);
  pdfDoc.text(`Date: ${format(parseISO(order.createdAt), 'PP')}`, margin, infoY + 5);
  pdfDoc.text(`Customer: ${order.customerName || 'Walk-in'}`, margin, infoY + 10);

  const rates = order.ratesApplied as Record<string, number>;
  const usedKarats = new Set(order.items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
  const ratesApplied: string[] = [];
  if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
  if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
  if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
  if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
  if (ratesApplied.length > 0) { pdfDoc.setFontSize(6.5).setTextColor(150); pdfDoc.text(`Gold Rates (PKR): ${ratesApplied.join(' | ')}`, margin, infoY + 15); }

  pdfDoc.setTextColor(0).setFontSize(8.5).setFont('helvetica', 'bold');
  pdfDoc.text(`Est: PKR ${(order.subtotal || 0).toLocaleString()}`, pageWidth - margin, infoY + 5, { align: 'right' });
  pdfDoc.text('Advance Paid:', pageWidth - margin, infoY + 10, { align: 'right' });
  const totalAdvance = (order.advancePayment || 0) + (order.advanceInExchangeValue || 0);
  pdfDoc.text(`- PKR ${totalAdvance.toLocaleString()}`, pageWidth - margin, infoY + 15, { align: 'right' });
  pdfDoc.setLineWidth(0.3).line(margin, infoY + 20, pageWidth - margin, infoY + 20);

  const tableRows: any[][] = order.items.map((item, i) => {
    const metalName = item.metalType === 'silver' ? '925 Sterling Silver' : `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.karat ? ` (${item.karat.toUpperCase()})` : ''}`;
    const metalLine = item.isManualPrice ? metalName : `${metalName}  |  Est. Wt: ${item.estimatedWeightG}g${item.metalType !== 'silver' && item.wastagePercentage > 0 ? `  |  Wastage: ${item.wastagePercentage}%` : ''}`;
    const categoryTitle = staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '';
    const detailLines: string[] = [];
    if (categoryTitle) detailLines.push(categoryTitle.toUpperCase());
    detailLines.push(item.description);
    detailLines.push(metalLine);
    if (item.referenceSku) detailLines.push(`Ref SKU: ${item.referenceSku}`);
    if (item.stoneDetails) detailLines.push(`Instructions: ${item.stoneDetails}`);
    if (item.diamondDetails) detailLines.push(`Instructions: ${item.diamondDetails}`);
    return [i + 1, detailLines.join('\n'), `PKR ${(item.totalEstimate || 0).toLocaleString()}`];
  });

  pdfDoc.autoTable({
    head: [['#', 'Item Details', 'Est. Price']],
    body: tableRows,
    startY: infoY + 27,
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 40, fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
    styles: { fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 }, valign: 'top', lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles: { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 28, halign: 'right' } },
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > 1) { pdfDoc.setPage(data.pageNumber); data.settings.startY = 30; }
      drawHeader(data.pageNumber);
    },
  });

  const footerStartY = pageHeight - 36;
  const contacts = [
    { name: STORE_CONFIG.contact1Name, number: STORE_CONFIG.contact1Number },
    { name: STORE_CONFIG.contact2Name, number: STORE_CONFIG.contact2Number },
    { name: STORE_CONFIG.contact3Name, number: STORE_CONFIG.contact3Number },
    { name: STORE_CONFIG.contact4Name, number: STORE_CONFIG.contact4Number },
  ].filter(c => c.name && c.number);
  const qrCodeSize = 16, qrGap = 3;
  const qrSectionWidth = qrCodeSize * 2 + qrGap;
  const textBlockWidth = pageWidth - margin * 2 - qrSectionWidth - 6;
  const qrStartX = pageWidth - margin - qrSectionWidth;
  pdfDoc.setLineWidth(0.2).line(margin, footerStartY - 2, pageWidth - margin, footerStartY - 2);
  pdfDoc.setFontSize(6).setFont('helvetica', 'bold').setTextColor(70);
  pdfDoc.text('For Orders & Inquiries:', margin, footerStartY + 2, { maxWidth: textBlockWidth });
  pdfDoc.setFontSize(7.5).setFont('helvetica', 'normal').setTextColor(30);
  contacts.forEach((c, i) => pdfDoc.text(`${c.name}: ${c.number}`, margin, footerStartY + 6 + i * 4, { maxWidth: textBlockWidth }));
  const afterContacts = footerStartY + 6 + contacts.length * 4;
  pdfDoc.setFontSize(6).setFont('helvetica', 'bold').setTextColor(80);
  pdfDoc.text(STORE_CONFIG.bankLine, margin, afterContacts + 2, { maxWidth: textBlockWidth });
  if (STORE_CONFIG.iban) { pdfDoc.setFontSize(6).setFont('helvetica', 'normal').setTextColor(100); pdfDoc.text(`IBAN: ${STORE_CONFIG.iban}`, margin, afterContacts + 6, { maxWidth: textBlockWidth }); }
  const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
  const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
  if (waQrCanvas) { pdfDoc.setFontSize(5).setFont('helvetica', 'bold').setTextColor(60); pdfDoc.text('Join us on Whatsapp', qrStartX + qrCodeSize / 2, footerStartY + 2, { align: 'center' }); pdfDoc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY + 4, qrCodeSize, qrCodeSize); }
  if (instaQrCanvas) { const secondQrX = qrStartX + qrCodeSize + qrGap; pdfDoc.setFontSize(5).setFont('helvetica', 'bold').setTextColor(60); pdfDoc.text('Follow us on Instagram', secondQrX + qrCodeSize / 2, footerStartY + 2, { align: 'center' }); pdfDoc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY + 4, qrCodeSize, qrCodeSize); }
  savePDF(pdfDoc, `OrderSlip-${order.id}.pdf`, iOSWin);
}

const getStatusBadgeVariant = (status: Order['status'] | 'Paid' | 'Unpaid') => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      case 'Refunded': return 'bg-purple-500/80 text-purple-50';
      case 'Paid': return 'bg-green-600/80 text-green-50';
      case 'Unpaid': return 'bg-orange-500/80 text-orange-50';
      default: return 'secondary';
    }
};

const getDocStatus = (doc: DocumentType): Order['status'] | 'Paid' | 'Unpaid' => {
  if (doc.docType === 'order') {
    return (doc as Order).status;
  }
  const inv = doc as Invoice;
  if (inv.status === 'Refunded') return 'Refunded';
  return inv.balanceDue <= 0 ? 'Paid' : 'Unpaid';
};

const isShopifyDoc = (doc: DocumentType): boolean =>
  doc.docType === 'invoice' && !!((doc as Invoice).source?.startsWith('shopify'));


const DocumentCard: React.FC<{ doc: DocumentType; onPrint: () => void }> = ({ doc, onPrint }) => {
    const router = useRouter();
    const status = getDocStatus(doc);
    
    const handleCardClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/cart?invoice_id=${doc.id}`);
        }
    };

    return (
        <Card className="mb-4">
            <CardContent className="p-4 space-y-3" onClick={handleCardClick}>
                <div className="flex justify-between items-start">
                    <div>
                        <div className="font-bold text-primary hover:underline text-lg">{doc.id}</div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <Badge variant={doc.docType === 'order' ? 'secondary' : 'default'} className="capitalize flex items-center gap-1 w-fit">
                                {doc.docType === 'order' ? <ClipboardList className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}
                                {doc.docType}
                            </Badge>
                            {isShopifyDoc(doc) && (
                                <Badge className="bg-green-600/80 text-green-50 border-transparent flex items-center gap-1 w-fit">
                                    <ShoppingBag className="h-3 w-3"/> Shopify
                                </Badge>
                            )}
                        </div>
                    </div>
                    <Badge className={cn("border-transparent capitalize", getStatusBadgeVariant(status))}>{status}</Badge>
                </div>
                 <div className="text-sm text-foreground space-y-2 pt-2 border-t mt-2">
                    <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground"/> 
                        <span>{doc.customerName || 'Walk-in Customer'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground"/> 
                        <span>{format(parseISO(doc.createdAt), 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground"/> 
                        <span>Total: <span className="font-bold text-primary">PKR {doc.grandTotal.toLocaleString()}</span></span>
                    </div>
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t bg-muted/30 flex gap-2">
                <Button variant="ghost" className="flex-1 justify-center" onClick={handleCardClick}>
                    <Eye className="w-4 h-4 mr-2" /> View Details
                </Button>
                <Button variant="ghost" className="flex-1 justify-center" onClick={(e) => { e.stopPropagation(); onPrint(); }}>
                    <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
            </CardFooter>
        </Card>
    );
};


const DocumentRow: React.FC<{ doc: DocumentType; onPrint: () => void }> = ({ doc, onPrint }) => {
    const router = useRouter();
    const status = getDocStatus(doc);

    const handleRowClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/cart?invoice_id=${doc.id}`);
        }
    };

    return (
        <TableRow onClick={handleRowClick} className="cursor-pointer">
            <TableCell>
                 <div className="font-medium text-primary hover:underline">{doc.id}</div>
            </TableCell>
            <TableCell>{doc.customerName || 'Walk-in'}</TableCell>
            <TableCell>{format(parseISO(doc.createdAt), 'dd MMM, yyyy')}</TableCell>
            <TableCell>
                <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant={doc.docType === 'order' ? 'secondary' : 'default'} className="capitalize flex items-center gap-1">
                        {doc.docType === 'order' ? <ClipboardList className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}
                        {doc.docType}
                    </Badge>
                    {isShopifyDoc(doc) && (
                        <Badge className="bg-green-600/80 text-green-50 border-transparent flex items-center gap-1">
                            <ShoppingBag className="h-3 w-3"/> Shopify
                        </Badge>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-right">PKR {doc.grandTotal.toLocaleString()}</TableCell>
             <TableCell>
                <Badge className={cn("border-transparent capitalize", getStatusBadgeVariant(status))}>
                     {status}
                </Badge>
            </TableCell>
            <TableCell>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onPrint(); }}>
                    <Printer className="w-4 h-4 mr-1" /> Print
                </Button>
            </TableCell>
        </TableRow>
    );
};


// --- CSV Parsing ---
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  });
}

async function importShopifyCSV(
  csvContent: string,
  onProgress: (msg: string) => void,
): Promise<number> {
  const rows = parseCSV(csvContent);
  onProgress(`Parsed ${rows.length} rows…`);

  // Group rows by Shopify order Name (multi-item orders have one row per line item)
  // Only accept valid Shopify order names like #1001 — skip corrupt/metadata rows
  const VALID_ORDER_NAME = /^#\d+$/;
  const orderMap = new Map<string, { header: Record<string, string>; items: Record<string, string>[] }>();
  for (const row of rows) {
    const name = row['Name'];
    if (!name || !VALID_ORDER_NAME.test(name)) continue;
    if (!orderMap.has(name)) orderMap.set(name, { header: row, items: [] });
    orderMap.get(name)!.items.push(row);
  }
  onProgress(`${rows.length} rows → ${orderMap.size} unique orders…`);

  // Get current lastInvoiceNumber
  const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
  let lastInvoiceNumber: number = (settingsSnap.data()?.lastInvoiceNumber as number) || 7;
  onProgress(`Starting from INV-${String(lastInvoiceNumber + 1).padStart(6, '0')}…`);

  // Sort orders chronologically
  const sortedOrders = [...orderMap.values()].sort((a, b) =>
    new Date(a.header['Created at']).getTime() - new Date(b.header['Created at']).getTime()
  );

  let batch = writeBatch(db);
  let batchCount = 0;
  let imported = 0;

  for (const order of sortedOrders) {
    const h = order.header;
    const createdAt = h['Created at'] ? new Date(h['Created at']).toISOString() : new Date().toISOString();
    const billingName = h['Billing Name'] || h['Shipping Name'] || 'Walk-in Customer';
    const total = parseFloat(h['Total']) || 0;
    const subtotal = parseFloat(h['Subtotal']) || total;
    const discount = parseFloat(h['Discount Amount']) || 0;
    const financialStatus = h['Financial Status'] || 'paid';
    const amountPaid = financialStatus === 'paid' ? total : 0;
    const balanceDue = total - amountPaid;

    const items = order.items.map(row => {
      const price = parseFloat(row['Lineitem price']) || 0;
      const qty = parseInt(row['Lineitem quantity']) || 1;
      const sku = row['Lineitem sku'] || `SHOP-${h['Name'].replace('#', '')}-${(row['Lineitem name'] || '').slice(0, 8)}`;
      return {
        sku,
        name: row['Lineitem name'] || 'Item',
        categoryId: '',
        metalType: 'gold',
        karat: '21k',
        metalWeightG: 0,
        stoneWeightG: 0,
        quantity: qty,
        unitPrice: price,
        itemTotal: price * qty,
        metalCost: 0,
        wastageCost: 0,
        wastagePercentage: 0,
        makingCharges: price * qty,
        diamondChargesIfAny: 0,
        stoneChargesIfAny: 0,
        miscChargesIfAny: 0,
      };
    });

    lastInvoiceNumber++;
    const invoiceId = `INV-${String(lastInvoiceNumber).padStart(6, '0')}`;

    const invoice = {
      id: invoiceId,
      shopifyOrderName: h['Name'],
      customerId: '',
      customerName: billingName,
      customerContact: h['Billing Phone'] || h['Phone'] || '',
      items,
      subtotal,
      discountAmount: discount,
      grandTotal: total,
      amountPaid,
      balanceDue,
      createdAt,
      ratesApplied: {},
      paymentHistory: amountPaid > 0 ? [{ amount: amountPaid, date: createdAt, notes: 'Shopify payment' }] : [],
      source: 'shopify_import',
    };

    batch.set(doc(db, 'invoices', invoiceId), invoice);
    batchCount++;
    imported++;

    if (batchCount >= 400) {
      await batch.commit();
      onProgress(`Committed batch (${imported} so far)…`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber });
  return imported;
}

export default function DocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: number; firstNames: string[] } | null>(null);
  const [importProgress, setImportProgress] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const appReady = useAppReady();
  const { orders, generatedInvoices, isOrdersLoading, isInvoicesLoading, loadOrders, loadGeneratedInvoices, settings, customers } = useAppStore(state => ({
    orders: state.orders,
    generatedInvoices: state.generatedInvoices,
    isOrdersLoading: state.isOrdersLoading,
    isInvoicesLoading: state.isInvoicesLoading,
    loadOrders: state.loadOrders,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    settings: state.settings,
    customers: state.customers,
  }));

  const handlePrint = (document: DocumentType) => {
    if (document.docType === 'invoice') {
      generateInvoicePDF(document as Invoice, settings, customers);
    } else {
      generateOrderSlipPDF(document as Order, settings);
    }
  };
  
  useEffect(() => {
    if (appReady) {
      loadOrders();
      loadGeneratedInvoices();
    }
  }, [appReady, loadOrders, loadGeneratedInvoices]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportDone(false);
    setImportProgress([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const rows = parseCSV(content);
      const firstNames = rows.slice(0, 5).map(r => r['Billing Name'] || r['Shipping Name'] || 'Walk-in');
      setImportPreview({ rows: rows.length, firstNames });
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportProgress([]);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      try {
        const count = await importShopifyCSV(content, (msg) => {
          setImportProgress(prev => [...prev, msg]);
        });
        setImportDone(true);
        toast({ title: `Imported ${count} invoices`, description: 'Shopify CSV import complete.' });
        loadGeneratedInvoices();
      } catch (e: any) {
        toast({ title: 'Import Failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(importFile);
  };

  const isLoading = isOrdersLoading || isInvoicesLoading;

  const combinedDocuments: DocumentType[] = useMemo(() => {
    if (!appReady) return [];
    const orderDocs: DocumentType[] = (orders || []).map(o => ({ ...o, docType: 'order' }));
    const invoiceDocs: DocumentType[] = (generatedInvoices || []).map(i => ({ ...i, docType: 'invoice' }));
    return [...orderDocs, ...invoiceDocs].sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
  }, [appReady, orders, generatedInvoices]);


  const filteredDocuments = useMemo(() => {
    let docs = combinedDocuments;
    
    if (dateRange?.from) {
      docs = docs.filter(doc => {
        const docDate = parseISO(doc.createdAt);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
        return isWithinInterval(docDate, { start: startOfDay(dateRange.from!), end: toDate });
      });
    }

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      docs = docs.filter(doc => 
        doc.id.toLowerCase().includes(lowerSearchTerm) ||
        (doc.customerName && doc.customerName.toLowerCase().includes(lowerSearchTerm))
      );
    }
    
    return docs;
  }, [combinedDocuments, dateRange, searchTerm]);

  const renderContent = (docs: DocumentType[]) => {
      if (isLoading) {
         return (
            <div className="text-center py-12">
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
                <p className="text-muted-foreground">Fetching documents...</p>
            </div>
         );
      }
      if (docs.length === 0) {
          return (
             <div className="text-center py-12 bg-card rounded-lg shadow">
                <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Documents Found</h3>
                <p className="text-muted-foreground">
                    {searchTerm || dateRange ? "Try adjusting your search or filter." : "No orders or invoices have been created yet."}
                </p>
            </div>
          );
      }
      return (
        <>
            {/* Mobile View: Cards */}
            <div className="md:hidden">
                {docs.map((d) => <DocumentCard key={`${d.docType}-${d.id}`} doc={d} onPrint={() => handlePrint(d)} />)}
            </div>

            {/* Desktop View: Table */}
            <Card className="hidden md:block">
                <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Total (PKR)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {docs.map((d) => <DocumentRow key={`${d.docType}-${d.id}`} doc={d} onPrint={() => handlePrint(d)} />)}
                </TableBody>
                </Table>
            </Card>
        </>
      );
  };
  
  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><FileText className="w-8 h-8 mr-3"/>Documents</h1>
          <p className="text-muted-foreground">Search and manage all invoices and custom orders.</p>
        </div>
        <Button variant="outline" onClick={() => { setImportOpen(true); setImportFile(null); setImportPreview(null); setImportProgress([]); setImportDone(false); }}>
          <Upload className="w-4 h-4 mr-2" /> Import Shopify CSV
        </Button>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative flex-grow w-full">
                    <Input
                    type="search"
                    placeholder="Search by ID or Customer Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                </div>
                <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full md:w-auto md:justify-self-end" />
            </div>
        </CardContent>
      </Card>
      
      {/* Shopify CSV Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!isImporting) setImportOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Shopify Orders CSV</DialogTitle>
            <DialogDescription>
              Upload a Shopify orders export CSV. Each row becomes an invoice. Invoices are numbered sequentially from the last invoice number.
            </DialogDescription>
          </DialogHeader>

          {!importDone ? (
            <div className="space-y-4 py-2">
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {importFile ? importFile.name : 'Click to select CSV file'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {importPreview && (
                <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                  <p className="font-medium">{importPreview.rows} rows detected</p>
                  <p className="text-muted-foreground">First entries: {importPreview.firstNames.join(', ')}{importPreview.rows > 5 ? '…' : ''}</p>
                </div>
              )}

              {importProgress.length > 0 && (
                <div className="bg-muted rounded-md p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  {importProgress.map((msg, i) => <p key={i}>{msg}</p>)}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">Import Complete</p>
              <p className="text-muted-foreground text-sm">All invoices have been saved to Firestore.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={isImporting}>Cancel</Button>
            {!importDone && (
              <Button onClick={handleImport} disabled={!importFile || isImporting}>
                {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isImporting ? 'Importing…' : 'Import'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden QR code elements needed for PDF generation */}
      <div style={{ display: 'none' }}>
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
      </div>

      <Tabs defaultValue="all">
        <TabsList className="grid w-full grid-cols-4 md:w-fit md:grid-cols-4 mb-4">
          <TabsTrigger value="all">All ({filteredDocuments.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({filteredDocuments.filter(d => d.docType === 'invoice' && !isShopifyDoc(d)).length})</TabsTrigger>
          <TabsTrigger value="orders">Orders ({filteredDocuments.filter(d => d.docType === 'order').length})</TabsTrigger>
          <TabsTrigger value="shopify" className="flex items-center gap-1">
            <ShoppingBag className="h-3 w-3" /> Shopify ({filteredDocuments.filter(d => isShopifyDoc(d)).length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          {renderContent(filteredDocuments)}
        </TabsContent>
        <TabsContent value="invoices">
          {renderContent(filteredDocuments.filter(d => d.docType === 'invoice' && !isShopifyDoc(d)))}
        </TabsContent>
        <TabsContent value="orders">
          {renderContent(filteredDocuments.filter(d => d.docType === 'order'))}
        </TabsContent>
        <TabsContent value="shopify">
          {renderContent(filteredDocuments.filter(d => isShopifyDoc(d)))}
        </TabsContent>
      </Tabs>
      
    </div>
  );
}
