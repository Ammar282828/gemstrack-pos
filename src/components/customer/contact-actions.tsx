'use client';

/**
 * The one Contact control, wherever a customer appears (lib/customer-contact.ts has the rules): the
 * customer's page, an invoice, an order, a repair, an online order, a hisaab. In this order:
 *
 *   Call · WhatsApp · Message · [Send PDF — invoice/order] · More (Share PDF…, Copy number)
 *
 * Send PDF sends the document's PDF to the customer on WhatsApp from this house's own line
 * (/api/app/whatsapp/send-doc), after a sheet that shows the number (changeable) and, for an invoice of
 * several pieces, offers one invoice per piece. Where no line is connected the answer says so and the
 * page's own link send is offered instead. No number on file: "Add phone" (the customer's edit page).
 * A walk-in has nobody to call: only the document's actions.
 */

import * as React from 'react';
import { Copy, FileText, MessageCircle, MessageSquare, MoreHorizontal, Phone, Send, Share2, UserPlus, CircleUser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { contactHrefs, isWalkInContact } from '@/lib/customer-contact';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { QuickAction } from '@/components/ledger/quick-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContactPickButton } from '@/components/shared/contact-pick-button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface ContactDoc {
  kind: 'invoice' | 'order';
  id: string;
  /** An invoice's piece count: more than one offers "one invoice per piece". */
  pieces?: number;
  /** Share PDF…: the page's own Print / Save (the device's share sheet or a download). */
  onShare?: () => void;
  /** No line connected: the page's own way, WhatsApp on this device with a link or message. */
  onLinkFallback?: (phone: string) => void;
  /** After a send, with what the server noted on the document. */
  onSent?: (sent: { at: string; to: string; by: string; fileName: string }) => void;
  /** "Sent 2 Nov" under the button, from the document's `sentOnWhatsApp`. */
  sentAt?: string | null;
}

export interface CustomerContactProps {
  phone: string | null | undefined;
  customerId?: string | null;
  customerName?: string | null;
  /** The invoice or order this page is about, for its Send PDF and Share PDF. */
  doc?: ContactDoc;
  /** What WhatsApp and Message open with, typed and ready to change or send (lib/customer-messages.ts). */
  message?: string;
  className?: string;
}

/** The tile look of QuickAction, as a button. */
type TileProps = { icon: React.ReactNode; label: string; prominent?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;
const TileButton = React.forwardRef<HTMLButtonElement, TileProps>(function TileButton({ icon, label, prominent, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" {...rest} className={cn('group flex min-w-0 flex-1 flex-col items-center gap-1 focus-visible:outline-none disabled:opacity-50', className)}>
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-full items-center justify-center rounded-tile transition-opacity group-active:opacity-70 group-focus-visible:ring-2 group-focus-visible:ring-primary/40 [&>svg]:h-5 [&>svg]:w-5',
          prominent ? 'bg-primary text-primary-foreground' : 'bg-primary/[.12] text-primary',
        )}
      >
        {icon}
      </span>
      <span className="text-2xs font-medium text-foreground">{label}</span>
    </button>
  );
});

