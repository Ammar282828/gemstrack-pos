"use client";

import { useParams } from 'next/navigation';
import { InvoiceViewer } from '@/components/invoice/invoice-viewer';

/** An invoice, for the shop. The customer's page is /view-invoice/<id>. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceViewer key={id} invoiceId={decodeURIComponent(id)} />;
}