export function CustomerContact({ phone, customerId, customerName, doc, message, className }: CustomerContactProps) {
  const { toast } = useToast();
  const walkIn = isWalkInContact({ customerId, customerName });
  const hrefs = walkIn ? null : contactHrefs(phone, message);
  const [asking, setAsking] = React.useState(false);

  const copy = async () => {
    if (!hrefs) return;
    try {
      await navigator.clipboard.writeText(hrefs.e164);
      toast({ title: 'Number copied', description: hrefs.e164 });
    } catch {
      toast({ title: 'Could not copy', description: hrefs.e164, variant: 'destructive' });
    }
  };

  const more = (doc?.onShare || hrefs) ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TileButton icon={<MoreHorizontal />} label="More" aria-label="More contact actions" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {doc?.onShare && <DropdownMenuItem onSelect={() => doc.onShare?.()}><Share2 className="mr-2 h-4 w-4" />Share PDF…</DropdownMenuItem>}
        {hrefs && <DropdownMenuItem onSelect={copy}><Copy className="mr-2 h-4 w-4" />Copy number</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  if (!hrefs && !doc && !(customerId && !walkIn)) return null;
  return (
    <>
      <div className={cn('flex gap-3', className)}>
        {hrefs ? (
          <>
            <QuickAction icon={<Phone />} label="Call" href={hrefs.tel} prominent={!doc} />
            <QuickAction icon={<MessageCircle />} label="WhatsApp" href={hrefs.whatsapp} />
            <QuickAction icon={<MessageSquare />} label="Message" href={hrefs.sms} />
          </>
        ) : !walkIn && customerId ? (
          <QuickAction icon={<UserPlus />} label="Add phone" href={`/customers/${encodeURIComponent(customerId)}/edit`} />
        ) : null}
        {doc && (
          <TileButton
            icon={doc.kind === 'invoice' ? <FileText /> : <Send />}
            label={doc.sentAt ? 'Send again' : 'Send PDF'}
            onClick={() => setAsking(true)}
            prominent
          />
        )}
        {more}
      </div>
      {doc && (
        <SendDocDialog
          open={asking}
          onOpenChange={setAsking}
          doc={doc}
          phone={hrefs?.e164 ?? (walkIn ? String(phone || '') : '')}
          customerName={walkIn ? null : customerName}
          onFallback={(n) => {
            if (doc.onLinkFallback) doc.onLinkFallback(n);
            else { const h = contactHrefs(n); if (h) window.open(h.whatsapp, '_blank'); }
          }}
        />
      )}
    </>
  );
}

/**
 * The confirm sheet: what goes, to which number (changeable), per piece for an invoice of several; then the
 * send from the shop's line. Exported for a page that has its own Send button (the invoice viewer's).
 */
export function SendDocDialog({ open, onOpenChange, doc, phone, customerName, onFallback }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: ContactDoc;
  phone: string;
  customerName?: string | null;
  onFallback: (phone: string) => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = React.useState(phone);
  const [perPiece, setPerPiece] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  React.useEffect(() => { if (open) { setTo(phone); setPerPiece(false); } }, [open, phone]);
  const what = doc.kind === 'invoice' ? 'invoice' : 'order';

  const send = async () => {
    if (sending) return;
    if (!contactHrefs(to)) { toast({ title: 'Enter a WhatsApp number', description: 'With its country code, or a Pakistani 03… number.', variant: 'destructive' }); return; }
    setSending(true);
    try {
      const res = await authedFetch('/api/app/whatsapp/send-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: doc.kind, id: doc.id, to, perPiece: doc.kind === 'invoice' && perPiece }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; fallback?: string; to?: string; at?: string; by?: string; fileName?: string };
      if (!res.ok) {
        const typed = to;
        toast({
          title: 'Could not send the PDF',
          description: res.status === 401 ? 'Sign in with Google to send from the shop’s WhatsApp.' : data.error || `Failed (${res.status})`,
          variant: 'destructive',
          ...(data.fallback === 'link' || res.status >= 500
            ? { action: <ToastAction altText="Open WhatsApp on this device instead" onClick={() => onFallback(typed)}>Send a link</ToastAction> }
            : {}),
        });
        return;
      }
      onOpenChange(false);
      doc.onSent?.({ at: data.at!, to: contactHrefs(to)?.e164 ?? to, by: data.by!, fileName: data.fileName! });
      toast({ title: `Sent to ${customerName || data.to}`, description: `${data.fileName} — on WhatsApp, from the shop’s number.` });
    } catch (e) {
      toast({ title: 'Could not send the PDF', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send {what} PDF on WhatsApp</DialogTitle>
          <DialogDescription>
            {doc.id} goes as a PDF from the shop’s own WhatsApp number{customerName ? ` to ${customerName}` : ''}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="send-doc-to">WhatsApp number</Label>
            <div className="flex items-center gap-1">
              <Input id="send-doc-to" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" value={to} onChange={(e) => setTo(e.target.value)} />
              <ContactPickButton onPick={pick => { if (pick.phone) setTo(pick.phone); }} />
            </div>
          </div>
          {doc.kind === 'invoice' && (doc.pieces ?? 0) > 1 && (
            <label className="flex items-center gap-2 text-ios-foot">
              <Checkbox checked={perPiece} onCheckedChange={(v) => setPerPiece(v === true)} />
              One invoice per piece ({doc.pieces} pages)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={send} disabled={sending}><Send className="mr-2 h-4 w-4" />{sending ? 'Sending…' : 'Send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same Contact actions as a compact menu, for a row in a list (a repair ticket, an online order):
 * Call, WhatsApp, Message, Copy number, in that order. Nothing for a walk-in or without a number.
 */
export function ContactMenu({ phone, customerId, customerName, message, className }: {
  phone: string | null | undefined;
  customerId?: string | null;
  customerName?: string | null;
  /** Words already written into the WhatsApp chat (a "your repair is ready"). */
  message?: string;
  className?: string;
}) {
  const { toast } = useToast();
  const hrefs = isWalkInContact({ customerId, customerName: customerName ?? (phone ? 'customer' : null) }) ? null : contactHrefs(phone, message);
  if (!hrefs) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={cn('h-8', className)} aria-label={`Contact ${customerName || hrefs.e164}`}>
          <CircleUser className="mr-1.5 h-3.5 w-3.5" />Contact
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><a href={hrefs.tel}><Phone className="mr-2 h-4 w-4" />Call</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={hrefs.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={hrefs.sms}><MessageSquare className="mr-2 h-4 w-4" />Message</a></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { navigator.clipboard.writeText(hrefs.e164).then(() => toast({ title: 'Number copied', description: hrefs.e164 }), () => toast({ title: 'Could not copy', description: hrefs.e164, variant: 'destructive' })); }}>
          <Copy className="mr-2 h-4 w-4" />Copy number
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
